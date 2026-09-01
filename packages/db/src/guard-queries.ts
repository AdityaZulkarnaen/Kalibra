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

const orderSchema = z.object({
  marketId: z.string(),
  side,
  stake: bigintString,
  limitProb: z.number().nullable(),
  clientOrderId: z.string(),
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
