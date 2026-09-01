import { join } from 'node:path';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
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
  if (config.KALIBRA_MODE === 'live') {
    throw new Error(
      'live mode is not implemented: LiveAdapter lands on day 4, and the venue mapping is ' +
        'still unverified (docs/DREAMDEX_ADAPTER.md section 7). Use KALIBRA_MODE=replay.',
    );
  }

  const adapter = await ReplayAdapter.fromDirectory(join(process.cwd(), 'fixtures', 'synthetic'));
  const { db, close } = openDatabase(config.KALIBRA_DB_PATH);
  try {
    const now = Date.now();
    const summary = await runIngest(adapter, db, { ingestedAt: now });
    console.log(`replay -> ${config.KALIBRA_DB_PATH}`);
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
