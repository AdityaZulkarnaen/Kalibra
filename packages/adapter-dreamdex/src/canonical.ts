import { z } from 'zod';

/**
 * The canonical types of DREAMDEX_ADAPTER.md section 3, with a Zod schema for each.
 *
 * Types are inferred from the schemas rather than declared alongside them, so the runtime
 * contract and the compile-time contract cannot drift apart. Invariant I4: every value
 * crossing this boundary is parsed, never cast.
 *
 * Two schemas exist per type. The plain one is the in-memory contract, where money is a
 * bigint. The `...Json` one parses the wire and file form, where a bigint is a decimal
 * string (API_SPEC.md section 2.1), and pipes the result through the plain one so shape
 * and invariants are both enforced.
 */

/** ms since epoch, UTC. DREAMDEX_ADAPTER.md 4.4. */
const timestamp = z.number().int().nonnegative();

/** Lowercase, 0x-prefixed, never checksummed. DREAMDEX_ADAPTER.md 4.3. */
const address = z.string().regex(/^0x[0-9a-f]{40}$/, 'expected a lowercase 0x EVM address');

/** DREAMDEX_ADAPTER.md 4.2: always P(UP). */
const probability = z.number().min(0).max(1);

const decimals = z.number().int().min(0).max(36);

const txHash = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, 'expected a lowercase 0x transaction hash')
  .nullable();

const bigintString = z
  .string()
  .regex(/^-?\d+$/, 'expected a decimal integer string')
  .transform((value) => BigInt(value));

export const sideSchema = z.enum(['UP', 'DOWN']);
export const quoteSourceSchema = z.enum(['MID', 'LAST']);
export const marketStatusSchema = z.enum(['OPEN', 'CLOSED', 'SETTLED', 'VOID']);
export const outcomeSchema = z.enum(['UP', 'DOWN', 'VOID']);

export type CanonicalSide = z.infer<typeof sideSchema>;
export type CanonicalQuoteSource = z.infer<typeof quoteSourceSchema>;
export type CanonicalMarketStatus = z.infer<typeof marketStatusSchema>;
export type CanonicalOutcome = z.infer<typeof outcomeSchema>;

export const canonicalMarketSchema = z
  .object({
    marketId: z.string().min(1),
    underlying: z.string().min(1),
    windowStart: timestamp,
    windowEnd: timestamp,
    /** Null where the venue defines UP as "above the window-open price" — see U9. */
    strike: z.bigint().nullable(),
    strikeDecimals: decimals,
    status: marketStatusSchema,
  })
  .refine((m) => m.windowEnd > m.windowStart, {
    message: 'windowEnd must be after windowStart',
    path: ['windowEnd'],
  });

export const canonicalTradeSchema = z.object({
  tradeId: z.string().min(1),
  marketId: z.string().min(1),
  wallet: address,
  side: sideSchema,
  impliedProbUp: probability,
  quoteSource: quoteSourceSchema,
  stake: z.bigint().nonnegative(),
  stakeDecimals: decimals,
  timestamp,
  txHash,
});

export const canonicalSettlementSchema = z.object({
  marketId: z.string().min(1),
  outcome: outcomeSchema,
  settlementLevel: z.bigint().nullable(),
  settledAt: timestamp,
  txHash,
});

export const canonicalQuoteSchema = z.object({
  marketId: z.string().min(1),
  bestBidUp: probability.nullable(),
  bestAskUp: probability.nullable(),
  midUp: probability.nullable(),
  lastUp: probability.nullable(),
  timestamp,
});

export const canonicalOrderSchema = z.object({
  marketId: z.string().min(1),
  side: sideSchema,
  stake: z.bigint().positive(),
  limitProb: probability.nullable(),
  clientOrderId: z.string().min(1),
});

export const canonicalOrderResultSchema = z.object({
  accepted: z.boolean(),
  venueOrderId: z.string().nullable(),
  txHash,
  /** The venue's own text, verbatim. Never parsed for control flow. */
  rejectReason: z.string().nullable(),
});

export type CanonicalMarket = z.infer<typeof canonicalMarketSchema>;
export type CanonicalTrade = z.infer<typeof canonicalTradeSchema>;
export type CanonicalSettlement = z.infer<typeof canonicalSettlementSchema>;
export type CanonicalQuote = z.infer<typeof canonicalQuoteSchema>;
export type CanonicalOrder = z.infer<typeof canonicalOrderSchema>;
export type CanonicalOrderResult = z.infer<typeof canonicalOrderResultSchema>;

export const canonicalMarketJson = z
  .object({
    marketId: z.string(),
    underlying: z.string(),
    windowStart: timestamp,
    windowEnd: timestamp,
    strike: bigintString.nullable(),
    strikeDecimals: decimals,
    status: marketStatusSchema,
  })
  .pipe(canonicalMarketSchema);

export const canonicalTradeJson = z
  .object({
    tradeId: z.string(),
    marketId: z.string(),
    wallet: z.string(),
    side: sideSchema,
    impliedProbUp: probability,
    quoteSource: quoteSourceSchema,
    stake: bigintString,
    stakeDecimals: decimals,
    timestamp,
    txHash,
  })
  .pipe(canonicalTradeSchema);

export const canonicalSettlementJson = z
  .object({
    marketId: z.string(),
    outcome: outcomeSchema,
    settlementLevel: bigintString.nullable(),
    settledAt: timestamp,
    txHash,
  })
  .pipe(canonicalSettlementSchema);

/** Inverse of the `...Json` schemas, for writing fixtures. Bigints become strings. */
export function toJsonValue<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonValue(v)]),
    );
  }
  return value;
}
