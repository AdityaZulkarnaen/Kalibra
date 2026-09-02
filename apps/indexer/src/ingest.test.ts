import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ReplayAdapter,
  type CanonicalSettlement,
  type CanonicalTrade,
} from '@kalibra/adapter-dreamdex';
import { countRows, countSettledMarkets, openDatabase, type OpenedDatabase } from '@kalibra/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runIngest } from './ingest.js';

const FIXTURES = join(process.cwd(), 'fixtures', 'synthetic');
const INGESTED_AT = 1_787_620_000_000;

/** Counted from the files rather than hardcoded: the fixture size is a spec parameter. */
const countIn = async (name: string): Promise<number> =>
  (JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as unknown[]).length;

let opened: OpenedDatabase;

beforeEach(() => {
  opened = openDatabase(':memory:');
});

afterEach(() => {
  opened.close();
});

describe('runIngest over the synthetic fixtures', { timeout: 30_000 }, () => {
  it('lands every market, trade and settlement', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const summary = await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT });

    const [markets, trades, settlements] = await Promise.all([
      countIn('markets.json'),
      countIn('trades.json'),
      countIn('settlements.json'),
    ]);

    expect(summary.marketsInserted).toBe(markets);
    expect(summary.tradesInserted).toBe(trades);
    expect(summary.settlementsApplied).toBe(settlements);
    expect(summary.tradesOrphaned).toBe(0);
    expect(summary.settlementsOrphaned).toBe(0);

    expect(countRows(opened.db, 'markets')).toBe(markets);
    expect(countRows(opened.db, 'trades')).toBe(trades);
    expect(countSettledMarkets(opened.db)).toBe(settlements);
  });

  it('produces zero duplicate rows when run again', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT });
    const second = await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT + 1 });

    const trades = await countIn('trades.json');
    expect(second.marketsInserted).toBe(0);
    expect(second.tradesInserted).toBe(0);
    expect(second.tradesSeen).toBe(trades);
    expect(countRows(opened.db, 'markets')).toBe(await countIn('markets.json'));
    expect(countRows(opened.db, 'trades')).toBe(trades);
  });

  it('keeps the first ingestion timestamp rather than overwriting it on replay', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT });
    await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT + 5000 });
    const row = opened.sqlite
      .prepare('SELECT DISTINCT ingested_at AS at FROM trades')
      .all() as Array<{ at: number }>;
    expect(row).toEqual([{ at: INGESTED_AT }]);
  });

  it('carries the VOID settlement through to the market row', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT });
    const voided = opened.sqlite
      .prepare("SELECT market_id, status FROM markets WHERE outcome = 'VOID'")
      .all() as Array<{ market_id: string; status: string }>;
    expect(voided).toHaveLength(1);
    expect(voided[0]?.status).toBe('VOID');
  });

  it('preserves stake precision by storing it as text, not a float', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    await runIngest(adapter, opened.db, { ingestedAt: INGESTED_AT });
    const rows = opened.sqlite.prepare('SELECT stake FROM trades').all() as Array<{
      stake: string;
    }>;
    for (const row of rows) {
      expect(typeof row.stake).toBe('string');
      expect(row.stake).toMatch(/^\d+$/);
    }
  });

  it('honours the stream window it is given', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const markets = await adapter.listMarkets();
    const firstWindowEnd = Math.min(...markets.map((market) => market.windowEnd));
    const summary = await runIngest(adapter, opened.db, {
      ingestedAt: INGESTED_AT,
      window: { until: firstWindowEnd },
    });
    expect(summary.tradesSeen).toBeGreaterThan(0);
    expect(summary.tradesSeen).toBeLessThan(await countIn('trades.json'));
  });
});

describe('runIngest on data that does not fit', () => {
  const orphanAdapter = {
    listMarkets: () => Promise.resolve([]),
    async *streamTrades(): AsyncIterable<CanonicalTrade> {
      yield {
        tradeId: 'SYN-ORPHAN',
        marketId: 'NOT-A-MARKET',
        wallet: '0x0000000000000000000000000000000000000001',
        side: 'UP' as const,
        impliedProbUp: 0.5,
        quoteSource: 'MID' as const,
        stake: 1_000_000n,
        stakeDecimals: 6,
        timestamp: 1,
        txHash: null,
      };
    },
    async *streamSettlements(): AsyncIterable<CanonicalSettlement> {
      yield {
        marketId: 'NOT-A-MARKET',
        outcome: 'UP' as const,
        settlementLevel: null,
        settledAt: 2,
        txHash: null,
      };
    },
    getQuote: () => Promise.reject(new Error('not used')),
    placeOrder: () => Promise.reject(new Error('not used')),
  };

  it('skips an orphan rather than inventing the market it refers to', async () => {
    const summary = await runIngest(orphanAdapter, opened.db, { ingestedAt: INGESTED_AT });
    expect(summary.tradesOrphaned).toBe(1);
    expect(summary.tradesInserted).toBe(0);
    expect(summary.settlementsOrphaned).toBe(1);
    expect(countRows(opened.db, 'markets')).toBe(0);
  });
});
