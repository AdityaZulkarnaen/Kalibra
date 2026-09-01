import { z } from 'zod';

/**
 * ARCHITECTURE.md section 6: configuration is parsed once, at startup, and a malformed
 * value is a crash rather than a silent default.
 *
 * The two defaults below are deliberate and are the only ones. They exist so that running
 * the repository with no configuration at all produces a working offline replay, which is
 * what invariant I3 rests on.
 */
export const configSchema = z.object({
  KALIBRA_MODE: z.enum(['replay', 'live']).default('replay'),
  KALIBRA_DB_PATH: z.string().min(1).default('./kalibra.db'),
});

export type IndexerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): IndexerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
