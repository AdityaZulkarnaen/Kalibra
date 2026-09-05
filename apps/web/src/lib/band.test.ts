import { describe, expect, it } from 'vitest';

import { SCORE_BANDS, scoreBand } from './band';

describe('scoreBand', () => {
  it.each([
    [1000, 'strong'],
    [800, 'strong'],
    [799, 'edge'],
    [600, 'edge'],
    [599, 'market'],
    [450, 'market'],
    [449, 'noise'],
    [250, 'noise'],
    [249, 'worse'],
    [0, 'worse'],
  ])('places %i in the %s band', (score, id) => {
    expect(scoreBand(score).id).toBe(id);
  });

  it('anchors 500 in the neutral band', () => {
    // 500 is the metric's null value. A band that read as good or bad here would contradict
    // the anchor SCORING_SPEC.md 6 is built on.
    expect(scoreBand(500).id).toBe('market');
  });

  it('covers the whole 0..1000 range with no gap and no overlap', () => {
    const ascending = [...SCORE_BANDS].reverse();
    expect(ascending[0]?.floor).toBe(0);
    expect(ascending[ascending.length - 1]?.ceiling).toBe(1000);
    for (let i = 1; i < ascending.length; i += 1) {
      expect(ascending[i]?.floor).toBe((ascending[i - 1]?.ceiling ?? -1) + 1);
    }
  });

  it('agrees with the band table it was derived from at every boundary', () => {
    for (const band of SCORE_BANDS) {
      expect(scoreBand(band.floor)).toBe(band);
      expect(scoreBand(band.ceiling)).toBe(band);
    }
  });
});
