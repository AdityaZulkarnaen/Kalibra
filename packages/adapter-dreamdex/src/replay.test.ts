import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MalformedPayloadError, UnsupportedOperationError } from './adapter.js';
import type { CanonicalOrder, CanonicalSettlement, CanonicalTrade } from './canonical.js';
import { ReplayAdapter } from './replay.js';

const FIXTURES = join(process.cwd(), 'fixtures', 'synthetic');

const drain = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const rows: T[] = [];
  for await (const row of stream) rows.push(row);
  return rows;
};

describe('ReplayAdapter over the committed fixtures', () => {
  it('parses every fixture through the canonical schemas', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const markets = await adapter.listMarkets();
    expect(markets).toHaveLength(12);
    expect(await drain(adapter.streamTrades({}))).toHaveLength(681);
    expect(await drain(adapter.streamSettlements({}))).toHaveLength(12);
  });

  it('yields trades in timestamp order, ties broken by trade id', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const trades: CanonicalTrade[] = await drain(adapter.streamTrades({}));
    for (let i = 1; i < trades.length; i += 1) {
      const previous = trades[i - 1] as CanonicalTrade;
      const current = trades[i] as CanonicalTrade;
      const ordered =
        current.timestamp > previous.timestamp ||
        (current.timestamp === previous.timestamp && current.tradeId > previous.tradeId);
      expect(ordered).toBe(true);
    }
  });

  it('yields settlements in settlement order', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const settlements: CanonicalSettlement[] = await drain(adapter.streamSettlements({}));
    const times = settlements.map((settlement) => settlement.settledAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('honours a half-open window, so a resumed stream cannot double-count', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const all = await drain(adapter.streamTrades({}));
    const boundary = all[Math.floor(all.length / 2)]?.timestamp as number;
    const before = await drain(adapter.streamTrades({ until: boundary }));
    const after = await drain(adapter.streamTrades({ since: boundary }));
    expect(before.length + after.length).toBe(all.length);
    expect(before.every((trade) => trade.timestamp < boundary)).toBe(true);
    expect(after.every((trade) => trade.timestamp >= boundary)).toBe(true);
  });

  it('reports a last trade but never invents a mid', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const [market] = await adapter.listMarkets();
    const quote = await adapter.getQuote(market?.marketId as string, market?.windowEnd as number);
    expect(quote.midUp).toBeNull();
    expect(quote.bestBidUp).toBeNull();
    expect(quote.lastUp).not.toBeNull();
  });

  it('refuses to place an order instead of returning a plausible rejection', async () => {
    const adapter = await ReplayAdapter.fromDirectory(FIXTURES);
    const order: CanonicalOrder = {
      marketId: 'BTC-USD-1787616000000',
      side: 'UP',
      stake: 1_000_000n,
      limitProb: 0.6,
      clientOrderId: 'test-1',
    };
    expect(() => adapter.placeOrder(order)).toThrow(UnsupportedOperationError);
  });
});

describe('ReplayAdapter on bad input', () => {
  const writeFixtures = async (contents: Record<string, string>): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'kalibra-replay-'));
    const files = {
      'markets.json': '[]',
      'trades.json': '[]',
      'settlements.json': '[]',
      ...contents,
    };
    for (const [name, body] of Object.entries(files))
      await writeFile(join(dir, name), body, 'utf8');
    return dir;
  };

  it('rejects malformed JSON rather than starting up empty', async () => {
    const dir = await writeFixtures({ 'trades.json': '{ not json' });
    await expect(ReplayAdapter.fromDirectory(dir)).rejects.toThrow(MalformedPayloadError);
  });

  it('rejects a fixture that violates the canonical contract, never coercing it', async () => {
    const dir = await writeFixtures({
      'trades.json': JSON.stringify([
        {
          tradeId: 'SYN-1',
          marketId: 'M',
          wallet: '0xNOTLOWERCASE0000000000000000000000000000',
          side: 'UP',
          impliedProbUp: 0.5,
          quoteSource: 'MID',
          stake: '1000000',
          stakeDecimals: 6,
          timestamp: 1,
          txHash: null,
        },
      ]),
    });
    await expect(ReplayAdapter.fromDirectory(dir)).rejects.toThrow(MalformedPayloadError);
  });
});
