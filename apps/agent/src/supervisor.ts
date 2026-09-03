import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CanonicalMarket } from '@kalibra/adapter-dreamdex';

import type { Intent, MarketView, Strategy } from './strategy.js';

/**
 * The collection loop. Its job is not to trade well; it is to keep producing resolved
 * positions for two days without supervision.
 *
 * Everything here is written for that: a cycle that throws is logged and the next one runs,
 * no state is held that a restart would need, and every decision is appended to a log so the
 * morning check is a file read rather than a guess.
 */

export interface Venue {
  /** Live Event Contract windows, most recently active first. */
  listMarkets(): Promise<CanonicalMarket[]>;
  /**
   * Live top of book for the whole list in one read, rather than reconstructed and rather
   * than one call per market — the fan-out version exhausted the chain socket within
   * minutes of running.
   */
  tops(
    marketIds: readonly string[],
  ): Promise<
    Map<string, { bestBidUp: number | null; bestAskUp: number | null; midUp: number | null }>
  >;
}

export interface GuardClient {
  /** Rotates the allowlist. Operator-authenticated; no agent reaches it. */
  allowMarkets(marketIds: readonly string[]): Promise<void>;
  submit(
    agentId: string,
    order: {
      marketId: string;
      side: 'UP' | 'DOWN';
      stake: string;
      limitProb: number;
      clientOrderId: string;
      postOnly: boolean;
    },
  ): Promise<{ verdict: string; reason?: string; auditSeq: number; recorded: boolean }>;
}

export interface SupervisorOptions {
  readonly venue: Venue;
  readonly guard: GuardClient;
  readonly strategies: readonly Strategy[];
  readonly logPath: string;
  /** Skip a window closing sooner than this: it can lock between the read and the send. */
  readonly minHeadroomMs: number;
  /** Most markets one cycle will touch, so a cycle stays shorter than the interval. */
  readonly maxMarketsPerCycle: number;
  /** How far through the touch to bid, in probability. One tick is 0.001 on this venue. */
  readonly slippage: number;
  readonly now: () => number;
}

export interface CycleReport {
  readonly considered: number;
  readonly submitted: number;
  readonly allowed: number;
  readonly denied: number;
  readonly failed: number;
}

export class Supervisor {
  /**
   * Where each market's price stood when this process first saw it, so momentum has a
   * baseline. Deliberately in memory and deliberately not recovered on restart: a made-up
   * baseline would produce a confident forecast from nothing, and a strategy with no
   * baseline simply declines to trade until it has one.
   */
  private readonly openingProb = new Map<string, number>();

  /**
   * Client order ids must be unique for the life of the agent, not the life of the process.
   * A counter from zero regenerates the same id after a restart, and Guard correctly refuses
   * it as a duplicate — which reads as the agent malfunctioning rather than as the id being
   * reused. Seeding from the clock makes a restart continue the sequence instead.
   */
  private sequence = Date.now();

  constructor(private readonly options: SupervisorOptions) {
    mkdirSync(dirname(options.logPath), { recursive: true });
  }

  async runCycle(): Promise<CycleReport> {
    const { venue, guard, strategies, now, minHeadroomMs, maxMarketsPerCycle } = this.options;
    const at = now();

    const tradeable = (await venue.listMarkets())
      .filter((market) => market.status === 'OPEN' && market.windowEnd - at > minHeadroomMs)
      .sort((a, b) => a.windowEnd - b.windowEnd)
      .slice(0, maxMarketsPerCycle);

    // Deny by default still holds: the operator's own supervisor narrows the allowlist to
    // exactly the windows open right now, and every other market stays refused.
    await guard.allowMarkets(tradeable.map((market) => market.marketId));

    let submitted = 0;
    let allowed = 0;
    let denied = 0;
    let failed = 0;

    let tops: Awaited<ReturnType<Venue['tops']>>;
    try {
      tops = await venue.tops(tradeable.map((market) => market.marketId));
    } catch (cause) {
      this.log({ event: 'tops_failed', error: describe(cause) });
      return { considered: tradeable.length, submitted: 0, allowed: 0, denied: 0, failed: 1 };
    }

    for (const market of tradeable) {
      const view = this.viewOf(market, tops.get(market.marketId.toLowerCase()), at);
      if (view === null) continue;

      // The three agents are independent and sign from different wallets, so their orders
      // go out together rather than one waiting on the last one's chain write. Sequentially
      // a full cycle could need eighteen confirmations end to end, which outlived the
      // watchdog and got the whole cycle abandoned.
      const priced = strategies.flatMap((strategy) => {
        const intent = strategy.decide(view);
        if (intent === null) return [];
        const limitProb = this.priceFor(intent, view);
        // No edge left once the achievable price is used instead of the mid. Not an error:
        // the strategy had a view and the book had already taken it.
        if (limitProb === null) return [];
        return [{ strategy, intent, limitProb }];
      });

      submitted += priced.length;
      const outcomes = await Promise.all(
        priced.map((row) => this.send(row.strategy, row.intent, row.limitProb, view)),
      );
      for (const outcome of outcomes) {
        if (outcome === 'ALLOW') allowed += 1;
        else if (outcome === 'DENY') denied += 1;
        else failed += 1;
      }
    }

    return { considered: tradeable.length, submitted, allowed, denied, failed };
  }

