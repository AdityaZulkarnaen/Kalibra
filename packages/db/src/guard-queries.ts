import {
  canonicalJson,
  type AuditEntry,
  type GuardDecision,
  type GuardOrder,
  type GuardState,
} from '@kalibra/core';
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';

import type { KalibraDatabase } from './migrate.js';
import { auditLog, markets, trades } from './schema.js';

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

/** One order Guard forwarded, as it can be recovered after a restart. */
export const guardForwardedSchema = z.object({
  clientOrderId: z.string().min(1),
  marketId: z.string().min(1),
  side: z.enum(['UP', 'DOWN']),
  stake: z.string().regex(/^\d+$/).transform(BigInt),
  impliedProbUp: z.number(),
  at: z.number().int(),
});

export type GuardForwardedRow = z.infer<typeof guardForwardedSchema>;

/**
 * Rebuilds an agent's forwarded orders from the trades Guard itself wrote.
 *
 * Guard derives every counter in `GuardState` from this list rather than storing them, so
 * losing it means an agent's open notional, daily loss and loss streak all silently reset to
 * zero. A restart would hand a limit-breaching agent a clean slate, which is the one thing a
 * risk envelope must not do — and it is invisible, because the numbers look plausible.
 *
 * Nothing new is persisted for this. A forwarded order already becomes a row in `trades`
 * with `source = 'GUARD'` and a `trade_id` of `guard:{agentId}:{clientOrderId}`, so the
 * ledger was always recoverable; it simply was not being recovered.
 */
export function readGuardLedger(db: KalibraDatabase, agentId: string): GuardForwardedRow[] {
  const prefix = `guard:${agentId}:`;
  const rows = db
    .select({
      tradeId: trades.tradeId,
      marketId: trades.marketId,
      side: trades.side,
      stake: trades.stake,
      impliedProbUp: trades.impliedProbUp,
      at: trades.timestamp,
    })
    .from(trades)
    .where(and(eq(trades.source, 'GUARD'), like(trades.tradeId, `${prefix}%`)))
    .orderBy(trades.timestamp)
    .all();

  return rows.map((row) =>
    guardForwardedSchema.parse({
      clientOrderId: row.tradeId.slice(prefix.length),
      marketId: row.marketId,
      side: row.side,
      stake: row.stake,
      impliedProbUp: row.impliedProbUp,
      at: row.at,
    }),
  );
}
