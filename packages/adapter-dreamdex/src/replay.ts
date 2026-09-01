import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  MalformedPayloadError,
  UnsupportedOperationError,
  type DreamDexAdapter,
  type StreamOpts,
} from './adapter.js';
import {
  canonicalMarketJson,
  canonicalSettlementJson,
  canonicalTradeJson,
  type CanonicalMarket,
  type CanonicalOrder,
  type CanonicalOrderResult,
  type CanonicalQuote,
  type CanonicalSettlement,
  type CanonicalTrade,
} from './canonical.js';

export interface ReplayData {
  readonly markets: readonly CanonicalMarket[];
  readonly trades: readonly CanonicalTrade[];
  readonly settlements: readonly CanonicalSettlement[];
}

/**
 * A first-class adapter backed by files, not a mock. The demo and most tests run against
 * it, so it goes through the same Zod schemas as a live payload would — a fixture that
 * drifts from the canonical contract must fail here rather than downstream.
 *
 * Recorded timing is collapsed to zero delay: events are yielded in order, immediately.
 */
export class ReplayAdapter implements DreamDexAdapter {
  private readonly data: ReplayData;

  constructor(data: ReplayData) {
    this.data = {
      markets: [...data.markets].sort((a, b) => compare(a.marketId, b.marketId)),
      trades: [...data.trades].sort(
        (a, b) => a.timestamp - b.timestamp || compare(a.tradeId, b.tradeId),
      ),
      settlements: [...data.settlements].sort(
        (a, b) => a.settledAt - b.settledAt || compare(a.marketId, b.marketId),
      ),
    };
  }

  static async fromDirectory(directory: string): Promise<ReplayAdapter> {
    const [markets, trades, settlements] = await Promise.all([
      readJsonArray(join(directory, 'markets.json'), canonicalMarketJson),
      readJsonArray(join(directory, 'trades.json'), canonicalTradeJson),
      readJsonArray(join(directory, 'settlements.json'), canonicalSettlementJson),
    ]);
    return new ReplayAdapter({ markets, trades, settlements });
  }

  async *streamTrades(opts: StreamOpts): AsyncIterable<CanonicalTrade> {
    for (const trade of this.data.trades) {
      if (withinWindow(trade.timestamp, opts)) yield trade;
    }
  }

  async *streamSettlements(opts: StreamOpts): AsyncIterable<CanonicalSettlement> {
    for (const settlement of this.data.settlements) {
      if (withinWindow(settlement.settledAt, opts)) yield settlement;
    }
  }

  listMarkets(): Promise<CanonicalMarket[]> {
    return Promise.resolve([...this.data.markets]);
  }

  /**
   * Fixtures record no order book, so there is no mid to report. The most recent trade at
   * or before `at` is returned as `lastUp` and `midUp` stays null, which is the honest
   * degradation SCORING_SPEC.md section 2 asks for rather than a fabricated spread.
   */
  getQuote(marketId: string, at: number): Promise<CanonicalQuote> {
    let lastUp: number | null = null;
    for (const trade of this.data.trades) {
      if (trade.marketId !== marketId) continue;
      if (trade.timestamp > at) break;
      lastUp = trade.impliedProbUp;
    }
    return Promise.resolve({
      marketId,
      bestBidUp: null,
      bestAskUp: null,
      midUp: null,
      lastUp,
      timestamp: at,
    });
  }

  placeOrder(order: CanonicalOrder): Promise<CanonicalOrderResult> {
    throw new UnsupportedOperationError(
      `placeOrder(${order.clientOrderId})`,
      'ReplayAdapter reads recorded history and cannot write to a venue',
    );
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const withinWindow = (at: number, opts: StreamOpts): boolean =>
  (opts.since === undefined || at >= opts.since) && (opts.until === undefined || at < opts.until);

async function readJsonArray<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MalformedPayloadError(path, error instanceof Error ? error.message : 'invalid JSON');
  }
  const result = z.array(schema).safeParse(parsed);
  if (!result.success) {
    throw new MalformedPayloadError(path, z.prettifyError(result.error));
  }
  return result.data;
}
