import { leaderboardSchema, walletSchema } from '@kalibra/api/schemas';
import { KalibraError } from '@kalibra/core/errors';
import { z } from 'zod';

/**
 * The only place the web app talks to `apps/api`.
 *
 * Responses are parsed with the schemas `apps/api` publishes and validates its own replies
 * against, so the reader and the server cannot drift: a renamed field fails here rather
 * than rendering as `undefined`. That is invariant I4 applied to the browser's side of the
 * boundary, and it is why the schemas are imported rather than restated.
 *
 * There is no fallback data. Every failure throws, and the pages render an error state.
 * A leaderboard that quietly serves a stale copy is worse than one that says it is down.
 */

export type Leaderboard = z.infer<typeof leaderboardSchema>;
export type LeaderboardEntry = Leaderboard['entries'][number];
export type Wallet = z.infer<typeof walletSchema>;
export type CalibrationBin = Wallet['calibration'][number];
export type ScoringParams = Leaderboard['params'];

/** The API is unreachable, or answered with something that is not its published contract. */
export class ApiUnavailableError extends KalibraError {
  constructor(message: string) {
    super('API_UNAVAILABLE', message);
  }
}

/** The API answered 404: this wallet has no positions at all, which is a real answer. */
export class ApiNotFoundError extends KalibraError {
  constructor(message: string) {
    super('API_NOT_FOUND', message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  readonly baseUrl?: string;
  /** Injected by tests so the failure paths are exercised without a server. */
  readonly fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

export function apiBaseUrl(): string {
  const configured = process.env['KALIBRA_API_URL'];
  return configured === undefined || configured === '' ? DEFAULT_BASE_URL : configured;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function get<T>(path: string, schema: z.ZodType<T>, options: ApiOptions): Promise<T> {
  const base = options.baseUrl ?? apiBaseUrl();
  const call = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  let response: Response;
  try {
    // The API sets its own Cache-Control; re-caching here would let a page outlive an
    // ingestion run and show numbers the pipeline has already replaced.
    response = await call(`${base}${path}`, { cache: 'no-store' });
  } catch (cause) {
    throw new ApiUnavailableError(`GET ${path} could not reach ${base}: ${describe(cause)}`);
  }

  if (response.status === 404) throw new ApiNotFoundError(`GET ${path} returned 404`);
  if (!response.ok) throw new ApiUnavailableError(`GET ${path} returned HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiUnavailableError(`GET ${path} did not return JSON`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiUnavailableError(
      `GET ${path} broke its contract: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export type LeaderboardStatus = 'ranked' | 'all';

export function fetchLeaderboard(
  status: LeaderboardStatus,
  limit: number,
  options: ApiOptions = {},
): Promise<Leaderboard> {
  return get(`/v1/leaderboard?status=${status}&limit=${limit}`, leaderboardSchema, options);
}

export function fetchWallet(address: string, options: ApiOptions = {}): Promise<Wallet> {
  return get(`/v1/wallet/${encodeURIComponent(address)}`, walletSchema, options);
}
