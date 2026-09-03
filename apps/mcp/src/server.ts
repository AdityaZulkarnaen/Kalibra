import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GuardTransport, IndexTransport } from './transport.js';

/**
 * Guard as an MCP server. `RISK_POLICY_SPEC.md` §7 names the six tools and the two
 * resources, and this file registers exactly those and nothing else.
 *
 * **There is no policy-mutation tool, and there cannot be one by accident.** This process
 * reaches Guard only through `GuardTransport`, which has no method that changes a policy,
 * and it is never given the operator bearer token those routes require. Adding such a tool
 * would mean editing the transport interface, the transport implementation and this file —
 * three deliberate steps, none of which a refactor performs on its own. `server.test.ts`
 * asserts the tool list and asserts that driving every tool produces no write to Guard
 * beyond `POST /guard/order`.
 *
 * Every tool returns JSON as text. MCP clients hand tool output to a model, and a model
 * reading `"stake": "50000000"` can reason about it; a model reading a rendered sentence
 * cannot check the arithmetic.
 */

export const TOOL_NAMES = [
  'list_markets',
  'get_quote',
  'place_order',
  'get_positions',
  'get_risk_status',
  'get_my_score',
] as const;

export interface McpOptions {
  readonly guard: GuardTransport;
  readonly index: IndexTransport;
  /** The one agent this server speaks for. Tools take no agent id: see below. */
  readonly agentId: string;
}

/**
 * A tool that took an `agentId` argument would let a model address any agent's positions,
 * risk budget and orders by guessing an identifier. The server is configured for one agent
 * and every tool uses that one, so the identity is a deployment fact rather than a model's
 * choice.
 */
export function buildMcpServer(options: McpOptions): McpServer {
  const { guard, index, agentId } = options;

  const server = new McpServer(
    { name: 'kalibra-guard', version: '0.1.0' },
    {
      instructions:
        'Kalibra Guard. Every order you place is evaluated against a risk policy before it ' +
        'reaches the venue, and both the decision and the order are written to a ' +
        'hash-chained audit log. Call get_risk_status before sizing an order: it reports ' +
        'what headroom is left under each limit, so a refusal is avoidable rather than ' +
        'discovered. You cannot change the policy from here.',
      capabilities: { tools: {}, resources: {} },
    },
  );

  server.registerTool(
    'list_markets',
    {
      title: 'List permitted markets',
      description:
        'Open Event Contract markets this agent is permitted to trade right now. Already ' +
        'filtered to the policy allowlist and to markets with enough time left before ' +
        'close, so every market listed is one an order could be accepted on.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => json(await guard.markets()),
  );

  server.registerTool(
    'get_quote',
    {
      title: 'Get a quote',
      description:
        "The venue's current implied probability of UP for one market, with the touch. " +
        '`midUp` is null when the book is empty — price against the touch or skip the ' +
        'market; do not assume 0.5.',
      inputSchema: { marketId: z.string().min(1).describe('A marketId from list_markets') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ marketId }) => json(await guard.quote(marketId)),
  );

  server.registerTool(
    'place_order',
    {
      title: 'Place an order through Guard',
      description:
        'Submit an order. Guard evaluates it against the policy, writes the decision to the ' +
        'audit log, and forwards it only if allowed. A refusal returns verdict DENY with a ' +
        'reason code — that is a real answer, not an error, and the refusal is recorded ' +
        'either way. Stake is in base units as a decimal string.',
      inputSchema: {
        marketId: z.string().min(1),
        side: z.enum(['UP', 'DOWN']).describe('UP buys the UP outcome'),
        stake: z
          .string()
          .regex(/^\d+$/)
          .describe('Base units, decimal string. Never a float: see CLAUDE.md I5.'),
        limitProb: z
          .number()
          .min(0)
          .max(1)
          .nullable()
          .describe('Limit as P(UP), not as the price of your own side. Null for a market order.'),
        clientOrderId: z.string().min(1).describe('Your idempotency key for this order'),
        postOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (order) => json(await guard.submit(agentId, order)),
  );

  server.registerTool(
    'get_positions',
    {
      title: 'Get open positions',
      description:
        "This agent's open exposure, marked at the current mid where one is available. A " +
        'position leaves this list when its market settles. `unrealisedPnl` is zero when ' +
        'there was no quote to mark against, which means unknown rather than flat.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => json(await guard.positions(agentId)),
  );

  server.registerTool(
    'get_risk_status',
    {
      title: 'Get remaining risk budget',
      description:
        'Remaining headroom under every limit, plus cooldown and kill-switch state. Call ' +
        'this before sizing an order. `remaining` is what is left, not what the limit is.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => json(await guard.riskStatus(agentId)),
  );

  server.registerTool(
    'get_my_score',
    {
      title: 'Get my Kalibra Score',
      description:
        "This agent's Kalibra Score and ten-bin calibration curve, from the public index. " +
        'PROVISIONAL with a null score means fewer than the minimum resolved positions — ' +
        'not a bad score, an absent one. Requires the agent to be registered in the Arena.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const board = await index.arena();
      const entry = board.entries.find((row) => row.agentId === agentId);
      if (entry === undefined) {
        return json({
          agentId,
          registered: false,
          note: 'not registered in the Arena; register with POST /v1/arena/register',
        });
      }
      const wallet = await index.wallet(entry.wallet);
      if (wallet === null) {
        // Registered, but the pipeline has not scored this wallet yet. Reporting a zero
        // here would read as "measurably bad" rather than "no evidence".
        return json({
          agentId,
          registered: true,
          wallet: entry.wallet,
          score: null,
          status: 'PROVISIONAL',
          n: 0,
          note: 'registered, but no resolved positions have been scored for this wallet yet',
        });
      }
      return json({ agentId, registered: true, ...wallet });
    },
  );

  /**
   * The two resources from §7. Both read-only, and `kalibra://policy/current` is the one an
   * agent should read to understand what it is being held to — it is exposed so the limits
   * are legible, not so they are negotiable.
   */
  server.registerResource(
    'policy',
    'kalibra://policy/current',
    {
      title: 'Current risk policy',
      description: 'The policy every order from this agent is evaluated against. Read-only.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await guard.policy(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'audit',
    'kalibra://audit/recent',
    {
      title: 'Recent audit entries',
      description:
        "The tail of this agent's audit log: every decision Guard made on its orders, " +
        'allowed and refused. The chain verifies over the whole log, not over this slice.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await guard.recentAudit(agentId, RECENT_AUDIT), null, 2),
        },
      ],
    }),
  );

  return server;
}

/** How much of the log `kalibra://audit/recent` returns. Enough to see a pattern of refusals. */
const RECENT_AUDIT = 20;

/**
 * Tool output. `isError` is deliberately not set for a DENY: a refusal is Guard working,
 * and a model told its call errored will retry it rather than read the reason code.
 */
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
