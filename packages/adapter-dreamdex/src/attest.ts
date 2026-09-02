import {
  readChainEvidence,
  readHoldings,
  readOracleEvidence,
  type ChainEvidence,
  type OracleEvidence,
  type OutcomeHoldings,
} from './attest-chain.js';
import { queryFills, queryMarket } from './attest-queries.js';
import type { VenueSide } from './book.js';
import type { CanonicalSide } from './canonical.js';
import { toCanonicalSettlement, toCanonicalSide, type FetchLike } from './live.js';
import { withSomniaClient } from './somnia.js';
import type { VenueFill } from './venue.js';

/**
 * G0.1. Proves that the side stored against a trade is the side that actually won money,
 * not merely the side the venue's own label says won.
 *
 * This exists because an inverted UP/DOWN mapping is the one defect in this system that
 * produces entirely plausible output: every score flips, nothing throws, and no number looks
 * wrong. Checking it against the indexer's `winningOutcome` would be circular — that is the
 * field the adapter already trusts. So four sources that do not depend on each other are
 * read and reconciled:
 *
 *   A. the oracle's opening and closing numbers, reproducing the comparison the contract
 *      settled on;
 *   B. the payout vector, which names the paying outcome index without naming a direction;
 *   C. the chain's resolved state, read through the module registry;
 *   D. an ERC-6909 balance, the only source that links "bought YES on the tape" to "holds
 *      the token the payout vector pays".
 *
 * A, B and C establish which outcome index won. D carries that back to a side on the tape,
 * and it is also the layer that can legitimately be unobservable — a winner who has already
 * redeemed holds nothing. That is reported as unobserved, never passed silently.
 */

export interface AttestLeg {
  readonly tradeId: string;
  readonly wallet: string;
  readonly venueSide: VenueSide;
  /** The crossing path, so a mint-a-pair leg can be told from a direct one. */
  readonly kind: string | null;
  readonly canonicalSide: CanonicalSide;
  readonly stake: bigint;
  /**
   * Balances at the market's outcome ids, read only for wallets that took one side here.
   * A wallet that took both holds both tokens and proves nothing. Null means not read.
   */
  readonly yesBalance: bigint | null;
  readonly noBalance: bigint | null;
  /** Whether this leg's canonical side is the direction the evidence says won. */
  readonly won: boolean | null;
}

export interface PayoutEvidence {
  readonly numerators: readonly string[] | null;
  readonly denominator: string | null;
  readonly payingIndex: number | null;
}

export interface SideAttestation {
  readonly marketId: string;
  readonly underlying: string;
  readonly question: string | null;
  readonly strike: string | null;
  /** What this repository's own adapter concluded from the same market row. */
  readonly adapterOutcome: 'UP' | 'DOWN' | 'VOID' | null;
  readonly oracle: OracleEvidence;
  readonly payout: PayoutEvidence;
  readonly chain: ChainEvidence;
  readonly legs: readonly AttestLeg[];
  readonly agrees: boolean;
  readonly disagreements: readonly string[];
  /** Layers that could not be read at all, so a pass is never mistaken for a full check. */
  readonly unobserved: readonly string[];
}

export interface AttestConfig {
  readonly indexerUrl: string;
  /** Optional override; the SDK's Shannon definition already carries a WebSocket endpoint. */
  readonly wsRpcUrl?: string | undefined;
  readonly fetch?: FetchLike;
}

export async function attestSideAttribution(
  config: AttestConfig,
  marketId: string,
): Promise<SideAttestation> {
  const doFetch = config.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const [market, fills] = await Promise.all([
    queryMarket(doFetch, config.indexerUrl, marketId),
    queryFills(doFetch, config.indexerUrl, marketId),
  ]);

  const bare = fills.flatMap(toLegs);
  const { chain, oracle, holdings } = await withSomniaClient(config, async (client) => {
    const chainEvidence = await readChainEvidence(client, marketId);
    const oracleEvidence = await readOracleEvidence(client, marketId, market);
    const read = new Map<string, OutcomeHoldings>();
    for (const wallet of oneSidedWallets(bare)) {
      read.set(wallet, await readHoldings(client, chainEvidence, wallet));
    }
    return { chain: chainEvidence, oracle: oracleEvidence, holdings: read };
  });

  const adapterOutcome = toCanonicalSettlement(market)?.outcome ?? null;
  const payout = payingIndex(market.payoutNumerators, market.payoutDenominator);
  const legs = bare.map((leg) => withHoldings(leg, holdings.get(leg.wallet), oracle.direction));
  const disagreements = [
    ...reconcileOutcome({ adapterOutcome, oracle, payout, chain }),
    ...reconcileLegs(legs),
  ];

  return {
    marketId: market.marketId.toLowerCase(),
    underlying: market.asset.toUpperCase(),
    question: market.question ?? null,
    strike: market.strike,
    adapterOutcome,
    oracle,
    payout,
    chain,
    legs,
    agrees: disagreements.length === 0,
    disagreements,
    unobserved: unobservedLayers(oracle, payout, legs),
  };
}

const withHoldings = (
  leg: BareLeg,
  held: OutcomeHoldings | undefined,
  direction: 'UP' | 'DOWN' | null,
): AttestLeg => ({
  ...leg,
  yesBalance: held?.yes ?? null,
  noBalance: held?.no ?? null,
  won: direction === null ? null : leg.canonicalSide === direction,
});

