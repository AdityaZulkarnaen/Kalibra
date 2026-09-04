import { describe, expect, it } from 'vitest';

import { STRATEGIES, contrarianFade, midAnchored, momentumLean } from './strategy.js';
import type { MarketView } from './strategy.js';

/**
 * What the three agents actually claim.
 *
 * These are pure — a view in, an intent or nothing out — so they are asserted against fixed
 * numbers rather than driven through a venue. The properties that matter are the ones a
 * reader of the leaderboard would assume from each `method` string, because Arena publishes
 * those strings verbatim and they have to stay true of the code.
 */

const view = (over: Partial<MarketView> = {}): MarketView => ({
  marketId: '0xmarket',
  underlying: 'BTC',
  windowStart: 1_000_000,
  windowEnd: 1_900_000,
  bestBidUp: 0.58,
  bestAskUp: 0.62,
  midUp: 0.6,
  probDriftSinceOpen: 0,
  now: 1_450_000,
  ...over,
});

describe('every strategy', () => {
  it('declines rather than guessing when the book has no price at all', () => {
    const blind = view({ bestBidUp: null, bestAskUp: null, midUp: null });
    for (const strategy of STRATEGIES) {
      expect(strategy.decide(blind)).toBeNull();
    }
  });

  it('keeps its forecast inside the range the scoring spec clamps to', () => {
    // Extremes are where a forecast escapes [0.01, 0.99] if nothing holds it.
    for (const midUp of [0.01, 0.02, 0.5, 0.98, 0.99]) {
      for (const drift of [-0.9, 0, 0.9]) {
        for (const strategy of STRATEGIES) {
          const intent = strategy.decide(
            view({ midUp, bestBidUp: midUp, bestAskUp: midUp, probDriftSinceOpen: drift }),
          );
          if (intent === null) continue;
          expect(intent.forecast).toBeGreaterThanOrEqual(0.01);
          expect(intent.forecast).toBeLessThanOrEqual(0.99);
        }
      }
    }
  });

  it('publishes a method describing the forecast, which Arena shows verbatim', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.method.length).toBeGreaterThan(80);
      expect(strategy.agentId).toMatch(/^[a-z-]+$/);
    }
  });

  it('takes a side consistent with where its forecast sits against the market', () => {
    for (const strategy of STRATEGIES) {
      for (const midUp of [0.2, 0.5, 0.8]) {
        const intent = strategy.decide(view({ midUp, bestBidUp: midUp, bestAskUp: midUp }));
        if (intent === null) continue;
        // Believing UP is worth more than the market is what buying UP means.
        expect(intent.side).toBe(intent.forecast >= midUp ? 'UP' : 'DOWN');
      }
    }
  });
});

describe('mid-anchored', () => {
  it('states a forecast within two points of the market', () => {
    const intent = midAnchored.decide(view());
    expect(intent).not.toBeNull();
    expect(Math.abs((intent?.forecast ?? 0) - 0.6)).toBeCloseTo(0.02, 6);
  });

  /**
   * The claim its `method` string makes, pinned. It reads best bid and ask *prices* and never
   * sizes, so it cannot lean toward thin liquidity however it is described — the old test
   * `bestBidUp < 1 - bestAskUp` is `mid < 0.5` rearranged. The live data agreed before this
   * was written: all 25 of its DOWN positions sat at `p > 0.5`, none anywhere else.
   */
  it('leans toward even odds, not toward book depth', () => {
    for (const mid of [0.1, 0.3, 0.45]) {
      expect(midAnchored.decide(view({ midUp: mid, bestBidUp: mid, bestAskUp: mid }))?.side).toBe(
        'UP',
      );
    }
    for (const mid of [0.55, 0.7, 0.9]) {
      expect(midAnchored.decide(view({ midUp: mid, bestBidUp: mid, bestAskUp: mid }))?.side).toBe(
        'DOWN',
      );
    }
  });

  /** A lopsided book does not move it, which is the same claim seen from the other side. */
  it('ignores how far apart the two sides of the book are', () => {
    const wide = midAnchored.decide(view({ midUp: 0.7, bestBidUp: 0.4, bestAskUp: 1.0 }));
    const tight = midAnchored.decide(view({ midUp: 0.7, bestBidUp: 0.69, bestAskUp: 0.71 }));
    expect(wide?.side).toBe(tight?.side);
    expect(wide?.stake).toBe(tight?.stake);
  });

  it('rests rather than takes, so it pays no spread it does not have to', () => {
    expect(midAnchored.decide(view())?.postOnly).toBe(true);
  });
});

