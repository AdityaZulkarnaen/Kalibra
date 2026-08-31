import { PROB_MAX, PROB_MIN } from './constants.js';
import { InvalidInputError } from './errors.js';
import type { Side } from './types.js';

/**
 * SCORING_SPEC.md section 2. A quoted probability of exactly 0 or 1 makes the log-scoring
 * diagnostic infinite and gives the conviction model degenerate behaviour, so it is pulled
 * inside the interval. Callers persist the pre-clamp value in `positions.raw_p`.
 */
export function clampProbability(rawP: number): number {
  if (!Number.isFinite(rawP)) {
    throw new InvalidInputError(`p must be finite, received ${rawP}`);
  }
  if (rawP < 0 || rawP > 1) {
    throw new InvalidInputError(`p must lie in [0, 1], received ${rawP}`);
  }
  if (rawP < PROB_MIN) return PROB_MIN;
  if (rawP > PROB_MAX) return PROB_MAX;
  return rawP;
}

/**
 * SCORING_SPEC.md section 3.3. Both branches are one operation seen from either end: move
 * `p` toward the certainty the position implies, by fraction `lambda` of the remaining
 * distance. At lambda = 0 the forecast is exactly the market price, which is the correct
 * null behaviour and what anchors the score at 500.
 */
export function computeForecast(p: number, side: Side, lambda: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new InvalidInputError(`p must lie in [0, 1], received ${p}`);
  }
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new InvalidInputError(`lambda must lie in [0, 1], received ${lambda}`);
  }
  return side === 'UP' ? p + lambda * (1 - p) : p * (1 - lambda);
}
