import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { KalibraDatabase } from './migrate.js';
import { calibrationBins, markets, positions, scores, trades } from './schema.js';

/**
 * Reads and writes for the aggregation and scoring pass. Still no arithmetic: this file
 * moves rows, `packages/core` decides what they mean.
 */

export interface AggregatableTradeRow {
  readonly tradeId: string;
  readonly wallet: string;
  readonly marketId: string;
  readonly side: 'UP' | 'DOWN';
  readonly impliedProbUp: number;
  readonly quoteSource: 'MID' | 'LAST';
  readonly stake: bigint;
  readonly timestamp: number;
}

export interface MarketResolutionRow {
  readonly marketId: string;
  readonly outcome: 'UP' | 'DOWN' | 'VOID' | null;
  readonly settledAt: number | null;
}

export interface PositionWrite {
  readonly positionId: string;
  readonly wallet: string;
  readonly marketId: string;
  readonly side: string;
  readonly netStake: bigint;
  readonly p: number;
  readonly rawP: number;
  readonly quoteSource: string;
  readonly lambda: number | null;
  readonly forecast: number | null;
  readonly outcomeY: 0 | 1 | null;
  readonly excludedReason: string | null;
  readonly enteredAt: number;
  readonly settledAt: number | null;
}

export interface ScoreWrite {
  readonly wallet: string;
  readonly n: number;
  readonly bsTrader: number | null;
  readonly bsMarket: number | null;
  readonly bss: number | null;
  readonly bssShrunk: number | null;
  readonly eceTrader: number | null;
  readonly eceMarket: number | null;
  readonly eceExcess: number | null;
  readonly auc: number | null;
  readonly score: number | null;
  readonly scoreInternal: number;
  readonly status: string;
  readonly excludedCount: number;
  readonly paramsHash: string;
  readonly computedAt: number;
}

export interface CalibrationBinWrite {
  readonly binIndex: number;
  readonly count: number;
  readonly meanForecast: number | null;
  readonly observedFreq: number | null;
}

export function loadTradesForAggregation(db: KalibraDatabase): AggregatableTradeRow[] {
  return db
    .select({
      tradeId: trades.tradeId,
      wallet: trades.wallet,
      marketId: trades.marketId,
      side: trades.side,
      impliedProbUp: trades.impliedProbUp,
      quoteSource: trades.quoteSource,
      stake: trades.stake,
      timestamp: trades.timestamp,
    })
    .from(trades)
    .all()
    .map((row) => ({
      ...row,
      side: row.side as 'UP' | 'DOWN',
      quoteSource: row.quoteSource as 'MID' | 'LAST',
      stake: BigInt(row.stake),
    }));
}

export function loadMarketResolutions(db: KalibraDatabase): MarketResolutionRow[] {
  return db
    .select({ marketId: markets.marketId, outcome: markets.outcome, settledAt: markets.settledAt })
    .from(markets)
    .all()
    .map((row) => ({ ...row, outcome: row.outcome as 'UP' | 'DOWN' | 'VOID' | null }));
}

/**
 * Replaces a position wholesale. Aggregation is a pure function of the trades, so a rerun
 * must overwrite rather than accumulate; the derived `position_id` keeps that idempotent.
 */
export function upsertPosition(db: KalibraDatabase, row: PositionWrite): void {
  db.insert(positions)
    .values({ ...row, netStake: row.netStake.toString() })
    .onConflictDoUpdate({
      target: positions.positionId,
      set: {
        side: row.side,
        netStake: row.netStake.toString(),
        p: row.p,
        rawP: row.rawP,
        quoteSource: row.quoteSource,
        lambda: row.lambda,
        forecast: row.forecast,
        outcomeY: row.outcomeY,
        excludedReason: row.excludedReason,
        enteredAt: row.enteredAt,
        settledAt: row.settledAt,
      },
    })
    .run();
}

export function upsertScore(db: KalibraDatabase, row: ScoreWrite): void {
  db.insert(scores)
    .values(row)
    .onConflictDoUpdate({ target: scores.wallet, set: { ...row } })
    .run();
}

/** All ten bins are rewritten together; a partial curve would read as a real gap. */
export function replaceCalibrationBins(
  db: KalibraDatabase,
  wallet: string,
  bins: readonly CalibrationBinWrite[],
): void {
  db.delete(calibrationBins).where(eq(calibrationBins.wallet, wallet)).run();
  if (bins.length === 0) return;
  db.insert(calibrationBins)
    .values(bins.map((bin) => ({ wallet, ...bin })))
    .run();
}

export function countScoredPositions(db: KalibraDatabase): number {
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(positions)
    .where(and(isNull(positions.excludedReason), isNotNull(positions.outcomeY)))
    .all();
  return row?.n ?? 0;
}

export function countExcludedPositions(db: KalibraDatabase): number {
  const [row] = db
    .select({ n: sql<number>`count(*)` })
    .from(positions)
    .where(isNotNull(positions.excludedReason))
    .all();
  return row?.n ?? 0;
}

export function listScores(db: KalibraDatabase): Array<typeof scores.$inferSelect> {
  return db.select().from(scores).orderBy(scores.wallet).all();
}

export function listPositions(db: KalibraDatabase): Array<typeof positions.$inferSelect> {
  return db.select().from(positions).orderBy(positions.positionId).all();
}
