import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { realisedPnl, sumPnl, unrealisedPnl, type GuardPosition } from './pnl.js';

const position = (patch: Partial<GuardPosition> = {}): GuardPosition => ({
  marketId: 'm1',
  side: 'UP',
  stake: 10_000_000n,
  impliedProbUp: 0.5,
  ...patch,
});

describe('realisedPnl', () => {
  it('doubles the stake at even odds when the side wins', () => {
    // 10 risked at 0.5 buys 20 of contract; profit is the other 10.
    expect(realisedPnl(position(), 1)).toBe(10_000_000n);
  });

  it('loses exactly the stake when the side loses', () => {
    expect(realisedPnl(position(), 0)).toBe(-10_000_000n);
  });

  it('pays less for a favourite than for a longshot', () => {
    const favourite = realisedPnl(position({ impliedProbUp: 0.8 }), 1);
    const longshot = realisedPnl(position({ impliedProbUp: 0.2 }), 1);
    expect(favourite).toBe(2_500_000n); // 10 x 0.2 / 0.8
    expect(longshot).toBe(40_000_000n); // 10 x 0.8 / 0.2
    expect(longshot).toBeGreaterThan(favourite);
  });

  it('prices the DOWN side at the complement', () => {
    // DOWN at an implied P(UP) of 0.8 costs 0.2, so a win pays four times the stake.
    expect(realisedPnl(position({ side: 'DOWN', impliedProbUp: 0.8 }), 0)).toBe(40_000_000n);
    expect(realisedPnl(position({ side: 'DOWN', impliedProbUp: 0.8 }), 1)).toBe(-10_000_000n);
  });

  it('nets a void market to zero rather than to a loss', () => {
    // Nothing was decided, so nothing is owed either way.
    expect(realisedPnl(position(), 'VOID')).toBe(0n);
  });

  it('floors a gain rather than rounding it up', () => {
    // 3 x 0.6 / 0.4 is 4.5; the agent is credited 4, never 5.
    expect(realisedPnl({ ...position(), stake: 3n, impliedProbUp: 0.4 }, 1)).toBe(4n);
  });

  it('refuses a degenerate price instead of dividing by zero', () => {
    expect(() => realisedPnl(position({ impliedProbUp: 0 }), 1)).toThrow(InvalidInputError);
    expect(() => realisedPnl(position({ impliedProbUp: 1 }), 1)).toThrow(InvalidInputError);
    expect(() => realisedPnl(position({ impliedProbUp: Number.NaN }), 1)).toThrow(
      InvalidInputError,
    );
  });
});

describe('unrealisedPnl', () => {
  it('is exactly zero when marked at the entry price', () => {
    // What a caller with no fresh quote must get: no invented gain, no invented loss.
    expect(unrealisedPnl(position({ impliedProbUp: 0.42 }), 0.42)).toBe(0n);
  });

  it('gains when the market moves the position’s way', () => {
    expect(unrealisedPnl(position(), 0.6)).toBe(2_000_000n);
  });

  it('loses when the market moves against it', () => {
    expect(unrealisedPnl(position(), 0.4)).toBe(-2_000_000n);
  });

  it('reads the mark from the DOWN side’s own price', () => {
    // Bought DOWN at 0.5; P(UP) falling to 0.4 makes DOWN worth 0.6.
    expect(unrealisedPnl(position({ side: 'DOWN' }), 0.4)).toBe(2_000_000n);
  });

  it('cannot lose more than the stake', () => {
    expect(unrealisedPnl(position(), 0.0001)).toBeGreaterThanOrEqual(-10_000_000n);
  });
});

describe('sumPnl', () => {
  it('adds a mixed book without leaving bigint', () => {
    expect(sumPnl([10n, -4n, -6n])).toBe(0n);
    expect(sumPnl([])).toBe(0n);
  });
});
