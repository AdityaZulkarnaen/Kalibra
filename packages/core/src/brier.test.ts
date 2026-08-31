import { describe, expect, it } from 'vitest';

import { brierScore, brierSkillScore, shrinkSkillScore } from './brier.js';
import { SHRINK_K } from './constants.js';
import { InvalidInputError } from './errors.js';

describe('brierScore (SCORING_SPEC 5.1)', () => {
  it('reproduces the V3 trader and market scores', () => {
    expect(brierScore([0.8, 0.75, 0.2, 0.275], [1, 1, 0, 1])).toBeCloseTo(0.16703125, 9);
    expect(brierScore([0.6, 0.5, 0.4, 0.55], [1, 1, 0, 1])).toBeCloseTo(0.193125, 9);
  });

  it('is zero for a perfect forecaster and one for a perfectly wrong one', () => {
    expect(brierScore([1, 0], [1, 0])).toBe(0);
    expect(brierScore([0, 1], [1, 0])).toBe(1);
  });

  it('refuses an empty or mismatched set rather than returning a number', () => {
    expect(() => brierScore([], [])).toThrow(InvalidInputError);
    expect(() => brierScore([0.5], [1, 0])).toThrow(InvalidInputError);
    expect(() => brierScore([1.5], [1])).toThrow(InvalidInputError);
  });
});

describe('brierSkillScore (SCORING_SPEC 5.2, 5.3)', () => {
  it('is zero when the trader matches the market', () => {
    expect(brierSkillScore(0.27, 0.27)).toBe(0);
  });

  it('reproduces the V3 skill score', () => {
    expect(brierSkillScore(0.16703125, 0.193125)).toBeCloseTo(0.13511326860841422, 9);
  });

  it('is negative when the deviations were noise', () => {
    expect(brierSkillScore(0.4, 0.2)).toBe(-1);
  });

  it('handles a perfect market without dividing by zero', () => {
    expect(brierSkillScore(0, 0)).toBe(0);
    expect(brierSkillScore(1e-15, 1e-15)).toBe(0);
    expect(brierSkillScore(0.3, 0)).toBe(-1);
    expect(Number.isFinite(brierSkillScore(0.3, 0))).toBe(true);
  });

  it('rejects impossible Brier scores', () => {
    expect(() => brierSkillScore(-0.1, 0.2)).toThrow(InvalidInputError);
    expect(() => brierSkillScore(Number.NaN, 0.2)).toThrow(InvalidInputError);
  });
});

describe('shrinkSkillScore (SCORING_SPEC 5.2)', () => {
  it('keeps n / (n + k) of the measured skill', () => {
    expect(shrinkSkillScore(1, 5)).toBeCloseTo(5 / (5 + SHRINK_K), 12);
    expect(shrinkSkillScore(1, 25)).toBeCloseTo(0.5, 12);
    expect(shrinkSkillScore(1, 100)).toBeCloseTo(0.8, 12);
  });

  it('reproduces the V3 shrunk score', () => {
    expect(shrinkSkillScore(0.13511326860841422, 4)).toBeCloseTo(0.018636312911505408, 9);
  });

  it('clamps a pathological skill score to -5 before shrinking', () => {
    expect(shrinkSkillScore(-40, 10)).toBe(shrinkSkillScore(-5, 10));
  });

  it('rejects a non-positive sample count', () => {
    expect(() => shrinkSkillScore(0.5, 0)).toThrow(InvalidInputError);
    expect(() => shrinkSkillScore(0.5, 1.5)).toThrow(InvalidInputError);
  });
});