/**
 * The payout vector names an index, never a direction. Reading it separately from
 * `winningOutcome` is the point: if the two ever disagreed, trusting either alone would be
 * exactly the failure this function exists to catch.
 */
export function payingIndex(
  numerators: readonly string[] | null,
  denominator: string | null,
): PayoutEvidence {
  if (numerators === null || numerators.length === 0) {
    return { numerators, denominator, payingIndex: null };
  }
  const paying = numerators
    .map((value, index) => ({ value: BigInt(value), index }))
    .filter((entry) => entry.value > 0n);
  const only = paying.length === 1 ? paying[0] : undefined;
  // A voided market pays both sides, so there is no single winner to name.
  return { numerators, denominator, payingIndex: only?.index ?? null };
}

const asDirection = (index: number | null): 'UP' | 'DOWN' | null =>
  index === null ? null : index === 0 ? 'UP' : 'DOWN';

interface OutcomeInputs {
  readonly adapterOutcome: 'UP' | 'DOWN' | 'VOID' | null;
  readonly oracle: OracleEvidence;
  readonly payout: PayoutEvidence;
  readonly chain: ChainEvidence;
}

function reconcileOutcome(inputs: OutcomeInputs): string[] {
  const { adapterOutcome, oracle, payout, chain } = inputs;
  const found: string[] = [];

  if (chain.isVoided !== (adapterOutcome === 'VOID')) {
    found.push(`chain isVoided=${chain.isVoided} but the adapter said ${adapterOutcome}`);
  }
  if (chain.isVoided) return found;

  if (payout.payingIndex !== null && chain.isResolved) {
    if (payout.payingIndex !== chain.winningOutcome) {
      found.push(
        `the payout vector pays index ${payout.payingIndex} but the chain reports ` +
          `winningOutcome=${chain.winningOutcome}`,
      );
    }
  }

  const layers = [
    ['oracle', oracle.direction],
    ['payout vector', asDirection(payout.payingIndex)],
    ['chain', chain.isResolved ? asDirection(chain.winningOutcome) : null],
  ] as const;
  for (const [label, value] of layers) {
    if (value !== null && adapterOutcome !== null && value !== adapterOutcome) {
      found.push(`${label} says ${value} won but the adapter stored ${adapterOutcome}`);
    }
  }
  return found;
}

/**
 * The tape-to-token link. A wallet the tape records as UP must hold the YES id and not the
 * NO id. Zero on both sides is a redeemed or closed position, which is unobserved rather
 * than a failure — see `unobservedLayers`.
 */
function reconcileLegs(legs: readonly AttestLeg[]): string[] {
  const found: string[] = [];
  for (const leg of legs) {
    if (leg.yesBalance === null || leg.noBalance === null) continue;
    if (leg.yesBalance === 0n && leg.noBalance === 0n) continue;
    const held = leg.yesBalance > 0n ? 'UP' : 'DOWN';
    if (held !== leg.canonicalSide) {
      found.push(
        `${leg.tradeId} traded ${leg.venueSide} (stored ${leg.canonicalSide}) but holds ` +
          `yes=${leg.yesBalance} no=${leg.noBalance}, which is a ${held} position`,
      );
    }
  }
  return found;
}

function unobservedLayers(
  oracle: OracleEvidence,
  payout: PayoutEvidence,
  legs: readonly AttestLeg[],
): string[] {
  const missing: string[] = [];
  if (oracle.direction === null) missing.push('oracle direction');
  if (payout.payingIndex === null) missing.push('payout vector');
  const observed = legs.some(
    (leg) =>
      leg.yesBalance !== null &&
      leg.noBalance !== null &&
      (leg.yesBalance > 0n || leg.noBalance > 0n),
  );
  if (!observed) missing.push('outcome-token holdings (every traced wallet holds nothing)');
  return missing;
}

/** Wallets that took exactly one side here. A wallet on both holds both and proves nothing. */
function oneSidedWallets(
  legs: ReadonlyArray<{ wallet: string; canonicalSide: CanonicalSide }>,
): string[] {
  const bySide = new Map<string, Set<CanonicalSide>>();
  for (const leg of legs) {
    const seen = bySide.get(leg.wallet) ?? new Set<CanonicalSide>();
    seen.add(leg.canonicalSide);
    bySide.set(leg.wallet, seen);
  }
  return [...bySide].filter(([, sides]) => sides.size === 1).map(([wallet]) => wallet);
}

type BareLeg = Omit<AttestLeg, 'yesBalance' | 'noBalance' | 'won'>;

function toLegs(fill: VenueFill): BareLeg[] {
  const quantity = BigInt(fill.quantity);
  const quoteQuantity = BigInt(fill.quoteQuantity);
  const sides = [
    { suffix: 'taker', wallet: fill.taker, side: fill.takerSide },
    { suffix: 'maker', wallet: fill.maker, side: fill.makerSide },
  ];
  return sides.flatMap(({ suffix, wallet, side }) => {
    if (side === null) return [];
    const canonicalSide = toCanonicalSide(side);
    return [
      {
        tradeId: `${fill.id}:${suffix}`,
        wallet: wallet.toLowerCase(),
        venueSide: side,
        kind: fill.kind,
        canonicalSide,
        // Mirrors LiveAdapter exactly: UP risks the premium, DOWN risks the complement.
        stake: canonicalSide === 'UP' ? quoteQuantity : quantity - quoteQuantity,
      },
    ];
  });
}
