/**
 * `pnpm agent-funding` — what each agent's wallet holds, and optionally mint collateral.
 *
 * Run it before starting the agents. An underfunded agent does not stop: it sends an order
 * that reverts every cycle and pays gas each time, and the on-chain reason is a bare selector
 * unless someone decodes it.
 *
 * Keys are read from the environment and never printed. Only derived addresses appear here,
 * which is what an operator needs in order to confirm the wallet is the one they meant.
 *
 * Pass `--mint` to call the testnet faucet for any agent short of collateral. Gas is not
 * mintable and has to come from the Somnia faucet by hand.
 */
import { addressForKey, mintCollateral, readFunding } from '@kalibra/adapter-dreamdex';

import { parseAgentKeys } from '../apps/guard/src/config.js';

const INDEXER_URL = process.env['DREAMDEX_INDEXER_URL'] ?? 'https://dev.smk.somnia.host/v1/graphql';

/** Enough gas for a few hundred orders, and enough collateral to reach MIN_SAMPLE. */
const MIN_GAS = 10n ** 16n; // 0.01 STT
const MIN_COLLATERAL = 100n * 10n ** 6n; // 100 tUSDC

const fmt = (raw: bigint, decimals: number): string => {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(decimals, '0').slice(0, 4);
  return `${whole}.${frac}`;
};

async function main(): Promise<void> {
  const keys = parseAgentKeys(process.env['GUARD_AGENT_KEYS'] ?? '');
  if (keys.size === 0) {
    console.log('GUARD_AGENT_KEYS is empty: no agent can trade. See .env.example.');
    process.exitCode = 1;
    return;
  }

  const agents = await Promise.all(
    [...keys].map(async ([agentId, key]) => ({ agentId, key, address: await addressForKey(key) })),
  );

  const funding = await readFunding(
    { indexerUrl: INDEXER_URL },
    agents.map((agent) => agent.address),
  );
  const byAddress = new Map(funding.map((row) => [row.address, row]));

  console.log(`${keys.size} agent(s) configured\n`);
  const short: typeof agents = [];
  for (const agent of agents) {
    const row = byAddress.get(agent.address);
    const gas = row === undefined ? 0n : row.gas;
    const collateral = row === undefined ? 0n : row.collateral;
    const flags = [
      gas < MIN_GAS ? 'NEEDS GAS' : '',
      collateral < MIN_COLLATERAL ? 'NEEDS COLLATERAL' : '',
    ].filter((flag) => flag !== '');
    console.log(
      `  ${agent.agentId.padEnd(16)} ${agent.address}  ` +
        `${fmt(gas, 18).padStart(10)} STT  ${fmt(collateral, 6).padStart(12)} tUSDC  ` +
        `${flags.join(' ') || 'ready'}`,
    );
    if (collateral < MIN_COLLATERAL) short.push(agent);
  }

  if (!process.argv.includes('--mint')) {
    if (short.length > 0) console.log('\nre-run with --mint to draw testnet collateral');
    return;
  }

  for (const agent of short) {
    const gas = byAddress.get(agent.address)?.gas ?? 0n;
    if (gas < MIN_GAS) {
      // Minting is itself a transaction. Without gas it cannot be paid for, and saying so
      // beats a revert whose reason is a bare selector.
      console.log(`\n${agent.agentId}: skipped, no STT to pay for the faucet call`);
      continue;
    }
    console.log(`\n${agent.agentId}: minting collateral…`);
    try {
      const hash = await mintCollateral({ indexerUrl: INDEXER_URL }, agent.key);
      console.log(`  ${hash}`);
    } catch (cause) {
      // One agent that cannot mint should not hide the state of the other two.
      const first = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
      console.log(`  failed: ${first}`);
      process.exitCode = 1;
    }
  }
}

await main();

// The SDK's WebSocket keeps a handle open past close(), so the process would otherwise sit
// idle after the report is written.
process.exit(process.exitCode ?? 0);
