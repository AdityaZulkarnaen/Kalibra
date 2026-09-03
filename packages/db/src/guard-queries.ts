import {
  canonicalJson,
  type AuditEntry,
  type GuardDecision,
  type GuardOrder,
  type GuardState,
} from '@kalibra/core';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { KalibraDatabase } from './migrate.js';
import { auditLog, markets } from './schema.js';

/**
 * Guard's audit log, on disk. `API_SPEC.md` §1 defines the table; `RISK_POLICY_SPEC.md` §6
 * defines what goes in it.
 *
 * The three JSON columns are written with `canonicalJson` and read back through Zod, so a
 * row that survives a round trip rehashes to the same digest it was sealed with. Anything
 * looser and the chain would verify in memory and fail from disk, which is the worst place
 * to discover it.
 *
 * `seq` is the table's primary key, so there is **one chain across all agents**, not one
 * per agent. A per-agent export is therefore a filtered view and will not verify on its
 * own — `verifyChain` needs the whole log, which is what `readAuditLog` with no agent
 * returns.
 */

const bigintString = z
  .string()
  .regex(/^-?\d+$/)
  .transform(BigInt);
const side = z.enum(['UP', 'DOWN']);

/**
 * Every field the order carried when it was hashed has to survive the round trip, because
 * the digest was taken over all of them. Zod strips what it does not name, so a field added
 * to `GuardOrder` and forgotten here does not fail loudly — it silently drops out of the
 * recomputed hash and the whole chain reads as tampered with from entry one.
 *
 * That happened when `postOnly` was added: 201 real entries verified as broken while every
 * byte on disk was intact. If another field joins `GuardOrder`, it belongs here too.
 */
const orderSchema = z.object({
  marketId: z.string(),
  side,
  stake: bigintString,
  limitProb: z.number().nullable(),
  clientOrderId: z.string(),
  postOnly: z.boolean().optional(),
});

const decisionSchema = z.union([
  z.object({ verdict: z.literal('ALLOW') }),
  z.object({
    verdict: z.literal('DENY'),
    reason: z.string(),
    detail: z.string(),
    severity: z.enum(['BLOCK', 'FATAL']),
  }),
]);

const stateSchema = z.object({
  now: z.number(),
  openNotional: bigintString,
  dailyRealisedPnl: bigintString,
  dailyUnrealisedPnl: bigintString,
  ordersInWindow: z.number(),
  consecutiveLosses: z.number(),
  cooldownUntil: z.number().nullable(),
  killSwitchTrippedAt: z.number().nullable(),
  market: z
    .object({
      marketId: z.string(),
      status: z.enum(['OPEN', 'CLOSED', 'SETTLED', 'VOID']),
      windowEnd: z.number(),
    })
    .nullable(),
  clientOrderIdSeen: z.boolean(),
});

export function appendAuditEntry(db: KalibraDatabase, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      seq: entry.seq,
      timestamp: entry.timestamp,
      agentId: entry.agentId,
      policyId: entry.policyId,
      policyVersion: entry.policyVersion,
      orderJson: canonicalJson(entry.order),
      decisionJson: canonicalJson(entry.decision),
      stateJson: canonicalJson(entry.stateSnapshot),
      prevHash: entry.prevHash,
      hash: entry.hash,
    })
    .run();
}

type AuditRow = typeof auditLog.$inferSelect;

