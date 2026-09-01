import { describe, expect, it } from 'vitest';

import {
  evaluate,
  type GuardMarket,
  type GuardOrder,
  type GuardPolicy,
  type GuardState,
  type ReasonCode,
} from './policy.js';

/**
 * `RISK_POLICY_SPEC.md` §4 and `PRD.md` A5: eleven reason codes, eleven tests, each
 * building the minimal state that triggers exactly that code and asserting no other fires.
 *
 * Ten of them are decided by `evaluate`. `UPSTREAM_UNAVAILABLE` is raised at forward time,
 * after the verdict, so its test lives with the transport in `apps/guard`.
 */

const MARKET: GuardMarket = { marketId: 'm1', status: 'OPEN', windowEnd: 1_000_000 };

/** A policy that permits the order below, so a test only has to break one thing. */
const POLICY: GuardPolicy = {
  policyId: 'test',
  version: 1,
  maxNotionalPerOrder: 50_000_000n,
  maxOpenNotional: 200_000_000n,
  maxDailyLoss: 100_000_000n,
  maxOrdersPerWindow: 10,
  rateWindowMs: 60_000,
  lossStreakThreshold: 3,
  cooldownMs: 300_000,
  allowedMarkets: ['m1'],
  minTimeToCloseMs: 5_000,
  killSwitch: false,
  autoKillOnDailyLoss: true,
};

const STATE: GuardState = {
  now: 900_000,
  openNotional: 0n,
  dailyRealisedPnl: 0n,
  dailyUnrealisedPnl: 0n,
  ordersInWindow: 0,
  consecutiveLosses: 0,
  cooldownUntil: null,
  killSwitchTrippedAt: null,
  market: MARKET,
  clientOrderIdSeen: false,
};

const ORDER: GuardOrder = {
  marketId: 'm1',
  side: 'UP',
  stake: 10_000_000n,
  limitProb: 0.6,
  clientOrderId: 'coid-1',
};

const policy = (patch: Partial<GuardPolicy>): GuardPolicy => ({ ...POLICY, ...patch });
const state = (patch: Partial<GuardState>): GuardState => ({ ...STATE, ...patch });
const order = (patch: Partial<GuardOrder>): GuardOrder => ({ ...ORDER, ...patch });

/** Asserts the verdict is DENY for exactly this reason, and reports the reason if not. */
function expectDeny(
  reason: ReasonCode,
  p: GuardPolicy,
  s: GuardState,
  o: GuardOrder = ORDER,
): void {
  const decision = evaluate(p, s, o);
  expect(decision.verdict === 'DENY' ? decision.reason : decision.verdict).toBe(reason);
}

describe('evaluate, the baseline', () => {
  it('allows an order that satisfies every rule', () => {
    expect(evaluate(POLICY, STATE, ORDER)).toEqual({ verdict: 'ALLOW' });
  });
});

describe('one test per reason code (RISK_POLICY_SPEC 4)', () => {
  it('1 KILL_SWITCH_ACTIVE', () => {
    expectDeny('KILL_SWITCH_ACTIVE', policy({ killSwitch: true }), STATE);
  });

  it('2 IN_COOLDOWN', () => {
    expectDeny('IN_COOLDOWN', POLICY, state({ cooldownUntil: STATE.now + 1 }));
  });

  it('3 MARKET_NOT_ALLOWED', () => {
    expectDeny('MARKET_NOT_ALLOWED', policy({ allowedMarkets: ['other'] }), STATE);
  });

  it('4 MARKET_NOT_OPEN', () => {
    expectDeny('MARKET_NOT_OPEN', POLICY, state({ market: { ...MARKET, status: 'SETTLED' } }));
  });

  it('5 TOO_CLOSE_TO_CLOSE', () => {
    expectDeny('TOO_CLOSE_TO_CLOSE', POLICY, state({ now: MARKET.windowEnd - 4_999 }));
  });

  it('6 RATE_LIMIT_EXCEEDED', () => {
    expectDeny('RATE_LIMIT_EXCEEDED', POLICY, state({ ordersInWindow: 10 }));
  });

  it('7 ORDER_TOO_LARGE', () => {
    expectDeny('ORDER_TOO_LARGE', POLICY, STATE, order({ stake: 50_000_001n }));
  });

  it('8 OPEN_NOTIONAL_EXCEEDED', () => {
    expectDeny('OPEN_NOTIONAL_EXCEEDED', POLICY, state({ openNotional: 195_000_000n }));
  });

  it('9 DAILY_LOSS_EXCEEDED', () => {
    expectDeny('DAILY_LOSS_EXCEEDED', POLICY, state({ dailyRealisedPnl: -100_000_000n }));
  });

  it('10 INVALID_ORDER', () => {
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ stake: 0n }));
  });

  it('11 UPSTREAM_UNAVAILABLE is not evaluate’s to raise', () => {
    // It happens after ALLOW, when the adapter cannot be reached. apps/guard owns it, and
    // `guard.test.ts` asserts the transport produces exactly this code and logs it.
    const decision = evaluate(POLICY, STATE, ORDER);
    expect(decision.verdict).toBe('ALLOW');
  });
});

