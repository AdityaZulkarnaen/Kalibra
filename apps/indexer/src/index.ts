import { join } from 'node:path';

import { LiveAdapter, ReplayAdapter, type DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import { openDatabase } from '@kalibra/db';

import { loadConfig } from './config.js';
import { formatSummary, runIngest } from './ingest.js';
import { runPipeline } from './pipeline.js';

/**
 * `pnpm ingest`. Replay mode reads the committed fixtures and needs no network and no
 * credentials.
 *
 * `--watch` repeats the pass on an interval. Guard resolves a market's status, window and
 * outcome from the `markets` table rather than from the venue, so while agents are trading
 * something has to keep that table current — a stale row means Guard refuses a live market as
 * closed, or marks an open position against a settlement that has not happened.
 */
async function buildAdapter(
  config: ReturnType<typeof loadConfig>,
): Promise<{ adapter: DreamDexAdapter; label: string }> {
  if (config.KALIBRA_MODE === 'live') {
    if (config.DREAMDEX_INDEXER_URL === undefined) {
      throw new Error('live mode needs DREAMDEX_INDEXER_URL; see docs/DREAMDEX_ADAPTER.md U19');
    }
    return {
      adapter: new LiveAdapter({
        indexerUrl: config.DREAMDEX_INDEXER_URL,
        marketLimit: config.DREAMDEX_MARKET_LIMIT,
        includeUntraded: config.DREAMDEX_INCLUDE_UNTRADED,
      }),
      label: 'live',
    };
  }
  return {
    adapter: await ReplayAdapter.fromDirectory(join(process.cwd(), 'fixtures', 'synthetic')),
    label: 'replay',
  };
}

async function onePass(adapter: DreamDexAdapter, db: Parameters<typeof runPipeline>[0]) {
  const now = Date.now();
  const summary = await runIngest(adapter, db, { ingestedAt: now });
  const pipeline = runPipeline(db, { computedAt: now });
  return { summary, pipeline };
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const watch = process.argv.includes('--watch');
  const { adapter, label } = await buildAdapter(config);
  const { db, close } = openDatabase(config.KALIBRA_DB_PATH);

  try {
    if (!watch) {
      const { summary, pipeline } = await onePass(adapter, db);
      console.log(`${label} -> ${config.KALIBRA_DB_PATH}`);
      console.log(formatSummary(summary));
      console.log(
        `positions    ${pipeline.positionsScored} scored, ${pipeline.positionsExcluded} excluded`,
      );
      console.log(`wallets      ${pipeline.walletsSeen} seen, ${pipeline.walletsRanked} RANKED`);
      console.log(`params       ${pipeline.paramsHash}`);
      return;
    }

    const every = config.KALIBRA_INGEST_INTERVAL_MS;
    console.log(`${label} -> ${config.KALIBRA_DB_PATH}, every ${every / 1000}s`);
    for (;;) {
      try {
        const { summary, pipeline } = await onePass(adapter, db);
        console.log(
          `${new Date().toISOString()}  ` +
            `+${summary.marketsInserted}m +${summary.tradesInserted}t +${summary.settlementsApplied}s  ` +
            `scored ${pipeline.positionsScored}  ranked ${pipeline.walletsRanked}`,
        );
      } catch (cause) {
        // A pass that fails is not a reason to stop watching. The venue drops a connection,
        // the indexer lags, a query times out; the next pass picks up where this one left
        // off because ingestion is idempotent.
        console.error(`${new Date().toISOString()}  pass failed: ${describe(cause)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  } finally {
    close();
  }
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);

await main();
