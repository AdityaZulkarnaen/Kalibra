import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Guard } from './guard.js';
import {
  acceptingAdapter,
  policyFor,
  setUpHarness,
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
