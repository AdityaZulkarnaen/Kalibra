import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
import { openDatabase, type OpenedDatabase } from '@kalibra/db';
import { runIngest, runPipeline } from '@kalibra/indexer';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  arenaSchema,
  errorSchema,
  leaderboardExampleSchema,
  leaderboardSchema,
  marketsSchema,
  registerRequestExampleSchema,
  registeredAgentSchema,
  statsSchema,
  walletExampleSchema,
  walletPositionsSchema,
  walletSchema,
} from './schemas.js';
import { buildServer } from './server.js';

const ROOT = process.cwd();
const AT = 1_787_620_000_000;

let opened: OpenedDatabase;
let app: FastifyInstance;
let rankedWallet: string;
let provisionalWallet: string;

beforeAll(async () => {
  opened = openDatabase(':memory:');
  const adapter = await ReplayAdapter.fromDirectory(join(ROOT, 'fixtures', 'synthetic'));
  await runIngest(adapter, opened.db, { ingestedAt: AT, mode: 'replay' });
  runPipeline(opened.db, { computedAt: AT });
  app = buildServer(opened.db, { validateResponses: true });

  const rows = opened.sqlite
    .prepare('SELECT wallet, status FROM scores ORDER BY wallet')
    .all() as Array<{ wallet: string; status: string }>;
  rankedWallet = rows.find((row) => row.status === 'RANKED')?.wallet as string;
  provisionalWallet = rows.find((row) => row.status === 'PROVISIONAL')?.wallet as string;
});

afterAll(async () => {
  await app.close();
  opened.close();
});

/**
 * Contract tests. The example payloads in API_SPEC.md are parsed by the same schemas the
 * server validates against, so the document and the implementation cannot drift apart
 * without a test failing.
 */
