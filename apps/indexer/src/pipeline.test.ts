import { join } from 'node:path';

import { ReplayAdapter } from '@kalibra/adapter-dreamdex';
import { MIN_SAMPLE, SCORE_ANCHOR } from '@kalibra/core';
import { listPositions, listScores, openDatabase, type OpenedDatabase } from '@kalibra/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runIngest } from './ingest.js';
import { runPipeline } from './pipeline.js';

const FIXTURES = join(process.cwd(), 'fixtures', 'synthetic');
const AT = 1_787_620_000_000;

/** Wallet addresses are assigned by index in the fixture generator. */
const walletAddress = (index: number): string => `0x${(index + 1).toString(16).padStart(40, '0')}`;
const WASH_WALLETS = [2, 10, 18].map(walletAddress);
const DUST_WALLETS = [7, 15].map(walletAddress);

let opened: OpenedDatabase;

const ingestAndScore = async (): Promise<void> => {
  const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
  await runIngest(adapter, opened.db, { ingestedAt: AT });
  runPipeline(opened.db, { computedAt: AT });
};

beforeEach(() => {
  opened = openDatabase(':memory:');
});

afterEach(() => {
  opened.close();
});

describe('the full pipeline over the synthetic fixtures', () => {
  it('produces a score row for every one of the 25 wallets', async () => {
    await ingestAndScore();
    const rows = listScores(opened.db);
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((row) => row.wallet)).size).toBe(25);
    for (const row of rows) {
      expect(row.paramsHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(row.computedAt).toBe(AT);
    }
  });

  it('gives every wallet all ten calibration bins, empty ones included', async () => {
    await ingestAndScore();
    const bins = opened.sqlite
      .prepare('SELECT wallet, COUNT(*) AS n FROM calibration_bins GROUP BY wallet')
      .all() as Array<{ wallet: string; n: number }>;
    expect(bins).toHaveLength(25);
    expect(bins.every((row) => row.n === 10)).toBe(true);
  });

  it('nets wash traders out — they are excluded, never scored', async () => {
    await ingestAndScore();
    for (const wallet of WASH_WALLETS) {
      const row = listScores(opened.db).find((score) => score.wallet === wallet);
      expect(row?.n, `${wallet} should have no scored positions`).toBe(0);
      expect(row?.score).toBeNull();
      expect(row?.excludedCount).toBeGreaterThan(0);
      // Gaming the metric converges to the metric's null value.
      expect(row?.scoreInternal).toBe(SCORE_ANCHOR);
    }
    const washPositions = listPositions(opened.db).filter((p) => WASH_WALLETS.includes(p.wallet));
    expect(washPositions.length).toBeGreaterThan(0);
    expect(washPositions.every((p) => p.excludedReason === 'NO_DIRECTIONAL_VIEW')).toBe(true);
  });

  it('excludes sub-minimum-stake wallets with a reason recorded', async () => {
    await ingestAndScore();
    for (const wallet of DUST_WALLETS) {
      const positions = listPositions(opened.db).filter((p) => p.wallet === wallet);
      expect(positions.length).toBeGreaterThan(0);
      expect(positions.every((p) => p.excludedReason === 'BELOW_MIN_STAKE')).toBe(true);
      expect(listScores(opened.db).find((s) => s.wallet === wallet)?.n).toBe(0);
    }
  });

  it('excludes every position in the VOID market', async () => {
    await ingestAndScore();
    const voided = opened.sqlite
      .prepare("SELECT market_id FROM markets WHERE outcome = 'VOID'")
      .get() as { market_id: string };
    const positions = listPositions(opened.db).filter((p) => p.marketId === voided.market_id);
    expect(positions.length).toBeGreaterThan(0);

    // Not one of them is scored, and none carries an outcome.
    expect(positions.every((p) => p.excludedReason !== null)).toBe(true);
    expect(positions.every((p) => p.outcomeY === null)).toBe(true);

    // A position excluded only by the void carries that reason. One that is also a wash or
    // below the minimum reports the reason checked first — any one of them is enough, and
    // SCORING_SPEC 4.4 does not rank them.
    const voidOnly = positions.filter((p) => p.excludedReason === 'MARKET_VOID');
    expect(voidOnly.length).toBeGreaterThan(0);
  });

  it('records lambda and forecast on scored positions and nothing on excluded ones', async () => {
    await ingestAndScore();
    for (const position of listPositions(opened.db)) {
      if (position.excludedReason === null) {
        expect(position.lambda).not.toBeNull();
        expect(position.forecast).not.toBeNull();
      } else {
        expect(position.lambda).toBeNull();
        expect(position.forecast).toBeNull();
      }
    }
  });

  it('withholds a published score from every PROVISIONAL wallet', async () => {
    await ingestAndScore();
    for (const row of listScores(opened.db)) {
      if (row.n < MIN_SAMPLE) {
        expect(row.status).toBe('PROVISIONAL');
        expect(row.score).toBeNull();
      } else {
        expect(row.status).toBe('RANKED');
        expect(row.score).toBe(row.scoreInternal);
      }
    }
  });

  it('produces identical score rows when run twice', async () => {
    await ingestAndScore();
    const first = listScores(opened.db);
    const firstPositions = listPositions(opened.db);

    runPipeline(opened.db, { computedAt: AT });

    expect(listScores(opened.db)).toEqual(first);
    expect(listPositions(opened.db)).toEqual(firstPositions);
  });

  it('keeps one position per wallet per market, which is what stops sample farming', async () => {
    await ingestAndScore();
    const positions = listPositions(opened.db);
    const keys = positions.map((p) => `${p.wallet}|${p.marketId}`);
    expect(new Set(keys).size).toBe(positions.length);
  });
});
