import { describe, expect, it } from 'vitest';

import { canonicalJson } from './audit.js';
import { LAMBDA_MAX, MIN_SAMPLE, MIN_STAKE_BASE, SHRINK_K } from './constants.js';
import { SCORING_PARAMS, paramsHash } from './params.js';

describe('paramsHash (API_SPEC 1.2)', () => {
  it('covers exactly the eleven rows of the SCORING_SPEC section 1 table', () => {
    expect(Object.keys(SCORING_PARAMS).sort()).toEqual([
      'ECE_BINS',
      'EPSILON',
      'LAMBDA_MAX',
      'MIN_SAMPLE',
      'MIN_STAKE_BASE',
      'SCORE_ANCHOR',
      'SCORE_MAX',
      'SCORE_MIN',
      'SHRINK_K',
      'W_BSS',
      'W_ECE',
    ]);
  });

  it('carries the published values', () => {
    expect(SCORING_PARAMS.LAMBDA_MAX).toBe(LAMBDA_MAX);
    expect(SCORING_PARAMS.SHRINK_K).toBe(SHRINK_K);
    expect(SCORING_PARAMS.MIN_SAMPLE).toBe(MIN_SAMPLE);
    expect(SCORING_PARAMS.MIN_STAKE_BASE).toBe(MIN_STAKE_BASE);
  });

  it('is a stable 0x-prefixed sha256', () => {
    expect(paramsHash()).toMatch(/^0x[0-9a-f]{64}$/);
    expect(paramsHash()).toBe(paramsHash());
  });

  it('changes when any parameter changes, which is the whole point', () => {
    const tweaked = canonicalJson({ ...SCORING_PARAMS, LAMBDA_MAX: 0.6 });
    expect(tweaked).not.toBe(canonicalJson(SCORING_PARAMS));
  });
});
