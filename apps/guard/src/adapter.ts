import {
  LiveAdapter,
  ReplayAdapter,
  SomniaWriter,
  addressForKey,
  type DreamDexAdapter,
} from '@kalibra/adapter-dreamdex';

import { parseAgentKeys, parseAgentWallets, type GuardConfig } from './config.js';

/**
 * Which venue Guard forwards to, whether it can write to it, and on whose behalf.
 *
 * The signing keys live here rather than anywhere an agent can reach, which is the whole
 * basis of the claim that an agent cannot touch the venue except through Guard. Without key
 * custody that claim is decoration: an agent holding its own key calls the venue directly and
 * every rule in the policy engine becomes advisory.
 *
 * One key per agent, because each agent trades from its own wallet. Sharing one would put
 * every agent's fills on a single address, and Arena would rank one trader three times.
 */

export interface ResolvedVenue {
  /** Reads — quotes and market facts. Shared, and needs no signer. */
  readonly adapter: DreamDexAdapter;
  /** Writes — the adapter that signs as this agent, when Guard holds its key. */
  readonly adapterFor: (agentId: string) => DreamDexAdapter;
  /** agentId to the wallet its fills are attributed to, derived from the key where there is one. */
  readonly wallets: ReadonlyMap<string, string>;
  /** Printed at startup, so an operator can see whether this process can spend. */
  readonly description: string;
  /** False when the venue keeps its own tape, which the indexer ingests instead. */
  readonly recordFills: boolean;
}

export async function resolveVenue(config: GuardConfig): Promise<ResolvedVenue> {
  const declared = parseAgentWallets(config.GUARD_AGENT_WALLETS);

  if (config.KALIBRA_MODE !== 'live') {
    const adapter = await ReplayAdapter.fromDirectory('./fixtures/synthetic');
    return {
      adapter,
      adapterFor: () => adapter,
      wallets: declared,
      description: 'replay (committed fixtures, no network, cannot write)',
      // A replay has no tape of its own, so a forwarded order is the only record there is.
      recordFills: true,
    };
  }

  if (config.DREAMDEX_INDEXER_URL === undefined) {
    throw new Error('live mode needs DREAMDEX_INDEXER_URL; see docs/DREAMDEX_ADAPTER.md U19');
  }
  const indexerUrl = config.DREAMDEX_INDEXER_URL;

  // Reads first, and with no signer at all: the venue's read surface is permissionless
  // (U20), and a read path should not be able to spend.
  const reader = new LiveAdapter({ indexerUrl });

  const keys = parseAgentKeys(config.GUARD_AGENT_KEYS);
  const signers = new Map<string, DreamDexAdapter>();
  const wallets = new Map<string, string>(declared);

  for (const [agentId, privateKey] of keys) {
    const writer = new SomniaWriter({
      indexerUrl,
      wsRpcUrl: config.SOMNIA_WS_RPC_URL,
      privateKey,
      orderTtlMs: config.GUARD_ORDER_TTL_MS,
    });
    signers.set(agentId, new LiveAdapter({ indexerUrl, writer }));
    // Derived, never restated: an address written by hand beside its key can disagree with
    // it, and the failure is silent — fills attributed to a wallet that never traded.
    wallets.set(agentId, await addressForKey(privateKey));
  }

  return {
    adapter: reader,
    // An agent Guard holds no key for still passes through the policy engine and the audit
    // log; it simply meets an adapter that refuses to write, rather than one that pretends.
    adapterFor: (agentId) => signers.get(agentId) ?? reader,
    wallets,
    description:
      signers.size === 0
        ? 'live, read-only (no GUARD_AGENT_KEYS: orders are evaluated and logged, never sent)'
        : `live, signing for ${signers.size} agent${signers.size === 1 ? '' : 's'}`,
    // The venue's own tape records what filled. Writing the order here as well would put
    // intent and fill in the same wallet and market, and aggregation would net them.
    recordFills: false,
  };
}
