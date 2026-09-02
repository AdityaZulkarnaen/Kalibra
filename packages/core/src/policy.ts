import type { Side } from './types.js';

/**
 * Guard's decision function. `RISK_POLICY_SPEC.md` §4 and §5.
 *
 * Pure, and deliberately so (invariant I1, and §1 of that document): both transports —
 * HTTP today, MCP on day 7 — call this one function, so enforcement cannot drift between
 * them, and every time-dependent rule is testable without a fake clock.
 *
 * It decides. It does not act. Tripping the kill switch on a FATAL verdict, writing the
 * audit entry and forwarding the order are the transport's job, because all three are
 * effects and none of them belong in here.
 */

export type ReasonCode =
  | 'KILL_SWITCH_ACTIVE'
  | 'IN_COOLDOWN'
  | 'MARKET_NOT_ALLOWED'
  | 'MARKET_NOT_OPEN'
  | 'TOO_CLOSE_TO_CLOSE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ORDER_TOO_LARGE'
  | 'OPEN_NOTIONAL_EXCEEDED'
  | 'DAILY_LOSS_EXCEEDED'
  | 'INVALID_ORDER'
  | 'UPSTREAM_UNAVAILABLE';

export type Severity = 'BLOCK' | 'FATAL';

export interface GuardPolicy {
  readonly policyId: string;
  readonly version: number;
  readonly maxNotionalPerOrder: bigint;
  readonly maxOpenNotional: bigint;
  readonly maxDailyLoss: bigint;
  readonly maxOrdersPerWindow: number;
  readonly rateWindowMs: number;
  readonly lossStreakThreshold: number;
  readonly cooldownMs: number;
  /** Empty means no market is permitted. Deny by default. */
  readonly allowedMarkets: readonly string[];
  readonly minTimeToCloseMs: number;
  readonly killSwitch: boolean;
  readonly autoKillOnDailyLoss: boolean;
}

/** The order as the agent submitted it. Never modified — Guard refuses or forwards. */
export interface GuardOrder {
  readonly marketId: string;
  readonly side: Side;
  readonly stake: bigint;
  /** P(UP), never the price of the order's own side. */
  readonly limitProb: number | null;
  readonly clientOrderId: string;
  /** Rest rather than take. Forwarded untouched; Guard has no opinion on it. */
  readonly postOnly?: boolean | undefined;
}

/** What the transport resolved about the market named by the order. */
export interface GuardMarket {
  readonly marketId: string;
  readonly status: 'OPEN' | 'CLOSED' | 'SETTLED' | 'VOID';
  readonly windowEnd: number;
}

/**
 * Everything `evaluate` is allowed to know, gathered by the caller.
 *
 * `market` and `clientOrderIdSeen` are not in `RISK_POLICY_SPEC.md` §3, which lists the
 * agent's own counters. They are here because rules 3 to 5 and rule 10 need them and the
 * specified signature carries nowhere else to put them. Keeping them in the state rather
 * than in a fourth argument means the audit entry's `stateSnapshot` records every input
 * the decision was made from, so a reviewer can recompute the verdict from the log alone.
 */
export interface GuardState {
  /** ms since epoch UTC, passed in. `evaluate` reads no clock. */
  readonly now: number;
  readonly openNotional: bigint;
  /** Negative is a loss. */
  readonly dailyRealisedPnl: bigint;
  readonly dailyUnrealisedPnl: bigint;
  readonly ordersInWindow: number;
  readonly consecutiveLosses: number;
  readonly cooldownUntil: number | null;
  readonly killSwitchTrippedAt: number | null;
  /** Null when the venue does not know this market at all. */
  readonly market: GuardMarket | null;
  readonly clientOrderIdSeen: boolean;
}

export type GuardDecision =
  | { readonly verdict: 'ALLOW' }
  | {
      readonly verdict: 'DENY';
      readonly reason: ReasonCode;
      /** For humans and logs. Never parse it for control flow; branch on `reason`. */
      readonly detail: string;
      readonly severity: Severity;
    };

/** FATAL trips the kill switch. BLOCK refuses this order only. */
const SEVERITY: Readonly<Record<ReasonCode, Severity>> = {
  KILL_SWITCH_ACTIVE: 'FATAL',
  IN_COOLDOWN: 'BLOCK',
  MARKET_NOT_ALLOWED: 'BLOCK',
  MARKET_NOT_OPEN: 'BLOCK',
  TOO_CLOSE_TO_CLOSE: 'BLOCK',
  RATE_LIMIT_EXCEEDED: 'BLOCK',
  ORDER_TOO_LARGE: 'BLOCK',
  OPEN_NOTIONAL_EXCEEDED: 'BLOCK',
  DAILY_LOSS_EXCEEDED: 'BLOCK',
  INVALID_ORDER: 'BLOCK',
  UPSTREAM_UNAVAILABLE: 'BLOCK',
};

export function deny(reason: ReasonCode, detail: string, severity?: Severity): GuardDecision {
  return { verdict: 'DENY', reason, detail, severity: severity ?? SEVERITY[reason] };
}

const ALLOW: GuardDecision = { verdict: 'ALLOW' };

type Rule = (policy: GuardPolicy, state: GuardState, order: GuardOrder) => GuardDecision | null;

