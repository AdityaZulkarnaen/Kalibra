import { CONVICTION_QUANTILE, CONVICTION_WINDOW, LAMBDA_MAX } from './constants.js';
import { InvalidInputError } from './errors.js';

/**
 * SCORING_SPEC.md section 3.2: p90 by the nearest-rank method.
 *
 * Nearest-rank rather than interpolation because it is reproducible across languages and
 * interpolation is not; anyone re-deriving a score in Python must land on the same number.
 */
export function referenceStake(window: readonly bigint[]): bigint {
  if (window.length === 0) {
    throw new InvalidInputError('referenceStake needs at least one stake in the window');
  }
  const sorted = [...window].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rank = Math.ceil(CONVICTION_QUANTILE * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  const value = sorted[index];
  if (value === undefined) {
    throw new InvalidInputError(`p90 index ${index} out of range for ${sorted.length} stakes`);
  }
  return value;
}

/**
 * SCORING_SPEC.md section 3.2. A wallet's first scored position always yields
 * S_ref = stake and therefore maximum conviction; that is a documented simplification,
 * and shrinkage (section 5.2) keeps it harmless at the score level.
 */
export function conviction(stake: bigint, sRef: bigint): number {
  if (stake < 0n) {
    throw new InvalidInputError(`stake must not be negative, received ${stake}`);
  }
  if (sRef < 0n) {
    throw new InvalidInputError(`S_ref must not be negative, received ${sRef}`);
  }
  if (stake === 0n || sRef === 0n) return 0;
  if (stake >= sRef) return LAMBDA_MAX;
  return LAMBDA_MAX * (Number(stake) / Number(sRef));
}

/**
 * Conviction for each position in a wallet's history, in the order given.
 *
 * The caller is responsible for that order — SCORING_SPEC.md section 7 requires
 * settled_at ASC then position_id ASC — because lambda depends on the trailing window and
 * a different order silently produces different scores.
 */
export function convictionSeries(stakes: readonly bigint[]): number[] {
  return stakes.map((stake, i) => {
    const window = stakes.slice(Math.max(0, i - CONVICTION_WINDOW + 1), i + 1);
    return conviction(stake, referenceStake(window));
  });
}
