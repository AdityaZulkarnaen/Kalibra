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
  /** agentId=wallet pairs, comma separated. Guard fills are attributed to these. */
  GUARD_AGENT_WALLETS: z.string().default(''),

  /** replay forwards to the fixture adapter and reaches no network. */
  KALIBRA_MODE: z.enum(['replay', 'live']).default('replay'),
  /** Required in live mode. No default: replay must never silently reach a network. */
  DREAMDEX_INDEXER_URL: z.url().optional(),

  /**
   * The signing key Guard places orders with, and the reason Guard is a risk envelope
   * rather than a polite API.
   *
   * RISK_POLICY_SPEC.md section 1 says an agent cannot reach the venue except through
   * Guard. Nothing in the policy engine makes that true — what makes it true is that this
   * key lives in Guard's process and the agent never holds one. An agent with its own key
   * bypasses every rule here by calling the venue directly.
   *
   * Absent, Guard runs read-only: orders are evaluated and logged but the adapter refuses
   * to write. That is the honest degradation, not a silent no-op.
   */
  GUARD_SIGNER_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 0x-prefixed 32-byte hex private key')
    .optional(),
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
