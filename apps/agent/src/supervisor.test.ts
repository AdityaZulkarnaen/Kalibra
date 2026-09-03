import { describe, expect, it, vi } from 'vitest';

import { withTimeout } from './supervisor.js';

/**
 * The watchdog, which is what makes an unattended run survivable.
 *
 * The collection loop stopped for two hours and nineteen minutes on a venue read that never
 * settled and never rejected. There was no error, no exit, and no cycle — just silence, which
 * looks exactly like a quiet market. A crash would have been in the log and would have
 * restarted; a hang is neither, so nothing here may assume a remote call terminates.
 */
describe('withTimeout', () => {
  it('passes a value through when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000, 'work')).resolves.toBe('done');
  });

  it('passes a rejection through unchanged, rather than masking it as a timeout', async () => {
    const failed = Promise.reject(new Error('venue said no'));
    await expect(withTimeout(failed, 1000, 'work')).rejects.toThrow('venue said no');
  });

  it('rejects when the work never settles, naming what stalled', async () => {
    vi.useFakeTimers();
    try {
      // A promise that never settles is the exact shape of the bug: not slow, not broken,
      // simply never answering.
      const forever = new Promise<string>(() => {});
      const guarded = withTimeout(forever, 5000, 'book tops');
      const assertion = expect(guarded).rejects.toThrow('book tops did not answer within 5000ms');
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its timer once the work resolves, so it holds nothing open', async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.resolve(1), 60_000, 'work');
      // A live timer would keep a process alive well past the work it was guarding.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its timer when the work rejects, too', async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.reject(new Error('nope')), 60_000, 'work').catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
