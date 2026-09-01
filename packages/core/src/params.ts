import { createHash } from 'node:crypto';

import { canonicalJson } from './audit.js';
import {
  ECE_BINS,
  EPSILON,
  LAMBDA_MAX,
  MIN_SAMPLE,
  MIN_STAKE_BASE,
  SCORE_ANCHOR,
  SCORE_MAX,
  SCORE_MIN,
  SHRINK_K,
  W_BSS,
  W_ECE,
} from './constants.js';

/**
 * The parameter set that API_SPEC.md section 1.2 hashes onto every score row, so it is
 * always visible which scores were computed under which parameters.
 *
 * These are exactly the eleven rows of the SCORING_SPEC.md section 1 table, and no more.
 * Other constants in `constants.ts` also affect a score — the probability clamp of section
 * 2, the conviction window of section 3.2, the BSS clamp of section 5.3 — but they are
 * fixed by prose rather than listed in that table, so including them would make this hash
 * disagree with any independent implementation of 1.2. Moving one of them is a
 * specification change, not a tuning knob.
 */
export const SCORING_PARAMS = {
  LAMBDA_MAX,
  SHRINK_K,
  MIN_SAMPLE,
  ECE_BINS,
  MIN_STAKE_BASE,
  W_BSS,
  W_ECE,
  SCORE_ANCHOR,
  SCORE_MIN,
  SCORE_MAX,
  EPSILON,
} as const;

/** Lowercase hex, `0x`-prefixed, matching the API examples. */
export function paramsHash(): string {
  return `0x${createHash('sha256').update(canonicalJson(SCORING_PARAMS)).digest('hex')}`;
}