  /**
   * Null when the market has no book to price against.
   *
   * There is no on-chain status gate here, and that is deliberate rather than an omission:
   * `SomniaWriter.placeOrder` reads the chain's own status immediately before signing and
   * refuses anything not Trading. This decides what to price; that decides what may be sent,
   * and it is the one that has to be right.
   */
  private viewOf(
    market: CanonicalMarket,
    top: { bestBidUp: number | null; bestAskUp: number | null; midUp: number | null } | undefined,
    at: number,
  ): MarketView | null {
    if (top === undefined) return null;
    const touch = top;

    const current = touch.midUp ?? touch.bestBidUp ?? touch.bestAskUp;
    if (current === null) return null;
    if (!this.openingProb.has(market.marketId)) this.openingProb.set(market.marketId, current);
    const opening = this.openingProb.get(market.marketId) ?? current;

    return {
      marketId: market.marketId,
      underlying: market.underlying,
      windowStart: market.windowStart,
      windowEnd: market.windowEnd,
      bestBidUp: touch.bestBidUp,
      bestAskUp: touch.bestAskUp,
      midUp: touch.midUp,
      probDriftSinceOpen: current - opening,
      now: at,
    };
  }

  /**
   * The price to actually bid, and whether the trade is worth making at it.
   *
   * A forecast is what the agent believes; a limit is what it is willing to pay. Setting the
   * limit to the forecast means offering the full value of the claim and keeping none of the
   * edge — and against a book that disagrees sharply it means paying far over the market. It
   * did: an agent that believed DOWN was worth 0.192 bid exactly that while the book was
   * selling DOWN at 0.038, filled instantly at five times the going rate, and ran through the
   * daily loss limit inside a minute.
   *
   * So the limit comes from the book, crossing the touch by one slippage step, and the trade
   * only happens when the belief still beats the price actually available.
   */
  private priceFor(intent: Intent, view: MarketView): number | null {
    const slip = this.options.slippage;
    if (intent.side === 'UP') {
      // Paying the ask in UP terms. Worth it only if UP is believed to be worth more.
      const ask = view.bestAskUp ?? view.midUp;
      if (ask === null) return null;
      if (intent.forecast <= ask) return null;
      return Math.min(0.99, ask + slip);
    }
    // A DOWN buyer pays 1 − bid. Worth it only if DOWN is believed to be worth more than that,
    // which is the same as the forecast for UP sitting below the bid.
    const bid = view.bestBidUp ?? view.midUp;
    if (bid === null) return null;
    if (intent.forecast >= bid) return null;
    return Math.max(0.01, bid - slip);
  }

  private async send(
    strategy: Strategy,
    intent: Intent,
    limitProb: number,
    view: MarketView,
  ): Promise<'ALLOW' | 'DENY' | 'FAILED'> {
    // Incremented before any await, so concurrent sends cannot draw the same number.
    this.sequence += 1;
    const clientOrderId = `${strategy.agentId}-${view.marketId.slice(-8)}-${this.sequence}`;
    try {
      const result = await this.options.guard.submit(strategy.agentId, {
        marketId: view.marketId,
        side: intent.side,
        stake: intent.stake.toString(),
        limitProb,
        clientOrderId,
        postOnly: intent.postOnly,
      });
      this.log({
        event: 'order',
        agentId: strategy.agentId,
        marketId: view.marketId,
        side: intent.side,
        forecast: intent.forecast,
        limitProb,
        marketProb: view.midUp,
        bestBidUp: view.bestBidUp,
        bestAskUp: view.bestAskUp,
        stake: intent.stake.toString(),
        verdict: result.verdict,
        reason: result.reason ?? null,
        auditSeq: result.auditSeq,
        recorded: result.recorded,
        rationale: intent.rationale,
      });
      return result.verdict === 'ALLOW' ? 'ALLOW' : 'DENY';
    } catch (cause) {
      // Guard unreachable, or the venue refused in a way that threw. Neither is a reason to
      // stop the loop; the next window is a fresh chance and nothing here is left half-done.
      this.log({
        event: 'submit_failed',
        agentId: strategy.agentId,
        marketId: view.marketId,
        error: describe(cause),
      });
      return 'FAILED';
    }
  }

  /** One JSON object per line, appended. The morning check reads this file. */
  private log(entry: Record<string, unknown>): void {
    appendFileSync(
      this.options.logPath,
      `${JSON.stringify({ at: new Date(this.options.now()).toISOString(), ...entry })}\n`,
      'utf8',
    );
  }
}

/**
 * Fails a promise that never settles.
 *
 * This is the difference between a run that survives two days and one that quietly stops.
 * The collection loop hung for two hours and nineteen minutes on a venue read that never
 * resolved and never rejected — no error, no exit, no cycle. A crash would have been visible
 * in the log and, being a supervised process, would have restarted. A hang is neither.
 *
 * Nothing here can assume a remote call terminates on its own.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms}ms`)), ms);
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

export const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);
