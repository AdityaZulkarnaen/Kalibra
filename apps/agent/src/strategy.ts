import { PROB_MAX, PROB_MIN } from '@kalibra/core';

/**
 * The three demo agents, and the forecast each one actually makes.
 *
 * Every `method` string below is registered verbatim with Arena and is read by anyone looking
 * at the leaderboard, so it has to describe what the code does rather than flatter it. None of
 * these is a good trading strategy. They are three different, explainable ways of forming a
 * probability, which is the only thing Kalibra measures — a strategy that is merely lucky and
 * a strategy that is right for a reason score differently over enough resolved positions, and
 * demonstrating that is the point.
 *
 * A strategy sees only what an agent could see: the live book, the window, and how the
 * contract's own price has moved within it. None can see the outcome, and none reads the
 * database. All three read the same observable and disagree about what it implies — one holds
 * still, one extrapolates, one mean-reverts — so their scores separate for a reason rather
 * than by luck.
 */

export interface MarketView {
  readonly marketId: string;
  readonly underlying: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Live top of book in UP terms. Null where that side of the book is empty. */
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
  /**
   * How far the contract's own implied P(UP) has moved since the window opened, in
   * probability points. Null when the window has too little history to say.
   */
  readonly probDriftSinceOpen: number | null;
  readonly now: number;
}

export interface Intent {
  readonly side: 'UP' | 'DOWN';
  /** The agent's own P(UP). Its distance from the market price is the forecast being scored. */
  readonly forecast: number;
  /** Collateral to risk, base units at six decimals. */
  readonly stake: bigint;
  /** Rest rather than take. */
  readonly postOnly: boolean;
  /** One line, written to the collection log so a decision can be read back later. */
  readonly rationale: string;
}

export interface Strategy {
  readonly agentId: string;
  readonly name: string;
  /** Registered with Arena verbatim. Describes the forecast, not the ambition. */
  readonly method: string;
  decide(view: MarketView): Intent | null;
}

const clamp = (p: number): number => Math.min(PROB_MAX, Math.max(PROB_MIN, p));

const USDC = 1_000_000n;

/** Where the market itself sits, falling back to a bid or ask when one side is empty. */
function marketProb(view: MarketView): number | null {
  if (view.midUp !== null) return view.midUp;
  if (view.bestBidUp !== null && view.bestAskUp === null) return view.bestBidUp;
  if (view.bestAskUp !== null && view.bestBidUp === null) return view.bestAskUp;
  return null;
}

/**
 * Quotes both sides around the market's own mid and leans by a fixed amount toward whichever
 * side the book is thinner on.
 *
 * Deliberately the dullest of the three. It expresses almost no view, so over enough resolved
 * positions it should score near the anchor of 500 — which is what the scale means, and having
 * one agent land there on purpose is worth more than three agents all claiming an edge.
 */
export const midAnchored: Strategy = {
  agentId: 'mid-anchored',
  name: 'Mid Anchored',
  method:
    'Takes the market mid as its forecast and leans two points toward the thinner side of ' +
    'the book. Expresses almost no independent view, so it should score near 500 — the ' +
    'anchor meaning "exactly as good as the market". It is the control, not a contender.',
  decide(view) {
    const p = marketProb(view);
    if (p === null) return null;
    const thinnerIsUp =
      view.bestAskUp === null || (view.bestBidUp ?? 0) < 1 - (view.bestAskUp ?? 1);
    const forecast = clamp(p + (thinnerIsUp ? 0.02 : -0.02));
    return {
      side: forecast >= p ? 'UP' : 'DOWN',
      forecast,
      stake: 2n * USDC,
      postOnly: true,
      rationale: `mid ${p.toFixed(3)}, leaning to ${thinnerIsUp ? 'UP' : 'DOWN'}`,
    };
  },
};

