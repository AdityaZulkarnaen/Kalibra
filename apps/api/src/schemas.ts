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

/**
 * Arena. `API_SPEC.md` §2: the leaderboard filtered to registered agents, the same shape
 * plus each agent's `method`.
 *
 * The entry schema is derived from `leaderboardSchema` rather than restated, so a field
 * added to one cannot silently go missing from the other.
 */
export const arenaSchema = z.object({
  params: paramsSchema,
  total: z.number().int().nonnegative(),
  entries: z.array(
    leaderboardSchema.shape.entries.element.extend({
      agentId: z.string().min(1),
      method: z.string().nullable(),
      registeredAt: timestamp,
    }),
  ),
});

/**
 * The registration request. `agentId` is not in the body: it is derived from the name, so
 * that a caller cannot claim an identifier that does not match what is displayed.
 */
export const registerRequestSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'wallet must be a 0x EVM address'),
  name: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[\p{L}\p{N} ._-]+$/u, 'name may hold letters, digits, spaces, dot, underscore, dash'),
  description: z.string().trim().max(500).nullish(),
  method: z.string().trim().max(1000).nullish(),
});

/** The document elides the address, as it does elsewhere. See `elided` above. */
export const registerRequestExampleSchema = z.lazy(() =>
  registerRequestSchema.omit({ wallet: true }).extend({ wallet: elided }),
);

export const registeredAgentSchema = z.object({
  agentId: z.string().min(1),
  wallet,
  name: z.string(),
  description: z.string().nullable(),
  method: z.string().nullable(),
  registeredAt: timestamp,
});

export const statsSchema = z.object({
  totalWallets: z.number().int().nonnegative(),
  rankedWallets: z.number().int().nonnegative(),
  positionsScored: z.number().int().nonnegative(),
  marketsSettled: z.number().int().nonnegative(),
  /** Null until an ingest has recorded which mode produced these rows. */
  mode: z.enum(['replay', 'live']).nullable(),
  lastIngestedAt: timestamp.nullable(),
  paramsHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  /**
   * `ARCHITECTURE.md` §7 specifies counting rejected upstream payloads and continuing.
   * The adapters currently throw on a malformed payload instead, so there is no counter to
   * report — and a zero here would read as "ingestion is clean" rather than "nobody is
   * counting". Null until that path exists.
   */
  rejectedPayloads: z.number().int().nonnegative().nullable(),
});

/** Pagination, shared by every list endpoint. API_SPEC.md section 2.1. */
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