describe('momentum-lean', () => {
  it('says nothing when the price has not moved since the window opened', () => {
    expect(momentumLean.decide(view({ probDriftSinceOpen: 0 }))).toBeNull();
  });

  it('carries a rise forward, and a fall the other way', () => {
    const up = momentumLean.decide(view({ probDriftSinceOpen: 0.3 }));
    const down = momentumLean.decide(view({ probDriftSinceOpen: -0.3 }));
    expect(up?.side).toBe('UP');
    expect(down?.side).toBe('DOWN');
  });

  it('weights the same move more heavily the later in the window it happens', () => {
    // Large enough that both ends of the window produce a view at all, so the two are
    // actually comparable.
    const early = momentumLean.decide(view({ probDriftSinceOpen: 0.9, now: 1_100_000 }));
    const late = momentumLean.decide(view({ probDriftSinceOpen: 0.9, now: 1_850_000 }));
    expect(early).not.toBeNull();
    // Less time left to reverse is the whole claim, so the late forecast must be the bolder.
    expect(late?.forecast ?? 0).toBeGreaterThan(early?.forecast ?? 1);
  });

  it('declines a moderate move early on, having barely any of the window behind it', () => {
    // The same drift that is worth acting on near the close is not worth acting on at the
    // open: the scaling is the strategy, not a detail of it.
    expect(momentumLean.decide(view({ probDriftSinceOpen: 0.4, now: 1_100_000 }))).toBeNull();
    expect(momentumLean.decide(view({ probDriftSinceOpen: 0.4, now: 1_850_000 }))).not.toBeNull();
  });
});

describe('contrarian-fade', () => {
  it('ignores a book that is not extreme', () => {
    expect(
      contrarianFade.decide(view({ midUp: 0.55, bestBidUp: 0.54, bestAskUp: 0.56 })),
    ).toBeNull();
  });

  it('fades toward even odds from either end', () => {
    const high = contrarianFade.decide(view({ midUp: 0.9, bestBidUp: 0.89, bestAskUp: 0.91 }));
    const low = contrarianFade.decide(view({ midUp: 0.1, bestBidUp: 0.09, bestAskUp: 0.11 }));
    expect(high?.forecast ?? 1).toBeLessThan(0.9);
    expect(low?.forecast ?? 0).toBeGreaterThan(0.1);
  });

  /**
   * The refusals in the audit log have to come from an agent trading, not from a script
   * staging them. This is the sizing that produces them, and it is load-bearing for the
   * Guard demo — if it ever stopped exceeding the limit, ORDER_TOO_LARGE would quietly stop
   * appearing and the log would look tidier than the system deserves.
   */
  it('exceeds maxNotionalPerOrder at a genuinely extreme price, on purpose', () => {
    const extreme = contrarianFade.decide(view({ midUp: 0.96, bestBidUp: 0.95, bestAskUp: 0.97 }));
    expect(extreme?.stake ?? 0n).toBeGreaterThan(50_000_000n);
  });

  it('stays inside the limit at a merely unusual price, so it still collects positions', () => {
    const unusual = contrarianFade.decide(view({ midUp: 0.75, bestBidUp: 0.74, bestAskUp: 0.76 }));
    expect(unusual?.stake ?? 0n).toBeLessThanOrEqual(50_000_000n);
  });
});
