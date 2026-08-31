/** Direction of an Event Contract position, always expressed in the UP frame. */
export type Side = 'UP' | 'DOWN';

/**
 * Settled outcome relative to UP: 1 if the contract settled UP, 0 if DOWN.
 *
 * SCORING_SPEC.md section 3.4 forbids a "was the trader right" boolean anywhere in the
 * scoring path — sides are handled symmetrically by the math, and a correctness flag only
 * invites sign errors.
 */
export type OutcomeY = 0 | 1;

export type WalletStatus = 'RANKED' | 'PROVISIONAL';

/** Where `p` came from. LAST means mid was unavailable and the value is degraded. */
export type QuoteSource = 'MID' | 'LAST';

/** One resolved forecast: what the market said, what the trader implied, what happened. */
export interface ForecastObservation {
  /** Market-implied P(UP), already clamped per SCORING_SPEC.md section 2. */
  readonly p: number;
  /** The trader's point forecast of P(UP), from SCORING_SPEC.md section 3.3. */
  readonly f: number;
  readonly y: OutcomeY;
}

/**
 * One calibration bin. Empty bins are returned with `count: 0` and null statistics so the
 * chart can render a gap rather than interpolating across missing evidence.
 */
export interface CalibrationBin {
  readonly bin: number;
  readonly count: number;
  readonly meanForecast: number | null;
  readonly observedFrequency: number | null;
}

/** Everything the scoring pipeline produces for one wallet. Mirrors API_SPEC.md 2.2. */
export interface WalletMetrics {
  readonly n: number;
  readonly bsTrader: number | null;
  readonly bsMarket: number | null;
  readonly bss: number | null;
  readonly bssShrunk: number | null;
  readonly eceTrader: number | null;
  readonly eceMarket: number | null;
  readonly eceExcess: number | null;
  /** Null when one outcome class is absent — AUC is undefined there. */
  readonly auc: number | null;
  /** Null while PROVISIONAL. SCORING_SPEC.md section 6.1: a number from 4 samples misleads. */
  readonly score: number | null;
  /** Computed even while PROVISIONAL so history is continuous across the threshold. */
  readonly scoreInternal: number | null;
  readonly status: WalletStatus;
  readonly calibration: readonly CalibrationBin[];
}
