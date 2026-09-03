import { LiveAdapter, readLiveTouch } from '@kalibra/adapter-dreamdex';
import { z } from 'zod';

import { STRATEGIES } from './strategy.js';
import { Supervisor, describe, type GuardClient, type Venue } from './supervisor.js';

/**
 * `pnpm agents` — runs the demo agents continuously against Guard.
 *
 * They trade through Guard's HTTP surface and hold no key: Guard signs, which is what makes
 * the policy binding rather than advisory. The supervisor holds the operator token because it
 * has to keep the allowlist current as windows roll — it is the operator here, not an agent.
 *
 * Restart-safe by construction. Nothing is kept that a restart would need: Guard rebuilds each
 * agent's exposure from the trades it wrote, and a market whose baseline this process has not
 * seen is simply not traded by the strategy that needs one, rather than traded on a guess.
 */
const configSchema = z.object({
  DREAMDEX_INDEXER_URL: z.url(),
  GUARD_URL: z.string().default('http://127.0.0.1:3002'),
  GUARD_OPERATOR_TOKEN: z.string().min(16),
  AGENT_INTERVAL_MS: z.coerce.number().int().min(10_000).max(600_000).default(45_000),
  /** Windows closing sooner than this are skipped: they can lock mid-flight. */
  AGENT_MIN_HEADROOM_MS: z.coerce.number().int().min(30_000).default(90_000),
  AGENT_MAX_MARKETS: z.coerce.number().int().min(1).max(20).default(6),
  /** Must not exceed DREAMDEX_MARKET_LIMIT, or Guard cannot resolve what the agent picks. */
  AGENT_MARKET_LIMIT: z.coerce.number().int().min(1).max(500).default(25),
  /** How far through the touch to bid. Two ticks on this venue. */
  AGENT_SLIPPAGE: z.coerce.number().min(0).max(0.2).default(0.002),
  AGENT_LOG_PATH: z.string().default('./logs/collection.jsonl'),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`agent configuration is not valid:\n${z.prettifyError(parsed.error)}`);
}
const config = parsed.data;

// Bounded below the indexer's own limit on purpose. Guard resolves a market's status and
// window from the `markets` table, so a window the indexer has not reached yet is refused
// as MARKET_NOT_OPEN — the agent would be picking markets Guard cannot see.
const adapter = new LiveAdapter({
  indexerUrl: config.DREAMDEX_INDEXER_URL,
  marketLimit: config.AGENT_MARKET_LIMIT,
  includeUntraded: true,
});

const venue: Venue = {
  listMarkets: () => adapter.listMarkets(),
  touch: async (marketId) => {
    // The live book from the pool contract, never the reconstruction getQuote returns: that
    // one is the mid at a past fill, which is what scoring wants and what quoting must not use.
    const live = await readLiveTouch({ indexerUrl: config.DREAMDEX_INDEXER_URL }, marketId);
    return {
      bestBidUp: live.bestBidUp,
      bestAskUp: live.bestAskUp,
      midUp: live.midUp,
      status: live.status,
    };
  },
};

const post = async (path: string, body: unknown, token?: string): Promise<Response> =>
  fetch(`${config.GUARD_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

const guard: GuardClient = {
  allowMarkets: async (marketIds) => {
    const response = await post(
      '/guard/operator/allowed-markets',
      { allowedMarkets: [...marketIds] },
      config.GUARD_OPERATOR_TOKEN,
    );
    if (!response.ok) {
      throw new Error(`allowlist rotation failed: HTTP ${response.status}`);
    }
  },
  submit: async (agentId, order) => {
    const response = await post('/guard/order', { agentId, order });
    // 403 is a policy denial and a normal outcome; anything else is a transport problem.
    if (!response.ok && response.status !== 403) {
      throw new Error(`guard returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      decision: { verdict: string; reason?: string };
      auditSeq: number;
      recorded: boolean;
    };
    return {
      verdict: body.decision.verdict,
      ...(body.decision.reason === undefined ? {} : { reason: body.decision.reason }),
      auditSeq: body.auditSeq,
      recorded: body.recorded,
    };
  },
};

const supervisor = new Supervisor({
  venue,
  guard,
  strategies: STRATEGIES,
  logPath: config.AGENT_LOG_PATH,
  minHeadroomMs: config.AGENT_MIN_HEADROOM_MS,
  maxMarketsPerCycle: config.AGENT_MAX_MARKETS,
  slippage: config.AGENT_SLIPPAGE,
  now: () => Date.now(),
});

console.log(`kalibra agents -> ${config.GUARD_URL}, every ${config.AGENT_INTERVAL_MS / 1000}s`);
for (const strategy of STRATEGIES) console.log(`  ${strategy.agentId}  ${strategy.name}`);
console.log(`log ${config.AGENT_LOG_PATH}\n`);

for (;;) {
  const startedAt = Date.now();
  try {
    const report = await supervisor.runCycle();
    console.log(
      `${new Date().toISOString()}  ` +
        `markets ${report.considered}  submitted ${report.submitted}  ` +
        `allowed ${report.allowed}  denied ${report.denied}  failed ${report.failed}`,
    );
  } catch (cause) {
    // A cycle that throws is one lost cycle, not a lost run. The venue drops a socket, Guard
    // restarts, a window locks mid-read; none of that should end a two-day collection.
    console.error(`${new Date().toISOString()}  cycle failed: ${describe(cause)}`);
  }
  const elapsed = Date.now() - startedAt;
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(1000, config.AGENT_INTERVAL_MS - elapsed)),
  );
}
