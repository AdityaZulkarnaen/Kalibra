/**
 * The parameter set the whole product is anchored on. Defined once here so that
 * `params_hash` (API_SPEC.md 1.2) has exactly one source to hash, and so that a tuning
 * change is a one-line diff rather than a search-and-replace across the scoring path.
 *
 * Values are normative in SCORING_SPEC.md section 1.
 */

/** Maximum conviction lean. */
export const LAMBDA_MAX = 0.5;

/** Empirical-Bayes shrinkage constant. */
export const SHRINK_K = 25;

/** Resolved positions required to leave PROVISIONAL. */
export const MIN_SAMPLE = 30;

/** Equal-width calibration bins over [0, 1]. */
export const ECE_BINS = 10;

/**
 * Minimum stake for a position to be scored, in base units of the settlement token.
 *
 * Assumes 6 decimals (1 USDso). The token and its decimals are unverified — see
 * DREAMDEX_ADAPTER.md section 7, unknown U7. If U7 resolves to a different scale this
 * threshold is wrong by orders of magnitude, which is why it is a named constant.
 */
export const MIN_STAKE_BASE = 1_000_000n;

/** Weight on the shrunk Brier Skill Score. */
export const W_BSS = 1500;

/** Weight on excess calibration error. */
export const W_ECE = 100;

/** Score representing market-equivalent performance. */
export const SCORE_ANCHOR = 500;

export const SCORE_MIN = 0;
export const SCORE_MAX = 1000;

/** Zero-comparison tolerance for float guards. */
export const EPSILON = 1e-12;

/** SCORING_SPEC.md section 2: p is clamped to this range before any use. */
export const PROB_MIN = 0.01;
export const PROB_MAX = 0.99;

/** SCORING_SPEC.md section 3.2: S_ref is the p90 stake over the trailing window. */
export const CONVICTION_WINDOW = 100;
export const CONVICTION_QUANTILE = 0.9;

/**
 * SCORING_SPEC.md section 5.3: BSS is clamped to this range before shrinkage, so that one
 * pathological market cannot dominate a wallet's score.
 */
export const BSS_MIN = -5;
export const BSS_MAX = 1;
