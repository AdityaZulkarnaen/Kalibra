import { ECE_BINS } from './constants.js';
import { InvalidInputError, assertFinite } from './errors.js';
import type { CalibrationBin, OutcomeY } from './types.js';

interface Bucket {
  count: number;
  forecastSum: number;
  outcomeSum: number;
}

/**
 * SCORING_SPEC.md section 5.4. Bins are left-closed and right-open except the last, which
 * is closed, so f = 0.80 falls in bin 8 rather than bin 7. An off-by-one here silently
 * corrupts every calibration curve in the product, which is why the boundary is pinned by
 * test vector V3.
 */
export function binIndex(f: number): number {
  if (!Number.isFinite(f) || f < 0 || f > 1) {
    throw new InvalidInputError(`forecast must lie in [0, 1], received ${f}`);
  }
  return Math.min(Math.floor(f * ECE_BINS), ECE_BINS - 1);
}

/** Inclusive lower and exclusive upper edge of a bin, for labelling the chart axis. */
export function binRange(bin: number): readonly [number, number] {
  if (!Number.isInteger(bin) || bin < 0 || bin >= ECE_BINS) {
    throw new InvalidInputError(`bin must be an integer in [0, ${ECE_BINS - 1}], received ${bin}`);
  }
  return [bin / ECE_BINS, (bin + 1) / ECE_BINS];
}

/**
 * All ECE_BINS bins, including empty ones. Empty bins carry null statistics rather than
 * zeros: zero would render as a point at the origin and read as evidence, which it is not.
 */
export function calibrationBins(
  forecasts: readonly number[],
  outcomes: readonly OutcomeY[],
): CalibrationBin[] {
  const buckets = accumulate(forecasts, outcomes);
  return buckets.map((bucket, bin) => ({
    bin,
    count: bucket.count,
    meanForecast: bucket.count === 0 ? null : bucket.forecastSum / bucket.count,
    observedFrequency: bucket.count === 0 ? null : bucket.outcomeSum / bucket.count,
  }));
}

/**
 * SCORING_SPEC.md section 5.4. Empty bins contribute nothing; the sum runs in ascending
 * bin order so the floating-point result is reproducible.
 */
export function expectedCalibrationError(
  forecasts: readonly number[],
  outcomes: readonly OutcomeY[],
): number {
  if (forecasts.length === 0) {
    throw new InvalidInputError('expectedCalibrationError is undefined for an empty set');
  }
  let ece = 0;
  for (const bin of calibrationBins(forecasts, outcomes)) {
    if (bin.count === 0 || bin.meanForecast === null || bin.observedFrequency === null) continue;
    ece += (bin.count / forecasts.length) * Math.abs(bin.meanForecast - bin.observedFrequency);
  }
  return assertFinite(ece, 'expectedCalibrationError');
}

/**
 * SCORING_SPEC.md section 5.5. The penalty is on being less calibrated than the market,
 * not on absolute miscalibration: the conviction model deliberately pushes forecasts away
 * from p, so absolute ECE would punish traders for our own modelling choice. Beating the
 * market earns no bonus here because BSS already counts it.
 */
export function excessCalibrationError(eceTrader: number, eceMarket: number): number {
  if (!Number.isFinite(eceTrader) || !Number.isFinite(eceMarket)) {
    throw new InvalidInputError(`ECE values must be finite, received ${eceTrader}, ${eceMarket}`);
  }
  return Math.max(0, eceTrader - eceMarket);
}

function accumulate(forecasts: readonly number[], outcomes: readonly OutcomeY[]): Bucket[] {
  if (forecasts.length !== outcomes.length) {
    throw new InvalidInputError(
      `forecasts (${forecasts.length}) and outcomes (${outcomes.length}) must be the same length`,
    );
  }
  const buckets: Bucket[] = Array.from({ length: ECE_BINS }, () => ({
    count: 0,
    forecastSum: 0,
    outcomeSum: 0,
  }));
  for (let i = 0; i < forecasts.length; i += 1) {
    const f = forecasts[i];
    const y = outcomes[i];
    if (f === undefined || y === undefined) {
      throw new InvalidInputError(`missing forecast or outcome at index ${i}`);
    }
    const bucket = buckets[binIndex(f)];
    if (bucket === undefined) {
      throw new InvalidInputError(`bin index out of range for forecast ${f}`);
    }
    bucket.count += 1;
    bucket.forecastSum += f;
    bucket.outcomeSum += y;
  }
  return buckets;
}
