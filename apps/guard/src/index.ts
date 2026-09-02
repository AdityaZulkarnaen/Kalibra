import { readFileSync } from 'node:fs';

import { openDatabase } from '@kalibra/db';

import { resolveAdapter } from './adapter.js';
import { guardConfigSchema, parseAgentWallets } from './config.js';
import { Guard } from './guard.js';
import { parsePolicy } from './policy-file.js';
import { buildGuardServer } from './server.js';

/**
 * `pnpm guard`. Loopback only: the operator surface is not on the public internet, and
 * the agent surface is reached through the MCP server on day 7.
 */
const config = guardConfigSchema.parse(process.env);
const policy = parsePolicy(JSON.parse(readFileSync(config.GUARD_POLICY_PATH, 'utf8')));
const { db } = openDatabase(config.KALIBRA_DB_PATH);
const { adapter, description } = await resolveAdapter(config);

const guard = new Guard({
  db,
  adapter,
  policy,
  wallets: parseAgentWallets(config.GUARD_AGENT_WALLETS),
});

const app = buildGuardServer({
  guard,
  clock: () => Date.now(),
  operatorToken: config.GUARD_OPERATOR_TOKEN,
});

await app.listen({ port: config.GUARD_PORT, host: '127.0.0.1' });
console.log(`kalibra guard on http://127.0.0.1:${config.GUARD_PORT}/guard`);
console.log(
  `policy ${policy.policyId} v${policy.version}, ${policy.allowedMarkets.length} markets allowed`,
);
console.log(`venue  ${description}`);
if (config.GUARD_OPERATOR_TOKEN === undefined) {
  console.log('operator routes are not registered: GUARD_OPERATOR_TOKEN is unset');
}
