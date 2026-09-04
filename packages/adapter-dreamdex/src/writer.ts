import { UnsupportedOperationError } from './adapter.js';
import type { CanonicalOrder, CanonicalOrderResult } from './canonical.js';
import { openSomniaSession, type SomniaConfig, type SomniaSession } from './somnia.js';

/**
 * The write half of the airlock: a canonical order becomes a real transaction on Somnia.
 *
 * Reads and writes are separated because they have different requirements. Reading the venue
 * is permissionless and runs with no credential at all; writing needs a funded signer. Keeping
 * the signer here means `LiveAdapter` stays constructible — and testable — without one, and a
 * read path cannot accidentally acquire the ability to spend.
 *
 * Every step below is forced by documented venue behaviour, captured in
 * `fixtures/recorded/docs-snapshot-2026-09-01/developers_event-contracts_gotchas.md`.
 */

export interface WriterConfig extends SomniaConfig {
  readonly privateKey: `0x${string}`;
  /**
   * How long a resting order survives, in ms. Every binary order carries a mandatory expiry
   * and there is no "never": it is the dead-man's switch that ages a crashed bot's orders off
   * the book. Clamped to the market's own expiry by the pool, which rejects anything beyond it.
   */
  readonly orderTtlMs?: number;
  /**
   * Deadline for one placement, end to end.
   *
   * Nothing here may assume a remote call terminates. A venue read that never settles holds
   * the HTTP request that triggered it open, and the caller's loop with it — a hang stops a
   * run just as dead as a crash, without the log entry that would let anyone notice.
   */
  readonly timeoutMs?: number;
}

/** 2 — ImmediateOrCancel. 3 — PostOnly. From the SDK's own ORDER_TYPE. */
const ORDER_TYPE_IOC = 2;
const ORDER_TYPE_POST_ONLY = 3;

const DEFAULT_TTL_MS = 120_000;

/** Long enough for a slow confirmation, short enough that a wedged socket is not forever. */
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Rejects when `work` outlives `ms`. The underlying call is not cancelled — it cannot be —
 * so the caller drops the session afterwards rather than reusing whatever stopped answering.
 */
function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

/** Somnia's MarketStatus enum: 0 Listed, 1 Trading, 2 Locked, 3 Settling, 4 Resolved, 5 Voided. */
const STATUS_TRADING = 1;

const refused = (reason: string): CanonicalOrderResult => ({
  accepted: false,
  venueOrderId: null,
  txHash: null,
  rejectReason: reason,
});

export class SomniaWriter {
  /**
   * One session, reopened when it dies.
   *
   * A client per order looks tidier and does not survive a loop. Three agents placing ten
   * orders a cycle opened and closed thirty WebSockets a minute, and the venue stopped
   * answering: every forward came back "WebSocket request failed", which Guard correctly
   * recorded as UPSTREAM_UNAVAILABLE — thirty-two consecutive times, reading as an outage
   * rather than as this process opening far too many sockets.
   */
  private session: SomniaSession | null = null;

  constructor(private readonly config: WriterConfig) {}

  /** Releases the connection. A caller that forgets leaves the process alive. */
  async close(): Promise<void> {
    const dying = this.session;
    this.session = null;
    if (dying !== null) await dying.close().catch(() => undefined);
  }

  /**
   * Places one order and reports what the venue did with it.
   *
   * A refusal by the venue comes back as `accepted: false` with the venue's own words. A
   * failure to *reach* the venue throws, so that Guard records `UPSTREAM_UNAVAILABLE` and the
   * agent does not treat an unsent order as placed. The distinction matters: one is a
   * business outcome, the other is an unknown, and collapsing them loses the difference.
   */
  async placeOrder(order: CanonicalOrder): Promise<CanonicalOrderResult> {
    try {
      return await withDeadline(
        this.send(order),
        this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        `placing ${order.clientOrderId}`,
      );
    } catch (cause) {
      // A dead connection poisons every later write through it, so it is dropped here and the
      // next order opens a fresh one rather than retrying down the same pipe forever.
      if (!isRevert(cause)) await this.close();
      return toResult(cause);
    }
  }

