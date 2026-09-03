import { sql } from 'drizzle-orm';

import type { KalibraDatabase } from './migrate.js';
import type { LeaderboardRow, Page } from './read-queries.js';
import { agents } from './schema.js';

/**
 * Arena: the agent registry and the leaderboard filtered to it (`API_SPEC.md` §2,
 * `PRD.md` §4.2).
 *
 * There is no new scoring machinery here and there must not be. An agent's score is the
 * same score its wallet earns on the main leaderboard, read back through a join —
 * registering claims a display name and nothing else.
 */

export interface AgentRow {
  readonly agentId: string;
  readonly wallet: string;
  readonly name: string;
  readonly description: string | null;
  readonly method: string | null;
  readonly registeredAt: number;
}

export interface ArenaRow extends LeaderboardRow {
  readonly agentId: string;
  readonly method: string | null;
  readonly registeredAt: number;
}

/**
 * Why the outcome is a value rather than an exception: both collisions are ordinary
 * client errors that map to a 400, and a caller that has to parse an error message to
 * tell them apart will eventually get it wrong.
 */
export type RegistrationOutcome =
  | { readonly outcome: 'REGISTERED'; readonly agent: AgentRow }
  | { readonly outcome: 'DUPLICATE_WALLET' }
  | { readonly outcome: 'DUPLICATE_AGENT_ID' };

/**
 * Registers an agent, or reports which uniqueness it collided with.
 *
 * The lookup and the insert share a transaction. better-sqlite3 is synchronous, so this
 * is not defending against a thread — it is defending against the check and the write
 * being separated by a later refactor, at which point two registrations of one wallet
 * would both read "free" and one would fail on the constraint with no useful message.
 */
export function registerAgent(db: KalibraDatabase, row: AgentRow): RegistrationOutcome {
  return db.transaction((tx): RegistrationOutcome => {
    const clash = tx.all<{ agentId: string; wallet: string }>(sql`
      SELECT agent_id AS agentId, wallet FROM agents
      WHERE agent_id = ${row.agentId} OR wallet = ${row.wallet}
    `);
    if (clash.some((existing) => existing.wallet === row.wallet)) {
      return { outcome: 'DUPLICATE_WALLET' };
    }
    if (clash.length > 0) return { outcome: 'DUPLICATE_AGENT_ID' };

    tx.insert(agents).values(row).run();
    return { outcome: 'REGISTERED', agent: row };
  });
}

export function readAgent(db: KalibraDatabase, agentId: string): AgentRow | undefined {
  const [row] = db.all<AgentRow>(sql`
    SELECT agent_id AS agentId, wallet, name, description, method,
           registered_at AS registeredAt
    FROM agents WHERE agent_id = ${agentId}
  `);
  return row;
}

/**
 * The leaderboard, restricted to registered agents.
 *
 * Driven from `agents` rather than from `scores`, so an agent that has registered but has
 * not yet resolved a position appears with `n = 0` and no number, rather than vanishing.
 * A registry that hides its quiet members reads as smaller than it is.
 */
export function readArenaLeaderboard(
  db: KalibraDatabase,
  page: Page,
  rankedOnly: boolean,
): { total: number; rows: ArenaRow[] } {
  const filter = rankedOnly ? sql`WHERE s.status = 'RANKED'` : sql``;
  const [count] = db.all<{ n: number }>(sql`
    SELECT count(*) AS n FROM agents a LEFT JOIN scores s ON s.wallet = a.wallet ${filter}
  `);
  const rows = db.all<ArenaRow>(sql`
    SELECT a.agent_id AS agentId, a.wallet, a.name AS agentName, a.method,
           a.registered_at AS registeredAt,
           s.score, coalesce(s.status, 'PROVISIONAL') AS status, coalesce(s.n, 0) AS n,
           s.bss, s.ece_excess AS eceExcess, s.auc
    FROM agents a
    LEFT JOIN scores s ON s.wallet = a.wallet
    ${filter}
    ORDER BY CASE WHEN s.score IS NULL THEN 1 ELSE 0 END, s.score DESC, a.agent_id ASC
    LIMIT ${page.limit} OFFSET ${page.offset}
  `);
  return { total: count?.n ?? 0, rows };
}
