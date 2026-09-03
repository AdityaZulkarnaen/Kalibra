/**
 * `pnpm collection-status` — what the collection loop has, and what it still has in flight.
 *
 * Written for the one decision this repository makes at the console: whether it is safe to
 * stop. The indexer only sees the newest markets the venue lists, so a settlement missed
 * while nothing is running is missed permanently — a position whose market settled during
 * the gap stays MARKET_UNSETTLED and is excluded from scoring for good. Stopping is
 * therefore safe only once nothing is in flight.
 *
 * Deliberately scoped to the registered agents. `MARKET_UNSETTLED` across every wallet
 * counts the whole venue's traders and rises as fast as the indexer ingests new open
 * markets, so it never falls to zero and reads as a leak when it is simply flow.
 */
import { openDatabase, readArenaLeaderboard, readStats } from '@kalibra/db';
import { MIN_SAMPLE, SHRINK_K } from '@kalibra/core';

const DB_PATH = process.env['KALIBRA_DB_PATH'] ?? './kalibra.db';
const MINUTE = 60_000;

const { db, sqlite, close } = openDatabase(DB_PATH);
const now = Date.now();

try {
  const { rows: agents } = readArenaLeaderboard(db, { limit: 100, offset: 0 }, false);
  if (agents.length === 0) {
    console.log('No agents registered. Run `pnpm register-agents` first.');
  }

  const inFlight = sqlite.prepare(`
    SELECT p.wallet,
           sum(CASE WHEN m.window_end >  ? THEN 1 ELSE 0 END) AS open,
           sum(CASE WHEN m.window_end <= ? THEN 1 ELSE 0 END) AS awaiting
    FROM positions p
    JOIN markets m ON m.market_id = p.market_id
    WHERE p.excluded_reason = 'MARKET_UNSETTLED'
    GROUP BY p.wallet
  `);
  const byWallet = new Map(
    (inFlight.all(now, now) as Array<{ wallet: string; open: number; awaiting: number }>).map(
      (row) => [row.wallet, row],
    ),
  );

  console.log(`db      ${DB_PATH}`);
  const stats = readStats(db);
  const lastIngest =
    stats.lastIngestedAt === null
      ? 'never'
      : `${((now - stats.lastIngestedAt) / MINUTE).toFixed(1)} min ago`;
  const [audit] = sqlite.prepare('SELECT max(timestamp) AS t FROM audit_log').all() as Array<{
    t: number | null;
  }>;
  const lastOrder =
    audit?.t === null || audit?.t === undefined
      ? 'never'
      : `${((now - audit.t) / MINUTE).toFixed(1)} min ago`;
  console.log(`ingest  ${lastIngest}`);
  console.log(`order   ${lastOrder}\n`);

  console.log('agent               n   status        signal   in flight');
  let totalOpen = 0;
  let totalAwaiting = 0;
  for (const agent of agents) {
    const flight = byWallet.get(agent.wallet);
    const open = flight?.open ?? 0;
    const awaiting = flight?.awaiting ?? 0;
    totalOpen += open;
    totalAwaiting += awaiting;

    // How much of the measured skill survives shrinkage at this sample size. At n = 30 it
    // is 55%: the threshold is where a number appears, not where it can be trusted.
    const signal = `${((agent.n / (agent.n + SHRINK_K)) * 100).toFixed(0)}%`;
    const status = agent.status === 'RANKED' ? `RANKED ${agent.score}` : 'PROVISIONAL';
    console.log(
      `${agent.agentId.padEnd(18)}${String(agent.n).padEnd(4)}${status.padEnd(14)}` +
        `${signal.padEnd(9)}${open} open, ${awaiting} awaiting`,
    );
  }

  const short = agents.filter((agent) => agent.n < MIN_SAMPLE).length;
  console.log(
    `\n${agents.length - short} of ${agents.length} past the ${MIN_SAMPLE}-position minimum`,
  );

  if (totalOpen === 0 && totalAwaiting === 0) {
    console.log('\nSAFE TO STOP: nothing in flight.');
  } else {
    console.log(
      `\nDO NOT STOP YET: ${totalOpen} position(s) in an open window and ` +
        `${totalAwaiting} awaiting an outcome. Stopping the indexer now strands them, and a ` +
        `stranded position is excluded from scoring permanently. Stop the agents, leave the ` +
        `indexer running, and re-run this until it says safe.`,
    );
  }
} finally {
  close();
}
