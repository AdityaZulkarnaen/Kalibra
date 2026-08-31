import { describe, expect, it } from 'vitest';

import { brierSkillScore, shrinkSkillScore } from './brier.js';
import { ECE_BINS, PROB_MAX, PROB_MIN } from './constants.js';
import { clampProbability, computeForecast } from './forecast.js';
import { computeWalletMetrics } from './score.js';
import type { ForecastObservation, OutcomeY, Side } from './types.js';

/**
 * The normative vectors of SCORING_SPEC.md section 8. These are the contract: if code and
 * spec disagree, the spec is right and the code is a defect.
 *
 * Note on `score` vs `scoreInternal`: the vectors quote the computed score, which section
 * 6.1 stores but does not publish while a wallet is PROVISIONAL. `scoreInternal` carries
 * the quoted number; `score` is null until the wallet is RANKED.
 */

interface VectorRow {
  readonly p: number;
  readonly side: Side;
  readonly lambda: number;
  readonly y: OutcomeY;
}

const observe = (rows: readonly VectorRow[]): ForecastObservation[] =>
  rows.map((row) => ({ p: row.p, f: computeForecast(row.p, row.side, row.lambda), y: row.y }));

describe('V1 — zero-lean tracker', () => {
  const rows: VectorRow[] = [
    { p: 0.6, side: 'UP', lambda: 0, y: 1 },
    { p: 0.4, side: 'DOWN', lambda: 0, y: 0 },
    { p: 0.7, side: 'UP', lambda: 0, y: 0 },
  ];
  const metrics = computeWalletMetrics(observe(rows));

  it('forecasts exactly the market when lambda is zero', () => {
    for (const [i, row] of rows.entries()) {
      expect(computeForecast(row.p, row.side, row.lambda)).toBe(rows[i]?.p);
    }
  });

  it('scores exactly 500 — the anchor the whole metric rests on', () => {
    expect(metrics.scoreInternal).toBe(500);
  });

  it('produces zero skill and zero excess calibration error, exactly', () => {
    expect(metrics.bsTrader).toBe(metrics.bsMarket);
    expect(metrics.bss).toBe(0);
    expect(metrics.bssShrunk).toBe(0);
    expect(metrics.eceExcess).toBe(0);
  });

  it('is PROVISIONAL at n = 3 and publishes no score', () => {
    expect(metrics.n).toBe(3);
    expect(metrics.status).toBe('PROVISIONAL');
    expect(metrics.score).toBeNull();
  });
});

describe('V3 — four positions, full pipeline', () => {
  const rows: VectorRow[] = [
    { p: 0.6, side: 'UP', lambda: 0.5, y: 1 },
    { p: 0.5, side: 'UP', lambda: 0.5, y: 1 },
    { p: 0.4, side: 'DOWN', lambda: 0.5, y: 0 },
    { p: 0.55, side: 'DOWN', lambda: 0.5, y: 1 },
  ];
  const observations = observe(rows);
  const metrics = computeWalletMetrics(observations);

  it('derives the quoted forecasts', () => {
    expect(observations.map((o) => o.f)).toEqual([0.8, 0.75, 0.2, 0.275]);
  });

  it('matches every quoted statistic', () => {
    expect(metrics.bsTrader).toBeCloseTo(0.16703125, 9);
    expect(metrics.bsMarket).toBeCloseTo(0.193125, 9);
    expect(metrics.bss).toBeCloseTo(0.13511326860841422, 9);
    expect(metrics.bssShrunk).toBeCloseTo(0.018636312911505408, 9);
    expect(metrics.eceTrader).toBeCloseTo(0.24374999999999997, 9);
    expect(metrics.eceMarket).toBeCloseTo(0.4375, 9);
    expect(metrics.eceExcess).toBe(0);
    expect(metrics.auc).toBe(1);
  });

  it('scores 528 and stays PROVISIONAL at n = 4', () => {
    expect(metrics.scoreInternal).toBe(528);
    expect(metrics.status).toBe('PROVISIONAL');
    expect(metrics.score).toBeNull();
  });

  it('places f = 0.80 in bin 8, pinning the bin boundary convention', () => {
    const occupied = metrics.calibration.filter((bin) => bin.count > 0);
    expect(occupied.map((bin) => bin.bin)).toEqual([2, 7, 8]);
    expect(occupied[0]).toMatchObject({ count: 2, observedFrequency: 0.5 });
    expect(occupied[0]?.meanForecast).toBeCloseTo(0.2375, 9);
    expect(occupied[1]).toMatchObject({ count: 1, meanForecast: 0.75, observedFrequency: 1 });
    expect(occupied[2]).toMatchObject({ count: 1, meanForecast: 0.8, observedFrequency: 1 });
  });
});

describe('V6 — degenerate inputs', () => {
  it('n = 0 yields null everywhere and PROVISIONAL, without throwing', () => {
    const metrics = computeWalletMetrics([]);
    expect(metrics).toMatchObject({
      n: 0,
      bss: null,
      bssShrunk: null,
      auc: null,
      score: null,
      scoreInternal: null,
      status: 'PROVISIONAL',
    });
    expect(metrics.calibration).toHaveLength(ECE_BINS);
    expect(metrics.calibration.every((bin) => bin.count === 0)).toBe(true);
  });

  it('returns null AUC when the negative class is empty, and computes everything else', () => {
    const metrics = computeWalletMetrics([
      { p: 0.6, f: 0.8, y: 1 },
      { p: 0.5, f: 0.75, y: 1 },
      { p: 0.4, f: 0.7, y: 1 },
    ]);
    expect(metrics.auc).toBeNull();
    for (const value of [metrics.bsTrader, metrics.bsMarket, metrics.bss, metrics.bssShrunk]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(Number.isInteger(metrics.scoreInternal)).toBe(true);
  });

  it('treats a perfect market as zero skill when the trader is also perfect', () => {
    expect(brierSkillScore(0, 0)).toBe(0);
  });

  it('treats a perfect market the trader missed as BSS = -1', () => {
    expect(brierSkillScore(0.25, 0)).toBe(-1);
  });

  it('clamps BSS to -5 before shrinking', () => {
    expect(shrinkSkillScore(-40, 10)).toBeCloseTo((-5 * 10) / 35, 12);
  });

  it('clamps p = 0 and p = 1 into the open interval', () => {
    expect(clampProbability(0)).toBe(PROB_MIN);
    expect(clampProbability(1)).toBe(PROB_MAX);
  });
});