function toEntry(row: AuditRow): AuditEntry {
  return {
    seq: row.seq,
    timestamp: row.timestamp,
    agentId: row.agentId,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    order: orderSchema.parse(JSON.parse(row.orderJson)) as GuardOrder,
    decision: decisionSchema.parse(JSON.parse(row.decisionJson)) as GuardDecision,
    stateSnapshot: stateSchema.parse(JSON.parse(row.stateJson)) as GuardState,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/** The whole chain in `seq` order, or one agent's slice of it. */
export function readAuditLog(db: KalibraDatabase, agentId?: string): AuditEntry[] {
  const base = db.select().from(auditLog);
  const rows =
    agentId === undefined
      ? base.orderBy(asc(auditLog.seq)).all()
      : base.where(eq(auditLog.agentId, agentId)).orderBy(asc(auditLog.seq)).all();
  return rows.map(toEntry);
}

/** The tail of the chain, which is what the next entry links to. */
export function lastAuditEntry(db: KalibraDatabase): AuditEntry | undefined {
  const [row] = db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1).all();
  return row === undefined ? undefined : toEntry(row);
}

const guardMarketSchema = z.object({
  marketId: z.string(),
  status: z.enum(['OPEN', 'CLOSED', 'SETTLED', 'VOID']),
  windowEnd: z.number(),
  outcome: z.enum(['UP', 'DOWN', 'VOID']).nullable(),
  settledAt: z.number().nullable(),
});

/** Guard's view of a market: what it is doing now, and how it ended if it ended. */
export type GuardMarketRow = z.infer<typeof guardMarketSchema>;

/**
 * Read straight from `markets`, which the indexer keeps current, rather than from the
 * adapter. Guard needs settlement outcomes to compute a loss streak and the venue's market
 * list does not carry them; going to one source for both keeps the two from disagreeing
 * mid-decision.
 */
export function readGuardMarkets(db: KalibraDatabase, marketIds: readonly string[]) {
  if (marketIds.length === 0) return new Map<string, GuardMarketRow>();
  const rows = db
    .select({
      marketId: markets.marketId,
      status: markets.status,
      windowEnd: markets.windowEnd,
      outcome: markets.outcome,
      settledAt: markets.settledAt,
    })
    .from(markets)
    .where(inArray(markets.marketId, [...marketIds]))
    .all();
  // SQLite's CHECK constraint is not a type. Parse rather than cast (invariant I4): a row
  // written by some other tool with an unexpected status fails here, not three rules later.
  return new Map<string, GuardMarketRow>(
    rows.map((row) => {
      const parsed = guardMarketSchema.parse(row);
      return [parsed.marketId, parsed];
    }),
  );
}

/** One order Guard forwarded, as it can be recovered after a restart. */
export interface GuardForwardedRow {
  readonly clientOrderId: string;
  readonly marketId: string;
  readonly side: 'UP' | 'DOWN';
  readonly stake: bigint;
  readonly impliedProbUp: number;
  readonly at: number;
}

/**
 * Rebuilds an agent's forwarded orders from Guard's own audit log.
 *
 * The audit log is the right source and `trades` is not. A GUARD row in `trades` records
 * what an agent *asked for*; against a real venue the tape separately records what actually
 * *filled*, and the two are different numbers for the same position — a partial fill of an
 * order makes them differ by most of the size. Deriving risk from the audit log and scoring
 * from the tape keeps each question answered by the source that knows it.
 *
 * Only ALLOW decisions count, and only the last decision for a client order id: an order
 * allowed and then recorded as UPSTREAM_UNAVAILABLE never reached the venue, so it is no
 * exposure and must not be counted as any.
 *
 * The entry price is the order's own limit. Guard needs a price to mark a position against,
 * and a buyer never pays more than their limit — so PnL computed at the limit overstates
 * cost, which errs toward tripping a loss limit early rather than late. That is the
 * direction a risk control should be wrong in.
 */
export function readGuardLedger(db: KalibraDatabase, agentId: string): GuardForwardedRow[] {
  const latest = new Map<string, GuardForwardedRow | null>();

  for (const entry of readAuditLog(db, agentId)) {
    const { clientOrderId } = entry.order;
    if (entry.decision.verdict !== 'ALLOW') {
      latest.set(clientOrderId, null);
      continue;
    }
    latest.set(clientOrderId, {
      clientOrderId,
      marketId: entry.order.marketId,
      side: entry.order.side,
      stake: entry.order.stake,
      // A market order carries no limit; 0.5 is the neutral mark, and it is only ever a
      // marking price for a risk counter, never a number that reaches a score.
      impliedProbUp: entry.order.limitProb ?? 0.5,
      at: entry.timestamp,
    });
  }

  return [...latest.values()].filter((row): row is GuardForwardedRow => row !== null);
}
