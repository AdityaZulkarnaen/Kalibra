import { describe, expect, it } from 'vitest';

import { MIN_SAMPLE, SCORE_ANCHOR, SCORE_MAX, SCORE_MIN } from './constants.js';
import { InvalidInputError } from './errors.js';
import {
  computeWalletMetrics,
  kalibraScore,
  roundHalfAwayFromZero,
  walletStatus,
} from './score.js';
import type { ForecastObservation } from './types.js';

describe('roundHalfAwayFromZero (SCORING_SPEC 6)', () => {
  it('rounds a half away from zero in both directions, unlike Math.round', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
  });

  it('leaves the ordinary cases alone', () => {
    expect(roundHalfAwayFromZero(1.4)).toBe(1);
    expect(roundHalfAwayFromZero(-1.4)).toBe(-1);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });
});

describe('kalibraScore (SCORING_SPEC 6)', () => {
  it('anchors at 500 for market-equivalent performance', () => {
    expect(kalibraScore(0, 0)).toBe(SCORE_ANCHOR);
  });

  it('weights skill at 1500 and excess calibration error at 100', () => {
    expect(kalibraScore(0.1, 0)).toBe(650);
    expect(kalibraScore(0, 0.5)).toBe(450);
  });

  it('clamps to the published bounds', () => {
    expect(kalibraScore(1, 0)).toBe(SCORE_MAX);
    expect(kalibraScore(-5, 0)).toBe(SCORE_MIN);
    expect(kalibraScore(-1, 0.5)).toBe(SCORE_MIN);
  });

  it('rejects inputs that would produce a non-number', () => {
    expect(() => kalibraScore(Number.NaN, 0)).toThrow(InvalidInputError);
    expect(() => kalibraScore(0, -0.1)).toThrow(InvalidInputError);
  });
});

describe('walletStatus (SCORING_SPEC 6.1)', () => {
  it('needs MIN_SAMPLE resolved positions to be ranked', () => {
    expect(walletStatus(MIN_SAMPLE - 1)).toBe('PROVISIONAL');
    expect(walletStatus(MIN_SAMPLE)).toBe('RANKED');
    expect(walletStatus(0)).toBe('PROVISIONAL');
  });

  it('rejects a fractional or negative sample count', () => {
    expect(() => walletStatus(-1)).toThrow(InvalidInputError);
    expect(() => walletStatus(2.5)).toThrow(InvalidInputError);
  });
});

describe('computeWalletMetrics publication rule', () => {
  const marketTracker = (n: number): ForecastObservation[] =>
    Array.from({ length: n }, (_, i) => ({ p: 0.6, f: 0.6, y: i % 2 === 0 ? 1 : 0 }));

  it('publishes a score once the wallet is RANKED', () => {
    const metrics = computeWalletMetrics(marketTracker(MIN_SAMPLE));
    expect(metrics.status).toBe('RANKED');
    expect(metrics.score).toBe(metrics.scoreInternal);
    expect(metrics.score).toBe(SCORE_ANCHOR);
  });

  it('withholds the score while PROVISIONAL but still computes it', () => {
    const metrics = computeWalletMetrics(marketTracker(MIN_SAMPLE - 1));
    expect(metrics.status).toBe('PROVISIONAL');
    expect(metrics.score).toBeNull();
    expect(metrics.scoreInternal).toBe(SCORE_ANCHOR);
  });
});
