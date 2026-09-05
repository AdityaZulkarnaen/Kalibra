import { describe, expect, it } from 'vitest';

import {
  ApiNotFoundError,
  ApiUnavailableError,
  fetchLeaderboard,
  fetchStats,
  fetchWallet,
} from './api';

/**
 * The failure paths matter more than the happy one here: BUILD_PLAN.md day 5 requires that
 * an API which is down produces an error state and never stale data. These assert that
 * every way the API can disappoint ends in a throw rather than a partial object.
 */

const respond =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

const leaderboardBody = {
  params: {
    lambdaMax: 0.5,
    shrinkK: 25,
    minSample: 30,
    paramsHash: `0x${'a'.repeat(64)}`,
  },
  total: 1,
  entries: [
    {
      rank: 1,
      wallet: `0x${'1'.repeat(40)}`,
      score: 678,
      status: 'RANKED',
      n: 47,
      bss: 0.21,
      eceExcess: 0,
      auc: 0.64,
      isAgent: false,
      agentName: null,
    },
  ],
};

describe('fetchLeaderboard', () => {
  it('parses a response that matches the published contract', async () => {
    const board = await fetchLeaderboard('ranked', 50, {
      baseUrl: 'http://api.invalid',
      fetch: respond(leaderboardBody),
    });
    expect(board.entries[0]?.score).toBe(678);
    expect(board.params.minSample).toBe(30);
  });

  it('asks the API for the status the caller wanted', async () => {
    const seen: string[] = [];
    await fetchLeaderboard('all', 200, {
      baseUrl: 'http://api.invalid',
      fetch: (url) => {
        seen.push(url);
        return respond(leaderboardBody)();
      },
    });
    expect(seen[0]).toBe('http://api.invalid/v1/leaderboard?status=all&limit=200');
  });

  it('throws when the API is unreachable, rather than returning an empty board', async () => {
    await expect(
      fetchLeaderboard('ranked', 50, {
        baseUrl: 'http://api.invalid',
        fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    ).rejects.toThrow(ApiUnavailableError);
  });

  it('throws on a 500 rather than rendering a page with no rows', async () => {
    await expect(
      fetchLeaderboard('ranked', 50, {
        baseUrl: 'http://api.invalid',
        fetch: respond({ error: { code: 'INTERNAL', message: 'boom' } }, 500),
      }),
    ).rejects.toThrow(ApiUnavailableError);
  });

  it('throws when the payload breaks the contract, rather than rendering undefined', async () => {
    const broken = { ...leaderboardBody, entries: [{ rank: 1, wallet: 'not-an-address' }] };
    await expect(
      fetchLeaderboard('ranked', 50, { baseUrl: 'http://api.invalid', fetch: respond(broken) }),
    ).rejects.toThrow(ApiUnavailableError);
  });

  it('throws when the response is not JSON at all', async () => {
    await expect(
      fetchLeaderboard('ranked', 50, {
        baseUrl: 'http://api.invalid',
        fetch: () => Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
      }),
    ).rejects.toThrow(ApiUnavailableError);
  });
});

describe('fetchWallet', () => {
  it('distinguishes an unknown wallet from an unavailable API', async () => {
    await expect(
      fetchWallet(`0x${'2'.repeat(40)}`, {
        baseUrl: 'http://api.invalid',
        fetch: respond({ error: { code: 'NOT_FOUND', message: 'no positions' } }, 404),
      }),
    ).rejects.toThrow(ApiNotFoundError);
  });
});

describe('fetchStats', () => {
  const statsBody = {
    totalWallets: 25,
    rankedWallets: 20,
    positionsScored: 861,
    marketsSettled: 60,
    mode: 'replay',
    lastIngestedAt: 1_756_900_000_000,
    paramsHash: `0x${'b'.repeat(64)}`,
    rejectedPayloads: null,
  };

  it('parses the pipeline counters the landing page reports', async () => {
    const stats = await fetchStats({
      baseUrl: 'http://api.invalid',
      fetch: respond(statsBody),
    });
    expect(stats.positionsScored).toBe(861);
    expect(stats.mode).toBe('replay');
  });

  it('accepts the nulls the endpoint is specified to return', async () => {
    // `rejectedPayloads` is null by design: nothing counts them yet, and a zero would read
    // as "ingestion is clean" rather than "nobody is counting". Same for a fresh database
    // that has never been ingested into.
    const stats = await fetchStats({
      baseUrl: 'http://api.invalid',
      fetch: respond({ ...statsBody, mode: null, lastIngestedAt: null, paramsHash: null }),
    });
    expect(stats.rejectedPayloads).toBeNull();
    expect(stats.lastIngestedAt).toBeNull();
  });

  it('throws when the API is unreachable, so the caller cannot mistake it for zeroes', async () => {
    await expect(
      fetchStats({
        baseUrl: 'http://api.invalid',
        fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    ).rejects.toThrow(ApiUnavailableError);
  });
});
