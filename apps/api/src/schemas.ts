import { z } from 'zod';

/**
 * The public contract of API_SPEC.md section 2, as Zod schemas.
 *
 * Responses are validated against these before they are sent when `validateResponses` is
 * on, and the committed example payloads in the specification are parsed by them in
 * `server.test.ts`. That is what keeps the document and the implementation from drifting:
 * if one changes without the other, a test fails.
 */

const wallet = z.string().regex(/^0x[0-9a-f]{40}$/, 'wallet must be a lowercase 0x address');
const probability = z.number().min(0).max(1);
const bigintString = z.string().regex(/^\d+$/, 'bigints cross the boundary as decimal strings');
const timestamp = z.number().int().nonnegative();
const status = z.enum(['RANKED', 'PROVISIONAL']);

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(['NOT_FOUND', 'BAD_REQUEST', 'INTERNAL']),
    message: z.string(),
  }),
});

export const paramsSchema = z.object({
  lambdaMax: z.number(),
  shrinkK: z.number(),
  minSample: z.number(),
  paramsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});

export const leaderboardSchema = z.object({
  params: paramsSchema,
  total: z.number().int().nonnegative(),
  entries: z.array(
    z.object({
      rank: z.number().int().positive(),
      wallet,
      score: z.number().int().nullable(),
      status,
      n: z.number().int().nonnegative(),
      bss: z.number().nullable(),
      eceExcess: z.number().nullable(),
      auc: z.number().nullable(),
      isAgent: z.boolean(),
      agentName: z.string().nullable(),
    }),
  ),
});

export const calibrationBinSchema = z.object({
  bin: z.number().int().min(0).max(9),
  range: z.tuple([probability, probability]),
  count: z.number().int().nonnegative(),
  meanForecast: probability.nullable(),
  observedFreq: probability.nullable(),
});

/**
 * Variants used only to check the example payloads in API_SPEC.md.
 *
 * The document elides addresses and hashes for readability — `"0xabc..."`, `"0x..."` — and
 * abridges the ten-bin calibration array to a couple of rows. Those two relaxations are the
 * only difference from the strict schemas, which is what the server is actually validated
 * against, so the contract test still catches a renamed or retyped field.
 */
const elided = z.string();

export const leaderboardExampleSchema = z.lazy(() =>
  leaderboardSchema.omit({ params: true, entries: true }).extend({
    params: paramsSchema.omit({ paramsHash: true }).extend({ paramsHash: elided }),
    entries: z.array(
      leaderboardSchema.shape.entries.element.omit({ wallet: true }).extend({ wallet: elided }),
    ),
  }),
);

export const walletExampleSchema = z.lazy(() =>
  walletSchema.omit({ calibration: true, wallet: true, paramsHash: true }).extend({
    calibration: z.array(calibrationBinSchema),
    wallet: elided,
    paramsHash: elided,
  }),
);

export const walletSchema = z.object({
  wallet,
  score: z.number().int().nullable(),
  status,
  n: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  stats: z.object({
    bsTrader: z.number().nullable(),
    bsMarket: z.number().nullable(),
    bss: z.number().nullable(),
    bssShrunk: z.number().nullable(),
    eceTrader: z.number().nullable(),
    eceMarket: z.number().nullable(),
    eceExcess: z.number().nullable(),
    auc: z.number().nullable(),
  }),
  /** Always ten, empty bins included, so the chart renders gaps rather than interpolating. */
  calibration: z.array(calibrationBinSchema).length(10),
  agent: z
    .object({ agentId: z.string(), name: z.string(), method: z.string().nullable() })
    .nullable(),
  paramsHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  computedAt: timestamp,
});

export const walletPositionsSchema = z.object({
  total: z.number().int().nonnegative(),
  positions: z.array(
    z.object({
      positionId: z.string(),
      marketId: z.string(),
      underlying: z.string(),
      side: z.enum(['UP', 'DOWN']),
      netStake: bigintString,
      stakeDecimals: z.number().int().nonnegative().nullable(),
      p: probability,
      lambda: z.number().nullable(),
      forecast: probability.nullable(),
      outcomeY: z.union([z.literal(0), z.literal(1)]).nullable(),
      brierContribution: z.number().nullable(),
      marketBrierContribution: z.number().nullable(),
      excludedReason: z.string().nullable(),
      settledAt: timestamp.nullable(),
    }),
  ),
});

export const marketsSchema = z.object({
  markets: z.array(
    z.object({
      marketId: z.string(),
      underlying: z.string(),
      windowStart: timestamp,
      windowEnd: timestamp,
      status: z.enum(['OPEN', 'CLOSED', 'SETTLED', 'VOID']),
      outcome: z.enum(['UP', 'DOWN', 'VOID']).nullable(),
      tradeCount: z.number().int().nonnegative(),
      uniqueWallets: z.number().int().nonnegative(),
      /**
       * PRD.md R10, the market efficiency panel, is on the cut list in BUILD_PLAN.md.
       * Null until it is built — an unbuilt number is not reported as zero.
       */
      marketEce: z.number().nullable(),
    }),
  ),
});

/** Pagination, shared by every list endpoint. API_SPEC.md section 2.1. */
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
