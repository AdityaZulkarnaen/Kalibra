/**
 * The five interpretation bands of `SCORING_SPEC.md` §6.2.
 *
 * The bands are published, so showing them is reporting the spec rather than inventing a
 * judgement. `market` is deliberately the neutral one: 500 is the metric's null value, and a
 * trader sitting on it has demonstrated neither edge nor noise.
 */

export type BandId = 'strong' | 'edge' | 'market' | 'noise' | 'worse';

export interface ScoreBand {
  readonly id: BandId;
  /** The label `SCORING_SPEC.md` §6.2 gives this range, in its own words. */
  readonly label: string;
  /** Lowest score in the band, inclusive. */
  readonly floor: number;
  /** Highest score in the band, inclusive. */
  readonly ceiling: number;
  /*
   * Class names are spelled out rather than composed, because Tailwind generates utilities by
   * finding their literal text in the source. A name built at runtime produces no CSS.
   */
  readonly text: string;
  readonly fill: string;
  readonly border: string;
  readonly background: string;
}

/** Ordered high to low, the way the table in §6.2 reads. */
export const SCORE_BANDS: readonly ScoreBand[] = [
  {
    id: 'strong',
    label: 'Strong edge over the market',
    floor: 800,
    ceiling: 1000,
    text: 'text-band-strong',
    fill: 'bg-band-strong',
    border: 'border-band-strong/40',
    background: 'bg-band-strong/10',
  },
  {
    id: 'edge',
    label: 'Measurable edge',
    floor: 600,
    ceiling: 799,
    text: 'text-band-edge',
    fill: 'bg-band-edge',
    border: 'border-band-edge/40',
    background: 'bg-band-edge/10',
  },
  {
    id: 'market',
    label: 'Approximately market-equivalent',
    floor: 450,
    ceiling: 599,
    text: 'text-band-market',
    fill: 'bg-band-market',
    border: 'border-band-market/30',
    background: 'bg-band-market/5',
  },
  {
    id: 'noise',
    label: 'Deviations from market were noise',
    floor: 250,
    ceiling: 449,
    text: 'text-band-noise',
    fill: 'bg-band-noise',
    border: 'border-band-noise/40',
    background: 'bg-band-noise/10',
  },
  {
    id: 'worse',
    label: 'Systematically worse than the market',
    floor: 0,
    ceiling: 249,
    text: 'text-band-worse',
    fill: 'bg-band-worse',
    border: 'border-band-worse/40',
    background: 'bg-band-worse/10',
  },
];

const LOWEST = SCORE_BANDS[SCORE_BANDS.length - 1] as ScoreBand;

/**
 * The band a published score falls in.
 *
 * Only ever called with a RANKED score. A PROVISIONAL wallet has no number to place, and
 * `scoreDisplay` in `format.ts` is what keeps it that way.
 */
export function scoreBand(score: number): ScoreBand {
  return SCORE_BANDS.find((band) => score >= band.floor) ?? LOWEST;
}
