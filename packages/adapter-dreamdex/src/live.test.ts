import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MalformedPayloadError, UnsupportedOperationError } from './adapter.js';
import type { CanonicalTrade } from './canonical.js';
import { LiveAdapter, toCanonicalSide, type FetchLike } from './live.js';

/**
 * DREAMDEX_ADAPTER.md §5 Step 5: LiveAdapter is tested against the payloads captured from
 * the venue, with no network. Real bytes, no socket — which is what lets invariant I3 hold
 * while the live path is under test.
 */

const CAPTURED = join(process.cwd(), 'fixtures', 'recorded', 'dreamdex-testnet-2026-09-01');

/** Answers from the captured files, dispatching on which table the query names. */
const replayFetch = async (): Promise<FetchLike> => {
  const [markets, fills, orders] = await Promise.all([
    readFile(join(CAPTURED, 'market.json'), 'utf8'),
    readFile(join(CAPTURED, 'fills.json'), 'utf8'),
    readFile(join(CAPTURED, 'orders.json'), 'utf8'),
  ]);
  return (_url, init) => {
    const query = String(JSON.parse(String(init.body)).query);
    const body = query.includes('Market(') ? markets : query.includes('Fill(') ? fills : orders;
    return Promise.resolve(new Response(body, { status: 200 }));
  };
};

const adapter = async (): Promise<LiveAdapter> =>
  new LiveAdapter({ indexerUrl: 'https://example.invalid/graphql', fetch: await replayFetch() });

const drain = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const rows: T[] = [];
  for await (const row of stream) rows.push(row);
  return rows;
};

describe('side normalisation (DREAMDEX_ADAPTER 4.1)', () => {
  it('maps the four venue sides into the UP frame, and only here', () => {
    expect(toCanonicalSide('BUY_YES')).toBe('UP');
    expect(toCanonicalSide('SELL_NO')).toBe('UP');
    expect(toCanonicalSide('SELL_YES')).toBe('DOWN');
    expect(toCanonicalSide('BUY_NO')).toBe('DOWN');
  });
});

describe('LiveAdapter over the captured testnet payloads', () => {
  it('maps the market, converting seconds to milliseconds', async () => {
    const [market] = await (await adapter()).listMarkets();
    expect(market?.marketId).toBe(
      '0x000000000000000000000000000000000000000000000000000000000000ff46',
    );
    expect(market?.underlying).toBe('BTC');
    expect(market?.windowStart).toBe(1788251400 * 1000);
    expect(market?.windowEnd).toBe(1788252300 * 1000);
    expect(market?.status).toBe('SETTLED');
  });

  it('reads a strike of "0" as no strike, because the line is the opening price', async () => {
    const [market] = await (await adapter()).listMarkets();
    expect(market?.strike).toBeNull();
  });

  it('emits both legs of every fill, because both counterparties took a view', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    expect(trades).toHaveLength(6);
    expect(trades.map((trade) => trade.tradeId)).toContain('476784269_137:taker');
    expect(trades.map((trade) => trade.tradeId)).toContain('476784269_137:maker');
    expect(new Set(trades.map((trade) => trade.tradeId)).size).toBe(6);
  });

  it('prices every trade at the reconstructed mid, not at the fill price', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    const mids = [...new Set(trades.map((trade) => trade.impliedProbUp))].sort((a, b) => a - b);
    expect(mids).toHaveLength(3);
    for (const [i, expected] of [0.5935, 0.5995, 0.703].entries()) {
      expect(mids[i] as number).toBeCloseTo(expected, 9);
    }
    expect(trades.every((trade) => trade.quoteSource === 'MID')).toBe(true);
  });

  it('records a mid strictly below the fill price, which is the error section 2 prevents', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    // Every captured taker was buying; each paid above the mid they faced.
    const first = trades.find((trade) => trade.tradeId === '476784269_137:taker');
    expect(first?.side).toBe('UP');
    expect(first?.impliedProbUp).toBeCloseTo(0.5995, 9);
    expect(first?.impliedProbUp).toBeLessThan(0.614);
  });

  it('splits the stake so a DOWN position risks the complement, not the premium', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    const taker = trades.find((trade) => trade.tradeId === '476784269_137:taker');
    const maker = trades.find((trade) => trade.tradeId === '476784269_137:maker');
    expect(taker?.side).toBe('UP');
    expect(maker?.side).toBe('DOWN');
    // quantity 46511000, quoteQuantity 28557754.
    expect(taker?.stake).toBe(28_557_754n);
    expect(maker?.stake).toBe(46_511_000n - 28_557_754n);
    expect((taker?.stake as bigint) + (maker?.stake as bigint)).toBe(46_511_000n);
  });

  it('carries the venue scale rather than normalising it away', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    expect(trades.every((trade) => trade.stakeDecimals === 6)).toBe(true);
  });

  it('lowercases addresses so one trader cannot become two wallets', async () => {
    const trades = await drain((await adapter()).streamTrades({}));
    expect(trades.every((trade) => /^0x[0-9a-f]{40}$/.test(trade.wallet))).toBe(true);
  });

  it('honours the stream window', async () => {
    const all = await drain((await adapter()).streamTrades({}));
    const boundary = (all[2] as CanonicalTrade).timestamp;
    const after = await drain((await adapter()).streamTrades({ since: boundary }));
    expect(after.length).toBeLessThan(all.length);
    expect(after.every((trade) => trade.timestamp >= boundary)).toBe(true);
  });

  it('maps the settlement from the winning outcome', async () => {
    const [settlement] = await drain((await adapter()).streamSettlements({}));
    expect(settlement?.outcome).toBe('UP');
    expect(settlement?.settledAt).toBe(1788252302 * 1000);
  });

  it('reports a book and a last price, and never invents a mid it could not build', async () => {
    const quote = await (
      await adapter()
    ).getQuote('0x000000000000000000000000000000000000000000000000000000000000ff46', 1788252300000);
    expect(quote.bestBidUp as number).toBeCloseTo(0.681, 9);
    expect(quote.bestAskUp as number).toBeCloseTo(0.725, 9);
    expect(quote.midUp as number).toBeCloseTo(0.703, 9);
    expect(quote.lastUp as number).toBeCloseTo(0.709, 9);
  });

  it('refuses to write, because it has no signer', async () => {
    const live = await adapter();
    expect(() =>
      live.placeOrder({
        marketId: 'm',
        side: 'UP',
        stake: 1n,
        limitProb: null,
        clientOrderId: 'x',
      }),
    ).toThrow(UnsupportedOperationError);
  });
});

describe('LiveAdapter on a venue that misbehaves', () => {
  const withFetch = (fetchLike: FetchLike): LiveAdapter =>
    new LiveAdapter({ indexerUrl: 'https://example.invalid/graphql', fetch: fetchLike });

  it('rejects an HTTP error rather than reporting an empty market list', async () => {
    const live = withFetch(() => Promise.resolve(new Response('nope', { status: 502 })));
    await expect(live.listMarkets()).rejects.toThrow(MalformedPayloadError);
  });

  it('surfaces a GraphQL error instead of treating it as no rows', async () => {
    const live = withFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'bad enum' }] }))),
    );
    await expect(live.listMarkets()).rejects.toThrow(/bad enum/);
  });

  it('rejects a row that does not match the captured shape, never coercing it', async () => {
    const live = withFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { Market: [{ marketId: '0x01', marketType: 'SPOT' }] } }),
        ),
      ),
    );
    await expect(live.listMarkets()).rejects.toThrow(MalformedPayloadError);
  });
});
