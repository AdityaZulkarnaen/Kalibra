import { nextAuditEntry, verifyChain, type GuardOrder, type GuardState } from '@kalibra/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendAuditEntry, lastAuditEntry, readAuditLog } from './guard-queries.js';
import { openDatabase, type OpenedDatabase } from './migrate.js';

/**
 * An audit entry has to come back off disk as the same bytes it was sealed with.
 *
 * This is not a hypothetical. `postOnly` was added to `GuardOrder`, hashed into every new
 * entry, and never added to the schema this module parses rows back through — so Zod stripped
 * it on read, the recomputed digest no longer matched, and 201 real entries reported as
 * tampered with while every byte on disk was intact. A chain that cries wolf is worth about
 * as much as one that never checks.
 *
 * The order below is deliberately fully populated. A field added to `GuardOrder` and
 * forgotten in the read path fails here rather than in a verification months later.
 */

let opened: OpenedDatabase;

const ORDER: Required<GuardOrder> = {
  marketId: '0xmarket',
  side: 'UP',
  stake: 12_345_678n,
  limitProb: 0.6125,
  clientOrderId: 'coid-roundtrip',
  postOnly: true,
};

const STATE: GuardState = {
  now: 1_787_620_000_000,
  openNotional: 5n,
  dailyRealisedPnl: -3n,
  dailyUnrealisedPnl: 7n,
  ordersInWindow: 2,
  consecutiveLosses: 1,
  cooldownUntil: null,
  killSwitchTrippedAt: null,
  market: { marketId: '0xmarket', status: 'OPEN', windowEnd: 1_787_620_900_000 },
  clientOrderIdSeen: false,
};

const append = (order: GuardOrder): void => {
  const entry = nextAuditEntry(lastAuditEntry(opened.db), {
    timestamp: STATE.now,
    agentId: 'roundtrip-agent',
    policyId: 'test',
    policyVersion: 1,
    order,
    decision: { verdict: 'ALLOW' },
    stateSnapshot: STATE,
  });
  appendAuditEntry(opened.db, entry);
};

beforeEach(() => {
  opened = openDatabase(':memory:');
});

afterEach(() => {
  opened.close();
});

describe('an audit entry read back from disk', () => {
  it('verifies, with every field of the order present', () => {
    append(ORDER);
    expect(verifyChain(readAuditLog(opened.db))).toEqual({ valid: true });
  });

  it('keeps every key the order was hashed with', () => {
    append(ORDER);
    const [entry] = readAuditLog(opened.db);
    // Key-by-key rather than a deep equal, so the failure names the field that was dropped.
    expect(Object.keys(entry?.order ?? {}).sort()).toEqual(Object.keys(ORDER).sort());
    expect(entry?.order).toEqual(ORDER);
  });

  it('verifies a chain of several entries, not just one', () => {
    append(ORDER);
    append({ ...ORDER, clientOrderId: 'coid-2', postOnly: false });
    // An order with the optional field absent has to hash and verify too: canonical JSON
    // omits undefined, so present-but-false and absent are genuinely different entries.
    append({
      marketId: '0xmarket',
      side: 'DOWN',
      stake: 1n,
      limitProb: null,
      clientOrderId: 'coid-3',
    });
    expect(verifyChain(readAuditLog(opened.db))).toEqual({ valid: true });
  });

  it('still catches a real mutation, so the check has not been loosened into uselessness', () => {
    append(ORDER);
    append({ ...ORDER, clientOrderId: 'coid-2' });
    opened.sqlite.prepare('UPDATE audit_log SET agent_id = ? WHERE seq = 1').run('somebody-else');

    const result = verifyChain(readAuditLog(opened.db));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.brokenAt).toBe(0);
  });
});
