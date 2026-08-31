/**
 * `pnpm demo` — deterministic, offline, no credentials (CLAUDE.md invariant I3).
 *
 * Day 1 scope is the scoring core only: it replays the normative vectors from
 * SCORING_SPEC.md section 8 through the same functions the pipeline will call. The
 * end-to-end run — ReplayAdapter to indexer to scoring to API, asserted against
 * fixtures/expected/demo-output.json — arrives on day 3 of docs/BUILD_PLAN.md and
 * replaces the body of this script. It is not a pipeline yet, and does not claim to be.
 */
import { computeForecast, computeWalletMetrics, SCORE_ANCHOR } from '@kalibra/core';
import type { ForecastObservation, OutcomeY, Side } from '@kalibra/core';

interface Row {
  readonly p: number;
  readonly side: Side;
  readonly lambda: number;
  readonly y: OutcomeY;
}

const V1: Row[] = [
  { p: 0.6, side: 'UP', lambda: 0, y: 1 },
  { p: 0.4, side: 'DOWN', lambda: 0, y: 0 },
  { p: 0.7, side: 'UP', lambda: 0, y: 0 },
];

const V3: Row[] = [
  { p: 0.6, side: 'UP', lambda: 0.5, y: 1 },
  { p: 0.5, side: 'UP', lambda: 0.5, y: 1 },
  { p: 0.4, side: 'DOWN', lambda: 0.5, y: 0 },
  { p: 0.55, side: 'DOWN', lambda: 0.5, y: 1 },
];

const observe = (rows: readonly Row[]): ForecastObservation[] =>
  rows.map((row) => ({ p: row.p, f: computeForecast(row.p, row.side, row.lambda), y: row.y }));

const show = (label: string, rows: readonly Row[]): number | null => {
  const metrics = computeWalletMetrics(observe(rows));
  const bins = metrics.calibration
    .filter((bin) => bin.count > 0)
    .map((bin) => `${bin.bin}:${bin.count}`)
    .join(' ');
  console.log(`\n${label}  n=${metrics.n}  status=${metrics.status}`);
  console.log(`  BS_trader   ${metrics.bsTrader}`);
  console.log(`  BS_market   ${metrics.bsMarket}`);
  console.log(`  BSS         ${metrics.bss}`);
  console.log(`  BSS_shrunk  ${metrics.bssShrunk}`);
  console.log(`  ECE_excess  ${metrics.eceExcess}`);
  console.log(`  AUC         ${metrics.auc}`);
  console.log(`  score       ${metrics.scoreInternal}  (published: ${metrics.score})`);
  console.log(`  bins        ${bins}`);
  return metrics.scoreInternal;
};

console.log('Kalibra demo — scoring core only (day 1 of docs/BUILD_PLAN.md). Offline.');

const v1Score = show('V1  zero-lean tracker', V1);
const v3Score = show('V3  four positions', V3);

if (v1Score !== SCORE_ANCHOR) {
  console.error(`\nFAIL: V1 must anchor at ${SCORE_ANCHOR}, produced ${v1Score}.`);
  process.exit(1);
}
if (v3Score !== 528) {
  console.error(`\nFAIL: V3 must score 528, produced ${v3Score}.`);
  process.exit(1);
}

console.log('\nOK: V1 anchors at 500, V3 scores 528.');
