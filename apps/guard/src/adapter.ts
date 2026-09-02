import {
  LiveAdapter,
  ReplayAdapter,
  SomniaWriter,
  type DreamDexAdapter,
} from '@kalibra/adapter-dreamdex';

import type { GuardConfig } from './config.js';

/**
 * Which venue Guard forwards to, and whether it can write to it.
 *
 * The signer lives here rather than anywhere an agent can reach, which is the whole basis of
 * the claim that an agent cannot touch the venue except through Guard. Without key custody
 * that claim is decoration: an agent holding its own key calls the venue directly and every
 * rule in the policy engine becomes advisory.
 */

export interface ResolvedAdapter {
  readonly adapter: DreamDexAdapter;
  /** Printed at startup, so an operator can see whether this process can spend. */
  readonly description: string;
}

export async function resolveAdapter(config: GuardConfig): Promise<ResolvedAdapter> {
  if (config.KALIBRA_MODE !== 'live') {
    return {
      adapter: await ReplayAdapter.fromDirectory('./fixtures/synthetic'),
      description: 'replay (committed fixtures, no network, cannot write)',
    };
  }

  if (config.DREAMDEX_INDEXER_URL === undefined) {
    throw new Error('live mode needs DREAMDEX_INDEXER_URL; see docs/DREAMDEX_ADAPTER.md U19');
  }

  const writer =
    config.GUARD_SIGNER_KEY === undefined
      ? undefined
      : new SomniaWriter({
          indexerUrl: config.DREAMDEX_INDEXER_URL,
          wsRpcUrl: config.SOMNIA_WS_RPC_URL,
          privateKey: config.GUARD_SIGNER_KEY as `0x${string}`,
          orderTtlMs: config.GUARD_ORDER_TTL_MS,
        });

  return {
    adapter: new LiveAdapter({
      indexerUrl: config.DREAMDEX_INDEXER_URL,
      ...(writer && { writer }),
    }),
    description:
      writer === undefined
        ? 'live, read-only (no GUARD_SIGNER_KEY: orders are evaluated and logged, never sent)'
        : 'live, with a signer (orders that pass policy reach the venue)',
  };
}
