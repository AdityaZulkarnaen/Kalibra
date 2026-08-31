import { BSS_MAX, BSS_MIN, EPSILON, SHRINK_K } from './constants.js';
import { InvalidInputError, assertFinite } from './errors.js';
import type { OutcomeY } from './types.js';

/**
 * SCORING_SPEC.md section 5.1. Lower is better, range [0, 1].
 *
 * The sum accumulates in the order given, which the caller has already sorted; a
 * different accumulation order would change the last bits of the result and break the
 * byte-identical guarantee in invariant I6.
 */
export function brierScore(forecasts: readonly number[], outcomes: readonly OutcomeY[]): number {
  if (forecasts.length !== outcomes.length) {
    throw new InvalidInputError(
      `forecasts (${forecasts.length}) and outcomes (${outcomes.length}) must be the same length`,
    );
  }
  if (forecasts.length === 0) {
    throw new InvalidInputError('brierScore is undefined for an empty set');
  }
  let total = 0;
  for (let i = 0; i < forecasts.length; i += 1) {
    const f = forecasts[i];
    const y = outcomes[i];
    if (f === undefined || y === undefined) {
      throw new InvalidInputError(`missing forecast or outcome at index ${i}`);
    }
    if (!Number.isFinite(f) || f < 0 || f > 1) {
      throw new InvalidInputError(`forecast at index ${i} must lie in [0, 1], received ${f}`);
    }
    const error = f - y;
    total += error * error;
  }
  return assertFinite(total / forecasts.length, 'brierScore');
}

/**
 * SCORING_SPEC.md sections 5.2 and 5.3.
 *
 * The two degenerate branches exist because a perfect market makes the ratio undefined.
 * They are decided explicitly rather than left to IEEE division, which would hand NaN or
 * Infinity to the database.
 */
export function brierSkillScore(bsTrader: number, bsMarket: number): number {
  if (!Number.isFinite(bsTrader) || bsTrader < 0) {
    throw new InvalidInputError(`BS_trader must be finite and non-negative, received ${bsTrader}`);
  }
  if (!Number.isFinite(bsMarket) || bsMarket < 0) {
    throw new InvalidInputError(`BS_market must be finite and non-negative, received ${bsMarket}`);
  }
  if (bsMarket < EPSILON) {
    return bsTrader < EPSILON ? 0 : -1;
  }
  return assertFinite(1 - bsTrader / bsMarket, 'brierSkillScore');
}

/**
 * SCORING_SPEC.md section 5.2, with the clamp from 5.3 applied first.
 *
 * Regression toward a prior mean of zero: it is what stops three lucky trades from topping
 * the board, and it is the reason a wallet's first maximum-conviction position is harmless.
 */
export function shrinkSkillScore(bss: number, n: number): number {
  if (!Number.isFinite(bss)) {
    throw new InvalidInputError(`BSS must be finite, received ${bss}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidInputError(`n must be a positive integer, received ${n}`);
  }
  const clamped = Math.min(Math.max(bss, BSS_MIN), BSS_MAX);
  return assertFinite(clamped * (n / (n + SHRINK_K)), 'shrinkSkillScore');
}
