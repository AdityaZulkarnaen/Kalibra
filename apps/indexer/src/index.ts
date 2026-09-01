import { join } from 'node:path';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
import { openDatabase } from '@kalibra/db';

import { loadConfig } from './config.js';
import { formatSummary, runIngest } from './ingest.js';

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
    const summary = await runIngest(adapter, db, { ingestedAt: Date.now() });
    console.log(`replay -> ${config.KALIBRA_DB_PATH}`);
    console.log(formatSummary(summary));
  } finally {
    close();
  }
}

await main();
