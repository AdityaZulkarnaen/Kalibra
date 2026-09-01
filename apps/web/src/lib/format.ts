/**
 * Display rules. Pure, so the ones that carry a promise can be tested.
 */

export type ScoreDisplay =
  | { readonly kind: 'score'; readonly value: number }
  | { readonly kind: 'provisional'; readonly n: number; readonly minSample: number };

/**
 * A PROVISIONAL wallet never renders a number.
 *
 * `PRD.md` §4.1 exists to stop a rank being read without the sample behind it, and the
 * sharpest version of that failure is a three-digit score computed from four positions.
 * The API already withholds the score, and this withholds it a second time: if a future
 * change ever lets a number through, it still does not reach the page.
 */
export function scoreDisplay(
  entry: {
    readonly score: number | null;
    readonly status: 'RANKED' | 'PROVISIONAL';
    readonly n: number;
  },
  minSample: number,
): ScoreDisplay {
  if (entry.status !== 'RANKED' || entry.score === null) {
    return { kind: 'provisional', n: entry.n, minSample };
  }
  return { kind: 'score', value: entry.score };
}

/** Null is a real answer — a statistic that could not be computed — and reads as a dash. */
export const num = (value: number | null | undefined, digits = 4): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

export const shortAddress = (address: string): string =>
  address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;

export const shortHash = (hash: string): string =>
  hash.length <= 14 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
