import { arenaSchema, walletSchema } from '@kalibra/api/schemas';
import { z } from 'zod';

/**
 * The MCP server's two upstreams: Guard, and the public read API.
 *
 * It holds no database handle, no signing key and no venue adapter. Everything an MCP tool
 * can do, some other process already exposes over HTTP and already enforces — which is the
 * point. `RISK_POLICY_SPEC.md` §1 requires that both transports call the same `evaluate`;
 * the cheapest way to guarantee that is for this transport to be a client of the other one
 * rather than a second copy of Guard.
 *
 * Every response is parsed before it is returned (invariant I4). An upstream that changed
 * shape fails here, with the field named, rather than reaching an agent as `undefined`.
 */

export class UpstreamError extends Error {
  constructor(
    readonly upstream: 'guard' | 'index',
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  readonly guardUrl: string;
  readonly indexUrl: string;
  readonly fetch?: FetchLike;
}

const bigintString = z.string().regex(/^-?\d+$/, 'a bigint crosses the wire as a decimal string');
const probability = z.number().min(0).max(1).nullable();

export const permittedMarketSchema = z.object({
  marketId: z.string(),
  underlying: z.string(),
  windowStart: z.number(),
  windowEnd: z.number(),
  closesInMs: z.number(),
});

export const quoteSchema = z.object({
  marketId: z.string(),
  bestBidUp: probability,
  bestAskUp: probability,
  midUp: probability,
  lastUp: probability,
  at: z.number(),
});

export const openPositionSchema = z.object({
  marketId: z.string(),
  side: z.enum(['UP', 'DOWN']),
  stake: bigintString,
  entryProbUp: z.number(),
  markProbUp: z.number().nullable(),
  unrealisedPnl: bigintString,
  openedAt: z.number(),
});

export const decisionSchema = z.object({
  verdict: z.enum(['ALLOW', 'DENY']),
  reason: z.string().nullish(),
  severity: z.string().nullish(),
  detail: z.string().nullish(),
});

export const submitResultSchema = z.object({
  decision: decisionSchema,
  auditSeq: z.number(),
  venueOrderId: z.string().nullable(),
  txHash: z.string().nullable(),
  forwarded: z.boolean(),
  recorded: z.boolean(),
  note: z.string().nullable(),
});

export const riskStatusSchema = z.object({
  agentId: z.string(),
  policyId: z.string(),
  policyVersion: z.number(),
  killSwitch: z.boolean(),
  state: z.looseObject({
    openNotional: bigintString,
    dailyRealisedPnl: bigintString,
    dailyUnrealisedPnl: bigintString,
    ordersInWindow: z.number(),
    consecutiveLosses: z.number(),
    cooldownUntil: z.number().nullable(),
  }),
  remaining: z.object({
    notionalPerOrder: bigintString,
    openNotional: bigintString,
    dailyLoss: bigintString,
    ordersInWindow: z.number(),
  }),
});

export const orderInputSchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(['UP', 'DOWN']),
  stake: bigintString,
  limitProb: z.number().min(0).max(1).nullable(),
  clientOrderId: z.string().min(1),
  postOnly: z.boolean().optional(),
});

export type OrderInput = z.infer<typeof orderInputSchema>;

/**
 * What an MCP tool is allowed to ask of Guard, stated as a type.
 *
 * There is no method here that changes a policy, and there is no way to add one without
 * editing this interface — which is what makes "no MCP tool can mutate policy" a property
 * of the code rather than a promise in a document. Guard's operator routes need a bearer
 * token this process is never given.
 */
export interface GuardTransport {
  markets(): Promise<z.infer<typeof permittedMarketSchema>[]>;
  quote(marketId: string): Promise<z.infer<typeof quoteSchema>>;
  positions(agentId: string): Promise<z.infer<typeof openPositionSchema>[]>;
  riskStatus(agentId: string): Promise<z.infer<typeof riskStatusSchema>>;
  submit(agentId: string, order: OrderInput): Promise<z.infer<typeof submitResultSchema>>;
  policy(): Promise<unknown>;
  recentAudit(agentId: string, limit: number): Promise<unknown[]>;
}

