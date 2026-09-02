import { z } from 'zod';

/**
 * Guard's configuration. Parsed once; a malformed value is a startup crash, never a
 * silent default. See ARCHITECTURE.md section 6.
 */
export const guardConfigSchema = z.object({
  KALIBRA_DB_PATH: z.string().min(1).default('./kalibra.db'),
  GUARD_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  GUARD_POLICY_PATH: z.string().min(1).default('./guard.policy.json'),
  /**
   * Absent means the operator routes are not registered at all. RISK_POLICY_SPEC.md
   * section 1: an agent must not be able to widen its own limits, and a kill switch that
   * anyone who reaches the port can flip is not a kill switch.
   */
  GUARD_OPERATOR_TOKEN: z.string().min(16).optional(),
  /**
   * agentId=wallet pairs, comma separated. Only needed for an agent with no key here —
   * an agent whose key Guard holds has its wallet derived from that key instead, because a
   * hand-written address that disagrees with its key fails silently and misattributes every
   * fill.
   */
  GUARD_AGENT_WALLETS: z.string().default(''),

  /** replay forwards to the fixture adapter and reaches no network. */
  KALIBRA_MODE: z.enum(['replay', 'live']).default('replay'),
  /** Required in live mode. No default: replay must never silently reach a network. */
  DREAMDEX_INDEXER_URL: z.url().optional(),

  /**
   * The signing keys Guard places orders with, as `agentId=0xkey` pairs, and the reason
   * Guard is a risk envelope rather than a polite API.
   *
   * RISK_POLICY_SPEC.md section 1 says an agent cannot reach the venue except through
   * Guard. Nothing in the policy engine makes that true — what makes it true is that this
   * key lives in Guard's process and the agent never holds one. An agent with its own key
   * bypasses every rule here by calling the venue directly.
   *
   * One key per agent, because each agent trades from its own wallet: sharing one would
   * collapse every agent onto a single leaderboard row, and the point of Arena is that each
   * agent carries its own track record.
   *
   * Empty, Guard runs read-only: orders are evaluated and logged but the adapter refuses to
   * write. That is the honest degradation, not a silent no-op.
   */
  GUARD_AGENT_KEYS: z.string().default(''),
  /** Override for the chain WebSocket. The SDK's Shannon definition carries one already. */
  SOMNIA_WS_RPC_URL: z.string().optional(),
  /** How long a resting order survives, in ms — the dead-man's switch for a crashed agent. */
  GUARD_ORDER_TTL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(120_000),
});

export type GuardConfig = z.infer<typeof guardConfigSchema>;

export function parseAgentWallets(raw: string): Map<string, string> {
  const wallets = new Map<string, string>();
  for (const pair of raw.split(',').map((part) => part.trim())) {
    if (pair === '') continue;
    const [agentId, wallet] = pair.split('=');
    if (agentId === undefined || wallet === undefined || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      throw new Error(`GUARD_AGENT_WALLETS entry is not agentId=0xaddress: ${pair}`);
    }
    wallets.set(agentId, wallet.toLowerCase());
  }
  return wallets;
}

/**
 * `agentId=0xkey` pairs. The keys are never logged and never leave this process; only the
 * addresses they derive are printed, so an operator can confirm the wallet is the one they
 * meant without the key appearing anywhere.
 */
export function parseAgentKeys(raw: string): Map<string, `0x${string}`> {
  const keys = new Map<string, `0x${string}`>();
  for (const pair of raw.split(',').map((part) => part.trim())) {
    if (pair === '') continue;
    const separator = pair.indexOf('=');
    const agentId = separator === -1 ? '' : pair.slice(0, separator).trim();
    const key = separator === -1 ? '' : pair.slice(separator + 1).trim();
    // The 0x prefix is optional because wallets disagree about it — MetaMask exports 64 bare
    // hex characters, viem requires the prefix. Both spellings mean one key and there is no
    // third reading, so this canonicalises rather than guesses, the same way section 4.3
    // canonicalises an address. Anything that is not 64 hex characters is still rejected.
    const body = key.startsWith('0x') || key.startsWith('0X') ? key.slice(2) : key;
    if (agentId === '' || !/^[0-9a-fA-F]{64}$/.test(body)) {
      // Deliberately does not echo the value: a malformed key is still a secret.
      throw new Error(
        `GUARD_AGENT_KEYS entry for agent "${agentId}" is not 64 hex characters, ` +
          `with or without a 0x prefix`,
      );
    }
    keys.set(agentId, `0x${body.toLowerCase()}`);
  }
  return keys;
}
