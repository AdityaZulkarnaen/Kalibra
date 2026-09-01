import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
import { openDatabase, type OpenedDatabase } from '@kalibra/db';
import { runIngest, runPipeline } from '@kalibra/indexer';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  errorSchema,
  leaderboardExampleSchema,
  leaderboardSchema,
  marketsSchema,
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
  await runIngest(adapter, opened.db, { ingestedAt: AT });
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
