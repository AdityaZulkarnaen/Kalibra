import {
  realisedPnl,
  sumPnl,
  unrealisedPnl,
  type GuardMarket,
  type GuardOrder,
  type GuardPolicy,
  type GuardState,
  type Side,
} from '@kalibra/core';

/**
 * The agent's counters, derived rather than stored.
 *
 * Every field of `GuardState` is a function of the orders Guard forwarded and what the
 * markets did afterwards. Recomputing them on each evaluation costs nothing at this scale
 * and removes a whole class of bug: there is no counter to drift out of step with reality,
 * no decrement to forget, and a restart that reloads the same orders produces the same
 * state. `RISK_POLICY_SPEC.md` §3 lists the fields; this decides where they come from.
 */

export interface ForwardedOrder {
  readonly clientOrderId: string;
  readonly marketId: string;
  readonly side: Side;
  readonly stake: bigint;
  /** The market-implied P(UP) at the moment Guard forwarded it. */
  readonly impliedProbUp: number;
  readonly at: number;
}

/** What Guard knows about a market its agent is exposed to. */
export interface MarketFacts {
  readonly marketId: string;
  readonly status: 'OPEN' | 'CLOSED' | 'SETTLED' | 'VOID';
  readonly windowEnd: number;
  readonly outcome: 'UP' | 'DOWN' | 'VOID' | null;
  readonly settledAt: number | null;
  /** Current implied P(UP). Null when no quote is available; positions then mark at cost. */
  readonly markProbUp: number | null;
}

export interface AgentLedger {
  readonly forwarded: readonly ForwardedOrder[];
  readonly killSwitchTrippedAt: number | null;
}

export const emptyLedger = (): AgentLedger => ({ forwarded: [], killSwitchTrippedAt: null });

const DAY_MS = 86_400_000;

const sameUtcDay = (a: number, b: number): boolean =>
  Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS);

const isSettled = (facts: MarketFacts | undefined): boolean =>
  facts !== undefined && facts.outcome !== null;

export interface DeriveArgs {
  readonly ledger: AgentLedger;
  readonly markets: ReadonlyMap<string, MarketFacts>;
  readonly policy: GuardPolicy;
  readonly now: number;
  readonly order: GuardOrder;
}

export function deriveState(args: DeriveArgs): GuardState {
  const { ledger, markets, policy, now, order } = args;
  const open = ledger.forwarded.filter((row) => !isSettled(markets.get(row.marketId)));
  const cooldown = cooldownUntil(ledger, markets, policy);

  return {
    now,
    openNotional: sumPnl(open.map((row) => row.stake)),
    dailyRealisedPnl: dailyRealised(ledger, markets, now),
    dailyUnrealisedPnl: dailyUnrealised(open, markets),
    ordersInWindow: ledger.forwarded.filter((row) => row.at > now - policy.rateWindowMs).length,
    consecutiveLosses: consecutiveLosses(ledger, markets),
    cooldownUntil: cooldown,
    killSwitchTrippedAt: ledger.killSwitchTrippedAt,
    market: toGuardMarket(markets.get(order.marketId)),
    clientOrderIdSeen: ledger.forwarded.some((row) => row.clientOrderId === order.clientOrderId),
  };
}

function toGuardMarket(facts: MarketFacts | undefined): GuardMarket | null {
  if (facts === undefined) return null;
  return { marketId: facts.marketId, status: facts.status, windowEnd: facts.windowEnd };
}

/**
 * Only positions that settled today count. A limit named "daily" that carried yesterday's
 * losses forward would never release, and one that ignored the calendar would let an agent
 * lose the limit twice before midnight.
 */
function dailyRealised(
  ledger: AgentLedger,
  markets: ReadonlyMap<string, MarketFacts>,
  now: number,
): bigint {
  const settledToday = ledger.forwarded.filter((row) => {
    const facts = markets.get(row.marketId);
    return (
      facts !== undefined &&
      facts.outcome !== null &&
      facts.settledAt !== null &&
      sameUtcDay(facts.settledAt, now)
    );
  });

  return sumPnl(
    settledToday.map((row) => {
      const outcome = markets.get(row.marketId)?.outcome;
      return realisedPnl(row, outcome === 'VOID' ? 'VOID' : outcome === 'UP' ? 1 : 0);
    }),
  );
}

/**
 * Open positions marked at the current mid. A market with no quote marks at cost, which
 * contributes exactly zero: never a fabricated gain, and the caller can see from
 * `markProbUp` being null that the mark is degraded.
 */
function dailyUnrealised(
  open: readonly ForwardedOrder[],
  markets: ReadonlyMap<string, MarketFacts>,
): bigint {
  return sumPnl(
    open.map((row) => {
      const mark = markets.get(row.marketId)?.markProbUp;
      return mark === null || mark === undefined ? 0n : unrealisedPnl(row, mark);
    }),
  );
}

/** Settled positions, most recent first — the order a loss streak is counted in. */
function settledNewestFirst(
  ledger: AgentLedger,
  markets: ReadonlyMap<string, MarketFacts>,
): Array<{ row: ForwardedOrder; facts: MarketFacts }> {
  return ledger.forwarded
    .flatMap((row) => {
      const facts = markets.get(row.marketId);
      return facts !== undefined && facts.outcome !== null && facts.settledAt !== null
        ? [{ row, facts }]
        : [];
    })
    .sort((a, b) => (b.facts.settledAt ?? 0) - (a.facts.settledAt ?? 0));
}

function consecutiveLosses(ledger: AgentLedger, markets: ReadonlyMap<string, MarketFacts>): number {
  let streak = 0;
  for (const { row, facts } of settledNewestFirst(ledger, markets)) {
    const outcome = facts.outcome === 'VOID' ? 'VOID' : facts.outcome === 'UP' ? 1 : 0;
    if (realisedPnl(row, outcome) >= 0n) break;
    streak += 1;
  }
  return streak;
}

/**
 * The cooldown runs from the loss that completed the streak, not from now, so an agent
 * cannot extend its own penalty by staying quiet and cannot shorten it by trying again.
 */
function cooldownUntil(
  ledger: AgentLedger,
  markets: ReadonlyMap<string, MarketFacts>,
  policy: GuardPolicy,
): number | null {
  if (consecutiveLosses(ledger, markets) < policy.lossStreakThreshold) return null;
  const lastLoss = settledNewestFirst(ledger, markets)[0]?.facts.settledAt;
  return lastLoss === undefined || lastLoss === null ? null : lastLoss + policy.cooldownMs;
}
