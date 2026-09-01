import { UnsupportedOperationError, type DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import { verifyChain } from '@kalibra/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acceptingAdapter,
  guardFor,
  guardTradeCount,
  orderFor,
  policyFor,
  setUpHarness,
  settle,
  AGENT,
  type Harness,
} from './harness.js';

/**
 * Guard's transport. The rule table is tested in `packages/core/src/policy.test.ts`; what
 * is tested here is everything `evaluate` deliberately cannot do — writing the log before
 * acting, tripping the kill switch, and surviving a venue that is unreachable.
 */

let h: Harness;
let accepting: DreamDexAdapter;

beforeEach(async () => {
  h = await setUpHarness();
  accepting = acceptingAdapter(h.replay);
});

afterEach(() => h.opened.sqlite.close());

describe('the audit entry is written before the order is forwarded', () => {
  it('logs an allowed order, and the log survives a round trip through SQLite', async () => {
    const guard = guardFor(h, accepting);
    await guard.submit(AGENT, orderFor(h), h.now);

    const entries = guard.auditLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.decision.verdict).toBe('ALLOW');
    // Read back from disk, rehashed, and still linking to genesis.
    expect(verifyChain(entries)).toEqual({ valid: true });
  });

  it('logs a refused order too, which is the entry an operator actually needs', async () => {
    const guard = guardFor(h, accepting, policyFor(h, { allowedMarkets: [] }));
    const result = await guard.submit(AGENT, orderFor(h), h.now);
    expect(result.decision.verdict).toBe('DENY');
    expect(guard.auditLog()).toHaveLength(1);
    expect(guard.verify()).toEqual({ valid: true });
  });

  it('records the exact state the decision was made from', async () => {
    const guard = guardFor(h, accepting);
    await guard.submit(AGENT, orderFor(h), h.now);

    const snapshot = guard.auditLog()[0]?.stateSnapshot;
    expect(snapshot?.now).toBe(h.now);
    expect(snapshot?.market?.marketId).toBe(h.marketId);
    expect(snapshot?.openNotional).toBe(0n);
  });

  it('keeps the chain intact across many orders', async () => {
    const guard = guardFor(h, accepting);
    for (let i = 0; i < 6; i += 1) {
      await guard.submit(AGENT, orderFor(h, { clientOrderId: `coid-${i}` }), h.now + i);
    }
    expect(guard.auditLog().map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(guard.verify()).toEqual({ valid: true });
  });
});

describe('reason code 11, UPSTREAM_UNAVAILABLE', () => {
  const broken = (adapter: DreamDexAdapter): DreamDexAdapter => ({
    ...adapter,
    placeOrder: () => {
      throw new UnsupportedOperationError('placeOrder', 'the venue is unreachable');
    },
  });

  it('denies with UPSTREAM_UNAVAILABLE and no other code when forwarding fails', async () => {
    const result = await guardFor(h, broken(accepting)).submit(AGENT, orderFor(h), h.now);
    expect(result.decision.verdict === 'DENY' && result.decision.reason).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    expect(result.forwarded).toBe(false);
    expect(result.recorded).toBe(false);
  });

  it('leaves both the ALLOW and the failure in the log, in that order', async () => {
    const guard = guardFor(h, broken(accepting));
    await guard.submit(AGENT, orderFor(h), h.now);
    expect(guard.auditLog().map((entry) => entry.decision.verdict)).toEqual(['ALLOW', 'DENY']);
    expect(guard.verify()).toEqual({ valid: true });
  });

  it('writes no trade when the order never reached the venue', async () => {
    await guardFor(h, broken(accepting)).submit(AGENT, orderFor(h), h.now);
    expect(guardTradeCount(h.opened)).toBe(0);
  });
});

describe('the kill switch', () => {
  it('trips on a FATAL verdict and refuses everything after it', async () => {
    const guard = guardFor(h, accepting, policyFor(h, { maxDailyLoss: '1' }));

    // Force a loss large enough to breach: forward one order, settle its market against it.
    await guard.submit(AGENT, orderFor(h), h.now);
    settle(h.opened, h.marketId, 'DOWN', h.now + 1);

    // The next order goes into a market that is still open, so the loss is the only rule
    // it can trip. Ordering into the settled one would have shown MARKET_NOT_OPEN instead.
    const second = await guard.submit(
      AGENT,
      orderFor(h, { clientOrderId: 'coid-2', marketId: h.secondMarketId }),
      h.now + 2,
    );
    expect(second.decision.verdict === 'DENY' && second.decision.reason).toBe(
      'DAILY_LOSS_EXCEEDED',
    );
    expect(second.decision.verdict === 'DENY' && second.decision.severity).toBe('FATAL');
    expect(guard.currentPolicy().killSwitch).toBe(true);

    // Everything after it sees the switch, not the loss.
    const third = await guard.submit(
      AGENT,
      orderFor(h, { clientOrderId: 'coid-3', marketId: h.secondMarketId }),
      h.now + 3,
    );
    expect(third.decision.verdict === 'DENY' && third.decision.reason).toBe('KILL_SWITCH_ACTIVE');
  });

  it('is the operator’s to release, and bumps the policy version when it moves', () => {
    const guard = guardFor(h, accepting);
    expect(guard.currentPolicy().version).toBe(1);
    expect(guard.setKillSwitch(true, h.now).killSwitch).toBe(true);
    expect(guard.setKillSwitch(false, h.now).killSwitch).toBe(false);
    expect(guard.currentPolicy().version).toBe(3);
  });
});

describe('risk status', () => {
  it('reports the headroom left under every limit', async () => {
    const guard = guardFor(h, accepting);
    await guard.submit(AGENT, orderFor(h), h.now);

    const status = await guard.riskStatus(AGENT, h.now, h.marketId);
    expect(status.remaining.openNotional).toBe(190_000_000n);
    expect(status.remaining.ordersInWindow).toBe(9);
    expect(status.remaining.dailyLoss).toBe(100_000_000n);
    expect(status.state.market?.marketId).toBe(h.marketId);
  });

  it('never reports negative headroom', async () => {
    const guard = guardFor(h, accepting, policyFor(h, { maxOpenNotional: '5000000' }));
    const status = await guard.riskStatus(AGENT, h.now, h.marketId);
    expect(status.remaining.openNotional).toBeGreaterThanOrEqual(0n);
  });
});
