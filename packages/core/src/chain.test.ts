import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GENESIS_HASH,
  auditEntryHash,
  canonicalJson,
  nextAuditEntry,
  sealAuditEntry,
  verifyChain,
  type AuditEntry,
  type AuditEntryBody,
} from './audit.js';
import { InvalidInputError } from './errors.js';
import { deny, type GuardOrder, type GuardState } from './policy.js';

/**
 * `RISK_POLICY_SPEC.md` §6.2 and `PRD.md` A6: a clean log verifies, and a log with one
 * mutated byte fails at the right place. Both directions, because a verifier that only
 * ever returns true is indistinguishable from one that works until someone tries it.
 */

const ORDER: GuardOrder = {
  marketId: 'm1',
  side: 'UP',
  stake: 25_000_000n,
  limitProb: 0.58,
  clientOrderId: 'coid-1',
};

const STATE: GuardState = {
  now: 1_700_000_000_000,
  openNotional: 0n,
  dailyRealisedPnl: 0n,
  dailyUnrealisedPnl: 0n,
  ordersInWindow: 1,
  consecutiveLosses: 0,
  cooldownUntil: null,
  killSwitchTrippedAt: null,
  market: { marketId: 'm1', status: 'OPEN', windowEnd: 1_700_000_900_000 },
  clientOrderIdSeen: false,
};

const body = (seq: number, prevHash: string): AuditEntryBody => ({
  seq,
  timestamp: 1_700_000_000_000 + seq,
  agentId: 'ag_01',
  policyId: 'demo-conservative',
  policyVersion: 1,
  order: { ...ORDER, clientOrderId: `coid-${seq}` },
  decision: { verdict: 'ALLOW' },
  stateSnapshot: STATE,
  prevHash,
});

/** A chain of `length` sealed entries, each linking to the one before. */
function chain(length: number): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let seq = 1; seq <= length; seq += 1) {
    entries.push(nextAuditEntry(entries.at(-1), body(seq, 'ignored')));
  }
  return entries;
}

describe('auditEntryHash', () => {
  it('is a 0x-prefixed 32-byte digest', () => {
    expect(auditEntryHash(body(1, GENESIS_HASH))).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is Keccak-256, not SHA3-256', () => {
    // The two differ only in padding, so a mix-up produces a chain that verifies against
    // itself and against nothing else in the ecosystem. Hashing the identical bytes with
    // SHA3-256 has to give a different answer.
    const entry = body(1, GENESIS_HASH);
    const payload = canonicalJson({
      seq: entry.seq,
      timestamp: entry.timestamp,
      agentId: entry.agentId,
      policyId: entry.policyId,
      policyVersion: entry.policyVersion,
      order: entry.order,
      decision: entry.decision,
      stateSnapshot: entry.stateSnapshot,
      prevHash: entry.prevHash,
    });
    const sha3 = `0x${createHash('sha3-256').update(payload, 'utf8').digest('hex')}`;
    expect(auditEntryHash(entry)).not.toBe(sha3);
  });

  it('does not depend on the order the body was assembled in', () => {
    const forwards = body(1, GENESIS_HASH);
    const backwards: AuditEntryBody = {
      prevHash: forwards.prevHash,
      stateSnapshot: forwards.stateSnapshot,
      decision: forwards.decision,
      order: forwards.order,
      policyVersion: forwards.policyVersion,
      policyId: forwards.policyId,
      agentId: forwards.agentId,
      timestamp: forwards.timestamp,
      seq: forwards.seq,
    };
    expect(auditEntryHash(backwards)).toBe(auditEntryHash(forwards));
  });

  it('changes when any field changes', () => {
    const base = body(1, GENESIS_HASH);
    const hashes = new Set([
      auditEntryHash(base),
      auditEntryHash({ ...base, timestamp: base.timestamp + 1 }),
      auditEntryHash({ ...base, agentId: 'ag_02' }),
      auditEntryHash({ ...base, policyVersion: 2 }),
      auditEntryHash({ ...base, order: { ...ORDER, stake: 25_000_001n } }),
      auditEntryHash({ ...base, decision: deny('ORDER_TOO_LARGE', 'x') }),
      auditEntryHash({ ...base, stateSnapshot: { ...STATE, openNotional: 1n } }),
    ]);
    expect(hashes.size).toBe(7);
  });
});

