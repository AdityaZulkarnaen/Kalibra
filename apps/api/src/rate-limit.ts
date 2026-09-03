/**
 * A fixed-window counter for `POST /v1/arena/register`, which `API_SPEC.md` §2 limits to
 * five per hour per IP.
 *
 * In memory and per process. That is honest about what it defends against: casual repeat
 * submission from one address, not a distributed one. Registration confers no score — the
 * number comes from on-chain behaviour — so the limit exists to keep the registry readable,
 * not to secure anything, and a stronger mechanism would be defending nothing.
 *
 * The clock is an argument, so the window can be tested without waiting an hour.
 */
export interface RateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
}

interface Window {
  readonly startedAt: number;
  count: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the window resets. Sent as `Retry-After` when the answer is no. */
  readonly retryAfter: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly options: RateLimitOptions) {}

  /** How many windows are being tracked. Exposed so the eviction below can be asserted. */
  get size(): number {
    return this.windows.size;
  }

  /** Counts the attempt when it is allowed, and only then. A refusal costs no budget. */
  take(key: string, now: number): RateLimitVerdict {
    const current = this.windows.get(key);
    const live = current !== undefined && now - current.startedAt < this.options.windowMs;
    if (!live) {
      this.windows.set(key, { startedAt: now, count: 1 });
      this.evict(now);
      return { allowed: true, retryAfter: 0 };
    }
    if (current.count >= this.options.limit) {
      const elapsed = now - current.startedAt;
      return { allowed: false, retryAfter: Math.ceil((this.options.windowMs - elapsed) / 1000) };
    }
    current.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Drops expired windows whenever a new one opens, so a long-running process does not
   * accumulate one entry per address that ever called. Bounded work: the map only holds
   * addresses seen within the last window plus whatever this pass has not reached yet.
   */
  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.options.windowMs) this.windows.delete(key);
    }
  }
}
