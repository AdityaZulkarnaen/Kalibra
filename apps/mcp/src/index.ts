import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { buildMcpServer } from './server.js';
import { httpGuard, httpIndex } from './transport.js';

/**
 * `pnpm mcp`. Speaks MCP over stdio, which is how an MCP client launches a server it owns.
 *
 * It holds no key, no database handle and no venue adapter: it is a client of Guard and of
 * the public read API, both of which are already running. That is what keeps enforcement in
 * one place — an MCP order and an HTTP order reach the same `evaluate`.
 *
 * Nothing is written to stdout but protocol frames. A stray `console.log` here corrupts the
 * stream and the client reports a parse error rather than a mistake in this file, so
 * diagnostics go to stderr.
 */
const configSchema = z.object({
  GUARD_URL: z.string().default('http://127.0.0.1:3002'),
  KALIBRA_API_URL: z.string().default('http://127.0.0.1:3001'),
  /** The agent this server speaks for. No tool takes an agent id; this is it. */
  MCP_AGENT_ID: z.string().min(1),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`mcp configuration is not valid:\n${z.prettifyError(parsed.error)}`);
}
const config = parsed.data;

const options = { guardUrl: config.GUARD_URL, indexUrl: config.KALIBRA_API_URL };
const server = buildMcpServer({
  guard: httpGuard(options),
  index: httpIndex(options),
  agentId: config.MCP_AGENT_ID,
});

await server.connect(new StdioServerTransport());
console.error(
  `kalibra mcp for ${config.MCP_AGENT_ID} -> guard ${config.GUARD_URL}, index ${config.KALIBRA_API_URL}`,
);
