import { describe, expect, it } from 'vitest';

import { rocAuc } from './discrimination.js';
import { InvalidInputError } from './errors.js';

describe('rocAuc (SCORING_SPEC 5.6)', () => {
  it('is 1 when every winner is forecast above every loser — the V3 case', () => {
    expect(rocAuc([0.8, 0.75, 0.2, 0.275], [1, 1, 0, 1])).toBe(1);
  });

  it('is 0 when the ordering is exactly inverted', () => {
    expect(rocAuc([0.2, 0.8], [1, 0])).toBe(0);
  });

  it('counts a tie as half a concordant pair', () => {
    expect(rocAuc([0.5, 0.5], [1, 0])).toBe(0.5);
    expect(rocAuc([0.6, 0.6, 0.4], [1, 0, 0])).toBe(0.75);
  });

  it('is null when either outcome class is empty', () => {
    expect(rocAuc([0.7, 0.3], [1, 1])).toBeNull();
    expect(rocAuc([0.7, 0.3], [0, 0])).toBeNull();
    expect(rocAuc([], [])).toBeNull();
  });

  it('rejects mismatched inputs', () => {
    expect(() => rocAuc([0.5], [1, 0])).toThrow(InvalidInputError);
  });
});
