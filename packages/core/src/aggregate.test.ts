import { describe, expect, it } from 'vitest';

import { aggregatePositions, positionId, type AggregatableTrade } from './aggregate.js';
import { MIN_STAKE_BASE, PROB_MIN } from './constants.js';

const trade = (over: Partial<AggregatableTrade> = {}): AggregatableTrade => ({
  tradeId: 'T1',
  wallet: '0x0000000000000000000000000000000000000001',
  marketId: 'M1',
  side: 'UP',
  impliedProbUp: 0.6,
  quoteSource: 'MID',
  stake: 10_000_000n,
  timestamp: 1000,
  ...over,
});

const settled = [{ marketId: 'M1', outcome: 'UP' as const, settledAt: 5000 }];

describe('positionId (API_SPEC 1.1)', () => {
  it('is derived, stable and lowercase hex', () => {
    const id = positionId('0xABCdef0000000000000000000000000000000001', 'M1');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(positionId('0xabcdef0000000000000000000000000000000001', 'M1'));
  });

  it('separates wallet from market so the parts cannot be confused', () => {
    expect(positionId('0xab', 'cd')).not.toBe(positionId('0xabc', 'd'));
  });
});

describe('aggregatePositions — stake weighting (SCORING_SPEC 4.1)', () => {
  it('pulls the price toward the size a trader was willing to transact at', () => {
    const [position] = aggregatePositions(
      [
        trade({ tradeId: 'T1', impliedProbUp: 0.5, stake: 10_000_000n }),
        trade({ tradeId: 'T2', impliedProbUp: 0.8, stake: 30_000_000n }),
      ],
      settled,
    );
    // (0.5*10 + 0.8*30) / 40 = 0.725, not the unweighted 0.65.
    expect(position?.p).toBeCloseTo(0.725, 12);
    expect(position?.netStake).toBe(40_000_000n);
  });

  it('takes the earliest timestamp as the entry', () => {
    const [position] = aggregatePositions(
      [trade({ tradeId: 'T1', timestamp: 900 }), trade({ tradeId: 'T2', timestamp: 400 })],
      settled,
    );
    expect(position?.enteredAt).toBe(400);
  });

  it('clamps the price but keeps the raw value for audit', () => {
    const [position] = aggregatePositions([trade({ impliedProbUp: 0 })], settled);
    expect(position?.p).toBe(PROB_MIN);
    expect(position?.rawP).toBe(0);
  });

  it('degrades quoteSource to LAST if any contributing trade did', () => {
    const [position] = aggregatePositions(
      [trade({ tradeId: 'T1' }), trade({ tradeId: 'T2', quoteSource: 'LAST' })],
      settled,
    );
    expect(position?.quoteSource).toBe('LAST');
  });
});

describe('aggregatePositions — netting (SCORING_SPEC 4.3)', () => {
  it('keeps the larger side and subtracts the smaller', () => {
    const [position] = aggregatePositions(
      [
        trade({ tradeId: 'T1', side: 'UP', stake: 30_000_000n, impliedProbUp: 0.6 }),
        trade({ tradeId: 'T2', side: 'DOWN', stake: 10_000_000n, impliedProbUp: 0.4 }),
      ],
      settled,
    );
    expect(position?.side).toBe('UP');
    expect(position?.netStake).toBe(20_000_000n);
  });

  it('keeps the surviving side own weighted price, never a blend of the two', () => {
    const [position] = aggregatePositions(
      [
        trade({ tradeId: 'T1', side: 'DOWN', stake: 30_000_000n, impliedProbUp: 0.4 }),
        trade({ tradeId: 'T2', side: 'UP', stake: 10_000_000n, impliedProbUp: 0.9 }),
      ],
      settled,
    );
    expect(position?.side).toBe('DOWN');
    expect(position?.p).toBeCloseTo(0.4, 12);
  });

  it('excludes an exact wash: no directional view was expressed', () => {
    const [position] = aggregatePositions(
      [
        trade({ tradeId: 'T1', side: 'UP', stake: 50_000_000n }),
        trade({ tradeId: 'T2', side: 'DOWN', stake: 50_000_000n }),
      ],
      settled,
    );
    expect(position?.excludedReason).toBe('NO_DIRECTIONAL_VIEW');
    expect(position?.netStake).toBe(0n);
    expect(position?.outcomeY).toBeNull();
  });

  it('drags a partial wash below the minimum, which is the point of the design', () => {
    const [position] = aggregatePositions(
      [
        trade({ tradeId: 'T1', side: 'UP', stake: 50_000_000n }),
        trade({ tradeId: 'T2', side: 'DOWN', stake: 49_500_000n }),
      ],
      settled,
    );
    expect(position?.netStake).toBe(500_000n);
    expect(position?.excludedReason).toBe('BELOW_MIN_STAKE');
  });
});

describe('aggregatePositions — exclusions (SCORING_SPEC 4.4)', () => {
  it('excludes a position below the minimum stake', () => {
    const [position] = aggregatePositions([trade({ stake: MIN_STAKE_BASE - 1n })], settled);
    expect(position?.excludedReason).toBe('BELOW_MIN_STAKE');
  });

  it('scores a position exactly at the minimum', () => {
    const [position] = aggregatePositions([trade({ stake: MIN_STAKE_BASE })], settled);
    expect(position?.excludedReason).toBeNull();
  });

  it('excludes an unsettled market and one we have never heard of', () => {
    const unsettled = aggregatePositions(
      [trade()],
      [{ marketId: 'M1', outcome: null, settledAt: null }],
    );
    expect(unsettled[0]?.excludedReason).toBe('MARKET_UNSETTLED');
    expect(aggregatePositions([trade()], [])[0]?.excludedReason).toBe('MARKET_UNSETTLED');
  });

  it('excludes every position in a VOID market', () => {
    const positions = aggregatePositions(
      [
        trade({ tradeId: 'T1', wallet: '0x0000000000000000000000000000000000000001' }),
        trade({ tradeId: 'T2', wallet: '0x0000000000000000000000000000000000000002' }),
      ],
      [{ marketId: 'M1', outcome: 'VOID', settledAt: 5000 }],
    );
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => p.excludedReason === 'MARKET_VOID')).toBe(true);
    expect(positions.every((p) => p.outcomeY === null)).toBe(true);
  });

  it('keeps excluded positions rather than dropping them, so the count is auditable', () => {
    const positions = aggregatePositions([trade({ stake: 1n })], settled);
    expect(positions).toHaveLength(1);
  });
});

describe('aggregatePositions — outcome and determinism', () => {
  it('expresses the outcome relative to UP for both sides', () => {
    const up = aggregatePositions([trade({ side: 'UP' })], settled);
    const down = aggregatePositions([trade({ side: 'DOWN' })], settled);
    expect(up[0]?.outcomeY).toBe(1);
    expect(down[0]?.outcomeY).toBe(1);
  });

  it('produces the same output whatever order the trades arrive in', () => {
    const trades = [
      trade({ tradeId: 'T1', impliedProbUp: 0.5, stake: 7_000_003n, timestamp: 10 }),
      trade({ tradeId: 'T2', impliedProbUp: 0.7, stake: 3_000_001n, timestamp: 20 }),
      trade({ tradeId: 'T3', impliedProbUp: 0.3, stake: 11_000_007n, timestamp: 30 }),
    ];
    const forwards = aggregatePositions(trades, settled);
    const backwards = aggregatePositions([...trades].reverse(), settled);
    expect(backwards).toEqual(forwards);
    expect(forwards[0]?.p).toBe(backwards[0]?.p);
  });
});
