import { describe, expect, it } from 'vitest';

import { num, scoreDisplay, shortAddress } from './format';

describe('scoreDisplay', () => {
  it('shows the number for a ranked wallet', () => {
    expect(scoreDisplay({ score: 678, status: 'RANKED', n: 47 }, 30)).toEqual({
      kind: 'score',
      value: 678,
    });
  });

  it('shows status and sample size for a provisional wallet, never a number', () => {
    expect(scoreDisplay({ score: null, status: 'PROVISIONAL', n: 12 }, 30)).toEqual({
      kind: 'provisional',
      n: 12,
      minSample: 30,
    });
  });

  it('withholds the number even if the API ever sends one for a provisional wallet', () => {
    // Defence in depth. The pipeline nulls the score below MIN_SAMPLE; if that ever
    // changes, a small-sample number still does not reach a reader.
    const display = scoreDisplay({ score: 812, status: 'PROVISIONAL', n: 4 }, 30);
    expect(display.kind).toBe('provisional');
    expect(JSON.stringify(display)).not.toContain('812');
  });
});

describe('num', () => {
  it('renders a null statistic as a dash rather than a zero', () => {
    expect(num(null)).toBe('—');
    expect(num(undefined)).toBe('—');
    expect(num(0)).toBe('0.0000');
  });

  it('keeps four decimals by default, because that is the precision the API reports', () => {
    expect(num(0.21041234)).toBe('0.2104');
    expect(num(0.641, 3)).toBe('0.641');
  });
});

describe('shortAddress', () => {
  it('keeps enough of both ends to be recognisable', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });
});
