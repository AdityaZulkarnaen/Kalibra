import { describe, expect, it } from 'vitest';

import type { CanonicalOrder } from './canonical.js';
import { expiryNs, quantise, serialise } from './writer.js';

/**
 * The conversion from a canonical order to venue units, which is where a stake becomes a
 * token quantity. It is pure, so it is asserted against fixed numbers rather than mocked.
 *
 * The numbers matter more than they look. If this disagreed with the split
 * `toCanonicalTrades` applies when reading the fill back, a position would change size
 * between being placed and being scored, and nothing would say so.
 */

const DECIMALS = 6;
const ONE = 1_000_000;

/** Shannon's grid: 1e3 raw units is 0.001 in probability and 0.001 contracts. */
const BOOK = { tickSize: 1_000n, lotSize: 1_000n, minQuantity: 1_000n };

const order = (over: Partial<CanonicalOrder> = {}): CanonicalOrder => ({
  marketId: '0xmarket',
  side: 'UP',
  stake: 60n * BigInt(ONE),
  limitProb: 0.6,
  clientOrderId: 'test-1',
  ...over,
});

describe('quantise', () => {
  it('buys UP tokens at the premium, so a stake of s at p buys s/p', () => {
    const sized = quantise(order(), DECIMALS, BOOK);
    // 60 collateral at 0.60 per token is 100 tokens.
    expect(sized?.quantity).toBe(100n * BigInt(ONE));
    expect(sized?.price).toBe(600_000n);
  });

  it('buys DOWN tokens at the complement, so the same stake buys s/(1-p)', () => {
    const sized = quantise(order({ side: 'DOWN' }), DECIMALS, BOOK);
    // 60 collateral at 0.40 per NO token is 150 tokens.
    expect(sized?.quantity).toBe(150n * BigInt(ONE));
    // The price stays in YES terms whichever side is bought: one book, quoted in UP.
    expect(sized?.price).toBe(600_000n);
  });

  it('prices in UP terms for both sides, which is the venue convention and ours', () => {
    const up = quantise(order({ limitProb: 0.25 }), DECIMALS, BOOK);
    const down = quantise(order({ side: 'DOWN', limitProb: 0.25 }), DECIMALS, BOOK);
    expect(up?.price).toBe(down?.price);
  });

  it('snaps a price down onto the tick grid rather than sending it a few units off', () => {
    // 0.6127 is not on a 0.001 grid; the pool rejects anything that is not.
    expect(quantise(order({ limitProb: 0.6127 }), DECIMALS, BOOK)?.price).toBe(612_000n);
  });

  it('holds the price one tick inside (0, 1), where the pool accepts it', () => {
    expect(quantise(order({ limitProb: 1 }), DECIMALS, BOOK)?.price).toBe(999_000n);
    expect(quantise(order({ limitProb: 0, side: 'DOWN' }), DECIMALS, BOOK)?.price).toBe(1_000n);
  });

  it('treats a market order as a cross at the extreme of its own side', () => {
    // No limit means "take whatever is there": the extreme in UP terms is 1 for a buyer of
    // UP and 0 for a buyer of DOWN, because a DOWN price is the complement.
    expect(quantise(order({ limitProb: null }), DECIMALS, BOOK)?.price).toBe(999_000n);
    expect(quantise(order({ limitProb: null, side: 'DOWN' }), DECIMALS, BOOK)?.price).toBe(1_000n);
  });

  it('floors the quantity to the lot grid instead of sending a size the pool rounds away', () => {
    const sized = quantise(order({ stake: 1_500_500n, limitProb: 0.5 }), DECIMALS, BOOK);
    // 1.5005 collateral at 0.5 is 3.001 tokens, which floors to 3.001 -> 3001000 raw,
    // snapped down to the lot grid.
    expect(sized?.quantity).toBe(3_001_000n);
  });

  it('refuses an order that rounds below one lot rather than sending one for nothing', () => {
    // Gotcha 6: the pool accepts a zero-quantity order and nothing reverts to say so.
    expect(quantise(order({ stake: 100n, limitProb: 0.5 }), DECIMALS, BOOK)).toBeNull();
  });

  it('refuses an order below the venue minimum', () => {
    const strict = { ...BOOK, minQuantity: 10n * BigInt(ONE) };
    expect(
      quantise(order({ stake: 1n * BigInt(ONE), limitProb: 0.5 }), DECIMALS, strict),
    ).toBeNull();
  });

  it('refuses a side whose price is zero, which would divide by nothing', () => {
    expect(quantise(order({ side: 'UP', limitProb: 0 }), DECIMALS, BOOK)).toBeNull();
    expect(quantise(order({ side: 'DOWN', limitProb: 1 }), DECIMALS, BOOK)).toBeNull();
  });
});

