/**
 * `pnpm register-agents` — enter the demo agents into the Arena.
 *
 * It goes through the public `POST /v1/arena/register` endpoint rather than inserting rows,
 * so what it exercises is the same path any other agent would take. An agent that could only
 * be registered by a script with database access would not be a registry, it would be a list.
 *
 * The wallet is derived from the signing key Guard holds for that agent, never typed in. A
 * hand-written address that disagrees with its key attributes every fill to a wallet that
 * did not place it, and the score looks entirely plausible while being about nobody.
 *
 * Re-running it is safe: an already-registered wallet is reported and skipped.
 */
import { addressForKey } from '@kalibra/adapter-dreamdex';
import { STRATEGIES } from '@kalibra/agent/strategy';

import { parseAgentKeys, parseAgentWallets } from '../apps/guard/src/config.js';

const API_URL = process.env['KALIBRA_API_URL'] ?? 'http://127.0.0.1:3001';

async function walletFor(agentId: string): Promise<string | null> {
  const keys = parseAgentKeys(process.env['GUARD_AGENT_KEYS'] ?? '');
  const key = keys.get(agentId);
  if (key !== undefined) return addressForKey(key);
  return parseAgentWallets(process.env['GUARD_AGENT_WALLETS'] ?? '').get(agentId) ?? null;
}

async function main(): Promise<void> {
  let registered = 0;
  let skipped = 0;

  for (const strategy of STRATEGIES) {
    const wallet = await walletFor(strategy.agentId);
    if (wallet === null) {
      console.log(`${strategy.agentId.padEnd(16)} no key or wallet configured, skipped`);
      skipped += 1;
      continue;
    }

    const response = await fetch(`${API_URL}/v1/arena/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        name: strategy.name,
        method: strategy.method,
      }),
    });

    const body = (await response.json()) as { error?: { message: string }; agentId?: string };
    if (response.status === 201) {
      console.log(`${strategy.agentId.padEnd(16)} registered as ${body.agentId} (${wallet})`);
      registered += 1;
      continue;
    }
    // Already registered is the ordinary outcome of a re-run, not a failure.
    console.log(`${strategy.agentId.padEnd(16)} ${body.error?.message ?? response.statusText}`);
    skipped += 1;
  }

  console.log(`\n${registered} registered, ${skipped} skipped. See ${API_URL}/v1/arena`);
}

await main();
