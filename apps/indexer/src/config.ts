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
  /** Required only in live mode. No default: replay must never silently reach a network. */
  DREAMDEX_INDEXER_URL: z.string().url().optional(),
  /** Live mode reads orders per market to reconstruct mids, so this bounds one pass. */
  DREAMDEX_MARKET_LIMIT: z.coerce.number().int().min(1).max(500).default(10),
  /**
   * Ingest windows nobody has traded yet. Needed while agents are running: Guard resolves a
   * market's status and window from this table, so a window missing from it is refused as
   * MARKET_NOT_OPEN — and the agents could only ever join markets somebody else started,
   * which on a quiet testnet is most of the day.
   */
  DREAMDEX_INCLUDE_UNTRADED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** How often `--watch` repeats a pass. Guard reads market facts from this table. */
  KALIBRA_INGEST_INTERVAL_MS: z.coerce.number().int().min(5000).max(600_000).default(60_000),
});

export type IndexerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): IndexerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