/**
 * `SCORING_SPEC.md` has nothing to say here; the pool does. An expiry past the market's own
 * close is rejected, and the TTL is a wall-clock duration that knows nothing about which
 * market it is for — so on a short window the two disagree and the order dies.
 *
 * Found in production. A market two minutes from close took a 120s TTL and reverted with
 * "placeBinaryOrder reverted: Missing or invalid parameters", which names a parameter and
 * not the reason. These tests exist so the next person reads the reason here instead.
 */
describe('expiryNs', () => {
  const NOW = 1_800_000_000_000;
  const closesAt = (msFromNow: number): bigint => BigInt((NOW + msFromNow) / 1000);

  it('uses the TTL when the window outlasts it', () => {
    const at = expiryNs(120_000, closesAt(600_000), NOW);
    expect(at).toBe(BigInt(NOW + 120_000) * 1_000_000n);
  });

  it('clamps to the market close when the window is shorter than the TTL', () => {
    const at = expiryNs(120_000, closesAt(30_000), NOW);
    // A second inside the close: an expiry exactly on the boundary is the one case where
    // "at or past" and "past" disagree, and the pool decides which.
    expect(at).toBe(BigInt(NOW + 29_000) * 1_000_000n);
  });

  it('never returns an expiry at or before now', () => {
    expect(expiryNs(120_000, closesAt(1_000), NOW)).toBeNull();
    expect(expiryNs(120_000, closesAt(0), NOW)).toBeNull();
    expect(expiryNs(120_000, closesAt(-60_000), NOW)).toBeNull();
  });

  it('is always nanoseconds, never milliseconds', () => {
    const at = expiryNs(60_000, closesAt(600_000), NOW);
    expect(at).not.toBeNull();
    expect((at as bigint) % 1_000_000n).toBe(0n);
    expect(Number(at) / 1e6).toBeGreaterThan(NOW);
  });
});

/**
 * Two transactions from one address in flight together race for the same nonce, and the
 * venue reports the loser as a revert that reads like a malformed order. The demo agents
 * never trip it — a cycle walks its markets in order and the three strategies sign with
 * different keys — so it only appears once a second caller shares a signer, which is what
 * the MCP surface exists to allow.
 */
describe('serialise', () => {
  const holder = (): { queue: Promise<unknown> } => ({ queue: Promise.resolve() });
  const defer = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('never lets two pieces of work overlap', async () => {
    const h = holder();
    const events: string[] = [];
    const work = (name: string, ms: number) => async (): Promise<string> => {
      events.push(`${name}:start`);
      await defer(ms);
      events.push(`${name}:end`);
      return name;
    };

    // The slow one is queued first, so a racing implementation interleaves and this fails.
    const [a, b] = await Promise.all([serialise(h, work('a', 30)), serialise(h, work('b', 1))]);

    expect([a, b]).toEqual(['a', 'b']);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('runs work in the order it was queued', async () => {
    const h = holder();
    const seen: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map((i) =>
        serialise(h, async () => {
          await defer(4 - i);
          seen.push(i);
        }),
      ),
    );
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  /** The next order is a different order and has done nothing wrong. */
  it('keeps going after one piece of work rejects', async () => {
    const h = holder();
    await expect(serialise(h, () => Promise.reject(new Error('venue said no')))).rejects.toThrow(
      'venue said no',
    );
    await expect(serialise(h, () => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('does not retain the result of finished work', async () => {
    const h = holder();
    await serialise(h, () => Promise.resolve({ big: 'payload' }));
    await expect(h.queue).resolves.toBeUndefined();
  });
});