describe('sealAuditEntry', () => {
  it('refuses a seq below 1, because the chain is 1-based and contiguous', () => {
    expect(() => sealAuditEntry(body(0, GENESIS_HASH))).toThrow(InvalidInputError);
  });
});

describe('nextAuditEntry', () => {
  it('starts an empty chain at seq 1 with the genesis prevHash', () => {
    const first = nextAuditEntry(undefined, body(99, 'whatever'));
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toBe(`0x${'0'.repeat(64)}`);
  });

  it('links each entry to the hash of the one before it', () => {
    const entries = chain(3);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(entries[2]?.prevHash).toBe(entries[1]?.hash);
  });
});

describe('verifyChain accepts an untouched log', () => {
  it('verifies an empty log', () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it('verifies a chain of one', () => {
    expect(verifyChain(chain(1))).toEqual({ valid: true });
  });

  it('verifies a chain of twenty', () => {
    expect(verifyChain(chain(20))).toEqual({ valid: true });
  });
});

describe('verifyChain rejects a tampered log', () => {
  it('catches one mutated byte, at the right index', () => {
    const entries = chain(5);
    const target = entries[2] as AuditEntry;
    // The single most valuable field to forge: the stake the agent was allowed to risk.
    entries[2] = { ...target, order: { ...target.order, stake: 25_000_001n } };

    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.brokenAt).toBe(2);
    expect(result.valid === false && result.found).toBe(target.hash);
    expect(result.valid === false && result.expected).toBe(auditEntryHash(entries[2]));
  });

  it('catches a rewritten decision, which is the forgery that matters most', () => {
    // An operator claiming after the fact that a refused order was never refused.
    const entries = chain(4);
    const target = entries[1] as AuditEntry;
    entries[1] = { ...target, decision: deny('KILL_SWITCH_ACTIVE', 'engaged') };

    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.brokenAt).toBe(1);
    expect(result.valid === false && result.found).toBe(target.hash);
  });

  it('catches a deleted entry through the seq check', () => {
    const entries = chain(5);
    entries.splice(2, 1);
    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    // Position 2 now holds seq 4.
    expect(result.valid === false && result.brokenAt).toBe(2);
    expect(result.valid === false && result.expected).toBe('3');
    expect(result.valid === false && result.found).toBe('4');
  });

  it('catches two entries swapped', () => {
    const entries = chain(5);
    const [a, b] = [entries[1] as AuditEntry, entries[2] as AuditEntry];
    entries[1] = b;
    entries[2] = a;
    expect(verifyChain(entries).valid).toBe(false);
  });

  it('catches an entry spliced in with a valid hash of its own', () => {
    // A forger who understands the hash but not the links: the entry hashes correctly,
    // and the chain still refuses it because its prevHash points nowhere.
    const entries = chain(4);
    const forged = sealAuditEntry({ ...body(3, GENESIS_HASH), agentId: 'ag_forged' });
    expect(auditEntryHash(forged)).toBe(forged.hash);
    entries[2] = forged;

    const result = verifyChain(entries);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.brokenAt).toBe(2);
    expect(result.valid === false && result.expected).toBe(entries[1]?.hash);
  });

  it('catches a first entry that does not start from genesis', () => {
    const entries = chain(2);
    const first = entries[0] as AuditEntry;
    entries[0] = sealAuditEntry({ ...first, prevHash: `0x${'11'.repeat(32)}` });
    const result = verifyChain(entries);
    expect(result.valid === false && result.brokenAt).toBe(0);
    expect(result.valid === false && result.expected).toBe(GENESIS_HASH);
  });

  it('catches a chain that starts at the wrong seq', () => {
    const entries = chain(3).slice(1);
    const result = verifyChain(entries);
    expect(result.valid === false && result.brokenAt).toBe(0);
    expect(result.valid === false && result.expected).toBe('1');
    expect(result.valid === false && result.found).toBe('2');
  });
});
