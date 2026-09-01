import { InvalidInputError } from './errors.js';
import type { OutcomeY, Side } from './types.js';

/**
 * Profit and loss on a binary Event Contract position, in base units.
 *
 * `RISK_POLICY_SPEC.md` §3 requires `dailyRealisedPnl` and `dailyUnrealisedPnl` as inputs
 * to the daily-loss rule but does not say how they are computed, because nothing else in
 * the system needed a payoff model until Guard did. This is that model, stated once.
 *
 * A trader who risks stake S at implied probability p on a side that pays 1 holds S/p
 * contracts. If the side wins, the contracts pay S/p, so the profit is S(1−p)/p. If it
 * loses, the whole stake is gone. Prices are probabilities, so the DOWN side is priced at
 * 1−p and the arithmetic is symmetric.
 *
 * Every division floors. Floor on a gain understates it and floor on a loss overstates it,
 * so both directions err towards the limit binding sooner. A risk limit that rounds in the
 * agent's favour is worse than one that rounds against it.
 */

/** Probabilities enter as floats and are scaled to integers before any bigint division. */
const PRICE_SCALE = 1_000_000_000n;

function scalePrice(probability: number, label: string): bigint {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new InvalidInputError(`${label} must be strictly inside (0, 1), got ${probability}`);
  }
  const scaled = BigInt(Math.round(probability * Number(PRICE_SCALE)));
  if (scaled <= 0n || scaled >= PRICE_SCALE) {
    throw new InvalidInputError(`${label} rounded to a degenerate price: ${probability}`);
  }
  return scaled;
}

/** The price this side actually paid: p for UP, 1−p for DOWN. */
function entryPrice(impliedProbUp: number, side: Side): bigint {
  const up = scalePrice(impliedProbUp, 'impliedProbUp');
  return side === 'UP' ? up : PRICE_SCALE - up;
}

export interface GuardPosition {
  readonly marketId: string;
  readonly side: Side;
  /** Base units risked. */
  readonly stake: bigint;
  /** The market-implied P(UP) the position was opened at. */
  readonly impliedProbUp: number;
}

/**
 * What the position is worth once the market settles, minus what it cost.
 *
 * A win returns stake × (1 − price) / price. A loss returns the stake, negated. A VOID
 * market returns the stake, so the position nets zero — Guard does not treat a refund as
 * a loss, because nothing was decided.
 */
export function realisedPnl(position: GuardPosition, outcome: OutcomeY | 'VOID'): bigint {
  if (outcome === 'VOID') return 0n;
  const price = entryPrice(position.impliedProbUp, position.side);
  const won = (position.side === 'UP') === (outcome === 1);
  if (!won) return -position.stake;
  return (position.stake * (PRICE_SCALE - price)) / price;
}

/**
 * What the position is worth right now, minus what it cost.
 *
 * `markProbUp` is the current market-implied P(UP). Passing the entry probability back in
 * gives exactly zero, which is what a caller with no fresh quote should do: marking at
 * cost never invents a gain, and the degradation is visible because the caller had to
 * choose it.
 */
export function unrealisedPnl(position: GuardPosition, markProbUp: number): bigint {
  const entry = entryPrice(position.impliedProbUp, position.side);
  const mark = entryPrice(markProbUp, position.side);
  return (position.stake * mark) / entry - position.stake;
}

export const sumPnl = (values: readonly bigint[]): bigint =>
  values.reduce((total, value) => total + value, 0n);
