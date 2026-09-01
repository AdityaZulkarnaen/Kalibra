import type { DreamDexAdapter, StreamOpts } from '@kalibra/adapter-dreamdex';
import {
  applySettlement,
  insertMarket,
  insertTrade,
  type KalibraDatabase,
  type TradeSource,
} from '@kalibra/db';

/**
 * Ingestion: adapter streams in, rows land in SQLite, nothing is computed.
 *
 * Every insert is keyed on a natural identifier from the source and ignores duplicates, so
 * the whole pass is safely re-runnable. That is what makes over-fetching after a
 * reconnect safe, and it is what the offline demo depends on.
 */

export interface IngestOptions {
  /** Supplied rather than read from a clock, so a replay produces identical rows. */
  readonly ingestedAt: number;
  readonly source?: TradeSource;
  readonly window?: StreamOpts;
}

export interface IngestSummary {
  readonly marketsSeen: number;
  readonly marketsInserted: number;
  readonly tradesSeen: number;
  readonly tradesInserted: number;
  /** Trades naming a market we have never seen. Skipped, never invented. */
  readonly tradesOrphaned: number;
  readonly settlementsSeen: number;
  readonly settlementsApplied: number;
  /** Settlements for an unknown market. Warned about, never used to fabricate a market. */
  readonly settlementsOrphaned: number;
}

export async function runIngest(
  adapter: DreamDexAdapter,
  db: KalibraDatabase,
  options: IngestOptions,
): Promise<IngestSummary> {
  const source = options.source ?? 'FEED';
  const window = options.window ?? {};

  const marketList = await adapter.listMarkets();
  let marketsInserted = 0;
  for (const market of marketList) marketsInserted += insertMarket(db, market);
  const known = new Set(marketList.map((market) => market.marketId));

  let tradesSeen = 0;
  let tradesInserted = 0;
  let tradesOrphaned = 0;
  for await (const trade of adapter.streamTrades(window)) {
    tradesSeen += 1;
    if (!known.has(trade.marketId)) {
      tradesOrphaned += 1;
      continue;
    }
    tradesInserted += insertTrade(db, trade, source, options.ingestedAt);
  }

  let settlementsSeen = 0;
  let settlementsApplied = 0;
  let settlementsOrphaned = 0;
  for await (const settlement of adapter.streamSettlements(window)) {
    settlementsSeen += 1;
    if (applySettlement(db, settlement)) settlementsApplied += 1;
    else settlementsOrphaned += 1;
  }

  return {
    marketsSeen: marketList.length,
    marketsInserted,
    tradesSeen,
    tradesInserted,
    tradesOrphaned,
    settlementsSeen,
    settlementsApplied,
    settlementsOrphaned,
  };
}

export function formatSummary(summary: IngestSummary): string {
  const lines = [
    `markets      ${summary.marketsInserted} new of ${summary.marketsSeen} seen`,
    `trades       ${summary.tradesInserted} new of ${summary.tradesSeen} seen`,
    `settlements  ${summary.settlementsApplied} applied of ${summary.settlementsSeen} seen`,
  ];
  if (summary.tradesOrphaned > 0) {
    lines.push(`WARNING      ${summary.tradesOrphaned} trades named an unknown market, skipped`);
  }
  if (summary.settlementsOrphaned > 0) {
    lines.push(
      `WARNING      ${summary.settlementsOrphaned} settlements named an unknown market, skipped`,
    );
  }
  return lines.join('\n');
}