describe('the examples in API_SPEC.md parse under the published schemas', () => {
  const exampleUnder = async (heading: string): Promise<unknown> => {
    const spec = await readFile(join(ROOT, 'docs', 'API_SPEC.md'), 'utf8');
    const section = spec.slice(spec.indexOf(heading) + heading.length);
    const start = section.indexOf('```json');
    const body = section.slice(start + 7, section.indexOf('```', start + 7));
    return JSON.parse(body) as unknown;
  };

  it('the leaderboard example', async () => {
    const result = leaderboardExampleSchema.safeParse(
      await exampleUnder('### `GET /v1/leaderboard`'),
    );
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('the wallet example', async () => {
    const result = walletExampleSchema.safeParse(
      await exampleUnder('### `GET /v1/wallet/:address`'),
    );
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('the positions example', async () => {
    expect(
      walletPositionsSchema.safeParse(await exampleUnder('### `GET /v1/wallet/:address/positions`'))
        .success,
    ).toBe(true);
  });

  it('the markets example', async () => {
    expect(marketsSchema.safeParse(await exampleUnder('### `GET /v1/markets`')).success).toBe(true);
  });

  it('the error example', async () => {
    expect(errorSchema.safeParse(await exampleUnder('### 2.1 Conventions')).success).toBe(true);
  });

  it('the arena registration body', async () => {
    const result = registerRequestExampleSchema.safeParse(
      await exampleUnder('### `POST /v1/arena/register`'),
    );
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });
});

describe('GET /v1/leaderboard', () => {
  it('returns only ranked wallets by default, best first', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/leaderboard' });
    expect(response.statusCode).toBe(200);
    const body = leaderboardSchema.parse(response.json());
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((entry) => entry.status === 'RANKED')).toBe(true);
    const scores = body.entries.map((entry) => entry.score as number);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(body.entries.map((entry) => entry.rank)).toEqual(
      body.entries.map((_entry, index) => index + 1),
    );
  });

  it('puts the sample size beside every score, which is the point of the product', async () => {
    const body = leaderboardSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/leaderboard' })).json(),
    );
    expect(body.entries.every((entry) => Number.isInteger(entry.n))).toBe(true);
  });

  it('includes PROVISIONAL wallets only when asked, and never with a score', async () => {
    const body = leaderboardSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/leaderboard?status=all&limit=200' })).json(),
    );
    expect(body.total).toBe(25);
    const provisional = body.entries.filter((entry) => entry.status === 'PROVISIONAL');
    expect(provisional.length).toBe(5);
    expect(provisional.every((entry) => entry.score === null)).toBe(true);
  });

  it('echoes the parameter set so any row can be reproduced', async () => {
    const body = leaderboardSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/leaderboard' })).json(),
    );
    expect(body.params.minSample).toBe(30);
    expect(body.params.lambdaMax).toBe(0.5);
  });

  it('rejects a page size beyond the documented maximum', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/leaderboard?limit=500' });
    expect(response.statusCode).toBe(400);
    expect(errorSchema.parse(response.json()).error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /v1/wallet/:address', () => {
  it('returns all ten calibration bins, empty ones included', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/wallet/${rankedWallet}` });
    expect(response.statusCode).toBe(200);
    const body = walletSchema.parse(response.json());
    expect(body.calibration).toHaveLength(10);
    expect(body.calibration.map((bin) => bin.bin)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const empty = body.calibration.filter((bin) => bin.count === 0);
    expect(empty.every((bin) => bin.meanForecast === null && bin.observedFreq === null)).toBe(true);
  });

  it('answers on a checksummed address and replies in lowercase', async () => {
    const mixedCase = `0x${rankedWallet.slice(2).toUpperCase()}`;
    const body = walletSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/wallet/${mixedCase}` })).json(),
    );
    expect(body.wallet).toBe(rankedWallet);
  });

  it('withholds the score from a PROVISIONAL wallet but still reports the exclusions', async () => {
    const body = walletSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/wallet/${provisionalWallet}` })).json(),
    );
    expect(body.status).toBe('PROVISIONAL');
    expect(body.score).toBeNull();
    expect(body.excludedCount).toBeGreaterThan(0);
  });

  it('404s for a wallet we have never seen', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wallet/0xdead000000000000000000000000000000000000',
    });
    expect(response.statusCode).toBe(404);
    expect(errorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('400s on something that is not an address', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/wallet/not-an-address' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /v1/wallet/:address/positions', () => {
  it('shows the trader lean beside the market, per position', async () => {
    const body = walletPositionsSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/wallet/${rankedWallet}/positions` })).json(),
    );
    expect(body.total).toBeGreaterThan(0);
    const scored = body.positions.filter((position) => position.excludedReason === null);
    expect(scored.length).toBeGreaterThan(0);
    for (const position of scored) {
      expect(position.brierContribution).not.toBeNull();
      expect(position.marketBrierContribution).not.toBeNull();
      expect(position.netStake).toMatch(/^\d+$/);
    }
  });

  it('includes excluded positions with their reason, so the count is auditable', async () => {
    const body = walletPositionsSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/v1/wallet/${provisionalWallet}/positions` })
      ).json(),
    );
    expect(body.positions.every((position) => position.excludedReason !== null)).toBe(true);
    expect(body.positions.every((position) => position.brierContribution === null)).toBe(true);
  });

  it('paginates', async () => {
    const first = walletPositionsSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/v1/wallet/${rankedWallet}/positions?limit=5` })
      ).json(),
    );
    const second = walletPositionsSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/wallet/${rankedWallet}/positions?limit=5&offset=5`,
        })
      ).json(),
    );
    expect(first.positions).toHaveLength(5);
    expect(second.positions[0]?.positionId).not.toBe(first.positions[0]?.positionId);
  });
});

describe('GET /v1/markets', () => {
  it('reports trade counts and unique wallets per market', async () => {
    const body = marketsSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/markets?limit=200' })).json(),
    );
    expect(body.markets).toHaveLength(60);
    expect(body.markets.every((market) => market.tradeCount > 0)).toBe(true);
    expect(body.markets.every((market) => market.uniqueWallets > 0)).toBe(true);
  });

  it('reports marketEce as null rather than zero, because it is not built', async () => {
    const body = marketsSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/markets' })).json(),
    );
    expect(body.markets.every((market) => market.marketEce === null)).toBe(true);
  });

  it('filters by status and by underlying', async () => {
    const voided = marketsSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/markets?status=VOID' })).json(),
    );
    expect(voided.markets).toHaveLength(1);
    const btc = marketsSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/markets?underlying=BTC-USD&limit=200' })).json(),
    );
    expect(btc.markets).toHaveLength(20);
  });
});

/**
 * Arena. `PRD.md` section 4.2 is explicit that this adds no scoring machinery, so what
 * these tests check is that it adds none: the numbers on an Arena row are the wallet's own
 * numbers, read back through a join.
 */
describe('the Arena', () => {
  /**
   * Its own server, so the rate limiter starts empty and the clock can be driven. It shares
   * the database, because the point of the Arena is that it reads the same scores.
   */
  let arena: FastifyInstance;
  let now = AT;

  const register = async (body: Record<string, unknown>) =>
    arena.inject({ method: 'POST', url: '/v1/arena/register', payload: body });

  beforeAll(() => {
    arena = buildServer(opened.db, { validateResponses: true, clock: () => now });
  });

  afterAll(async () => {
    await arena.close();
    opened.sqlite.prepare('DELETE FROM agents').run();
  });

  it('registers an agent and derives its id from the name it will be shown under', async () => {
    const response = await register({
      wallet: rankedWallet,
      name: 'Vol Lean v2',
      description: 'leans against implied vol',
      method: 'fades the book when realised vol disagrees with it',
    });
    expect(response.statusCode).toBe(201);
    const agent = registeredAgentSchema.parse(response.json());
    expect(agent.agentId).toBe('vol-lean-v2');
    expect(agent.wallet).toBe(rankedWallet);
    expect(agent.registeredAt).toBe(AT);
  });

  it('refuses a second registration of the same wallet', async () => {
    const response = await register({ wallet: rankedWallet, name: 'Someone Else' });
    expect(response.statusCode).toBe(400);
    expect(errorSchema.parse(response.json()).error.message).toMatch(/already registered/);
  });

  it('refuses a name that would collide on the derived id', async () => {
    const response = await register({ wallet: provisionalWallet, name: 'vol lean V2' });
    expect(response.statusCode).toBe(400);
    expect(errorSchema.parse(response.json()).error.message).toMatch(/taken/);
  });

  it('refuses a body that is not a registration', async () => {
    expect((await register({ wallet: 'not-a-wallet', name: 'valid name' })).statusCode).toBe(400);
    expect((await register({ name: 'no wallet at all' })).statusCode).toBe(400);
  });

  it('limits registration to five an hour per address, then lets the window roll', async () => {
    // A refused registration costs budget too. Were it free, an invalid body would be an
    // unlimited attempt and the limit would only bind on callers who got it right.
    const fresh = buildServer(opened.db, { validateResponses: true, clock: () => now });
    try {
      for (let i = 0; i < 5; i += 1) {
        const response = await fresh.inject({
          method: 'POST',
          url: '/v1/arena/register',
          payload: { wallet: 'not a wallet', name: `agent ${i}` },
        });
        expect(response.statusCode).toBe(400);
      }
      const sixth = await fresh.inject({
        method: 'POST',
        url: '/v1/arena/register',
        payload: { wallet: provisionalWallet, name: 'sixth' },
      });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.headers['retry-after']).toBeDefined();

      now = AT + 60 * 60 * 1000;
      const later = await fresh.inject({
        method: 'POST',
        url: '/v1/arena/register',
        payload: { wallet: provisionalWallet, name: 'Sixth Try' },
      });
      expect(later.statusCode).toBe(201);
    } finally {
      now = AT;
      await fresh.close();
    }
  });

  it('ranks registered agents on the numbers their wallets already earned', async () => {
    const body = arenaSchema.parse((await arena.inject({ url: '/v1/arena' })).json());
    const entry = body.entries.find((row) => row.agentId === 'vol-lean-v2');
    expect(entry).toBeDefined();
    expect(entry?.method).toMatch(/fades the book/);
    expect(entry?.isAgent).toBe(true);

    const wallet = walletSchema.parse(
      (await app.inject({ url: `/v1/wallet/${rankedWallet}` })).json(),
    );
    expect(entry?.score).toBe(wallet.score);
    expect(entry?.n).toBe(wallet.n);
    expect(entry?.auc).toBe(wallet.stats.auc);
  });

  it('shows a registered agent that has not yet scored, rather than hiding it', async () => {
    const body = arenaSchema.parse((await arena.inject({ url: '/v1/arena' })).json());
    const provisional = body.entries.find((row) => row.agentId === 'sixth-try');
    expect(provisional?.status).toBe('PROVISIONAL');
    expect(provisional?.score).toBeNull();

    const ranked = arenaSchema.parse(
      (await arena.inject({ url: '/v1/arena?status=ranked' })).json(),
    );
    expect(ranked.entries.some((row) => row.agentId === 'sixth-try')).toBe(false);
    expect(ranked.total).toBeLessThan(body.total);
  });

  it('marks the agent on the main leaderboard too, so the two views agree', async () => {
    const body = leaderboardSchema.parse(
      (await app.inject({ url: '/v1/leaderboard?limit=200' })).json(),
    );
    const entry = body.entries.find((row) => row.wallet === rankedWallet);
    expect(entry?.isAgent).toBe(true);
    expect(entry?.agentName).toBe('Vol Lean v2');
  });
});

describe('GET /v1/stats', () => {
  it('reports what the pipeline actually did', async () => {
    const body = statsSchema.parse((await app.inject({ url: '/v1/stats' })).json());
    expect(body.totalWallets).toBe(25);
    expect(body.marketsSettled).toBeGreaterThan(0);
    expect(body.positionsScored).toBeGreaterThan(0);
    expect(body.lastIngestedAt).toBe(AT);
    expect(body.mode).toBe('replay');
  });

  /**
   * `ARCHITECTURE.md` section 7 specifies a counter that does not exist yet. Reporting zero
   * would read as "ingestion is clean"; null reads as "nobody is counting", which is true.
   */
  it('reports the rejected-payload count as null rather than as zero', async () => {
    const body = statsSchema.parse((await app.inject({ url: '/v1/stats' })).json());
    expect(body.rejectedPayloads).toBeNull();
  });
});

describe('conventions', () => {
  it('sets the documented cache header', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/leaderboard' });
    expect(response.headers['cache-control']).toBe('public, max-age=10');
  });

  it('answers an unknown route in the documented error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nothing' });
    expect(response.statusCode).toBe(404);
    expect(errorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });
});
