import { join } from 'node:path';

import { LiveAdapter, ReplayAdapter, type DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import { openDatabase } from '@kalibra/db';

import { loadConfig } from './config.js';
import { formatSummary, runIngest } from './ingest.js';
import { runPipeline } from './pipeline.js';

/**
 * `pnpm ingest`. Replay mode reads the committed fixtures and needs no network and no
 * credentials. Live mode is day 4 and says so rather than pretending.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  let adapter: DreamDexAdapter;
  if (config.KALIBRA_MODE === 'live') {
    if (config.DREAMDEX_INDEXER_URL === undefined) {
      throw new Error('live mode needs DREAMDEX_INDEXER_URL; see docs/DREAMDEX_ADAPTER.md U19');
    }
    adapter = new LiveAdapter({
      indexerUrl: config.DREAMDEX_INDEXER_URL,
      marketLimit: config.DREAMDEX_MARKET_LIMIT,
    });
  } else {
    adapter = await ReplayAdapter.fromDirectory(join(process.cwd(), 'fixtures', 'synthetic'));
  }
  const { db, close } = openDatabase(config.KALIBRA_DB_PATH);
  try {
    const now = Date.now();
    const summary = await runIngest(adapter, db, { ingestedAt: now });
    console.log(`${config.KALIBRA_MODE} -> ${config.KALIBRA_DB_PATH}`);
    console.log(formatSummary(summary));

    const pipeline = runPipeline(db, { computedAt: now });
    console.log(
      `positions    ${pipeline.positionsScored} scored, ${pipeline.positionsExcluded} excluded`,
    );
    console.log(`wallets      ${pipeline.walletsSeen} seen, ${pipeline.walletsRanked} RANKED`);
    console.log(`params       ${pipeline.paramsHash}`);
  } finally {
    close();
  }
}

await main();
