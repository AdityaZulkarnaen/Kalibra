import { brierScore, brierSkillScore, shrinkSkillScore } from './brier.js';
import {
  calibrationBins,
  excessCalibrationError,
  expectedCalibrationError,
} from './calibration.js';
import { MIN_SAMPLE, SCORE_ANCHOR, SCORE_MAX, SCORE_MIN, W_BSS, W_ECE } from './constants.js';
import { rocAuc } from './discrimination.js';
import { InvalidInputError, assertFinite } from './errors.js';
import type { ForecastObservation, OutcomeY, WalletMetrics, WalletStatus } from './types.js';

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