/**
 * The order of this array is the contract. `RISK_POLICY_SPEC.md` §4: a killed agent must
 * see `KILL_SWITCH_ACTIVE` rather than `MARKET_NOT_ALLOWED`, because the first is
 * actionable and the second sends the operator looking in the wrong place.
 */
const RULES: readonly Rule[] = [
  killSwitchActive,
  inCooldown,
  marketNotAllowed,
  marketNotOpen,
  tooCloseToClose,
  rateLimitExceeded,
  orderTooLarge,
  openNotionalExceeded,
  dailyLossExceeded,
  invalidOrder,
];

/** Deny by default: an order passes only by satisfying every rule. */
export function evaluate(policy: GuardPolicy, state: GuardState, order: GuardOrder): GuardDecision {
  for (const rule of RULES) {
    const decision = rule(policy, state, order);
    if (decision !== null) return decision;
  }
  return ALLOW;
}

function killSwitchActive(policy: GuardPolicy): GuardDecision | null {
  return policy.killSwitch ? deny('KILL_SWITCH_ACTIVE', 'the kill switch is engaged') : null;
}

function inCooldown(_policy: GuardPolicy, state: GuardState): GuardDecision | null {
  const until = state.cooldownUntil;
  if (until === null || state.now >= until) return null;
  return deny('IN_COOLDOWN', `in cooldown until ${until}, now ${state.now}`);
}

function marketNotAllowed(
  policy: GuardPolicy,
  _state: GuardState,
  order: GuardOrder,
): GuardDecision | null {
  if (policy.allowedMarkets.includes(order.marketId)) return null;
  return deny(
    'MARKET_NOT_ALLOWED',
    `market ${order.marketId} is not among the ${policy.allowedMarkets.length} allowed`,
  );
}

function marketNotOpen(
  _policy: GuardPolicy,
  state: GuardState,
  order: GuardOrder,
): GuardDecision | null {
  const market = state.market;
  if (market === null) {
    return deny('MARKET_NOT_OPEN', `market ${order.marketId} is not known to Guard`);
  }
  if (market.status === 'OPEN') return null;
  return deny('MARKET_NOT_OPEN', `market ${order.marketId} is ${market.status}, not OPEN`);
}

function tooCloseToClose(policy: GuardPolicy, state: GuardState): GuardDecision | null {
  // marketNotOpen ran first, so a null market never reaches here.
  const remaining = (state.market?.windowEnd ?? 0) - state.now;
  if (remaining >= policy.minTimeToCloseMs) return null;
  return deny(
    'TOO_CLOSE_TO_CLOSE',
    `${remaining}ms to close, minimum is ${policy.minTimeToCloseMs}ms`,
  );
}

function rateLimitExceeded(policy: GuardPolicy, state: GuardState): GuardDecision | null {
  if (state.ordersInWindow < policy.maxOrdersPerWindow) return null;
  return deny(
    'RATE_LIMIT_EXCEEDED',
    `${state.ordersInWindow} orders in the last ${policy.rateWindowMs}ms, limit ${policy.maxOrdersPerWindow}`,
  );
}

function orderTooLarge(
  policy: GuardPolicy,
  _state: GuardState,
  order: GuardOrder,
): GuardDecision | null {
  if (order.stake <= policy.maxNotionalPerOrder) return null;
  return deny(
    'ORDER_TOO_LARGE',
    `stake ${order.stake} exceeds maxNotionalPerOrder ${policy.maxNotionalPerOrder}`,
  );
}

function openNotionalExceeded(
  policy: GuardPolicy,
  state: GuardState,
  order: GuardOrder,
): GuardDecision | null {
  const after = state.openNotional + order.stake;
  if (after <= policy.maxOpenNotional) return null;
  return deny(
    'OPEN_NOTIONAL_EXCEEDED',
    `open notional would reach ${after}, limit ${policy.maxOpenNotional}`,
  );
}

/**
 * `>=` is deliberate (§4). Reaching the limit exactly stops trading: a limit that has to
 * be exceeded before it binds is not a limit.
 */
function dailyLossExceeded(policy: GuardPolicy, state: GuardState): GuardDecision | null {
  const loss = -(state.dailyRealisedPnl + state.dailyUnrealisedPnl);
  if (loss < policy.maxDailyLoss) return null;
  return deny(
    'DAILY_LOSS_EXCEEDED',
    `daily loss ${loss} has reached maxDailyLoss ${policy.maxDailyLoss}`,
    policy.autoKillOnDailyLoss ? 'FATAL' : 'BLOCK',
  );
}

function invalidOrder(
  _policy: GuardPolicy,
  state: GuardState,
  order: GuardOrder,
): GuardDecision | null {
  if (order.stake <= 0n) return deny('INVALID_ORDER', `stake ${order.stake} is not positive`);
  if (order.clientOrderId === '') return deny('INVALID_ORDER', 'clientOrderId is empty');
  if (state.clientOrderIdSeen) {
    return deny('INVALID_ORDER', `clientOrderId ${order.clientOrderId} was already used`);
  }
  const limit = order.limitProb;
  if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 1)) {
    return deny('INVALID_ORDER', `limitProb ${limit} is outside [0, 1]`);
  }
  return null;
}
