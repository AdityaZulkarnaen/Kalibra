/**
 * `pnpm verify-attribution` — Gate 0.1.
 *
 * Traces real settled markets from the fill tape to the money, in both directions, and
 * fails loudly if any independent layer disagrees with the side this repository stored.
 * See `packages/adapter-dreamdex/src/attest.ts` for what the four layers are and why an
 * agreement between fewer than all of them is not enough.
 *
 * Two markets, not one. A symmetric inversion — UP and DOWN swapped everywhere — passes a
 * one-direction check perfectly, so the check has to be run on a market that settled UP and
 * on one that settled DOWN.
 *
 * This reaches the network. It is not part of `pnpm demo` and nothing offline depends on it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attestSideAttribution, type SideAttestation } from '@kalibra/adapter-dreamdex';

const INDEXER_URL = process.env['DREAMDEX_INDEXER_URL'] ?? 'https://dev.smk.somnia.host/v1/graphql';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Both were picked from the live indexer for having settled with fills on the tape, one in
 * each direction. Passed on the command line they can be replaced with any other pair.
 */
const DEFAULT_MARKETS = [
  '0x000000000000000000000000000000000000000000000000000000000000ff46',
  '0x0000000000000000000000000000000000000000000000000000000000010e48',
];

const stringify = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner), 2);

function report(attestation: SideAttestation): void {
  const { marketId, underlying, question, adapterOutcome, oracle, payout, chain } = attestation;
  console.log(`\n${marketId}`);
  console.log(`  ${underlying} — ${question ?? '(no question)'}`);
  console.log(`  adapter stored outcome     ${adapterOutcome ?? 'none'}`);
  console.log(
    `  A oracle open -> close     ${oracle.opening ?? '?'} -> ${oracle.closing ?? '?'} = ${oracle.direction ?? 'not determinable'}`,
  );
  console.log(
    `  B payout vector            [${(payout.numerators ?? []).join(', ')}] / ${payout.denominator ?? '?'} pays index ${payout.payingIndex ?? '?'}`,
  );
  console.log(
    `  C chain                    resolved=${chain.isResolved} voided=${chain.isVoided} winningOutcome=${chain.winningOutcome}`,
  );

  console.log('  D legs');
  for (const leg of attestation.legs) {
    const held =
      leg.yesBalance === null || leg.noBalance === null
        ? 'not read (wallet traded both sides)'
        : `yes=${leg.yesBalance} no=${leg.noBalance}`;
    const verdict = leg.won === null ? '?' : leg.won ? 'won' : 'lost';
    console.log(
      `    ${leg.tradeId.padEnd(22)} ${leg.wallet} ${leg.venueSide.padEnd(9)} -> ` +
        `${leg.canonicalSide.padEnd(4)} ${verdict.padEnd(4)} stake=${leg.stake} ` +
        `kind=${leg.kind ?? '?'} ${held}`,
    );
  }

  for (const gap of attestation.unobserved) console.log(`  UNOBSERVED  ${gap}`);
  for (const problem of attestation.disagreements) console.log(`  DISAGREES   ${problem}`);
  console.log(`  => ${attestation.agrees ? 'every readable layer agrees' : 'ATTRIBUTION FAILED'}`);
}

async function main(): Promise<void> {
  const marketIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MARKETS;
  const outDir = join(ROOT, 'fixtures', 'recorded', 'attribution-2026-09-02');
  await mkdir(outDir, { recursive: true });

  console.log(`verifying side attribution against ${INDEXER_URL}`);
  const results: SideAttestation[] = [];
  for (const marketId of marketIds) {
    const attestation = await attestSideAttribution({ indexerUrl: INDEXER_URL }, marketId);
    report(attestation);
    results.push(attestation);
    await writeFile(
      join(outDir, `${marketId.slice(-6)}.json`),
      `${stringify(attestation)}\n`,
      'utf8',
    );
  }

  const directions = new Set(results.map((row) => row.adapterOutcome));
  const failed = results.filter((row) => !row.agrees);

  console.log('');
  if (!directions.has('UP') || !directions.has('DOWN')) {
    // A pass over one direction only cannot detect a symmetric inversion, which is the
    // failure mode this gate exists for. Report that rather than a green tick.
    console.log(`INCOMPLETE: both directions are needed, saw ${[...directions].join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.length} of ${results.length} markets disagree`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${results.length} markets, both directions, every readable layer agrees`);
  console.log(`evidence written to ${outDir}`);
}

await main();

// The SDK's WebSocket keeps a handle open past close(), so the process would otherwise sit
// idle after the report is written. Exit on the code main() decided.
process.exit(process.exitCode ?? 0);
