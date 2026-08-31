import { describe, expect, it } from 'vitest';

import { LAMBDA_MAX, PROB_MAX, PROB_MIN } from './constants.js';
import { InvalidInputError } from './errors.js';
import { clampProbability, computeForecast } from './forecast.js';

/** A deterministic grid stands in for randomised property testing: invariant I6. */
const PROBABILITIES = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
const LAMBDAS = Array.from({ length: 51 }, (_, i) => i / 100);

describe('clampProbability (SCORING_SPEC 2)', () => {
  it('leaves an interior probability untouched', () => {
    expect(clampProbability(0.5)).toBe(0.5);
  });

  it('pulls the endpoints inside the interval', () => {
    expect(clampProbability(0)).toBe(PROB_MIN);
    expect(clampProbability(1)).toBe(PROB_MAX);
    expect(clampProbability(0.004)).toBe(PROB_MIN);
    expect(clampProbability(0.996)).toBe(PROB_MAX);
  });

  it('rejects values that are not probabilities at all', () => {
    expect(() => clampProbability(Number.NaN)).toThrow(InvalidInputError);
    expect(() => clampProbability(1.5)).toThrow(InvalidInputError);
    expect(() => clampProbability(-0.5)).toThrow(InvalidInputError);
  });
});

describe('computeForecast (SCORING_SPEC 3.3)', () => {
  it('equals the market price at zero conviction, for both sides', () => {
    for (const p of PROBABILITIES) {
      expect(computeForecast(p, 'UP', 0)).toBe(p);
      expect(computeForecast(p, 'DOWN', 0)).toBe(p);
    }
  });

  it('reaches certainty at full conviction', () => {
    for (const p of PROBABILITIES) {
      expect(computeForecast(p, 'UP', 1)).toBe(1);
      expect(computeForecast(p, 'DOWN', 1)).toBe(0);
    }
  });

  it('stays strictly inside (0, 1) across the whole operating range', () => {
    for (const p of PROBABILITIES) {
      for (const lambda of LAMBDAS) {
        for (const side of ['UP', 'DOWN'] as const) {
          const f = computeForecast(p, side, lambda);
          expect(f).toBeGreaterThan(0);
          expect(f).toBeLessThan(1);
        }
      }
    }
  });

  it('leans away from the market in the direction of the position', () => {
    for (const p of PROBABILITIES) {
      for (const lambda of LAMBDAS.filter((l) => l > 0)) {
        expect(computeForecast(p, 'UP', lambda)).toBeGreaterThan(p);
        expect(computeForecast(p, 'DOWN', lambda)).toBeLessThan(p);
      }
    }
  });

  it('is monotone in lambda: up increases, down decreases', () => {
    for (const p of PROBABILITIES) {
      for (let i = 1; i < LAMBDAS.length; i += 1) {
        const previous = LAMBDAS[i - 1] as number;
        const current = LAMBDAS[i] as number;
        expect(computeForecast(p, 'UP', current)).toBeGreaterThan(
          computeForecast(p, 'UP', previous),
        );
        expect(computeForecast(p, 'DOWN', current)).toBeLessThan(
          computeForecast(p, 'DOWN', previous),
        );
      }
    }
  });

  it('rejects a lambda outside [0, 1]', () => {
    expect(() => computeForecast(0.5, 'UP', -0.1)).toThrow(InvalidInputError);
    expect(() => computeForecast(0.5, 'UP', 1.1)).toThrow(InvalidInputError);
    expect(LAMBDA_MAX).toBeLessThanOrEqual(1);
  });
});
