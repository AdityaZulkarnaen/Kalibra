import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Guard } from './guard.js';
import {
  acceptingAdapter,
  policyFor,
  setUpHarness,
  settle,
  AGENT,
  AGENT_WALLET,
  type Harness,
} from './harness.js';
import { buildGuardServer } from './server.js';

/**
 * The HTTP surface. It carries no rule logic — that is the point — so what is checked here
 * is the shape of what crosses the wire and, most of all, that the operator routes are not
 * reachable without a token.
 */

const TOKEN = 'operator-token-0123456789';

let h: Harness;

beforeEach(async () => {
  h = await setUpHarness();
});

afterEach(() => h.opened.sqlite.close());

const build = (operatorToken?: string): FastifyInstance => {
  const guard = new Guard({
    db: h.opened.db,
    adapter: acceptingAdapter(h.replay),
    policy: policyFor(h),
    wallets: new Map([[AGENT, AGENT_WALLET]]),
  });
  return buildGuardServer({ guard, clock: () => h.now, operatorToken });
};

const submit = (app: FastifyInstance, patch: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/guard/order',
    payload: {
      agentId: AGENT,
      order: {
        marketId: h.marketId,
        side: 'UP',
        stake: '10000000',
        limitProb: null,
        clientOrderId: 'coid-1',
        ...patch,
      },
    },
  });

