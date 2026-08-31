import { describe, expect, it } from 'vitest';

import {
  binIndex,
  binRange,
  calibrationBins,
  excessCalibrationError,
  expectedCalibrationError,
} from './calibration.js';
import { ECE_BINS } from './constants.js';
import { InvalidInputError } from './errors.js';

describe('binIndex (SCORING_SPEC 5.4)', () => {
  it('is left-closed and right-open', () => {
    expect(binIndex(0)).toBe(0);
    expect(binIndex(0.0999)).toBe(0);
    expect(binIndex(0.1)).toBe(1);
    expect(binIndex(0.7999)).toBe(7);
  });

  it('puts f = 0.80 in bin 8, not bin 7', () => {
    expect(binIndex(0.8)).toBe(8);
  });

  it('closes the last bin so that f = 1 has somewhere to go', () => {
    expect(binIndex(0.9999)).toBe(9);
    expect(binIndex(1)).toBe(9);
  });

  it('rejects a forecast outside [0, 1]', () => {
    expect(() => binIndex(-0.01)).toThrow(InvalidInputError);
    expect(() => binIndex(1.01)).toThrow(InvalidInputError);
  });
});

describe('binRange', () => {
  it('describes the bin edges the chart labels', () => {
    expect(binRange(0)).toEqual([0, 0.1]);
    expect(binRange(8)).toEqual([0.8, 0.9]);
    expect(() => binRange(ECE_BINS)).toThrow(InvalidInputError);
  });
});

describe('calibrationBins', () => {
  it('always returns every bin, so the chart can render gaps honestly', () => {
    const bins = calibrationBins([0.25, 0.25], [1, 0]);
    expect(bins).toHaveLength(ECE_BINS);
    expect(bins.filter((bin) => bin.count > 0).map((bin) => bin.bin)).toEqual([2]);
  });

  it('reports null statistics for empty bins rather than zero', () => {
    const [first] = calibrationBins([0.95], [1]);
    expect(first).toMatchObject({ bin: 0, count: 0, meanForecast: null, observedFrequency: null });
  });

  it('averages forecast and outcome within a bin', () => {
    const bins = calibrationBins([0.2, 0.275], [0, 1]);
    expect(bins[2]).toMatchObject({ count: 2, observedFrequency: 0.5 });
    expect(bins[2]?.meanForecast).toBeCloseTo(0.2375, 12);
  });
});

describe('expectedCalibrationError (SCORING_SPEC 5.4)', () => {
  it('is zero for a perfectly calibrated forecaster', () => {
    expect(expectedCalibrationError([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0);
  });

  it('reproduces the V3 trader and market errors', () => {
    expect(expectedCalibrationError([0.8, 0.75, 0.2, 0.275], [1, 1, 0, 1])).toBeCloseTo(
      0.24374999999999997,
      9,
    );
    expect(expectedCalibrationError([0.6, 0.5, 0.4, 0.55], [1, 1, 0, 1])).toBeCloseTo(0.4375, 9);
  });

  it('weights each bin by its share of the sample', () => {
    expect(expectedCalibrationError([0.05, 0.05, 0.95], [1, 1, 1])).toBeCloseTo(
      (2 / 3) * 0.95 + (1 / 3) * 0.05,
      12,
    );
  });

  it('is undefined for an empty set', () => {
    expect(() => expectedCalibrationError([], [])).toThrow(InvalidInputError);
  });
});

describe('excessCalibrationError (SCORING_SPEC 5.5)', () => {
  it('penalises only what exceeds the market', () => {
    expect(excessCalibrationError(0.5, 0.2)).toBeCloseTo(0.3, 12);
  });

  it('gives no bonus for beating the market, because BSS already counts it', () => {
    expect(excessCalibrationError(0.1, 0.4)).toBe(0);
    expect(excessCalibrationError(0.4, 0.4)).toBe(0);
  });
});