export type ArenaBoard = z.infer<typeof arenaSchema>;
export type WalletScore = z.infer<typeof walletSchema>;

/**
 * The public read surface, for the one tool that reports a score rather than a risk.
 *
 * The Arena is how an agent id becomes a wallet address: the registry already holds that
 * mapping, and going through it means `get_my_score` answers for the identity the agent is
 * ranked under, rather than for whatever address it was separately told to report on.
 */
export interface IndexTransport {
  arena(): Promise<ArenaBoard>;
  wallet(address: string): Promise<WalletScore | null>;
}

export function httpGuard(options: HttpOptions): GuardTransport {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const url = `${options.guardUrl}${path}`;
    const doFetch = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch (cause) {
      throw new UpstreamError('guard', `${path} could not reach guard: ${describe(cause)}`);
    }
    // 403 is Guard refusing an order, which is a real answer with a reason code in it.
    if (!response.ok && response.status !== 403) {
      throw new UpstreamError('guard', `${path} returned HTTP ${response.status}`);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamError('guard', `${path} did not return JSON`);
    }
  };

  const parse = <T>(schema: z.ZodType<T>, path: string, payload: unknown): T => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new UpstreamError('guard', `${path} broke its shape: ${z.prettifyError(result.error)}`);
    }
    return result.data;
  };

  const post = (path: string, body: unknown): Promise<unknown> =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    async markets() {
      const payload = await call('/guard/markets');
      return parse(z.array(permittedMarketSchema), '/guard/markets', payload);
    },
    async quote(marketId) {
      const path = `/guard/quote/${encodeURIComponent(marketId)}`;
      return parse(quoteSchema, path, await call(path));
    },
    async positions(agentId) {
      const path = `/guard/positions/${encodeURIComponent(agentId)}`;
      return parse(z.array(openPositionSchema), path, await call(path));
    },
    async riskStatus(agentId) {
      const path = `/guard/risk/${encodeURIComponent(agentId)}`;
      return parse(riskStatusSchema, path, await call(path));
    },
    async submit(agentId, order) {
      const payload = await post('/guard/order', { agentId, order });
      return parse(submitResultSchema, '/guard/order', payload);
    },
    policy() {
      return call('/guard/policy');
    },
    async recentAudit(agentId, limit) {
      const url = `${options.guardUrl}/guard/audit/${encodeURIComponent(agentId)}`;
      const doFetch = options.fetch ?? globalThis.fetch;
      let response: Response;
      try {
        response = await doFetch(url);
      } catch (cause) {
        throw new UpstreamError('guard', `audit could not reach guard: ${describe(cause)}`);
      }
      if (!response.ok) throw new UpstreamError('guard', `audit returned HTTP ${response.status}`);
      // JSON Lines, one entry per line, newest last. The tail is what "recent" means.
      const lines = (await response.text()).split('\n').filter((line) => line.trim() !== '');
      return lines.slice(-limit).map((line) => JSON.parse(line) as unknown);
    },
  };
}

export function httpIndex(options: HttpOptions): IndexTransport {
  const call = async (path: string): Promise<unknown | null> => {
    const doFetch = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(`${options.indexUrl}${path}`, { cache: 'no-store' });
    } catch (cause) {
      throw new UpstreamError('index', `${path} could not reach the api: ${describe(cause)}`);
    }
    // A wallet with no scored positions yet is a real answer, not a failure.
    if (response.status === 404) return null;
    if (!response.ok) throw new UpstreamError('index', `${path} returned HTTP ${response.status}`);
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UpstreamError('index', `${path} did not return JSON`);
    }
  };

  const parse = <T>(schema: z.ZodType<T>, path: string, payload: unknown): T => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new UpstreamError(
        'index',
        `${path} broke its contract: ${z.prettifyError(result.error)}`,
      );
    }
    return result.data;
  };

  return {
    async arena() {
      const path = '/v1/arena?status=all&limit=200';
      return parse(arenaSchema, path, await call(path));
    },
    async wallet(address) {
      const path = `/v1/wallet/${encodeURIComponent(address)}`;
      const payload = await call(path);
      return payload === null ? null : parse(walletSchema, path, payload);
    },
  };
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
