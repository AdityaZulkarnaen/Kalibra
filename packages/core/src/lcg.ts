import { InvalidInputError } from './errors.js';

/**
 * The 32-bit linear congruential generator with Numerical Recipes parameters, defined
 * normatively in SCORING_SPEC.md section 8 for test vector V4.
 *
 * It lives in core, and that is deliberate. It is a pure function of its seed — the same
 * seed yields the same sequence forever — so it is not the kind of randomness invariant I1
 * forbids; nothing here reads the machine. Keeping it here also means the numeric vectors
 * and the synthetic fixtures draw from one implementation rather than two that can drift
 * apart, which DREAMDEX_ADAPTER.md section 9 requires.
 *
 * These constants are not part of the scoring parameter set and must stay out of
 * `constants.ts`, or they would end up inside `params_hash` (API_SPEC.md 1.2) and make a
 * fixture change look like a scoring change.
 */
export const LCG_MULTIPLIER = 1_664_525;
export const LCG_INCREMENT = 1_013_904_223;
export const LCG_MODULUS = 2 ** 32;

/**
 * One state transition. `>>> 0` performs the mod 2^32; the product stays below 2^53 for
 * any 32-bit state, so the arithmetic is exact in a double and no BigInt is needed.
 */
export function lcgNext(state: number): number {
  return (LCG_MULTIPLIER * state + LCG_INCREMENT) >>> 0;
}

export interface Lcg {
  /** Advance and return the raw 32-bit state. */
  next(): number;
  /** Advance and return a value in [0, 1). */
  unit(): number;
}

export function createLcg(seed: number): Lcg {
  if (!Number.isInteger(seed) || seed < 0 || seed >= LCG_MODULUS) {
    throw new InvalidInputError(`seed must be an integer in [0, 2^32), received ${seed}`);
  }
  let state = seed;
  const advance = (): number => {
    state = lcgNext(state);
    return state;
  };
  return { next: advance, unit: () => advance() / LCG_MODULUS };
}
