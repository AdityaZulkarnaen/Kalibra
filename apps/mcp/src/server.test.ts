import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMcpServer, TOOL_NAMES } from './server.js';
import { httpGuard, httpIndex, type FetchLike } from './transport.js';

/**
 * A real MCP client, over the SDK's in-memory transport, against the real server. Nothing
 * here reimplements the protocol: `tools/list` is the same request a client launching this
 * over stdio sends, so "an MCP client connects and lists all six tools" is asserted rather
 * than asserted-about.
 *
 * Guard and the index are stubbed at the HTTP boundary, not at the transport interface, so
 * the request each tool actually makes is what gets recorded — which is what makes the
 * policy-mutation test mean something.
 */

const AGENT = 'contrarian-fade';
const WALLET = '0x1111111111111111111111111111111111111111';

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
}

let recorded: Recorded[] = [];

const bins = Array.from({ length: 10 }, (_value, index) => ({
  bin: index,
  range: [index / 10, (index + 1) / 10] as [number, number],
  count: 0,
  meanForecast: null,
  observedFreq: null,
}));

const BODIES: Record<string, unknown> = {
  '/guard/markets': [
    {
      marketId: 'mkt-1',
      underlying: 'BTC-USD',
      windowStart: 1_000,
      windowEnd: 900_000,
      closesInMs: 899_000,
    },
  ],
  '/guard/quote/mkt-1': {
    marketId: 'mkt-1',
    bestBidUp: 0.61,
    bestAskUp: 0.63,
    midUp: 0.62,
    lastUp: 0.6,
    at: 1_000,
  },
  [`/guard/positions/${AGENT}`]: [
    {
      marketId: 'mkt-1',
      side: 'UP',
      stake: '25000000',
      entryProbUp: 0.6,
      markProbUp: 0.62,
      unrealisedPnl: '833333',
      openedAt: 900,
    },
  ],
  [`/guard/risk/${AGENT}`]: {
    agentId: AGENT,
    policyId: 'demo',
    policyVersion: 1,
    killSwitch: false,
    state: {
      now: 1_000,
      openNotional: '25000000',
      dailyRealisedPnl: '0',
      dailyUnrealisedPnl: '833333',
      ordersInWindow: 1,
      consecutiveLosses: 0,
      cooldownUntil: null,
    },
    remaining: {
      notionalPerOrder: '50000000',
      openNotional: '175000000',
      dailyLoss: '100000000',
      ordersInWindow: 9,
    },
  },
  '/guard/order': {
    decision: { verdict: 'DENY', reason: 'ORDER_TOO_LARGE', severity: 'BLOCK', detail: 'too big' },
    auditSeq: 601,
    venueOrderId: null,
    txHash: null,
    forwarded: false,
    recorded: false,
    note: null,
  },
  '/guard/policy': { policyId: 'demo', version: 1, maxNotionalPerOrder: '50000000' },
  '/v1/arena?status=all&limit=200': {
    params: { lambdaMax: 0.5, shrinkK: 50, minSample: 30, paramsHash: `0x${'a'.repeat(64)}` },
    total: 1,
    entries: [
      {
        rank: 1,
        wallet: WALLET,
        score: 612,
        status: 'RANKED',
        n: 41,
        bss: 0.1,
        eceExcess: 0.02,
        auc: 0.61,
        isAgent: true,
        agentName: 'Contrarian Fade',
        agentId: AGENT,
        method: 'fades an extreme book',
        registeredAt: 1_000,
      },
    ],
  },
  [`/v1/wallet/${WALLET}`]: {
    wallet: WALLET,
    score: 612,
    status: 'RANKED',
    n: 41,
    excludedCount: 3,
    stats: {
      bsTrader: 0.2,
      bsMarket: 0.22,
      bss: 0.1,
      bssShrunk: 0.05,
      eceTrader: 0.04,
      eceMarket: 0.03,
      eceExcess: 0.02,
      auc: 0.61,
    },
    calibration: bins,
    agent: { agentId: AGENT, name: 'Contrarian Fade', method: 'fades an extreme book' },
    paramsHash: `0x${'a'.repeat(64)}`,
    computedAt: 1_000,
  },
};

const AUDIT_LINES = [
  '{"seq":600,"agentId":"contrarian-fade","decision":{"verdict":"ALLOW"}}',
  '{"seq":601,"agentId":"contrarian-fade","decision":{"verdict":"DENY","reason":"ORDER_TOO_LARGE"}}',
].join('\n');

const stubFetch: FetchLike = (url, init) => {
  const parsedUrl = new URL(url);
  const path = `${parsedUrl.pathname}${parsedUrl.search}`;
  const headers = new Headers(init?.headers);
  recorded.push({
    method: init?.method ?? 'GET',
    url: path,
    authorization: headers.get('authorization'),
  });

  if (path.startsWith('/guard/audit/')) {
    return Promise.resolve(
      new Response(AUDIT_LINES, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    );
  }
  const body = BODIES[path];
  if (body === undefined) {
    return Promise.resolve(new Response('{}', { status: 404 }));
  }
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      // Guard answers a refusal with 403 and a decision in the body.
      status: path === '/guard/order' ? 403 : 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
};

let client: Client;

beforeEach(async () => {
  recorded = [];
  const transports = { guardUrl: 'http://guard.test', indexUrl: 'http://index.test' };
  const server = buildMcpServer({
    guard: httpGuard({ ...transports, fetch: stubFetch }),
    index: httpIndex({ ...transports, fetch: stubFetch }),
    agentId: AGENT,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
});

const callJson = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? 'null') as unknown;
};

describe('an MCP client connecting to Guard', () => {
  it('lists exactly the six tools RISK_POLICY_SPEC.md section 7 specifies', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(6);
  });

  it('gives every tool a description and an input schema a model can plan against', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
  });

  it('exposes both read-only resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      'kalibra://audit/recent',
      'kalibra://policy/current',
    ]);
  });
});