/**
 * Believes the window finishes where it is already heading: a contract drifting up with
 * little time left is more likely to settle UP than the book currently says.
 *
 * The confidence comes from two observable things — how far the price has moved since the
 * window opened, and how little time remains for it to move back — and nothing else. It is a
 * falsifiable claim, which is what makes its score worth reading either way.
 *
 * Its weakness is stated in `method` rather than hidden: on a book this thin, the trend it
 * extrapolates may partly be its own earlier orders.
 */
export const momentumLean: Strategy = {
  agentId: 'momentum-lean',
  name: 'Momentum Lean',
  method:
    'Extrapolates the contract’s own price trend. Takes how far implied P(UP) has moved ' +
    'since the window opened and carries a third of that move forward, scaled by how little ' +
    'time is left for it to reverse — a move late in the window counts for more than the ' +
    'same move at the start. Stated limitation: on a thin book this can be reading its own ' +
    'footprints, and it uses no information outside the order book.',
  decide(view) {
    const p = marketProb(view);
    if (p === null || view.probDriftSinceOpen === null) return null;

    const span = Math.max(1, view.windowEnd - view.windowStart);
    const elapsed = Math.min(1, Math.max(0, (view.now - view.windowStart) / span));
    // Carry a third of the move forward, and only take the part of it the window has earned.
    const carry = (view.probDriftSinceOpen / 3) * elapsed;
    const forecast = clamp(p + carry);
    if (Math.abs(forecast - p) < 0.03) return null;

    return {
      side: forecast > p ? 'UP' : 'DOWN',
      forecast,
      // Size with conviction, within a limit the policy holds it to anyway.
      stake: BigInt(Math.round(2 + 40 * Math.abs(carry))) * USDC,
      postOnly: false,
      rationale:
        `drift ${(view.probDriftSinceOpen * 100).toFixed(1)}pts at ` +
        `${(elapsed * 100).toFixed(0)}% through -> ${forecast.toFixed(3)} vs market ${p.toFixed(3)}`,
    };
  },
};

/**
 * Fades the book when it is very confident, on the view that a thin testnet order book reaches
 * extremes it has not earned.
 *
 * It is also the agent that trips Guard on purpose. Its sizing rises with how extreme the
 * price is and is allowed to exceed `maxNotionalPerOrder`, so a strong enough signal produces
 * a refusal with a real reason code from a real agent, rather than a demo that stages one.
 */
export const contrarianFade: Strategy = {
  agentId: 'contrarian-fade',
  name: 'Contrarian Fade',
  method:
    'Fades extreme book prices back toward 0.5, on the view that a thin testnet book ' +
    'overshoots. Sizes up with the extremity of the price, and deliberately does not cap ' +
    'itself at the policy limit — so its largest signals are refused by Guard with ' +
    'ORDER_TOO_LARGE rather than being quietly trimmed. The refusals in the audit log are ' +
    'produced by this agent trading, not by a script staging them.',
  decide(view) {
    const p = marketProb(view);
    if (p === null) return null;

    const extremity = Math.abs(p - 0.5);
    if (extremity < 0.15) return null;

    // Pull a third of the way back toward even odds.
    const forecast = clamp(p + (0.5 - p) / 3);
    return {
      side: forecast > p ? 'UP' : 'DOWN',
      forecast,
      // Crosses maxNotionalPerOrder (50 tUSDC) above roughly 0.42 from even — a price
      // outside [0.08, 0.92], which a thin book reaches often enough to put real refusals in
      // the audit log, and rarely enough that the agent still collects positions. Sized to be
      // refused sometimes, not always: an agent that never gets an order through has no
      // track record to show.
      stake: BigInt(Math.round(4 + 110 * extremity)) * USDC,
      postOnly: false,
      rationale: `book at ${p.toFixed(3)}, fading to ${forecast.toFixed(3)}`,
    };
  },
};

export const STRATEGIES: readonly Strategy[] = [midAnchored, momentumLean, contrarianFade];
