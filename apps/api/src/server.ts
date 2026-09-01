import { LAMBDA_MAX, MIN_SAMPLE, SHRINK_K, binRange, paramsHash } from '@kalibra/core';
import {
  readCalibration,
  readLeaderboard,
  readMarkets,
  readWalletPositions,
  readWalletScore,
  walletHasPositions,
  type KalibraDatabase,
} from '@kalibra/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  leaderboardSchema,
  marketsSchema,
  pageSchema,
  walletPositionsSchema,
  walletSchema,
} from './schemas.js';

/**
 * The public read surface. No authentication, no writes, no arithmetic — every number here
 * was computed by the pipeline and is being read back.
 *
 * `validateResponses` parses each payload against its published schema before sending. It
 * is on in tests and off in production, so a contract break fails a test rather than
 * reaching a reader.
 */
export interface ServerOptions {
  readonly validateResponses?: boolean;
}

interface ErrorBody {
  error: { code: 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL'; message: string };
}

const fail = (code: ErrorBody['error']['code'], message: string): ErrorBody => ({
  error: { code, message },
});

export function buildServer(db: KalibraDatabase, options: ServerOptions = {}): FastifyInstance {
  const validate = options.validateResponses ?? false;
  const app = Fastify({ logger: false });

  const send = <T>(reply: unknown, schema: z.ZodType<T>, body: T): T => {
    if (!validate) return body;
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new Error(`response failed its published schema: ${z.prettifyError(result.error)}`);
    }
    return result.data;
  };

  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('Cache-Control', 'public, max-age=10');
    done(null, payload);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(fail('NOT_FOUND', 'no such route')),
  );

  app.setErrorHandler((error, _request, reply) => {
    if (validate) throw error;
    return reply.code(500).send(fail('INTERNAL', error.message));
  });

  app.get('/v1/leaderboard', (request, reply) => {
    const page = pageSchema.safeParse(request.query);
    if (!page.success) {
      return reply.code(400).send(fail('BAD_REQUEST', z.prettifyError(page.error)));
    }
    const statusFilter = z
      .enum(['ranked', 'all'])
      .default('ranked')
      .safeParse((request.query as Record<string, unknown>)['status'] ?? undefined);
    if (!statusFilter.success) {
      return reply.code(400).send(fail('BAD_REQUEST', 'status must be ranked or all'));
    }

    const { total, rows } = readLeaderboard(db, page.data, statusFilter.data === 'ranked');
    return reply.send(
      send(reply, leaderboardSchema, {
        params: {
          lambdaMax: LAMBDA_MAX,
          shrinkK: SHRINK_K,
          minSample: MIN_SAMPLE,
          paramsHash: paramsHash(),
        },
        total,
        entries: rows.map((row, index) => ({
          rank: page.data.offset + index + 1,
          wallet: row.wallet,
          score: row.score,
          status: row.status as 'RANKED' | 'PROVISIONAL',
          n: row.n,
          bss: row.bss,
          eceExcess: row.eceExcess,
          auc: row.auc,
          isAgent: row.agentName !== null,
          agentName: row.agentName,
        })),
      }),
    );
  });

  app.get('/v1/wallet/:address', (request, reply) => {
    const address = normaliseAddress(request.params);
    if (address === null) {
      return reply.code(400).send(fail('BAD_REQUEST', 'address must be a 0x EVM address'));
    }

    const score = readWalletScore(db, address);
    if (score === undefined) {
      // Unknown to us entirely is a 404; known but not yet measurable is a 200 with n = 0.
      if (!walletHasPositions(db, address)) {
        return reply.code(404).send(fail('NOT_FOUND', 'no positions for that wallet'));
      }
      return reply.code(404).send(fail('NOT_FOUND', 'no score computed for that wallet yet'));
    }

    const bins = readCalibration(db, address);
    return reply.send(
      send(reply, walletSchema, {
        wallet: score.wallet,
        score: score.score,
        status: score.status as 'RANKED' | 'PROVISIONAL',
        n: score.n,
        excludedCount: score.excludedCount,
        stats: {
          bsTrader: score.bsTrader,
          bsMarket: score.bsMarket,
          bss: score.bss,
          bssShrunk: score.bssShrunk,
          eceTrader: score.eceTrader,
          eceMarket: score.eceMarket,
          eceExcess: score.eceExcess,
          auc: score.auc,
        },
        calibration: bins.map((bin) => ({
          bin: bin.binIndex,
          range: binRange(bin.binIndex) as [number, number],
          count: bin.count,
          meanForecast: bin.meanForecast,
          observedFreq: bin.observedFreq,
        })),
        agent:
          score.agentId === null || score.agentName === null
            ? null
            : { agentId: score.agentId, name: score.agentName, method: score.agentMethod },
        paramsHash: score.paramsHash,
        computedAt: score.computedAt,
      }),
    );
  });

  app.get('/v1/wallet/:address/positions', (request, reply) => {
    const address = normaliseAddress(request.params);
    if (address === null) {
      return reply.code(400).send(fail('BAD_REQUEST', 'address must be a 0x EVM address'));
    }
    const page = pageSchema.safeParse(request.query);
    if (!page.success) {
      return reply.code(400).send(fail('BAD_REQUEST', z.prettifyError(page.error)));
    }
    if (!walletHasPositions(db, address)) {
      return reply.code(404).send(fail('NOT_FOUND', 'no positions for that wallet'));
    }

    const { total, rows } = readWalletPositions(db, address, page.data);
    return reply.send(
      send(reply, walletPositionsSchema, {
        total,
        positions: rows.map((row) => ({
          positionId: row.positionId,
          marketId: row.marketId,
          underlying: row.underlying,
          side: row.side as 'UP' | 'DOWN',
          netStake: row.netStake,
          stakeDecimals: row.stakeDecimals,
          p: row.p,
          lambda: row.lambda,
          forecast: row.forecast,
          outcomeY: row.outcomeY as 0 | 1 | null,
          // Both already exist; showing them side by side is what tells a trader whether
          // their lean helped or hurt on that contract.
          brierContribution: squaredError(row.forecast, row.outcomeY),
          marketBrierContribution: squaredError(row.p, row.outcomeY),
          excludedReason: row.excludedReason,
          settledAt: row.settledAt,
        })),
      }),
    );
  });

  app.get('/v1/markets', (request, reply) => {
    const page = pageSchema.safeParse(request.query);
    if (!page.success) {
      return reply.code(400).send(fail('BAD_REQUEST', z.prettifyError(page.error)));
    }
    const query = request.query as Record<string, unknown>;
    const filters = {
      ...(typeof query['status'] === 'string' ? { status: query['status'] } : {}),
      ...(typeof query['underlying'] === 'string' ? { underlying: query['underlying'] } : {}),
    };

    // API_SPEC section 2 documents no `total` on this endpoint, and sending an undocumented
    // field is still a contract deviation. The count is read but not published.
    const { rows } = readMarkets(db, page.data, filters);
    return reply.send(
      send(reply, marketsSchema, {
        markets: rows.map((row) => ({
          marketId: row.marketId,
          underlying: row.underlying,
          windowStart: row.windowStart,
          windowEnd: row.windowEnd,
          status: row.status as 'OPEN' | 'CLOSED' | 'SETTLED' | 'VOID',
          outcome: row.outcome as 'UP' | 'DOWN' | 'VOID' | null,
          tradeCount: row.tradeCount,
          uniqueWallets: row.uniqueWallets,
          marketEce: null,
        })),
      }),
    );
  });

  return app;
}

/** Addresses are lowercase in every response, regardless of request casing. */
function normaliseAddress(params: unknown): string | null {
  const address = (params as { address?: unknown }).address;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return address.toLowerCase();
}

const squaredError = (forecast: number | null, y: number | null): number | null =>
  forecast === null || y === null ? null : (forecast - y) ** 2;