/**
 * `RISK_POLICY_SPEC.md` §1 and §7: the agent cannot change what it is held to. The tool
 * list is one half of that; the other half is that no tool reaches an operator route, which
 * is asserted by driving all six and looking at what they actually sent.
 */
describe('no MCP tool can mutate policy', () => {
  it('registers no tool that names a policy, a limit or a kill switch', async () => {
    const { tools } = await client.listTools();
    const surface = tools
      .map((tool) => `${tool.name} ${JSON.stringify(tool.inputSchema)}`)
      .join(' ')
      .toLowerCase();
    expect(surface).not.toMatch(/set_policy|update_policy|kill_switch|allowed_markets/);
    for (const tool of tools) {
      const properties = Object.keys(
        (tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {},
      );
      expect(properties, tool.name).not.toContain('policy');
      expect(properties, tool.name).not.toContain('maxNotionalPerOrder');
    }
  });

  it('sends nothing but reads and one order, whichever tool is called', async () => {
    await callJson('list_markets');
    await callJson('get_quote', { marketId: 'mkt-1' });
    await callJson('get_positions');
    await callJson('get_risk_status');
    await callJson('get_my_score');
    await callJson('place_order', {
      marketId: 'mkt-1',
      side: 'UP',
      stake: '500000000',
      limitProb: 0.62,
      clientOrderId: 'demo-1',
    });
    await client.readResource({ uri: 'kalibra://policy/current' });
    await client.readResource({ uri: 'kalibra://audit/recent' });

    expect(recorded.length).toBeGreaterThan(0);
    const writes = recorded.filter((call) => call.method !== 'GET');
    expect(writes).toEqual([{ method: 'POST', url: '/guard/order', authorization: null }]);
    expect(recorded.some((call) => call.url.startsWith('/guard/operator'))).toBe(false);
    // The operator routes need a bearer token. This process never holds one, so even a
    // request that reached them would be refused — but it never makes one.
    expect(recorded.every((call) => call.authorization === null)).toBe(true);
  });
});

describe('the tools', () => {
  it('lists only markets the policy permits, with the time left on each', async () => {
    const markets = (await callJson('list_markets')) as Array<Record<string, unknown>>;
    expect(markets).toHaveLength(1);
    expect(markets[0]?.['closesInMs']).toBe(899_000);
  });

  it('reports the touch as well as the mid, so an empty book is visible', async () => {
    const quote = (await callJson('get_quote', { marketId: 'mkt-1' })) as Record<string, unknown>;
    expect(quote['midUp']).toBe(0.62);
    expect(quote['bestAskUp']).toBe(0.63);
  });

  it('returns a refusal as a decision with its reason code, not as a tool error', async () => {
    const result = await client.callTool({
      name: 'place_order',
      arguments: {
        marketId: 'mkt-1',
        side: 'UP',
        stake: '500000000',
        limitProb: 0.62,
        clientOrderId: 'demo-1',
      },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ text: string }>;
    const body = JSON.parse(content[0]?.text ?? '{}') as {
      decision: { verdict: string; reason: string };
      auditSeq: number;
    };
    expect(body.decision.verdict).toBe('DENY');
    expect(body.decision.reason).toBe('ORDER_TOO_LARGE');
    expect(body.auditSeq).toBe(601);
  });

  it('reports remaining headroom rather than the limits themselves', async () => {
    const risk = (await callJson('get_risk_status')) as { remaining: Record<string, string> };
    expect(risk.remaining['openNotional']).toBe('175000000');
    expect(risk.remaining['dailyLoss']).toBe('100000000');
  });

  it('resolves the score through the Arena registration, not through a given address', async () => {
    const score = (await callJson('get_my_score')) as Record<string, unknown>;
    expect(score['registered']).toBe(true);
    expect(score['wallet']).toBe(WALLET);
    expect(score['score']).toBe(612);
    expect((score['calibration'] as unknown[]).length).toBe(10);
    expect(recorded.some((call) => call.url === `/v1/wallet/${WALLET}`)).toBe(true);
  });

  it('refuses to guess a stake that is not an integer in base units', async () => {
    const result = await client.callTool({
      name: 'place_order',
      arguments: {
        marketId: 'mkt-1',
        side: 'UP',
        stake: '12.5',
        limitProb: 0.5,
        clientOrderId: 'bad',
      },
    });
    expect(result.isError).toBe(true);
    expect(recorded.some((call) => call.url === '/guard/order')).toBe(false);
  });
});

describe('the resources', () => {
  it('serves the policy read-only, so the limits are legible but not negotiable', async () => {
    const result = await client.readResource({ uri: 'kalibra://policy/current' });
    const contents = result.contents as Array<{ text: string }>;
    expect(JSON.parse(contents[0]?.text ?? '{}')).toMatchObject({ policyId: 'demo' });
  });

  it('serves the tail of this agent audit log, refusals included', async () => {
    const result = await client.readResource({ uri: 'kalibra://audit/recent' });
    const contents = result.contents as Array<{ text: string }>;
    const entries = JSON.parse(contents[0]?.text ?? '[]') as Array<{
      decision: { reason?: string };
    }>;
    expect(entries).toHaveLength(2);
    expect(entries[1]?.decision.reason).toBe('ORDER_TOO_LARGE');
  });
});
