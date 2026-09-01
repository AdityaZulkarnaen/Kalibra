import type { CalibrationBin } from './api';

/**
 * Turning the API's ten bins into something a chart can draw, without inventing anything.
 *
 * The rule that matters: an empty bin carries no observed frequency, so it becomes a break
 * in the series rather than a point on a line drawn between its neighbours. A trader who
 * never forecast in the 0.3–0.4 band has no calibration there, and a line segment spanning
 * the gap would assert one. `API_SPEC.md` §2 calls the gap "the honest representation";
 * this is where that happens.
 */

export interface CalibrationPoint {
  readonly bin: number;
  /** Position on the forecast axis: the bin's own mean when it has one. */
  readonly x: number;
  /** Null for an empty bin. Recharts breaks the line here rather than interpolating. */
  readonly observedFreq: number | null;
  readonly meanForecast: number | null;
  readonly count: number;
  readonly label: string;
}

const midpoint = (range: readonly [number, number]): number => (range[0] + range[1]) / 2;

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * An empty bin still occupies its slot on the x axis, at the midpoint of its range, so the
 * gap is visible where it actually falls. It carries no y value, which is what breaks the
 * line. A bin that reports a count without an observed frequency is treated as empty too:
 * that combination should not occur, and drawing it would be a guess about which half of
 * the pair is right.
 */
export function toCalibrationSeries(bins: readonly CalibrationBin[]): CalibrationPoint[] {
  return [...bins]
    .sort((a, b) => a.bin - b.bin)
    .map((bin) => {
      const populated = bin.count > 0 && bin.observedFreq !== null && bin.meanForecast !== null;
      return {
        bin: bin.bin,
        x: populated && bin.meanForecast !== null ? bin.meanForecast : midpoint(bin.range),
        observedFreq: populated ? bin.observedFreq : null,
        meanForecast: populated ? bin.meanForecast : null,
        count: bin.count,
        label: `${bin.range[0].toFixed(1)}–${bin.range[1].toFixed(1)}`,
      };
    });
}

export const populatedBins = (points: readonly CalibrationPoint[]): CalibrationPoint[] =>
  points.filter((point) => point.observedFreq !== null);

/**
 * Count-weighted mean of (observed frequency − mean forecast) across populated bins.
 *
 * Positive means outcomes came in above the forecasts on average — the points sit above the
 * diagonal. Negative means the reverse. It is a summary of the picture, not a new metric:
 * nothing downstream consumes it, and the scored numbers come from the pipeline.
 */
export function signedDeviation(points: readonly CalibrationPoint[]): number | null {
  const populated = populatedBins(points);
  const weight = populated.reduce((total, point) => total + point.count, 0);
  if (weight === 0) return null;

  const weighted = populated.reduce(
    (total, point) => total + point.count * ((point.observedFreq ?? 0) - (point.meanForecast ?? 0)),
    0,
  );
  return round4(weighted / weight);
}
