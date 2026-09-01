import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MIN_STAKE_BASE } from '@kalibra/core';
import { describe, expect, it } from 'vitest';

import { FIXTURE_DIR, generateFixtures, serialiseFixtures } from './generate-fixtures.js';

const walletAddress = (index: number): string => `0x${(index + 1).toString(16).padStart(40, '0')}`;

const stakeBySide = (
  trades: ReturnType<typeof generateFixtures>['trades'],
  wallet: string,
  side: 'UP' | 'DOWN',
): bigint =>
  trades
    .filter((trade) => trade.wallet === wallet && trade.side === side)
    .reduce((total, trade) => total + trade.stake, 0n);

describe('generateFixtures — determinism', () => {
  it('produces byte-identical output on every run', () => {
    expect(serialiseFixtures(generateFixtures())).toEqual(serialiseFixtures(generateFixtures()));
  });

  it('matches the committed files, so a silent drift cannot go unnoticed', async () => {
    const expected = serialiseFixtures(generateFixtures());
    for (const [name, body] of Object.entries(expected)) {
      const onDisk = await readFile(join(FIXTURE_DIR, name), 'utf8');
      expect(onDisk, `${name} is stale — run pnpm generate-fixtures`).toBe(body);
    }
  });
});

describe('generateFixtures — the shape DREAMDEX_ADAPTER section 9 asks for', () => {
  const { markets, trades, settlements } = generateFixtures();

  it('has sixty markets over three underlyings in sequential windows', () => {
    expect(markets).toHaveLength(60);
    expect(new Set(markets.map((market) => market.underlying)).size).toBe(3);
    const starts = [...new Set(markets.map((market) => market.windowStart))].sort((a, b) => a - b);
    expect(starts).toHaveLength(20);
    for (let i = 1; i < starts.length; i += 1) {
      expect((starts[i] as number) - (starts[i - 1] as number)).toBe(15 * 60 * 1000);
    }
  });

  it('has twenty-five wallets each trading between forty and a hundred and twenty times', () => {
    const perWallet = new Map<string, number>();
    for (const trade of trades) perWallet.set(trade.wallet, (perWallet.get(trade.wallet) ?? 0) + 1);
    expect(perWallet.size).toBe(25);
    // Wash wallets emit a matched pair per iteration, so their row count is doubled.
    const washWallets = new Set([2, 10, 18].map(walletAddress));
    for (const [wallet, count] of perWallet) {
      const iterations = washWallets.has(wallet) ? count / 2 : count;
      expect(iterations).toBeGreaterThanOrEqual(40);
      expect(iterations).toBeLessThanOrEqual(120);
    }
  });

  it('nets three wash-trading wallets to exactly zero', () => {
    for (const index of [2, 10, 18]) {
      const wallet = walletAddress(index);
      const up = stakeBySide(trades, wallet, 'UP');
      expect(up).toBeGreaterThan(0n);
      expect(stakeBySide(trades, wallet, 'DOWN')).toBe(up);
    }
  });

  it('keeps two wallets entirely below the minimum stake', () => {
    for (const index of [7, 15]) {
      const wallet = walletAddress(index);
      const mine = trades.filter((trade) => trade.wallet === wallet);
      expect(mine.length).toBeGreaterThan(0);
      for (const trade of mine) expect(trade.stake).toBeLessThan(MIN_STAKE_BASE);
    }
  });

  it('keeps every other wallet above it, so exclusion is the exception', () => {
    const excluded = new Set([7, 15].map(walletAddress));
    const scoreable = trades.filter((trade) => !excluded.has(trade.wallet));
    expect(scoreable.every((trade) => trade.stake >= MIN_STAKE_BASE)).toBe(true);
  });

  it('gives a typical wallet enough distinct markets to reach MIN_SAMPLE', () => {
    // The reason section 9 was widened: one position per wallet per market means the
    // market count is a hard ceiling on n, and MIN_SAMPLE is 30.
    const excluded = new Set([2, 10, 18, 7, 15].map(walletAddress));
    const distinct = new Map<string, Set<string>>();
    for (const trade of trades) {
      if (excluded.has(trade.wallet)) continue;
      if (!distinct.has(trade.wallet)) distinct.set(trade.wallet, new Set());
      distinct.get(trade.wallet)?.add(trade.marketId);
    }
    for (const [wallet, marketIds] of distinct) {
      expect(marketIds.size, `${wallet} must be able to be RANKED`).toBeGreaterThanOrEqual(30);
    }
  });

  it('settles exactly one market VOID and the rest to a side', () => {
    const voided = settlements.filter((settlement) => settlement.outcome === 'VOID');
    expect(voided).toHaveLength(1);
    expect(settlements).toHaveLength(markets.length);
    const voidedMarket = markets.find((market) => market.marketId === voided[0]?.marketId);
    expect(voidedMarket?.status).toBe('VOID');
  });

  it('fabricates no transaction hashes, because no transaction happened', () => {
    expect(trades.every((trade) => trade.txHash === null)).toBe(true);
    expect(settlements.every((settlement) => settlement.txHash === null)).toBe(true);
  });

  it('settles every market after its window closes', () => {
    const byId = new Map(markets.map((market) => [market.marketId, market]));
    for (const settlement of settlements) {
      const market = byId.get(settlement.marketId);
      expect(market).toBeDefined();
      expect(settlement.settledAt).toBeGreaterThan(market?.windowEnd as number);
    }
  });
});
