import type { GuardPolicy } from '@kalibra/core';
import { z } from 'zod';

/**
 * `guard.policy.json`, parsed. `RISK_POLICY_SPEC.md` §2.
 *
 * Bigints arrive as strings and are transformed, never cast: parsing them as numbers loses
 * precision above 2^53, and a silently truncated risk limit is the exact class of bug
 * invariant I5 exists to prevent.
 *
 * An unparseable policy is a startup crash. §1 says deny by default, and a process running
 * on a half-understood policy is a worse outcome than a process that refuses to start.
 */

const baseUnits = z
  .string()
  .regex(/^\d+$/, 'base units cross the boundary as decimal strings')
  .transform(BigInt);

const nonNegative = z.number().int().nonnegative();

export const guardPolicySchema = z.object({
  policyId: z.string().min(1),
  version: z.number().int().positive(),
  maxNotionalPerOrder: baseUnits,
  maxOpenNotional: baseUnits,
  maxDailyLoss: baseUnits,
  maxOrdersPerWindow: z.number().int().positive(),
  rateWindowMs: z.number().int().positive(),
  lossStreakThreshold: z.number().int().positive(),
  cooldownMs: nonNegative,
  /** Empty is the default and means no market is permitted. */
  allowedMarkets: z.array(z.string().min(1)),
  minTimeToCloseMs: nonNegative,
  killSwitch: z.boolean(),
  autoKillOnDailyLoss: z.boolean(),
});

export function parsePolicy(value: unknown): GuardPolicy {
  const result = guardPolicySchema.safeParse(value);
  if (!result.success) {
    throw new Error(`guard policy is not valid: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * The operator's two levers, both of which only ever narrow or widen the policy through
 * this one function. There is no code path by which an agent reaches it — see §1.
 */
export function withKillSwitch(policy: GuardPolicy, engaged: boolean): GuardPolicy {
  return { ...policy, killSwitch: engaged, version: policy.version + 1 };
}

export function withAllowedMarkets(policy: GuardPolicy, markets: readonly string[]): GuardPolicy {
  return { ...policy, allowedMarkets: [...markets], version: policy.version + 1 };
}