describe('rule ordering is part of the contract', () => {
  it('a killed agent over its daily loss sees KILL_SWITCH_ACTIVE', () => {
    expectDeny(
      'KILL_SWITCH_ACTIVE',
      policy({ killSwitch: true }),
      state({ dailyRealisedPnl: -500_000_000n }),
    );
  });

  it('a killed agent on a forbidden market still sees KILL_SWITCH_ACTIVE', () => {
    // The point of the ordering: MARKET_NOT_ALLOWED would send the operator to the
    // allow-list when the real answer is that the agent is switched off.
    expectDeny(
      'KILL_SWITCH_ACTIVE',
      policy({ killSwitch: true, allowedMarkets: [] }),
      state({ market: null }),
    );
  });

  it('cooldown outranks every limit below it', () => {
    expectDeny(
      'IN_COOLDOWN',
      policy({ allowedMarkets: [] }),
      state({ cooldownUntil: STATE.now + 1, ordersInWindow: 99 }),
      order({ stake: 999_000_000n }),
    );
  });

  it('an unknown market is refused before its size is considered', () => {
    expectDeny('MARKET_NOT_ALLOWED', POLICY, state({ market: null }), order({ marketId: 'ghost' }));
  });
});

describe('the edges each rule turns on', () => {
  it('allows an order exactly at maxNotionalPerOrder', () => {
    expect(evaluate(POLICY, STATE, order({ stake: 50_000_000n })).verdict).toBe('ALLOW');
  });

  it('allows open notional landing exactly on the cap', () => {
    expect(evaluate(POLICY, state({ openNotional: 190_000_000n }), ORDER).verdict).toBe('ALLOW');
  });

  it('denies at the daily loss limit, not one unit past it', () => {
    // A limit that must be exceeded before it binds is not a limit.
    expectDeny('DAILY_LOSS_EXCEEDED', POLICY, state({ dailyRealisedPnl: -100_000_000n }));
    expect(evaluate(POLICY, state({ dailyRealisedPnl: -99_999_999n }), ORDER).verdict).toBe(
      'ALLOW',
    );
  });

  it('counts unrealised losses towards the daily limit', () => {
    expectDeny(
      'DAILY_LOSS_EXCEEDED',
      POLICY,
      state({ dailyRealisedPnl: -60_000_000n, dailyUnrealisedPnl: -40_000_000n }),
    );
  });

  it('releases the cooldown at the instant it expires', () => {
    expect(evaluate(POLICY, state({ cooldownUntil: STATE.now }), ORDER).verdict).toBe('ALLOW');
  });

  it('allows an order exactly minTimeToCloseMs before the window shuts', () => {
    expect(evaluate(POLICY, state({ now: MARKET.windowEnd - 5_000 }), ORDER).verdict).toBe('ALLOW');
  });

  it('denies every market when the allow list is empty, which is the default', () => {
    expectDeny('MARKET_NOT_ALLOWED', policy({ allowedMarkets: [] }), STATE);
  });
});

describe('INVALID_ORDER covers each malformed field', () => {
  it('rejects a negative stake', () => {
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ stake: -1n }));
  });

  it('rejects an empty clientOrderId', () => {
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ clientOrderId: '' }));
  });

  it('rejects a replayed clientOrderId', () => {
    expectDeny('INVALID_ORDER', POLICY, state({ clientOrderIdSeen: true }));
  });

  it('rejects a limitProb outside [0, 1]', () => {
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ limitProb: 1.5 }));
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ limitProb: -0.01 }));
    expectDeny('INVALID_ORDER', POLICY, STATE, order({ limitProb: Number.NaN }));
  });

  it('accepts a null limitProb, which means no limit rather than a bad one', () => {
    expect(evaluate(POLICY, STATE, order({ limitProb: null })).verdict).toBe('ALLOW');
  });
});

describe('severity', () => {
  it('marks the kill switch FATAL', () => {
    const decision = evaluate(policy({ killSwitch: true }), STATE, ORDER);
    expect(decision.verdict === 'DENY' && decision.severity).toBe('FATAL');
  });

  it('marks a daily loss FATAL only when autoKillOnDailyLoss is set', () => {
    const breached = state({ dailyRealisedPnl: -100_000_000n });
    const auto = evaluate(POLICY, breached, ORDER);
    const manual = evaluate(policy({ autoKillOnDailyLoss: false }), breached, ORDER);
    expect(auto.verdict === 'DENY' && auto.severity).toBe('FATAL');
    expect(manual.verdict === 'DENY' && manual.severity).toBe('BLOCK');
  });

  it('marks an ordinary refusal BLOCK, which stops the order and nothing else', () => {
    const decision = evaluate(POLICY, STATE, order({ stake: 50_000_001n }));
    expect(decision.verdict === 'DENY' && decision.severity).toBe('BLOCK');
  });
});

describe('purity', () => {
  it('never mutates its arguments', () => {
    const p = policy({});
    const s = state({});
    const o = order({});
    const before = JSON.stringify([p, s, o], (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    evaluate(p, s, o);
    expect(JSON.stringify([p, s, o], (_k, v) => (typeof v === 'bigint' ? String(v) : v))).toBe(
      before,
    );
  });

  it('returns the same verdict for the same inputs', () => {
    const breached = state({ ordersInWindow: 10 });
    expect(evaluate(POLICY, breached, ORDER)).toEqual(evaluate(POLICY, breached, ORDER));
  });
});
