import { describe, expect, it } from 'vitest';

import type { CalibrationBin } from './api';
import { populatedBins, signedDeviation, toCalibrationSeries } from './calibration';

const bin = (
  index: number,
  count: number,
  meanForecast: number | null,
  observedFreq: number | null,
): CalibrationBin => ({
  bin: index,
  range: [index / 10, (index + 1) / 10],
  count,
  meanForecast,
  observedFreq,
});

const empty = (index: number): CalibrationBin => bin(index, 0, null, null);

/** Bins 3 and 4 are empty and sit between two populated ones — the interpolation trap. */
const withHole: CalibrationBin[] = [
  empty(0),
  empty(1),
  bin(2, 12, 0.2611, 0.25),
  empty(3),
  empty(4),
  bin(5, 31, 0.5512, 0.5806),
  bin(6, 20, 0.6402, 0.7),
  empty(7),
  empty(8),
  empty(9),
];

describe('toCalibrationSeries', () => {
  it('keeps all ten bins so the axis is the full probability range', () => {
    expect(toCalibrationSeries(withHole)).toHaveLength(10);
  });

  it('gives an empty bin no observed frequency, which is what breaks the line', () => {
    const series = toCalibrationSeries(withHole);
    expect(series[3]?.observedFreq).toBeNull();
    expect(series[4]?.observedFreq).toBeNull();
    // If this ever returns a number, the chart draws straight through the gap and asserts
    // calibration in a band where the trader never forecast.
    expect(populatedBins(series).map((point) => point.bin)).toEqual([2, 5, 6]);
  });

  it('still places an empty bin on the axis, at the midpoint of its own range', () => {
    const series = toCalibrationSeries(withHole);
    expect(series[3]?.x).toBeCloseTo(0.35, 9);
    expect(series[4]?.x).toBeCloseTo(0.45, 9);
  });

  it('places a populated bin at its own mean forecast, not at the bin midpoint', () => {
    const series = toCalibrationSeries(withHole);
    expect(series[5]?.x).toBeCloseTo(0.5512, 9);
    expect(series[5]?.x).not.toBeCloseTo(0.55, 9);
  });

  it('treats a count without an observed frequency as empty rather than guessing', () => {
    const series = toCalibrationSeries([
      bin(5, 9, 0.55, null),
      ...withHole.filter((b) => b.bin !== 5),
    ]);
    expect(series[5]?.observedFreq).toBeNull();
    expect(series[5]?.count).toBe(9);
  });

  it('sorts by bin, because the line is drawn in array order', () => {
    const shuffled = [...withHole].reverse();
    expect(toCalibrationSeries(shuffled).map((point) => point.bin)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});

describe('signedDeviation', () => {
  it('weights each bin by its count', () => {
    const series = toCalibrationSeries(withHole);
    // 12(0.25 - 0.2611) + 31(0.5806 - 0.5512) + 20(0.7 - 0.6402) over 63.
    const expected = (12 * -0.0111 + 31 * 0.0294 + 20 * 0.0598) / 63;
    expect(signedDeviation(series)).toBeCloseTo(Math.round(expected * 10_000) / 10_000, 9);
  });

  it('ignores empty bins entirely rather than counting them as zero deviation', () => {
    const onlyPopulated = toCalibrationSeries([
      bin(5, 10, 0.5, 0.6),
      ...[0, 1, 2, 3, 4, 6, 7, 8, 9].map(empty),
    ]);
    expect(signedDeviation(onlyPopulated)).toBeCloseTo(0.1, 9);
  });

  it('returns null when there is nothing to summarise', () => {
    expect(
      signedDeviation(toCalibrationSeries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(empty))),
    ).toBeNull();
  });
});
