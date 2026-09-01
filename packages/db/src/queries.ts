import { eq, sql } from 'drizzle-orm';

import type { KalibraDatabase } from './migrate.js';
import { markets, trades } from './schema.js';

/**
 * Typed writes for the ingestion path. No business logic lives here — the indexer decides
 * what to persist, this file decides how, and `packages/core` does the arithmetic.
 *
 * Every write is idempotent on a natural key from the source. A WebSocket reconnect will
 * replay messages, and over-fetching must be safe while under-fetching is not
 * (ARCHITECTURE.md section 3.1).
 */

/** Where a row entered the system. Guard-forwarded fills are distinguishable from feed. */
export type TradeSource = 'FEED' | 'ONCHAIN' | 'GUARD';

export interface MarketRow {
  readonly marketId: string;
  readonly underlying: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly strike: bigint | null;
  readonly strikeDecimals: number;
  readonly status: string;
}

export interface TradeRow {
  readonly tradeId: string;
  readonly marketId: string;
  readonly wallet: string;
  readonly side: string;
  readonly impliedProbUp: number;
  readonly quoteSource: string;
  readonly stake: bigint;
  readonly stakeDecimals: number;
  readonly timestamp: number;
  readonly txHash: string | null;
}

export interface SettlementRow {
  readonly marketId: string;
  readonly outcome: 'UP' | 'DOWN' | 'VOID';
  readonly settlementLevel: bigint | null;
  readonly settledAt: number;
  readonly txHash: string | null;
}

/** Inserts a market the first time it is seen. Later sightings do not overwrite it. */
export function insertMarket(db: KalibraDatabase, market: MarketRow): number {
  const result = db
    .insert(markets)
    .values({
      marketId: market.marketId,
      underlying: market.underlying,
      windowStart: market.windowStart,
      windowEnd: market.windowEnd,
      strike: market.strike === null ? null : market.strike.toString(),
      strikeDecimals: market.strikeDecimals,
      status: market.status,
    })
    .onConflictDoNothing()
    .run();
  return result.changes;
}

/**
 * Inserts a trade, ignoring one already present. `ingestedAt` is supplied by the caller
 * rather than read from a clock here, so a replay produces the same rows twice.
 */
export function insertTrade(
  db: KalibraDatabase,
  trade: TradeRow,
  source: TradeSource,
  ingestedAt: number,
): number {
  const result = db
    .insert(trades)
    .values({
      tradeId: trade.tradeId,
      marketId: trade.marketId,
      wallet: trade.wallet,
      side: trade.side,
      impliedProbUp: trade.impliedProbUp,
      quoteSource: trade.quoteSource,
      stake: trade.stake.toString(),
      stakeDecimals: trade.stakeDecimals,
      timestamp: trade.timestamp,
      txHash: trade.txHash,
      source,
      ingestedAt,
    })
    .onConflictDoNothing()
    .run();
  return result.changes;
}

/**
 * Records a settlement against its market.
 *
 * API_SPEC.md section 1 has no `settlements` table — the resolution lives in columns on
 * `markets` — so an unknown market has nowhere to go. Rather than fabricate a market row
 * from a settlement, this reports that nothing was applied and the caller warns. See the
 * contradiction noted in ARCHITECTURE.md section 3.1.
 */
export function applySettlement(db: KalibraDatabase, settlement: SettlementRow): boolean {
  const result = db
    .update(markets)
    .set({
      outcome: settlement.outcome,
      settlementLevel:
        settlement.settlementLevel === null ? null : settlement.settlementLevel.toString(),
      settledAt: settlement.settledAt,
      settleTxHash: settlement.txHash,
      status: settlement.outcome === 'VOID' ? 'VOID' : 'SETTLED',
    })
    .where(eq(markets.marketId, settlement.marketId))
    .run();
  return result.changes > 0;
}

export function countRows(db: KalibraDatabase, table: 'markets' | 'trades'): number {
  const target = table === 'markets' ? markets : trades;
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(target)
    .all();
  return row?.n ?? 0;
}

export function countSettledMarkets(db: KalibraDatabase): number {
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(markets)
    .where(sql`${markets.outcome} IS NOT NULL`)
    .all();
  return row?.n ?? 0;
}
