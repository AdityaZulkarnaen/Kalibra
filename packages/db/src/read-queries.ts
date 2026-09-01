import { sql } from 'drizzle-orm';

import type { KalibraDatabase } from './migrate.js';

/**
 * Read paths for the public API. Raw SQL where an aggregate is involved, because the query
 * a reviewer wants to read is the SQL itself (ARCHITECTURE.md section 4).
 *
 * Nothing here computes a score. Everything returned was written by the pipeline.
 */

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

export interface LeaderboardRow {
  readonly wallet: string;
  readonly score: number | null;
  readonly status: string;
  readonly n: number;
  readonly bss: number | null;
  readonly eceExcess: number | null;
  readonly auc: number | null;
  readonly agentName: string | null;
}

export function readLeaderboard(
  db: KalibraDatabase,
  page: Page,
  rankedOnly: boolean,
): { total: number; rows: LeaderboardRow[] } {
  const filter = rankedOnly ? sql`WHERE s.status = 'RANKED'` : sql``;
  const [count] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM scores s ${filter}`);
  const rows = db.all<LeaderboardRow>(sql`
    SELECT s.wallet, s.score, s.status, s.n, s.bss, s.ece_excess AS eceExcess, s.auc,
           a.name AS agentName
    FROM scores s
    LEFT JOIN agents a ON a.wallet = s.wallet
    ${filter}
    ORDER BY CASE WHEN s.score IS NULL THEN 1 ELSE 0 END, s.score DESC, s.wallet ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  return { total: count?.n ?? 0, rows };
}

export interface WalletScoreRow {
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
  readonly status: string;
  readonly excludedCount: number;
  readonly paramsHash: string;
  readonly computedAt: number;
  readonly agentId: string | null;
  readonly agentName: string | null;
  readonly agentMethod: string | null;
}

export function readWalletScore(db: KalibraDatabase, wallet: string): WalletScoreRow | undefined {
  const [row] = db.all<WalletScoreRow>(sql`
    SELECT s.wallet, s.n, s.bs_trader AS bsTrader, s.bs_market AS bsMarket, s.bss,
           s.bss_shrunk AS bssShrunk, s.ece_trader AS eceTrader, s.ece_market AS eceMarket,
           s.ece_excess AS eceExcess, s.auc, s.score, s.status,
           s.excluded_count AS excludedCount, s.params_hash AS paramsHash,
           s.computed_at AS computedAt,
           a.agent_id AS agentId, a.name AS agentName, a.method AS agentMethod
    FROM scores s
    LEFT JOIN agents a ON a.wallet = s.wallet
    WHERE s.wallet = ${wallet}
  `);
  return row;
}

export interface CalibrationRow {
  readonly binIndex: number;
  readonly count: number;
  readonly meanForecast: number | null;
  readonly observedFreq: number | null;
}

export function readCalibration(db: KalibraDatabase, wallet: string): CalibrationRow[] {
  return db.all<CalibrationRow>(sql`
    SELECT bin_index AS binIndex, count, mean_forecast AS meanForecast,
           observed_freq AS observedFreq
    FROM calibration_bins WHERE wallet = ${wallet} ORDER BY bin_index ASC
  `);
}

/** True when the wallet is unknown to us entirely, which is a 404 rather than an empty page. */
export function walletHasPositions(db: KalibraDatabase, wallet: string): boolean {
  const [row] = db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM positions WHERE wallet = ${wallet}`,
  );
  return (row?.n ?? 0) > 0;
}

export interface PositionRow {
  readonly positionId: string;
  readonly marketId: string;
  readonly underlying: string;
  readonly side: string;
  readonly netStake: string;
  readonly stakeDecimals: number | null;
  readonly p: number;
  readonly lambda: number | null;
  readonly forecast: number | null;
  readonly outcomeY: number | null;
  readonly excludedReason: string | null;
  readonly settledAt: number | null;
}

/**
 * `stakeDecimals` is carried on trades, not on positions (API_SPEC.md section 1), so it is
 * read back from any trade behind the position. Every trade in one market shares a scale.
 */
export function readWalletPositions(
  db: KalibraDatabase,
  wallet: string,
  page: Page,
): { total: number; rows: PositionRow[] } {
  const [count] = db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM positions WHERE wallet = ${wallet}`,
  );
  const rows = db.all<PositionRow>(sql`
    SELECT p.position_id AS positionId, p.market_id AS marketId, m.underlying, p.side,
           p.net_stake AS netStake, p.p, p.lambda, p.forecast, p.outcome_y AS outcomeY,
           p.excluded_reason AS excludedReason, p.settled_at AS settledAt,
           (SELECT t.stake_decimals FROM trades t
             WHERE t.market_id = p.market_id AND t.wallet = p.wallet LIMIT 1) AS stakeDecimals
    FROM positions p
    JOIN markets m ON m.market_id = p.market_id
    WHERE p.wallet = ${wallet}
    ORDER BY p.settled_at DESC, p.position_id ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  return { total: count?.n ?? 0, rows };
}

export interface MarketSummaryRow {
  readonly marketId: string;
  readonly underlying: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly status: string;
  readonly outcome: string | null;
  readonly tradeCount: number;
  readonly uniqueWallets: number;
}

export function readMarkets(
  db: KalibraDatabase,
  page: Page,
  filters: { status?: string; underlying?: string },
): { total: number; rows: MarketSummaryRow[] } {
  const status = filters.status;
  const underlying = filters.underlying;
  const where = sql`WHERE (${status ?? null} IS NULL OR m.status = ${status ?? null})
                      AND (${underlying ?? null} IS NULL OR m.underlying = ${underlying ?? null})`;
  const [count] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM markets m ${where}`);
  const rows = db.all<MarketSummaryRow>(sql`
    SELECT m.market_id AS marketId, m.underlying, m.window_start AS windowStart,
           m.window_end AS windowEnd, m.status, m.outcome,
           (SELECT count(*) FROM trades t WHERE t.market_id = m.market_id) AS tradeCount,
           (SELECT count(DISTINCT t.wallet) FROM trades t WHERE t.market_id = m.market_id)
             AS uniqueWallets
    FROM markets m
    ${where}
    ORDER BY m.window_start DESC, m.market_id ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  return { total: count?.n ?? 0, rows };
}
