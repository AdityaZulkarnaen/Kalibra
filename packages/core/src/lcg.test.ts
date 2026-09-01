import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { LCG_MODULUS, createLcg, lcgNext } from './lcg.js';

describe('createLcg (SCORING_SPEC 8)', () => {
  it('reproduces the first three draws for seed 42', () => {
    const rng = createLcg(42);
    expect(rng.next()).toBe(1083814273);
    expect(rng.next()).toBe(378494188);
    expect(rng.next()).toBe(2479403867);
  });

  it('yields units strictly inside [0, 1)', () => {
    const rng = createLcg(42);
    for (let i = 0; i < 1000; i += 1) {
      const u = rng.unit();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('stays inside 32 bits however far it runs', () => {
    let state = 42;
    for (let i = 0; i < 10_000; i += 1) {
      state = lcgNext(state);
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThan(LCG_MODULUS);
    }
  });

  it('is a function of the seed alone — two instances never diverge', () => {
    const a = createLcg(42);
    const b = createLcg(42);
    for (let i = 0; i < 200; i += 1) expect(a.next()).toBe(b.next());
  });

  it('rejects a seed that is not a 32-bit unsigned integer', () => {
    expect(() => createLcg(-1)).toThrow(InvalidInputError);
    expect(() => createLcg(1.5)).toThrow(InvalidInputError);
    expect(() => createLcg(LCG_MODULUS)).toThrow(InvalidInputError);
  });
});
