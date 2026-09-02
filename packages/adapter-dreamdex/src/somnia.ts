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
 * Runs `body` against the SDK's native client and releases its watches afterwards, whatever
 * happens. The exchange opens a WebSocket lazily and holds it until closed, so a caller that
 * forgets leaves the process alive.
 */
export async function withSomniaClient<T>(
  config: SomniaConfig,
  body: (client: SomniaMarketsClient) => Promise<T>,
): Promise<T> {
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
  try {
    return await body(exchange.client);
  } finally {
    await exchange.close();
  }
}
