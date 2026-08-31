import { describe, expect, it } from 'vitest';

import { CONVICTION_WINDOW, LAMBDA_MAX } from './constants.js';
import { conviction, convictionSeries, referenceStake } from './conviction.js';
import { InvalidInputError } from './errors.js';

describe('referenceStake — nearest-rank p90 (SCORING_SPEC 3.2)', () => {
  it('returns the only stake for a single-position window', () => {
    expect(referenceStake([250n])).toBe(250n);
  });

  it('uses index ceil(0.9 * N) - 1, not interpolation', () => {
    const window = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
    expect(referenceStake(window)).toBe(9n);
    expect(referenceStake([1n, 2n, 3n])).toBe(3n);
  });

  it('sorts numerically, not lexicographically', () => {
    expect(referenceStake([2n, 10n, 3n])).toBe(10n);
    expect(referenceStake([100n, 20n, 3n, 9n, 80n])).toBe(100n);
  });

  it('rejects an empty window rather than inventing a reference', () => {
    expect(() => referenceStake([])).toThrow(InvalidInputError);
  });
});

describe('V2 — conviction', () => {
  const cases: ReadonlyArray<readonly [bigint, bigint, number]> = [
    [100n, 100n, 0.5],
    [50n, 100n, 0.25],
    [200n, 100n, 0.5],
    [1n, 100n, 0.005],
    [0n, 100n, 0.0],
    [100n, 0n, 0.0],
  ];

  it.each(cases)('stake %s against S_ref %s gives lambda %s', (stake, sRef, expected) => {
    expect(conviction(stake, sRef)).toBeCloseTo(expected, 12);
  });

  it('never divides by zero', () => {
    expect(conviction(100n, 0n)).toBe(0);
  });

  it('rejects negative quantities', () => {
    expect(() => conviction(-1n, 100n)).toThrow(InvalidInputError);
    expect(() => conviction(100n, -1n)).toThrow(InvalidInputError);
  });
});

describe('convictionSeries', () => {
  it('gives a wallet maximum conviction on its first position, by construction', () => {
    expect(convictionSeries([42n])).toEqual([LAMBDA_MAX]);
  });

  it('measures each stake against the trailing window including itself', () => {
    const series = convictionSeries([100n, 50n, 200n]);
    expect(series[0]).toBe(LAMBDA_MAX);
    expect(series[1]).toBeCloseTo(LAMBDA_MAX * 0.5, 12);
    expect(series[2]).toBe(LAMBDA_MAX);
  });

  it('forgets stakes older than the window', () => {
    const stakes = [1000n, ...Array.from({ length: CONVICTION_WINDOW }, () => 10n)];
    const series = convictionSeries(stakes);
    expect(series).toHaveLength(CONVICTION_WINDOW + 1);
    expect(series.at(-1)).toBe(LAMBDA_MAX);
  });
});
