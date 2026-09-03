import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rate-limit.js';

/**
 * The clock is an argument, so an hour-long window is tested in microseconds. Nothing here
 * waits, and nothing here depends on `Date.now`.
 */
const HOUR = 60 * 60 * 1000;
const limiter = (): RateLimiter => new RateLimiter({ limit: 5, windowMs: HOUR });

describe('RateLimiter', () => {
  it('allows the limit and refuses the next one', () => {
    const limit = limiter();
    for (let i = 0; i < 5; i += 1) {
      expect(limit.take('1.2.3.4', 1000).allowed).toBe(true);
    }
    expect(limit.take('1.2.3.4', 1000).allowed).toBe(false);
  });

  it('reports how long is left on the window, rounded up to the second', () => {
    const limit = limiter();
    for (let i = 0; i < 5; i += 1) limit.take('1.2.3.4', 0);
    expect(limit.take('1.2.3.4', HOUR - 1500).retryAfter).toBe(2);
  });

  it('counts each key separately', () => {
    const limit = limiter();
    for (let i = 0; i < 5; i += 1) limit.take('1.2.3.4', 0);
    expect(limit.take('5.6.7.8', 0).allowed).toBe(true);
  });

  it('opens a fresh window once the old one has elapsed', () => {
    const limit = limiter();
    for (let i = 0; i < 5; i += 1) limit.take('1.2.3.4', 0);
    expect(limit.take('1.2.3.4', HOUR - 1).allowed).toBe(false);
    expect(limit.take('1.2.3.4', HOUR).allowed).toBe(true);
  });

  /**
   * A refusal that consumed budget would extend the window every time it was hit, so a
   * caller who kept trying could never get back in — the limit would become a ban.
   */
  it('does not spend budget on a request it refused', () => {
    const limit = limiter();
    for (let i = 0; i < 5; i += 1) limit.take('1.2.3.4', 0);
    limit.take('1.2.3.4', HOUR - 1);
    expect(limit.take('1.2.3.4', HOUR).allowed).toBe(true);
  });

  it('forgets keys whose window has passed rather than growing without bound', () => {
    const limit = limiter();
    for (let i = 0; i < 100; i += 1) limit.take(`10.0.0.${i}`, 0);
    expect(limit.size).toBe(100);
    limit.take('192.168.0.1', HOUR * 2);
    expect(limit.size).toBe(1);
  });
});
