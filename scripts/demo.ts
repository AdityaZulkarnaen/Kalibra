/**
 * `pnpm demo` — the full pipeline, offline, deterministic (CLAUDE.md invariant I3).
 *
 * ReplayAdapter to indexer to aggregation to scoring, over the committed fixtures, into an
 * in-memory database. No network, no credentials, no files written. The result is compared
 * against `fixtures/expected/demo-output.json` and the script fails if they differ.
 *
 * That file is the regression test for the entire pipeline and is regenerated only by
 * deliberate act: `pnpm demo --update`. If a code change alters it, that is either a bug
 * or an intended change to the scoring math, and the diff belongs in the commit message
 * (DREAMDEX_ADAPTER.md section 9).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
import { canonicalJson } from '@kalibra/core';
import { listPositions, listScores, openDatabase } from '@kalibra/db';
import { runIngest, runPipeline } from '@kalibra/indexer';

/** Fixed, because a clock would make the output differ on every run. */
const COMPUTED_AT = 1_787_620_000_000;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures', 'synthetic');
const EXPECTED = join(ROOT, 'fixtures', 'expected', 'demo-output.json');

interface DemoOutput {
  readonly paramsHash: string;
  readonly ingest: {
    readonly markets: number;
    readonly trades: number;
    readonly settlements: number;
  };
  readonly positions: {
    readonly total: number;
    readonly scored: number;
    readonly excluded: number;
    readonly byReason: Record<string, number>;
  };
  readonly wallets: ReadonlyArray<Record<string, unknown>>;
}

async function build(): Promise<DemoOutput> {
  const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
  const { db, close } = openDatabase(':memory:');
  try {
    const ingest = await runIngest(adapter, db, { ingestedAt: COMPUTED_AT, mode: 'replay' });
    const pipeline = runPipeline(db, { computedAt: COMPUTED_AT });

    const byReason: Record<string, number> = {};
    for (const position of listPositions(db)) {
      const reason = position.excludedReason ?? 'SCORED';
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }

    return {
      paramsHash: pipeline.paramsHash,
      ingest: {
        markets: ingest.marketsInserted,
        trades: ingest.tradesInserted,
        settlements: ingest.settlementsApplied,
      },
      positions: {
        total: pipeline.positionsWritten,
        scored: pipeline.positionsScored,
        excluded: pipeline.positionsExcluded,
        byReason,
      },
      wallets: listScores(db).map((row) => ({
        wallet: row.wallet,
        n: row.n,
        excludedCount: row.excludedCount,
        status: row.status,
        score: row.score,
        scoreInternal: row.scoreInternal,
        bsTrader: row.bsTrader,
        bsMarket: row.bsMarket,
        bss: row.bss,
        bssShrunk: row.bssShrunk,
        eceTrader: row.eceTrader,
        eceMarket: row.eceMarket,
        eceExcess: row.eceExcess,
        auc: row.auc,
      })),
    };
  } finally {
    close();
  }
}

function report(output: DemoOutput): void {
  console.log('Kalibra demo — full pipeline over committed fixtures. Offline, deterministic.\n');
  console.log(
    `ingested     ${output.ingest.markets} markets, ${output.ingest.trades} trades, ` +
      `${output.ingest.settlements} settlements`,
  );
  console.log(
    `positions    ${output.positions.scored} scored, ${output.positions.excluded} excluded`,
  );
  for (const [reason, count] of Object.entries(output.positions.byReason).sort()) {
    if (reason !== 'SCORED') console.log(`               ${reason.padEnd(22)} ${count}`);
  }

  const ranked = output.wallets.filter((wallet) => wallet['status'] === 'RANKED');
  console.log(`wallets      ${output.wallets.length} scored, ${ranked.length} RANKED`);
  console.log(`params       ${output.paramsHash}\n`);

  const measurable = [...output.wallets]
    .filter((wallet) => (wallet['n'] as number) > 0)
    .sort((a, b) => (b['scoreInternal'] as number) - (a['scoreInternal'] as number))
    .slice(0, 5);
  console.log('top by computed score');
  for (const wallet of measurable) {
    const address = wallet['wallet'] as string;
    console.log(
      `  ${address.slice(0, 10)}…  score ${String(wallet['scoreInternal']).padStart(4)}  ` +
        `n=${String(wallet['n']).padStart(2)}  status ${String(wallet['status'])}`,
    );
  }

  if (ranked.length === 0) {
    console.log(
      `
Every wallet is PROVISIONAL, and that is a property of the fixture set rather than
` +
        `a bug: aggregation keeps one position per wallet per market, so with 12 markets no
` +
        `wallet can hold more than 12 resolved positions, while MIN_SAMPLE is 30. Scores are
` +
        `computed and stored but not published. See the note in the README.`,
    );
  }
}

async function main(): Promise<void> {
  const output = await build();
  const serialised = `${JSON.stringify(JSON.parse(canonicalJson(output)), null, 2)}\n`;
  report(output);

  if (process.argv.includes('--update')) {
    await writeFile(EXPECTED, serialised, 'utf8');
    console.log(`\nwrote ${EXPECTED}`);
    return;
  }

  let expected: string;
  try {
    expected = await readFile(EXPECTED, 'utf8');
  } catch {
    console.error(`\nFAIL: ${EXPECTED} is missing. Generate it with: pnpm demo --update`);
    process.exit(1);
  }

  if (expected !== serialised) {
    console.error(
      '\nFAIL: the pipeline no longer reproduces fixtures/expected/demo-output.json.\n' +
        'That is either a bug or an intended change to the scoring math. If intended, run\n' +
        '`pnpm demo --update` and explain the diff in the commit message.',
    );
    process.exit(1);
  }

  console.log('\nOK: output matches fixtures/expected/demo-output.json exactly.');
}

await main();
