import type { SomniaMarketsClient } from '@somnia-chain/markets-sdk';

/**
 * The bridge to the venue's own SDK, and the only place it is loaded.
 *
 * Every value import here is dynamic. That is not style: `@somnia-chain/markets-sdk` pulls
 * in viem and opens a WebSocket, and invariant I3 requires `pnpm demo` to run with no network
 * and no credentials. A static import would put both on the offline path the moment anything
 * in this package were imported, which is every run. Loading it lazily means the offline path
 * never touches it, and the cost is paid only by code that is already reaching the chain.
 */

/**
 * Protocol addresses, deployed via CREATE3 and therefore identical on Shannon and mainnet.
 * Transcribed from the venue documentation captured in
 * `fixtures/recorded/docs-snapshot-2026-09-01/developers_event-contracts_contracts-and-addresses.md`.
 * Per-market addresses are deliberately absent: pools are recycled across windows, so they
 * are read per market and never remembered.
 */
export const SOMNIA_ADDRESSES = {
  binaryModule: '0x3ecC694Cef705358864a646142ac17A90E29e388',
  marketsCore: '0x2802504314685D89bF6C992CA5a8e7cC78bc0294',
  binarySettlement: '0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23',
  /** Shannon collateral, tUSDC at six decimals. Mainnet USDso is 18 and out of scope. */
  collateral: '0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E',
} as const;

export interface SomniaConfig {
  readonly indexerUrl: string;
  /** Optional override; the SDK's Shannon definition already carries a WebSocket endpoint. */
  readonly wsRpcUrl?: string | undefined;
  /**
   * Only writes need one. A read path that never signs should not be able to, so this is
   * threaded through rather than read from the environment here.
   */
  readonly privateKey?: `0x${string}` | undefined;
}

/**
 * A client held open across many reads.
 *
 * The exchange opens one WebSocket and keeps it. Opening and closing a client per read looks
 * tidier and does not survive contact with a loop: an agent reading six markets every
 * forty-five seconds churned a connection per market and the venue started refusing them —
 * "WebSocket request failed" on every touch, which reads as the venue being down rather than
 * as this process opening far too many sockets.
 *
 * The caller owns the lifetime and must `close()`, or the process will not exit.
 */
export interface SomniaSession {
  readonly client: SomniaMarketsClient;
  close(): Promise<void>;
}

export async function openSomniaSession(config: SomniaConfig): Promise<SomniaSession> {
  const [{ SomniaMarkets }, { somniaShannon }] = await Promise.all([
    import('@somnia-chain/markets-sdk'),
    import('@somnia-chain/markets-sdk/chains'),
  ]);
  const exchange = new SomniaMarkets({
    indexerUrl: config.indexerUrl,
    chain: somniaShannon,
    ...(config.wsRpcUrl === undefined ? {} : { wsRpcUrl: config.wsRpcUrl }),
    ...(config.privateKey === undefined ? {} : { privateKey: config.privateKey }),
    addresses: {
      binaryModule: SOMNIA_ADDRESSES.binaryModule,
      marketsCore: SOMNIA_ADDRESSES.marketsCore,
      binarySettlement: SOMNIA_ADDRESSES.binarySettlement,
      collateral: SOMNIA_ADDRESSES.collateral,
    },
  });
  return { client: exchange.client, close: () => exchange.close() };
}

/**
 * Runs `body` against a client opened for this call alone. For a script that reads once; a
 * loop should hold a {@link SomniaSession} instead.
 */
export async function withSomniaClient<T>(
  config: SomniaConfig,
  body: (client: SomniaMarketsClient) => Promise<T>,
): Promise<T> {
  const session = await openSomniaSession(config);
  try {
    return await body(session.client);
  } finally {
    await session.close();
  }
}
