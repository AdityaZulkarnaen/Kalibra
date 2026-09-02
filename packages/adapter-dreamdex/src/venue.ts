import { z } from 'zod';

/**
 * The venue's own shapes, as captured on 1 Sep 2026 from the Shannon testnet indexer.
 * Every row that crosses the airlock is parsed by one of these (invariant I4).
 *
 * These names belong to DreamDEX and appear nowhere else in the repository. If the venue
 * renames a field, this file changes and nothing downstream does.
 */

/** The indexer sends numerics as strings. Parse to bigint, never through a float. */
const numericString = z.string().regex(/^\d+$/, 'expected a decimal numeric string');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const venueSideSchema = z.enum(['BUY_YES', 'SELL_YES', 'BUY_NO', 'SELL_NO']);

export const venueMarketSchema = z.object({
  marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  marketType: z.literal('BINARY'),
  asset: z.string().min(1),
  question: z.string().nullable().optional(),
  /** "0" means the line is the window's opening price rather than a listed level. */
  strike: numericString.nullable(),
  expiry: numericString,
  tradingStart: numericString,
  clobStatus: z.string(),
  finalized: z.boolean(),
  voided: z.boolean(),
  /** 0 is the YES outcome, 1 is NO. Null until resolution. */
  winningOutcome: z.number().int().nullable(),
  resolvedAtTimestamp: numericString.nullable(),
  /**
   * The payout vector, indexed by outcome. It says which outcome pays without reference to
   * `winningOutcome`, which makes it an independent check on that label rather than a
   * restatement of it. Absent until the market resolves.
   */
  payoutNumerators: z.array(numericString).nullable(),
  payoutDenominator: numericString.nullable(),
  poolAddress: address,
  /**
   * Event-contract identity, and the answer to G0.2. A binary market carries an oracle
   * question and a pair of ERC-6909 outcome ids; a spot market has none of the three.
   * Nullable because absence is a fact worth reading, not a parse failure.
   */
  oracleQuestionId: z.string().nullable(),
  yesTokenId: numericString.nullable(),
  noTokenId: numericString.nullable(),
  quoteDecimals: z.number().int().min(0).max(36),
});

export const venueFillSchema = z.object({
  /** Already `${blockNumber}_${logIndex}` — a natural idempotency key. */
  id: z.string().min(1),
  blockNumber: numericString,
  logIndex: z.number().int().nonnegative(),
  timestamp: numericString,
  txHash: hash.nullable(),
  market_id: z.string().min(1),
  maker: address,
  taker: address,
  makerSide: venueSideSchema.nullable(),
  takerSide: venueSideSchema.nullable(),
  /**
   * The crossing path. `DIRECT_YES` and `MINT_A_PAIR` are captured; the documentation
   * names two more and neither has been seen. Deliberately a string rather than an enum:
   * an unobserved path must not reject an otherwise valid row (CLAUDE.md §1). Both legs
   * carry their own side whatever the path, which is what closes U21.
   */
  kind: z.string().nullable(),
  fillPrice: numericString,
  quantity: numericString,
  /** The collateral that changed hands: quantity times price, in quote base units. */
  quoteQuantity: numericString,
});

export const venueOrderSchema = z.object({
  orderId: z.string().min(1),
  owner: address,
  side: venueSideSchema,
  price: numericString,
  quantityRemaining: numericString,
  rested: z.boolean(),
  placedAtBlock: numericString,
  lastUpdatedAtBlock: numericString,
});

export type VenueMarket = z.infer<typeof venueMarketSchema>;
export type VenueFill = z.infer<typeof venueFillSchema>;
export type VenueOrder = z.infer<typeof venueOrderSchema>;

/** The indexer wraps every result in GraphQL's envelope and throws rather than 404s. */
export const graphqlEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data: data.optional(),
    errors: z.array(z.object({ message: z.string() })).optional(),
  });

export const marketsResponse = graphqlEnvelope(z.object({ Market: z.array(venueMarketSchema) }));
export const fillsResponse = graphqlEnvelope(z.object({ Fill: z.array(venueFillSchema) }));
export const ordersResponse = graphqlEnvelope(z.object({ Order: z.array(venueOrderSchema) }));

export const MARKET_FIELDS = `marketId marketType asset question strike expiry tradingStart
  clobStatus finalized voided winningOutcome resolvedAtTimestamp poolAddress quoteDecimals
  oracleQuestionId yesTokenId noTokenId payoutNumerators payoutDenominator`;

export const FILL_FIELDS = `id blockNumber logIndex timestamp txHash market_id maker taker
  makerSide takerSide kind fillPrice quantity quoteQuantity`;

export const ORDER_FIELDS = `orderId owner side price quantityRemaining rested placedAtBlock
  lastUpdatedAtBlock`;