  private async send(order: CanonicalOrder): Promise<CanonicalOrderResult> {
    this.session ??= await openSomniaSession({
      ...this.config,
      privateKey: this.config.privateKey,
    });
    const client = this.session.client;

    const onchain = await client.getMarketOnchain(order.marketId as `0x${string}`);
    // Gotcha 1: the indexer lags. An order on a market that just locked reverts, or worse
    // appears to succeed, so the gate is the chain's own status and never the indexer row.
    if (onchain.status !== STATUS_TRADING) {
      return refused(`market status is ${onchain.status}, not Trading`);
    }

    const book = await client.getBinaryBookParams(onchain.pool);
    const sized = quantise(order, onchain.decimals, book);
    if (sized === null) {
      // Gotcha 6: anything under one lot floors to zero and the pool takes an order for
      // nothing. Skipping is the honest outcome; sending it would burn gas to learn this.
      return refused('quantity rounds below the venue lot or minimum');
    }

    // Gotcha 5b: the pool rejects an expiry past the market's own close, and the TTL is a
    // wall-clock duration that knows nothing about which market it is for. A window with
    // less time left than the TTL therefore reverts — every time, with a message that names
    // parameters and not the reason. Clamping here is what makes an order near the close
    // legal rather than a certain revert.
    const expireAt = expiryNs(this.config.orderTtlMs ?? DEFAULT_TTL_MS, onchain.expiry);
    if (expireAt === null) return refused('the market closes before an order could live');

    const trader = client.createTrader({ privateKey: this.config.privateKey });
    const result = await trader.placeOrder({
      pool: onchain.pool,
      side: order.side === 'UP' ? 'BUY_YES' : 'BUY_NO',
      price: sized.price,
      quantity: sized.quantity,
      orderType: order.postOnly === true ? ORDER_TYPE_POST_ONLY : ORDER_TYPE_IOC,
      expireTimestampNs: expireAt,
    });

    return {
      accepted: true,
      venueOrderId: result.orderId?.toString() ?? null,
      txHash: result.hash.toLowerCase(),
      rejectReason: null,
    };
  }
}

/** A revert is the venue answering, so the connection is fine and worth keeping. */
const isRevert = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === 'ContractRevertError';

/**
 * A decoded contract revert is the venue refusing, which is a result. Anything else — an RPC
 * that never answered, a socket that dropped — is not a refusal and must not be reported as
 * one, so it propagates and Guard logs it as upstream unavailability.
 */
function toResult(cause: unknown): CanonicalOrderResult {
  const name = cause instanceof Error ? cause.name : '';
  const message = cause instanceof Error ? cause.message : String(cause);
  if (name === 'ContractRevertError') return refused(message);
  throw cause;
}

interface Sized {
  readonly price: bigint;
  readonly quantity: bigint;
}

interface BookGrid {
  readonly tickSize: bigint;
  readonly lotSize: bigint;
  readonly minQuantity: bigint;
}

/**
 * Canonical units to the venue's grid.
 *
 * `stake` is the collateral the order risks and `quantity` is outcome tokens, which are not
 * the same number. A buyer of UP at probability p pays p per token, so a stake of s buys s/p
 * tokens; a buyer of DOWN pays the complement and buys s/(1−p). This is the inverse of the
 * split `toCanonicalTrades` applies when reading fills back, and the two must agree or a
 * position's size would change meaning between being placed and being scored.
 */
export function quantise(order: CanonicalOrder, decimals: number, book: BookGrid): Sized | null {
  const one = 10 ** decimals;
  // A market order still needs a price: it is an IOC at the extreme, which crosses whatever
  // is there and cancels the rest. The extreme in UP terms is 1 for a buyer of UP and 0 for
  // a buyer of DOWN, each one tick inside the boundary so the pool accepts it.
  const probUp = order.limitProb ?? (order.side === 'UP' ? 1 : 0);
  const pricePerToken = order.side === 'UP' ? probUp : 1 - probUp;
  if (pricePerToken <= 0) return null;

  const price = snap(BigInt(Math.round(probUp * one)), book.tickSize, one);
  if (price === null) return null;

  const tokens = Number(order.stake) / pricePerToken;
  const quantity = (BigInt(Math.floor(tokens)) / book.lotSize) * book.lotSize;
  if (quantity < book.minQuantity || quantity === 0n) return null;
  return { price, quantity };
}

/** Snap to the tick grid, then hold the result one tick inside (0, 1) — the pool's own range. */
function snap(raw: bigint, tickSize: bigint, one: number): bigint | null {
  if (tickSize <= 0n) return null;
  const snapped = (raw / tickSize) * tickSize;
  const floor = tickSize;
  const ceiling = BigInt(one) - tickSize;
  if (ceiling < floor) return null;
  return snapped < floor ? floor : snapped > ceiling ? ceiling : snapped;
}

/**
 * Gotcha 5: nanoseconds, in the future, and never 0 — that reverts as already expired. And
 * never past the market's own close, which the pool rejects outright.
 *
 * `marketExpirySeconds` is the chain's `Trading-close / settlement timestamp`. The result is
 * held a second inside it, because an expiry landing exactly on the boundary is the one case
 * where "at or past" and "past" disagree and the pool decides which.
 *
 * Null when there is no future left to give the order, which is a refusal rather than a
 * clamp: sending an already-dead order burns gas to learn what was knowable here.
 */
export function expiryNs(
  ttlMs: number,
  marketExpirySeconds: bigint,
  now = Date.now(),
): bigint | null {
  const marketCloses = Number(marketExpirySeconds) * 1000 - 1000;
  const at = Math.min(now + ttlMs, marketCloses);
  if (at <= now) return null;
  return BigInt(at) * 1_000_000n;
}

/** Raised when a write is attempted with no signer configured. */
export const noSignerError = (clientOrderId: string): UnsupportedOperationError =>
  new UnsupportedOperationError(
    `placeOrder(${clientOrderId})`,
    'this adapter was built without a signer, so it can read the venue but not write to it',
  );
