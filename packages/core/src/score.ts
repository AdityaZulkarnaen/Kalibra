import { brierScore, brierSkillScore, shrinkSkillScore } from './brier.js';
import {
  calibrationBins,
  excessCalibrationError,
  expectedCalibrationError,
} from './calibration.js';
import { MIN_SAMPLE, SCORE_ANCHOR, SCORE_MAX, SCORE_MIN, W_BSS, W_ECE } from './constants.js';
import { convictionSeries } from './conviction.js';
import { rocAuc } from './discrimination.js';
import { InvalidInputError, assertFinite } from './errors.js';
import { computeForecast } from './forecast.js';
import type { ForecastObservation, OutcomeY, Side, WalletMetrics, WalletStatus } from './types.js';

/**
 * SCORING_SPEC.md section 6. Math.round rounds half toward positive infinity, which
 * differs for negative values, and `raw` can be negative before clamping.
 */
export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** SCORING_SPEC.md section 6. 500 is market-equivalent with no excess miscalibration. */
export function kalibraScore(bssShrunk: number, eceExcess: number): number {
  if (!Number.isFinite(bssShrunk)) {
    throw new InvalidInputError(`BSS_shrunk must be finite, received ${bssShrunk}`);
  }
  if (!Number.isFinite(eceExcess) || eceExcess < 0) {
    throw new InvalidInputError(`ECE_excess must be finite and non-negative, got ${eceExcess}`);
  }
  const raw = SCORE_ANCHOR + W_BSS * bssShrunk - W_ECE * eceExcess;
  const rounded = roundHalfAwayFromZero(assertFinite(raw, 'raw score'));
  return Math.min(Math.max(rounded, SCORE_MIN), SCORE_MAX);
}

/**
 * Round to a fixed number of decimals under the same half-away-from-zero rule. Used by the
 * V4 generator and by fixture generation, which must agree to the last bit.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new InvalidInputError(`value must be finite, received ${value}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 15) {
    throw new InvalidInputError(`decimals must be an integer in [0, 15], received ${decimals}`);
  }
  const factor = 10 ** decimals;
  return roundHalfAwayFromZero(value * factor) / factor;
}

/** SCORING_SPEC.md section 6.1. */
export function walletStatus(n: number): WalletStatus {
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidInputError(`n must be a non-negative integer, received ${n}`);
  }
  return n >= MIN_SAMPLE ? 'RANKED' : 'PROVISIONAL';
}

/**
 * The whole of SCORING_SPEC.md section 5 and 6 over one wallet's resolved forecasts.
 *
 * Observations must already be in the order fixed by section 7 — settled_at ASC then
 * position_id ASC — because every sum here accumulates in the order given.
 */
export function computeWalletMetrics(observations: readonly ForecastObservation[]): WalletMetrics {
  const n = observations.length;
  if (n === 0) return emptyMetrics();

  const forecasts = observations.map((o) => o.f);
  const prices = observations.map((o) => o.p);
  const outcomes: OutcomeY[] = observations.map((o) => o.y);

  const bsTrader = brierScore(forecasts, outcomes);
  const bsMarket = brierScore(prices, outcomes);
  const bss = brierSkillScore(bsTrader, bsMarket);
  const bssShrunk = shrinkSkillScore(bss, n);

  const eceTrader = expectedCalibrationError(forecasts, outcomes);
  const eceMarket = expectedCalibrationError(prices, outcomes);
  const eceExcess = excessCalibrationError(eceTrader, eceMarket);

  const scoreInternal = kalibraScore(bssShrunk, eceExcess);
  const status = walletStatus(n);

  return {
    n,
    bsTrader,
    bsMarket,
    bss,
    bssShrunk,
    eceTrader,
    eceMarket,
    eceExcess,
    auc: rocAuc(forecasts, outcomes),
    score: status === 'RANKED' ? scoreInternal : null,
    scoreInternal,
    status,
    calibration: calibrationBins(forecasts, outcomes),
  };
}

/**
 * A wallet with no resolved positions. Every statistic is null rather than zero: zero
 * means "measurably bad" and absence of evidence is not evidence of absence.
 */
function emptyMetrics(): WalletMetrics {
  return {
    n: 0,
    bsTrader: null,
    bsMarket: null,
    bss: null,
    bssShrunk: null,
    eceTrader: null,
    eceMarket: null,
    eceExcess: null,
    auc: null,
    score: null,
    scoreInternal: null,
    status: walletStatus(0),
    calibration: calibrationBins([], []),
  };
}

/** One resolved, scoreable position. Excluded positions never reach this function. */
export interface ScorablePosition {
  readonly positionId: string;
  readonly side: Side;
  /** Clamped market-implied P(UP). */
  readonly p: number;
  readonly stake: bigint;
  readonly y: OutcomeY;
  readonly settledAt: number;
}

export interface ScoredPosition extends ScorablePosition {
  readonly lambda: number;
  readonly forecast: number;
}

export interface WalletScore {
  readonly metrics: WalletMetrics;
  /** In the order the pipeline scored them, which is the order section 7 fixes. */
  readonly positions: readonly ScoredPosition[];
}

/**
 * SCORING_SPEC.md section 7, in order.
 *
 * The sort is not a convenience. Lambda depends on the trailing window of a wallet's own
 * history, so a different order produces different forecasts and therefore different
 * scores — which is why invariant I6 forbids relying on database or map ordering.
 */
export function scoreWallet(positions: readonly ScorablePosition[]): WalletScore {
  const ordered = [...positions].sort(
    (a, b) =>
      a.settledAt - b.settledAt ||
      (a.positionId < b.positionId ? -1 : a.positionId > b.positionId ? 1 : 0),
  );

  const lambdas = convictionSeries(ordered.map((position) => position.stake));
  const scored: ScoredPosition[] = ordered.map((position, i) => {
    const lambda = lambdas[i];
    if (lambda === undefined) {
      throw new InvalidInputError(`conviction missing for position ${position.positionId}`);
    }
    return { ...position, lambda, forecast: computeForecast(position.p, position.side, lambda) };
  });

  const observations: ForecastObservation[] = scored.map((position) => ({
    p: position.p,
    f: position.forecast,
    y: position.y,
  }));

  return { metrics: computeWalletMetrics(observations), positions: scored };
}