describe('POST /guard/order', () => {
  it('returns 200 and the decision when the order is allowed', async () => {
    const app = build();
    const response = await submit(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ decision: { verdict: 'ALLOW' }, forwarded: true });
  });

  it('returns 403 and the reason code when the order is refused', async () => {
    const app = build();
    const response = await submit(app, { marketId: 'not-a-market' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      decision: { verdict: 'DENY', reason: 'MARKET_NOT_ALLOWED' },
    });
  });

  it('takes the stake as a decimal string, so precision survives the wire', async () => {
    const app = build();
    const big = '9007199254740993'; // 2^53 + 1: unrepresentable as a JSON number.
    const response = await submit(app, { stake: big });
    // Too large for the policy, and the refusal quotes the number back intact.
    expect(response.json().decision.detail).toContain(big);
  });

  it('rejects a malformed body with 400 rather than guessing at it', async () => {
    const app = build();
    const response = await app.inject({
      method: 'POST',
      url: '/guard/order',
      payload: { agentId: AGENT, order: { marketId: h.marketId, side: 'SIDEWAYS' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('the audit endpoints', () => {
  it('serves the whole chain as JSON Lines, one entry per line', async () => {
    const app = build();
    await submit(app);
    await submit(app, { clientOrderId: 'coid-2' });

    const response = await app.inject({ method: 'GET', url: '/guard/audit' });
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const lines = response.body.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2]);
  });

  it('serialises bigints as strings, exactly as the hash saw them', async () => {
    const app = build();
    await submit(app);
    const entry = JSON.parse((await app.inject({ method: 'GET', url: '/guard/audit' })).body) as {
      order: { stake: unknown };
      stateSnapshot: { openNotional: unknown };
    };
    expect(entry.order.stake).toBe('10000000');
    expect(entry.stateSnapshot.openNotional).toBe('0');
  });

  it('filters to one agent, and says nothing about the others', async () => {
    const app = build();
    await submit(app);
    const mine = await app.inject({ method: 'GET', url: `/guard/audit/${AGENT}` });
    const other = await app.inject({ method: 'GET', url: '/guard/audit/ag_nobody' });
    expect(mine.body.split('\n')).toHaveLength(1);
    expect(other.body).toBe('');
  });

  it('verifies the chain it just wrote', async () => {
    const app = build();
    await submit(app);
    await submit(app, { clientOrderId: 'coid-2' });
    const response = await app.inject({ method: 'GET', url: '/guard/verify' });
    expect(response.json()).toEqual({ valid: true });
  });
});

describe('GET /guard/risk/:agentId', () => {
  it('reports the headroom left under every limit', async () => {
    const app = build();
    await submit(app);
    const status = (await app.inject({ method: 'GET', url: `/guard/risk/${AGENT}` })).json();
    expect(status.remaining.openNotional).toBe('190000000');
    expect(status.remaining.ordersInWindow).toBe(9);
  });
});

describe('the operator surface is not reachable by an agent', () => {
  it('is not registered at all when no token is configured', async () => {
    const app = build(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/guard/operator/kill-switch',
      payload: { engaged: true },
    });
    // 404, not 401: the route does not exist, so there is nothing to guess at.
    expect(response.statusCode).toBe(404);
  });

  it('refuses a request without the token', async () => {
    const app = build(TOKEN);
    const response = await app.inject({
      method: 'POST',
      url: '/guard/operator/kill-switch',
      payload: { engaged: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lets the operator engage the switch, and the next order sees it', async () => {
    const app = build(TOKEN);
    const engaged = await app.inject({
      method: 'POST',
      url: '/guard/operator/kill-switch',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { engaged: true },
    });
    expect(engaged.statusCode).toBe(200);
    expect(engaged.json().killSwitch).toBe(true);

    const response = await submit(app);
    expect(response.json().decision.reason).toBe('KILL_SWITCH_ACTIVE');
  });

  it('is not registered without a token, like the kill switch', async () => {
    const app = build(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/guard/operator/allowed-markets',
      payload: { allowedMarkets: [] },
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses an allowlist change without the token', async () => {
    const app = build(TOKEN);
    const response = await app.inject({
      method: 'POST',
      url: '/guard/operator/allowed-markets',
      payload: { allowedMarkets: ['0xdeadbeef'] },
    });
    // An agent that finds the port must not be able to permit itself a market.
    expect(response.statusCode).toBe(401);
  });

  it('rotates the allowlist for the operator, and the next order sees it', async () => {
    const app = build(TOKEN);
    // Event Contract windows roll every few minutes and take their ids with them, so the
    // supervisor rewrites this list rather than the policy being edited by hand each time.
    const rotated = await app.inject({
      method: 'POST',
      url: '/guard/operator/allowed-markets',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { allowedMarkets: ['0xsome-other-window'] },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().allowedMarkets).toEqual(['0xsome-other-window']);

    const response = await submit(app);
    expect(response.json().decision.reason).toBe('MARKET_NOT_ALLOWED');
  });

  it('bumps the policy version on a rotation, so the audit log records which list applied', async () => {
    const app = build(TOKEN);
    const before = (await app.inject({ method: 'GET', url: '/guard/policy' })).json().version;
    await app.inject({
      method: 'POST',
      url: '/guard/operator/allowed-markets',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { allowedMarkets: [] },
    });
    const after = (await app.inject({ method: 'GET', url: '/guard/policy' })).json().version;
    expect(after).toBe(before + 1);
  });

  it('changes the allowlist and nothing else', async () => {
    const app = build(TOKEN);
    const before = (await app.inject({ method: 'GET', url: '/guard/policy' })).json();
    await app.inject({
      method: 'POST',
      url: '/guard/operator/allowed-markets',
      headers: { authorization: `Bearer ${TOKEN}` },
      // A limit smuggled into the body must not take effect: the route exists so a loop can
      // keep a rolling allowlist current, not so it can widen the envelope it runs inside.
      payload: { allowedMarkets: [], maxNotionalPerOrder: '999999999999', killSwitch: false },
    });
    const after = (await app.inject({ method: 'GET', url: '/guard/policy' })).json();
    expect(after.maxNotionalPerOrder).toBe(before.maxNotionalPerOrder);
    expect(after.maxOpenNotional).toBe(before.maxOpenNotional);
    expect(after.maxDailyLoss).toBe(before.maxDailyLoss);
    expect(after.allowedMarkets).toEqual([]);
  });

  it('exposes no route that widens a limit', async () => {
    const app = build(TOKEN);
    const routes = app.printRoutes();
    // RISK_POLICY_SPEC section 1: no set_policy, no update_limits, nothing like them.
    expect(routes).not.toMatch(/set.?policy|update.?limits|max.?notional/i);
  });
});

/**
 * The read routes the MCP surface is built on. They exist so an agent can see what it may
 * trade and what it already holds without asking the venue directly — `RISK_POLICY_SPEC.md`
 * §1 says the agent reaches DreamDEX only through Guard, and that covers reads.
 */
describe('the MCP read routes', () => {
  it('lists only markets the allowlist permits', async () => {
    const app = build();
    const body = JSON.parse((await app.inject({ url: '/guard/markets' })).body) as Array<{
      marketId: string;
      closesInMs: number;
    }>;
    expect(body.map((row) => row.marketId).sort()).toEqual([h.marketId, h.secondMarketId].sort());
    expect(body.every((row) => row.closesInMs > 0)).toBe(true);
  });

  it('drops a market the allowlist does not name, rather than offering a certain refusal', async () => {
    const guard = new Guard({
      db: h.opened.db,
      adapter: acceptingAdapter(h.replay),
      policy: policyFor(h, { allowedMarkets: [h.marketId] }),
      wallets: new Map([[AGENT, AGENT_WALLET]]),
    });
    const app = buildGuardServer({ guard, clock: () => h.now });
    const body = JSON.parse((await app.inject({ url: '/guard/markets' })).body) as Array<{
      marketId: string;
    }>;
    expect(body.map((row) => row.marketId)).toEqual([h.marketId]);
  });

  /**
   * The same filter `evaluate` applies as TOO_CLOSE_TO_CLOSE. Listing a market an order
   * would certainly be refused on spends the agent's turn to tell it something Guard
   * already knew.
   */
  it('drops a market inside minTimeToCloseMs', async () => {
    const guard = new Guard({
      db: h.opened.db,
      adapter: acceptingAdapter(h.replay),
      policy: policyFor(h, { minTimeToCloseMs: 86_400_000 }),
      wallets: new Map([[AGENT, AGENT_WALLET]]),
    });
    const app = buildGuardServer({ guard, clock: () => h.now });
    expect(JSON.parse((await app.inject({ url: '/guard/markets' })).body)).toEqual([]);
  });

  /**
   * The constraint that actually binds, and the one this filter originally missed. An order
   * carries an expiry of `now + orderTtlMs` and the pool rejects an expiry past the market's
   * own, so a market with less time left than the TTL cannot accept an order at all — however
   * permissive `minTimeToCloseMs` is.
   *
   * Found in production, not in review: a market two minutes from close, comfortably past a
   * five-second `minTimeToCloseMs`, was offered by `list_markets` and then reverted at the
   * venue against a 120s TTL. `SKILL.md` promises an agent that every market listed is one an
   * order could be accepted on, and this is what keeps that promise true.
   */
  it('drops a market with less time left than an order would live', async () => {
    const guard = new Guard({
      db: h.opened.db,
      adapter: acceptingAdapter(h.replay),
      policy: policyFor(h, { minTimeToCloseMs: 5_000 }),
      wallets: new Map([[AGENT, AGENT_WALLET]]),
      orderTtlMs: 86_400_000,
    });
    const app = buildGuardServer({ guard, clock: () => h.now });
    expect(JSON.parse((await app.inject({ url: '/guard/markets' })).body)).toEqual([]);
  });

  it('keeps a market whose window outlasts the order TTL', async () => {
    const guard = new Guard({
      db: h.opened.db,
      adapter: acceptingAdapter(h.replay),
      policy: policyFor(h, { minTimeToCloseMs: 5_000 }),
      wallets: new Map([[AGENT, AGENT_WALLET]]),
      orderTtlMs: 1_000,
    });
    const app = buildGuardServer({ guard, clock: () => h.now });
    const body = JSON.parse((await app.inject({ url: '/guard/markets' })).body) as unknown[];
    expect(body.length).toBeGreaterThan(0);
  });

  it('quotes a market through the adapter Guard already marks positions with', async () => {
    const app = build();
    const response = await app.inject({ url: `/guard/quote/${h.marketId}` });
    expect(response.statusCode).toBe(200);
    const quote = JSON.parse(response.body) as { marketId: string; midUp: number | null };
    expect(quote.marketId).toBe(h.marketId);
    expect(quote.midUp).not.toBeUndefined();
  });

  it('answers 502 rather than 500 when the venue cannot price a market', async () => {
    const guard = new Guard({
      db: h.opened.db,
      adapter: {
        ...acceptingAdapter(h.replay),
        getQuote: () => Promise.reject(new Error('no book')),
      },
      policy: policyFor(h),
      wallets: new Map([[AGENT, AGENT_WALLET]]),
    });
    const app = buildGuardServer({ guard, clock: () => h.now });
    const response = await app.inject({ url: `/guard/quote/${h.marketId}` });
    expect(response.statusCode).toBe(502);
    expect((JSON.parse(response.body) as { error: { code: string } }).error.code).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
  });

  it('reports an open position after an order is forwarded, and drops it once settled', async () => {
    const app = build();
    expect((await submit(app)).statusCode).toBe(200);

    const open = JSON.parse(
      (await app.inject({ url: `/guard/positions/${AGENT}` })).body,
    ) as Array<{
      marketId: string;
      stake: string;
      side: string;
    }>;
    expect(open).toHaveLength(1);
    expect(open[0]?.marketId).toBe(h.marketId);
    // A bigint crosses the wire as a decimal string, never as a number (CLAUDE.md I5).
    expect(open[0]?.stake).toBe('10000000');
    expect(open[0]?.side).toBe('UP');

    settle(h.opened, h.marketId, 'UP', h.now + 1);
    expect(JSON.parse((await app.inject({ url: `/guard/positions/${AGENT}` })).body)).toEqual([]);
  });

  it('reports no position for an agent that has placed nothing', async () => {
    const app = build();
    expect(JSON.parse((await app.inject({ url: '/guard/positions/nobody' })).body)).toEqual([]);
  });

  it('leaves all three unauthenticated but read-only: none of them changes the policy', async () => {
    const app = build(TOKEN);
    const before = (await app.inject({ url: '/guard/policy' })).body;
    await app.inject({ url: '/guard/markets' });
    await app.inject({ url: `/guard/quote/${h.marketId}` });
    await app.inject({ url: `/guard/positions/${AGENT}` });
    expect((await app.inject({ url: '/guard/policy' })).body).toBe(before);
  });
});
