import type { GuardOrder } from '@kalibra/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Guard } from './guard.js';
import {
  AGENT,
  AGENT_WALLET,
  acceptingAdapter,
  orderFor,
  policyFor,
  setUpHarness,
  type Harness,
} from './harness.js';

/**
 * Guard's counters survive a restart.
 *
 * Every field of `GuardState` is derived from the orders Guard forwarded, and that list lived
 * only in memory. A crash therefore reset an agent's open notional, daily loss and loss
 * streak to zero — handing a limit-breaching agent a clean slate, with numbers that look
 * entirely reasonable afterwards. Nothing throws and nothing logs; the exposure is simply
 * gone.
 *
 * Each test forwards orders, throws the Guard instance away, and asks a fresh one over the
 * same database what it thinks the agent is carrying.
 */

let harness: Harness;

const build = (): Guard =>
  new Guard({
    db: harness.opened.db,
    adapter: acceptingAdapter(harness.replay),
    policy: policyFor(harness),
    wallets: new Map([[AGENT, AGENT_WALLET]]),
  });

const order = (id: string, stake: bigint): GuardOrder =>
  orderFor(harness, { clientOrderId: id, stake });

beforeEach(async () => {
  harness = await setUpHarness();
});

afterEach(() => {
  harness.opened.close();
});

describe('Guard after a restart', () => {
  it('recovers the open notional it had before, rather than starting at zero', async () => {
    const before = build();
    await before.submit(AGENT, order('a', 30_000_000n), harness.now);
    await before.submit(AGENT, order('b', 40_000_000n), harness.now);
    expect((await before.riskStatus(AGENT, harness.now)).state.openNotional).toBe(70_000_000n);

    // The process dies here. A new Guard over the same database is all that survives.
    const after = build();
    expect((await after.riskStatus(AGENT, harness.now)).state.openNotional).toBe(70_000_000n);
  });

  it('still refuses the order that breaches a limit the lost orders had already reached', async () => {
    const before = build();
    for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) {
      const result = await before.submit(AGENT, order(id, 50_000_000n), harness.now + index);
      expect(result.decision.verdict).toBe('ALLOW');
    }

    // Open notional is now exactly maxOpenNotional. A restart is not a way to get more.
    const after = build();
    const result = await after.submit(AGENT, order('e', 50_000_000n), harness.now + 5);
    expect(result.decision.verdict).toBe('DENY');
    if (result.decision.verdict === 'DENY') {
      expect(result.decision.reason).toBe('OPEN_NOTIONAL_EXCEEDED');
    }
  });

  it('recovers the duplicate-order guard, so a replayed client id is still refused', async () => {
    const before = build();
    await before.submit(AGENT, order('only-once', 10_000_000n), harness.now);

    const after = build();
    const result = await after.submit(AGENT, order('only-once', 10_000_000n), harness.now + 1);
    expect(result.decision.verdict).toBe('DENY');
    if (result.decision.verdict === 'DENY') {
      expect(result.decision.reason).toBe('INVALID_ORDER');
    }
  });

  it('keeps one agent out of another agent’s recovered ledger', async () => {
    const before = build();
    await before.submit(AGENT, order('a', 30_000_000n), harness.now);

    const after = build();
    expect((await after.riskStatus('someone-else', harness.now)).state.openNotional).toBe(0n);
  });
});
