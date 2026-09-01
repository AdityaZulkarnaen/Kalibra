import { keccak_256 } from '@noble/hashes/sha3.js';

import { InvalidInputError } from './errors.js';
import type { GuardDecision, GuardOrder, GuardState } from './policy.js';

/**
 * Canonical JSON: the same value always serialises to the same bytes.
 *
 * Object keys are emitted in sorted order, so a value assembled in a different order
 * hashes identically. Bigints become decimal strings, matching how they cross every other
 * boundary in this system (API_SPEC.md section 2.1).
 *
 * The Guard hash chain below builds on it, and so does `params_hash` (API_SPEC.md 1.2).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(`cannot canonicalise a non-finite number: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new InvalidInputError(`cannot canonicalise a value of type ${typeof value}`);
}

/**
 * The tamper-evident audit chain. `RISK_POLICY_SPEC.md` §6.
 *
 * This is the artefact that makes an agent's record worth anything: without it, "the agent
 * was only ever allowed to do X" is a claim, and with it the claim is checkable by someone
 * who does not trust the operator.
 *
 * Keccak-256, not SHA3-256. They differ only in padding, they produce different digests for
 * the same input, and Keccak is what the surrounding ecosystem means by `keccak256`.
 */

/** 0x followed by 64 zeros. The first entry's `prevHash`. */
export const GENESIS_HASH = `0x${'00'.repeat(32)}`;

/**
 * An entry before it is sealed. `order` is `GuardOrder` rather than the adapter's
 * `CanonicalOrder` because `packages/core` may not import another workspace package
 * (ARCHITECTURE.md §2); the two shapes are identical field for field.
 */
export interface AuditEntryBody {
  /** 1-based, contiguous, no gaps. */
  readonly seq: number;
  readonly timestamp: number;
  readonly agentId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  /** As received, before any processing. */
  readonly order: GuardOrder;
  readonly decision: GuardDecision;
  /** The exact state `evaluate` saw, so the verdict can be recomputed from the log. */
  readonly stateSnapshot: GuardState;
  readonly prevHash: string;
}

export interface AuditEntry extends AuditEntryBody {
  readonly hash: string;
}

export type ChainVerification =
  | { readonly valid: true }
  | {
      readonly valid: false;
      /**
       * The 0-based array index of the first bad entry — position, not `seq`. When `seq`
       * itself is what was tampered with, position is the only pointer that still means
       * something.
       */
      readonly brokenAt: number;
      readonly expected: string;
      readonly found: string;
    };

const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

/**
 * `canonicalJson` sorts keys at every depth, so the field order written here does not
 * reach the digest. That is the property the whole chain rests on, and it is asserted
 * directly in `audit.test.ts` with key-shuffled inputs.
 */
export function auditEntryHash(body: AuditEntryBody): string {
  const payload = canonicalJson({
    seq: body.seq,
    timestamp: body.timestamp,
    agentId: body.agentId,
    policyId: body.policyId,
    policyVersion: body.policyVersion,
    order: body.order,
    decision: body.decision,
    stateSnapshot: body.stateSnapshot,
    prevHash: body.prevHash,
  });
  return toHex(keccak_256(new TextEncoder().encode(payload)));
}

export function sealAuditEntry(body: AuditEntryBody): AuditEntry {
  if (!Number.isInteger(body.seq) || body.seq < 1) {
    throw new InvalidInputError(`audit seq must be a positive integer, got ${body.seq}`);
  }
  return { ...body, hash: auditEntryHash(body) };
}

/**
 * Builds the next entry from the tail of the chain, so a caller cannot get `seq` or
 * `prevHash` wrong by hand. An empty chain starts at seq 1 with the genesis prevHash.
 */
export function nextAuditEntry(
  previous: AuditEntry | undefined,
  body: Omit<AuditEntryBody, 'seq' | 'prevHash'>,
): AuditEntry {
  return sealAuditEntry({
    ...body,
    seq: previous === undefined ? 1 : previous.seq + 1,
    prevHash: previous === undefined ? GENESIS_HASH : previous.hash,
  });
}

/**
 * All four checks in `RISK_POLICY_SPEC.md` §6.2, in order. Any three of them leave a hole:
 * recomputing hashes catches content edits, and the seq and link checks catch insertion,
 * deletion and reordering, which a content check alone would pass.
 */
export function verifyChain(entries: readonly AuditEntry[]): ChainVerification {
  for (const [index, entry] of entries.entries()) {
    const broken = checkEntry(entries, index, entry);
    if (broken !== null) return broken;
  }
  return { valid: true };
}

function checkEntry(
  entries: readonly AuditEntry[],
  index: number,
  entry: AuditEntry,
): ChainVerification | null {
  const fail = (expected: string, found: string): ChainVerification => ({
    valid: false,
    brokenAt: index,
    expected,
    found,
  });

  if (entry.seq !== index + 1) return fail(String(index + 1), String(entry.seq));

  const previous = entries[index - 1];
  const expectedPrevHash = previous === undefined ? GENESIS_HASH : previous.hash;
  if (entry.prevHash !== expectedPrevHash) return fail(expectedPrevHash, entry.prevHash);

  const recomputed = auditEntryHash(entry);
  if (entry.hash !== recomputed) return fail(recomputed, entry.hash);

  return null;
}
