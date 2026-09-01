import { describe, expect, it } from 'vitest';

import {
  canonicalTradeJson,
  canonicalTradeSchema,
  canonicalMarketSchema,
  toJsonValue,
} from './canonical.js';

const trade = {
  tradeId: 'SYN-000001',
  marketId: 'BTC-USD-1787616000000',
  wallet: '0x0000000000000000000000000000000000000001',
  side: 'UP' as const,
  impliedProbUp: 0.61,
  quoteSource: 'MID' as const,
  stake: 25_000_000n,
  stakeDecimals: 6,
  timestamp: 1787616100000,
  txHash: null,
};

describe('canonical schemas (invariant I4)', () => {
  it('accepts a well-formed trade', () => {
    expect(canonicalTradeSchema.parse(trade)).toEqual(trade);
  });

  it('rejects a checksummed address, which would split one trader into two wallets', () => {
    const mixedCase = { ...trade, wallet: '0x00000000000000000000000000000000000000Ab' };
    expect(canonicalTradeSchema.safeParse(mixedCase).success).toBe(false);
  });

  it('rejects a probability outside [0, 1] rather than clamping it', () => {
    expect(canonicalTradeSchema.safeParse({ ...trade, impliedProbUp: 1.4 }).success).toBe(false);
    expect(canonicalTradeSchema.safeParse({ ...trade, impliedProbUp: -0.1 }).success).toBe(false);
  });

  it('rejects a negative stake', () => {
    expect(canonicalTradeSchema.safeParse({ ...trade, stake: -1n }).success).toBe(false);
  });

  it('rejects a market whose window ends before it starts', () => {
    const market = {
      marketId: 'BTC-USD-1',
      underlying: 'BTC-USD',
      windowStart: 2000,
      windowEnd: 1000,
      strike: null,
      strikeDecimals: 0,
      status: 'SETTLED' as const,
    };
    expect(canonicalMarketSchema.safeParse(market).success).toBe(false);
  });

  it('parses a bigint from its decimal string, and never from a number', () => {
    const json = { ...trade, stake: '25000000' };
    expect(canonicalTradeJson.parse(json).stake).toBe(25_000_000n);
    expect(canonicalTradeJson.safeParse({ ...trade, stake: 25_000_000 }).success).toBe(false);
    expect(canonicalTradeJson.safeParse({ ...trade, stake: '25.5' }).success).toBe(false);
  });

  it('round-trips through the JSON form without losing precision', () => {
    const big = { ...trade, stake: 123_456_789_012_345_678_901_234_567_890n };
    const encoded = toJsonValue(big);
    expect(canonicalTradeJson.parse(encoded)).toEqual(big);
  });
});
