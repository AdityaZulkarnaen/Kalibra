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
