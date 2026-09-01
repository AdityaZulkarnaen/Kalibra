import { KalibraError } from '@kalibra/core';

import type {
  CanonicalMarket,
  CanonicalOrder,
  CanonicalOrderResult,
  CanonicalQuote,
  CanonicalSettlement,
  CanonicalTrade,
} from './canonical.js';

/**
 * Bounds for a stream read, in ms since epoch UTC. Both are inclusive of the lower bound
 * and exclusive of the upper, matching the half-open convention used everywhere else.
 *
 * Not specified in DREAMDEX_ADAPTER.md; chosen here and documented because a stream with
 * no bounds cannot be resumed after a reconnect (ARCHITECTURE.md section 7).
 */
export interface StreamOpts {
  readonly since?: number;
  readonly until?: number;
}

/**
 * The airlock. DREAMDEX_ADAPTER.md section 2: nothing outside this package may know the
 * venue exists, and everything downstream consumes only the canonical types.
 */
export interface DreamDexAdapter {
  streamTrades(opts: StreamOpts): AsyncIterable<CanonicalTrade>;
  streamSettlements(opts: StreamOpts): AsyncIterable<CanonicalSettlement>;
  listMarkets(): Promise<CanonicalMarket[]>;
  getQuote(marketId: string, at: number): Promise<CanonicalQuote>;
  placeOrder(order: CanonicalOrder): Promise<CanonicalOrderResult>;
}

/**
 * Raised when an adapter is asked for something its backing source cannot do — a replay
 * of recorded history cannot place an order into a market that has already settled.
 *
 * It throws rather than returning `accepted: false`, because a rejection result would be
 * indistinguishable from a real venue refusal and would quietly turn a wiring mistake
 * into a plausible-looking business outcome.
 */
export class UnsupportedOperationError extends KalibraError {
  constructor(operation: string, reason: string) {
    super('UNSUPPORTED_OPERATION', `${operation} is not supported: ${reason}`);
  }
}

/** Raised when a fixture or a venue payload fails its schema. Never coerce, never crash. */
export class MalformedPayloadError extends KalibraError {
  constructor(source: string, detail: string) {
    super('MALFORMED_PAYLOAD', `${source} failed validation: ${detail}`);
  }
}
