/**
 * `pnpm mcp-place-one` — place one real order through the MCP surface and print its hash.
 *
 * The counterpart to `place-one.ts`, which proved the direct write path. This proves the
 * other one: a real MCP client, over a real stdio transport, driving the six tools of
 * `RISK_POLICY_SPEC.md` §7 against a running Guard that signs and sends to the venue.
 *
 * It exists because the README's MCP row says, accurately, that no order has yet reached the
 * venue *through MCP*. That row stays SYNTHETIC until this script produces a transaction
 * hash, and the only honest way to change it is to run the path rather than to describe it.
 *
 * **The position lands on the chosen agent's Arena record**, because Guard signs with that
 * agent's key and the venue tape attributes the fill to that wallet. That is one position
 * the agent's strategy did not decide, so the agent is named on the command line rather than
 * defaulted, and the script says so before it sends.
 *
 * Sends one order per invocation. Nothing here loops.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

const configSchema = z.object({
  GUARD_URL: z.string().default('http://127.0.0.1:3002'),
  KALIBRA_API_URL: z.string().default('http://127.0.0.1:3001'),
  MCP_AGENT_ID: z.string().min(1, 'name the agent whose record this order will land on'),
  /** Base units. Small enough to clear the per-order cap and to find a resting counterparty. */
  MCP_STAKE: z.string().regex(/^\d+$/).default('3000000'),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(`configuration is not valid:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const config = parsed.data;

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'apps/mcp/src/index.ts'],
  env: {
    ...(process.env as Record<string, string>),
    GUARD_URL: config.GUARD_URL,
    KALIBRA_API_URL: config.KALIBRA_API_URL,
    MCP_AGENT_ID: config.MCP_AGENT_ID,
  },
});

const client = new Client({ name: 'kalibra-mcp-place-one', version: '0.1.0' });

/** Every tool returns JSON as text. Parsed here rather than read, so a shape change fails. */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? 'null';
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as unknown;
}

const marketSchema = z.object({
  marketId: z.string(),
  underlying: z.string(),
  windowEnd: z.number(),
  closesInMs: z.number(),
});

const quoteSchema = z.object({
  bestBidUp: z.number().nullable(),
  bestAskUp: z.number().nullable(),
  midUp: z.number().nullable(),
});

const riskSchema = z.object({
  killSwitch: z.boolean(),
  remaining: z.object({ notionalPerOrder: z.string(), ordersInWindow: z.number() }),
});

const resultSchema = z.object({
  decision: z.object({ verdict: z.string(), reason: z.string().nullish() }),
  auditSeq: z.number(),
  txHash: z.string().nullable(),
  venueOrderId: z.string().nullable(),
  forwarded: z.boolean(),
  note: z.string().nullable(),
});

async function main(): Promise<void> {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`mcp      connected, ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
  console.log(`agent    ${config.MCP_AGENT_ID} — this order lands on that Arena record\n`);

  // 1. Headroom first, which is the order SKILL.md tells every agent to work in.
  const risk = riskSchema.parse(await callTool('get_risk_status'));
  if (risk.killSwitch) {
    console.log('kill switch is engaged; nothing can be placed. Stopping.');
    return;
  }
  console.log(
    `risk     ${risk.remaining.notionalPerOrder} base units per order, ` +
      `${risk.remaining.ordersInWindow} orders left in the window`,
  );

  // 2. Only markets the policy already permits. Guard filtered these, not this script.
  const markets = z.array(marketSchema).parse(await callTool('list_markets'));
  if (markets.length === 0) {
    console.log(
      'no permitted market right now. The supervisor rotates the allowlist every cycle, ' +
        'so try again in a minute — or check that `pnpm agents` is running.',
    );
    process.exitCode = 1;
    return;
  }

  // 3. A quote for each candidate, taking the first with an ask to cross. A market order
  //    would be simpler and would also price against a book we never looked at.
  for (const market of markets) {
    const quote = quoteSchema.parse(await callTool('get_quote', { marketId: market.marketId }));
    if (quote.bestAskUp === null) {
      console.log(`skip     ${market.underlying} ${short(market.marketId)} — no ask to cross`);
      continue;
    }

    // Cross by two ticks. Resting at the touch is what got the direct path refused with
    // PostOnlyWouldCross on a book that moved between the read and the send.
    const limitProb = Math.min(0.99, Number((quote.bestAskUp + 0.002).toFixed(3)));
    console.log(`\nmarket   ${market.underlying} ${short(market.marketId)}`);
    console.log(`         closes in ${Math.round(market.closesInMs / 60000)} min`);
    console.log(
      `book     bid=${quote.bestBidUp ?? '-'} ask=${quote.bestAskUp} mid=${quote.midUp ?? '-'}`,
    );
    console.log(`order    UP ${config.MCP_STAKE} base units, limitProb ${limitProb}\n`);

    const result = resultSchema.parse(
      await callTool('place_order', {
        marketId: market.marketId,
        side: 'UP',
        stake: config.MCP_STAKE,
        limitProb,
        clientOrderId: `mcp-place-one-${Date.now()}`,
        postOnly: false,
      }),
    );

    console.log(`verdict  ${result.decision.verdict}${reason(result.decision.reason)}`);
    console.log(`audit    seq ${result.auditSeq}`);

    if (result.decision.verdict === 'DENY') {
      // A refusal is Guard working. It is still evidence the path is live, but it is not
      // the evidence this script exists to produce.
      console.log('\nGuard refused it. The MCP path reached the policy engine, but no order');
      console.log('reached the venue, so the README row does not change. Try again.');
      process.exitCode = 1;
      return;
    }

    if (!result.forwarded || result.txHash === null) {
      console.log(`note     ${result.note ?? 'the venue did not accept it'}`);
      console.log('\nGuard allowed it and the venue did not take it. The note above is the');
      console.log('venue speaking; read it rather than assuming a thin book. A revert naming');
      console.log('parameters usually means the order itself was not acceptable, not that');
      console.log('nobody was there to trade with. Nothing to claim either way.');
      process.exitCode = 1;
      return;
    }

    console.log(`venue    order ${result.venueOrderId ?? '-'}`);
    console.log(`tx       ${result.txHash}`);
    console.log(`         https://shannon-explorer.somnia.network/tx/${result.txHash}`);
    console.log('\nThis is the evidence the MCP row needs. Put that hash in the README.');
    return;
  }

  console.log('\nno market had an ask to cross. Try again when the book has liquidity.');
  process.exitCode = 1;
}

const short = (id: string): string => (id.length <= 14 ? id : `${id.slice(0, 10)}…${id.slice(-4)}`);
const reason = (value: string | null | undefined): string =>
  value === null || value === undefined ? '' : ` — ${value}`;

try {
  await main();
} finally {
  await client.close();
}
