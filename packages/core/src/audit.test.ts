import { describe, expect, it } from 'vitest';

import { canonicalJson } from './audit.js';
import { InvalidInputError } from './errors.js';

describe('canonicalJson', () => {
  it('is invariant to key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe(canonicalJson({ c: 3, a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { d: 1, a: 2 } })).toBe('{"z":{"a":2,"d":1}}');
  });

  it('keeps array order, which carries meaning', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('writes a bigint as a decimal string, losing no precision', () => {
    expect(canonicalJson({ v: 123456789012345678901234567890n })).toBe(
      '{"v":"123456789012345678901234567890"}',
    );
  });

  it('omits undefined rather than emitting it', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses a value that cannot be canonicalised', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(InvalidInputError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(InvalidInputError);
    expect(() => canonicalJson(() => 1)).toThrow(InvalidInputError);
  });
});
