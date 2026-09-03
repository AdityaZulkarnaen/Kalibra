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
  /** Live top of book, read from the pool contract rather than reconstructed. */
  touch(marketId: string): Promise<{
    bestBidUp: number | null;
    bestAskUp: number | null;
    midUp: number | null;
    status: number;
  }>;
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

/** Somnia's MarketStatus: 1 is Trading. Anything else cannot take an order. */
const STATUS_TRADING = 1;

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

    for (const market of tradeable) {
      const view = await this.viewOf(market, at);
      if (view === null) continue;

      for (const strategy of strategies) {
        const intent = strategy.decide(view);
        if (intent === null) continue;
        const limitProb = this.priceFor(intent, view);
        // No edge left once the achievable price is used instead of the mid. Not an error:
        // the strategy had a view and the book had already taken it.
        if (limitProb === null) continue;
        submitted += 1;
        const outcome = await this.send(strategy, intent, view, limitProb);
        if (outcome === 'ALLOW') allowed += 1;
        else if (outcome === 'DENY') denied += 1;
        else failed += 1;
      }
    }

    return { considered: tradeable.length, submitted, allowed, denied, failed };
  }

  /** Null when the market cannot be read or is not actually open on-chain. */
  private async viewOf(market: CanonicalMarket, at: number): Promise<MarketView | null> {
    let touch: Awaited<ReturnType<Venue['touch']>>;
    try {
      touch = await this.options.venue.touch(market.marketId);
    } catch (cause) {
      this.log({ event: 'touch_failed', marketId: market.marketId, error: describe(cause) });
      return null;
    }
    // Gotcha 1: the indexer lags, so the chain's status is the gate, not the row.
    if (touch.status !== STATUS_TRADING) return null;

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
    view: MarketView,
    limitProb: number,
  ): Promise<'ALLOW' | 'DENY' | 'FAILED'> {
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

export const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);
