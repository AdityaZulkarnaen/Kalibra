import { InvalidInputError, assertFinite } from './errors.js';
import type { OutcomeY } from './types.js';

/**
 * SCORING_SPEC.md section 5.6. ROC-AUC by exhaustive pair counting.
 *
 * O(n squared) and deliberately so: at this scale it costs nothing, ties are handled
 * correctly and obviously, and the code reads identically to the definition. A sort-based
 * rank method would be faster and harder to check against the spec.
 *
 * Reported but not scored — it is scale-free and would double-count what BSS measures.
 */
export function rocAuc(forecasts: readonly number[], outcomes: readonly OutcomeY[]): number | null {
  if (forecasts.length !== outcomes.length) {
    throw new InvalidInputError(
      `forecasts (${forecasts.length}) and outcomes (${outcomes.length}) must be the same length`,
    );
  }
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let i = 0; i < forecasts.length; i += 1) {
    const f = forecasts[i];
    const y = outcomes[i];
    if (f === undefined || y === undefined) {
      throw new InvalidInputError(`missing forecast or outcome at index ${i}`);
    }
    if (!Number.isFinite(f)) {
      throw new InvalidInputError(`forecast at index ${i} must be finite, received ${f}`);
    }
    (y === 1 ? positives : negatives).push(f);
  }
  if (positives.length === 0 || negatives.length === 0) return null;

  let concordant = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) concordant += 1;
      else if (positive === negative) concordant += 0.5;
    }
  }
  return assertFinite(concordant / (positives.length * negatives.length), 'rocAuc');
}
