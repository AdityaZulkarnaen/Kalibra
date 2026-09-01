import { InvalidInputError } from './errors.js';

/**
 * Canonical JSON: the same value always serialises to the same bytes.
 *
 * Object keys are emitted in sorted order, so a value assembled in a different order
 * hashes identically. Bigints become decimal strings, matching how they cross every other
 * boundary in this system (API_SPEC.md section 2.1).
 *
 * The Guard hash chain in RISK_POLICY_SPEC.md builds on this and lands on day 6; today it
 * exists because `params_hash` (API_SPEC.md 1.2) needs a canonical form to hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(`cannot canonicalise a non-finite number: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new InvalidInputError(`cannot canonicalise a value of type ${typeof value}`);
}
