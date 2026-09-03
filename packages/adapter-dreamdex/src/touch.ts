import type { SomniaMarketsClient } from '@somnia-chain/markets-sdk';

import { withSomniaClient, type SomniaConfig } from './somnia.js';

/**
 * The live top of book, read from the pool contract.
 *
 * This is deliberately **not** `LiveAdapter.getQuote`, and the difference is the whole
 * reason this file exists. `getQuote` reconstructs the book as it stood at the block of a
 * past fill, because `SCORING_SPEC.md` §2 wants the mid a trader actually faced when they
 * traded. That is the right number for scoring and the wrong number for quoting: on a market
 * that has not traded for a while it can be minutes or hours stale, and an order priced
 * against it is priced against history.
 *
 * The first real order this repository sent was refused with `PostOnlyWouldCross()` for
 * exactly that reason — a resting bid two ticks under a reconstructed best bid of 0.623,
 * placed into a live book whose ask had since fallen through it.
 *
 * So: reconstruct to score, read the contract to trade.
 */

export interface LiveTouch {
  readonly marketId: string;
  readonly pool: string;
  /** Somnia's MarketStatus: 0 Listed, 1 Trading, 2 Locked, 3 Settling, 4 Resolved, 5 Voided. */
  readonly status: number;
  readonly windowEnd: number;
  /** Best resting bid and ask in UP terms, and their midpoint. Null when a side is empty. */
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
  /** The pool's own grid, so a caller can size and price onto it. */
  readonly tickSize: bigint;
  readonly lotSize: bigint;
  readonly minQuantity: bigint;
  readonly decimals: number;
}

/** One-shot: opens a client, reads, closes. A loop should use {@link readTouchWith}. */
export async function readLiveTouch(config: SomniaConfig, marketId: string): Promise<LiveTouch> {
  return withSomniaClient(config, (client) => readTouchWith(client, marketId));
}

/**
 * Reads through a client the caller already holds.
 *
 * A loop wants this one. Opening a client per read churns a WebSocket per market, which the
 * venue starts refusing — and it surfaces as "WebSocket request failed" on every touch,
 * which reads as an outage rather than as this process opening far too many sockets.
 */
export async function readTouchWith(
  client: SomniaMarketsClient,
  marketId: string,
): Promise<LiveTouch> {
  const onchain = await client.getMarketOnchain(marketId as `0x${string}`);
  const [book, params] = await Promise.all([
    client.getBinaryOrderBook(onchain.pool, { decimals: onchain.decimals }),
    client.getBinaryBookParams(onchain.pool),
  ]);

  const scale = 10 ** onchain.decimals;
  const bid = book.yesBids[0]?.price;
  const ask = book.yesAsks[0]?.price;
  const bestBidUp = bid === undefined ? null : Number(bid) / scale;
  const bestAskUp = ask === undefined ? null : Number(ask) / scale;

  return {
    marketId,
    pool: onchain.pool,
    status: onchain.status,
    windowEnd: Number(onchain.expiry) * 1000,
    bestBidUp,
    bestAskUp,
    // A mid needs both sides. One-sided is reported as null rather than as the one price
    // that happens to be there, which would read as a market consensus that does not exist.
    midUp: bestBidUp === null || bestAskUp === null ? null : (bestBidUp + bestAskUp) / 2,
    tickSize: params.tickSize,
    lotSize: params.lotSize,
    minQuantity: params.minQuantity,
    decimals: onchain.decimals,
  };
}

/**
 * Top of book for many markets in one indexer round-trip.
 *
 * The per-market path above costs two chain calls each, and a loop reading six markets every
 * forty-five seconds exhausted the WebSocket: every touch came back "WebSocket request
 * failed" while a fresh process read the same market fine. This asks the indexer instead —
 * one HTTP request for the whole list, no socket, no fan-out.
 *
 * What it gives up is the on-chain status gate, and that is safe to give up *here* because
 * it is not where the gate matters: `SomniaWriter.placeOrder` reads the chain's own status
 * immediately before signing and refuses anything not Trading. This read prices an order;
 * that read decides whether it may be sent.
 *
 * Markets with an empty book are absent from the result rather than present with nulls.
 */
export async function readBookTops(
  client: SomniaMarketsClient,
  marketIds: readonly string[],
): Promise<Map<string, TopOfBook>> {
  if (marketIds.length === 0) return new Map();
  const raw = await client.getBookTops([...marketIds]);

  const tops = new Map<string, TopOfBook>();
  for (const [marketId, top] of Object.entries(raw)) {
    const bestBidUp = scaled(top.bestBid);
    const bestAskUp = scaled(top.bestAsk);
    tops.set(marketId.toLowerCase(), {
      bestBidUp,
      bestAskUp,
      // Recomputed rather than taken from `mid`, which the venue floors to a whole raw unit.
      midUp: bestBidUp === null || bestAskUp === null ? null : (bestBidUp + bestAskUp) / 2,
    });
  }
  return tops;
}

export interface TopOfBook {
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
}

/**
 * Raw quote units to a probability. Six decimals is the Shannon collateral scale, which this
 * project targets exclusively — the same assumption `MIN_STAKE_BASE` records in
 * `packages/core/src/constants.ts`, and wrong by 10^12 on an 18-decimal venue.
 */
const QUOTE_SCALE = 1_000_000;

const scaled = (raw: string | null): number | null =>
  raw === null ? null : Number(raw) / QUOTE_SCALE;
