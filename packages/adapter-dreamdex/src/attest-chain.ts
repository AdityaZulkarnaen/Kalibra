import type { SomniaMarketsClient } from '@somnia-chain/markets-sdk';

import type { VenueMarket } from './venue.js';

/**
 * The two evidence layers that come from the chain and the oracle rather than from the
 * indexer's own labels. Keeping them here means the attestation can read them without
 * knowing how the SDK client is built.
 */

export interface ChainEvidence {
  readonly isResolved: boolean;
  readonly isVoided: boolean;
  /** 0 = YES, 1 = NO. Only meaningful when `isResolved`. */
  readonly winningOutcome: number;
  readonly outcomeToken: string;
  readonly yesId: string;
  readonly noId: string;
  readonly status: number;
}

export interface OracleEvidence {
  readonly opening: string | null;
  readonly closing: string | null;
  /** Null when the comparison cannot be made on one scale. See the note below. */
  readonly direction: 'UP' | 'DOWN' | null;
}

/** Read through the module registry, so the indexer does not supply its own alibi. */
export async function readChainEvidence(
  client: SomniaMarketsClient,
  marketId: string,
): Promise<ChainEvidence> {
  const onchain = await client.getMarketOnchain(marketId as `0x${string}`);
  return {
    isResolved: onchain.isResolved,
    isVoided: onchain.isVoided,
    winningOutcome: onchain.winningOutcome,
    outcomeToken: onchain.outcomeToken,
    yesId: onchain.yesId.toString(),
    noId: onchain.noId.toString(),
    status: onchain.status,
  };
}

/**
 * The oracle's two numbers, reproducing the comparison the contract settled on: "closes at
 * or above its opening price, Up wins", inclusive on the Up side.
 *
 * A direction is claimed only for a reference-mode market, where both numbers answer the
 * same oracle question and are therefore on one scale. On a fixed-strike market the closing
 * answer would have to be compared against `Market.strike`, whose scale is unconfirmed
 * (U22), and an unconfirmed scale is not a basis for asserting which side won.
 */
export async function readOracleEvidence(
  client: SomniaMarketsClient,
  marketId: string,
  market: VenueMarket,
): Promise<OracleEvidence> {
  const resolution = await client.getMarketResolution(marketId);
  const opening = resolution.openingAnswer?.numericValue ?? null;
  const closing = resolution.closingAnswer?.numericValue ?? null;

  const referenceMode = market.strike === null || market.strike === '0';
  if (!referenceMode || opening === null || closing === null) {
    return { opening, closing, direction: null };
  }
  return { opening, closing, direction: BigInt(closing) >= BigInt(opening) ? 'UP' : 'DOWN' };
}

export interface OutcomeHoldings {
  readonly yes: bigint;
  readonly no: bigint;
}

/**
 * ERC-6909 balances at the market's two outcome ids. This is the only layer that links a
 * side on the tape to the token the payout vector pays; the others all speak in outcome
 * indices and never touch a wallet.
 */
export async function readHoldings(
  client: SomniaMarketsClient,
  chain: ChainEvidence,
  wallet: string,
): Promise<OutcomeHoldings> {
  const token = chain.outcomeToken as `0x${string}`;
  const account = wallet as `0x${string}`;
  const [yes, no] = await Promise.all([
    client.getOutcomeBalance({ outcomeToken: token, account, id: BigInt(chain.yesId) }),
    client.getOutcomeBalance({ outcomeToken: token, account, id: BigInt(chain.noId) }),
  ]);
  return { yes, no };
}
