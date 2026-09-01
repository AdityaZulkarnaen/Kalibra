import type { DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import { runPipeline } from '@kalibra/indexer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acceptingAdapter,
  guardFor,
  guardTradeCount,
  orderFor,
  setUpHarness,
  settle,
  AGENT,
  AGENT_WALLET,
  type Harness,
} from './harness.js';

/**
 * `BUILD_PLAN.md` day 6, last criterion: a Guard fill appears in `trades` and flows into
 * scoring. `RISK_POLICY_SPEC.md` §8 is why it matters — there is no separate scoring path
 * for agents, so an agent's record is comparable to a human's by construction rather than
 * by assertion.
 */

const COMPUTED_AT = 1_787_620_000_000;

let h: Harness;
let accepting: DreamDexAdapter;

beforeEach(async () => {
  h = await setUpHarness();
  accepting = acceptingAdapter(h.replay);
});

afterEach(() => h.opened.sqlite.close());

const tradeRow = (): Record<string, unknown> =>
  h.opened.sqlite.prepare('SELECT * FROM trades WHERE source = ?').get('GUARD') as Record<
    string,
    unknown
  >;

describe('a Guard fill joins the same pipeline as an ingested trade', () => {
  it('writes the fill to trades with source GUARD', async () => {
    const result = await guardFor(h, accepting).submit(AGENT, orderFor(h), h.now);
    expect(result.forwarded).toBe(true);
    expect(result.recorded).toBe(true);

    const row = tradeRow();
    expect(row['wallet']).toBe(AGENT_WALLET);
    expect(row['side']).toBe('UP');
    expect(row['stake']).toBe('10000000');
    expect(row['trade_id']).toBe(`guard:${AGENT}:coid-1`);
  });

  it('prices the fill from the market, never from the agent’s own limit', async () => {
    await guardFor(h, accepting).submit(AGENT, orderFor(h, { limitProb: 0.99 }), h.now);

    const row = tradeRow();
    const quote = await h.replay.getQuote(h.marketId, h.now);
    expect(row['implied_prob_up']).toBe(quote.midUp ?? quote.lastUp);
    expect(row['implied_prob_up']).not.toBe(0.99);
    expect(['MID', 'LAST']).toContain(row['quote_source']);
  });

  it('scores the agent through the one scoring path, with no separate branch', async () => {
    await guardFor(h, accepting).submit(AGENT, orderFor(h), h.now);
    settle(h.opened, h.marketId, 'UP', h.now + 1);
    runPipeline(h.opened.db, { computedAt: COMPUTED_AT });

    const position = h.opened.sqlite
      .prepare('SELECT * FROM positions WHERE wallet = ?')
      .get(AGENT_WALLET) as Record<string, unknown> | undefined;
    expect(position).toBeDefined();
    expect(position?.['excluded_reason']).toBeNull();

    const score = h.opened.sqlite
      .prepare('SELECT n, status, score FROM scores WHERE wallet = ?')
      .get(AGENT_WALLET) as { n: number; status: string; score: number | null };
    expect(score.n).toBe(1);
    // One position is one position, agent or not: far below MIN_SAMPLE, so no number.
    expect(score.status).toBe('PROVISIONAL');
    expect(score.score).toBeNull();
  });

  it('refuses to score a fill it has no market price for', async () => {
    const noQuote: DreamDexAdapter = {
      ...accepting,
      getQuote: (marketId, at) =>
        Promise.resolve({
          marketId,
          bestBidUp: null,
          bestAskUp: null,
          midUp: null,
          lastUp: null,
          timestamp: at,
        }),
    };
    const result = await guardFor(h, noQuote).submit(AGENT, orderFor(h), h.now);
    expect(result.forwarded).toBe(true);
    expect(result.recorded).toBe(false);
    expect(result.note).toMatch(/no market quote/);
    expect(guardTradeCount(h.opened)).toBe(0);
  });

  it('does not record a fill for an agent with no wallet registered', async () => {
    const guard = guardFor(h, accepting, undefined, new Map());
    const result = await guard.submit(AGENT, orderFor(h), h.now);
    expect(result.forwarded).toBe(true);
    expect(result.recorded).toBe(false);
    expect(guardTradeCount(h.opened)).toBe(0);
  });

  it('does not record a fill the venue refused', async () => {
    const refusing: DreamDexAdapter = {
      ...accepting,
      placeOrder: () =>
        Promise.resolve({
          accepted: false,
          venueOrderId: null,
          txHash: null,
          rejectReason: 'insufficient collateral',
        }),
    };
    const result = await guardFor(h, refusing).submit(AGENT, orderFor(h), h.now);
    // Guard allowed it; the venue did not. That is the venue's decision, and the ALLOW
    // already in the log is the truthful record of what Guard did.
    expect(result.decision.verdict).toBe('ALLOW');
    expect(result.forwarded).toBe(false);
    expect(result.note).toBe('insufficient collateral');
    expect(guardTradeCount(h.opened)).toBe(0);
  });
});
