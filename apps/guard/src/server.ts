import { canonicalJson, type GuardOrder } from '@kalibra/core';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import type { Guard } from './guard.js';

/**
 * Guard's HTTP transport. It parses, calls `evaluate` through `Guard`, and serialises.
 * There is no rule logic here: both transports call the same function so enforcement
 * cannot drift between them (`RISK_POLICY_SPEC.md` §1).
 *
 * Bigints are serialised with `canonicalJson`, the same function that feeds the hash
 * chain, so a number on the wire is the number that was hashed.
 */

const orderSchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(['UP', 'DOWN']),
  /** Base units as a decimal string. Parsing as a number would truncate above 2^53. */
  stake: z
    .string()
    .regex(/^-?\d+$/, 'stake is a decimal string in base units')
    .transform(BigInt),
  limitProb: z.number().nullable(),
  clientOrderId: z.string(),
  postOnly: z.boolean().optional(),
});

const submitSchema = z.object({
  agentId: z.string().min(1),
  order: orderSchema,
});

export interface ServerOptions {
  readonly guard: Guard;
  /** Supplied by the caller: the transport reads the clock, `evaluate` never does. */
  readonly clock: () => number;
  /**
   * When set, the operator routes are registered and require this bearer token. When
   * unset they are not registered at all — an agent that finds the port must not be able
   * to widen its own limits, and a missing token failing open would be exactly that.
   */
  readonly operatorToken?: string | undefined;
}

const send = (reply: FastifyReply, status: number, body: unknown): FastifyReply =>
  reply
    .code(status)
    .header('content-type', 'application/json; charset=utf-8')
    .send(canonicalJson(body));

const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  send(reply, status, { error: { code, message } });

export function buildGuardServer(options: ServerOptions): FastifyInstance {
  const { guard, clock } = options;
  const app = Fastify({ logger: false });

  app.post('/guard/order', async (request, reply) => {
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'BAD_REQUEST', z.prettifyError(parsed.error));
    }
    const { agentId, order } = parsed.data;
    const result = await guard.submit(agentId, order as GuardOrder, clock());
    return send(reply, result.decision.verdict === 'ALLOW' ? 200 : 403, result);
  });

  app.get('/guard/risk/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const marketId = (request.query as Record<string, string | undefined>)['marketId'];
    return send(reply, 200, await guard.riskStatus(agentId, clock(), marketId));
  });

  /**
   * The three read routes the MCP surface is built on (`RISK_POLICY_SPEC.md` §7). They are
   * reads only: none of them can change the policy, and there is deliberately no route
   * anywhere on this server that lets a caller without the operator token change one.
   */
  app.get('/guard/markets', (_request, reply) => send(reply, 200, guard.markets(clock())));

  app.get('/guard/quote/:marketId', async (request, reply) => {
    const { marketId } = request.params as { marketId: string };
    try {
      return send(reply, 200, await guard.quote(marketId, clock()));
    } catch (cause) {
      // The venue could not price it. That is not a 500 on Guard's part, and an agent
      // needs to tell "no quote" apart from "Guard is broken".
      return fail(
        reply,
        502,
        'UPSTREAM_UNAVAILABLE',
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  });

  app.get('/guard/positions/:agentId', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    return send(reply, 200, await guard.positions(agentId, clock()));
  });

  app.get('/guard/policy', (_request, reply) => send(reply, 200, guard.currentPolicy()));

  /**
   * JSON Lines, so a reviewer can pipe the log to a verifier without loading it all into
   * memory (§6.3). The whole chain, because that is what verifies.
   */
  app.get('/guard/audit', (_request, reply) => sendJsonLines(reply, guard.auditLog()));

  app.get('/guard/audit/:agentId', (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    // A filtered view. `seq` keeps its chain-wide values and will have gaps, so this is
    // for reading, not for verifying. /guard/audit is the one that verifies.
    return sendJsonLines(reply, guard.auditLog(agentId));
  });

  app.get('/guard/verify', (_request, reply) => send(reply, 200, guard.verify()));

  if (options.operatorToken !== undefined && options.operatorToken !== '') {
    registerOperatorRoutes(app, options.operatorToken, guard, clock);
  }

  app.setNotFoundHandler((_request, reply) => fail(reply, 404, 'NOT_FOUND', 'no such route'));

  // An unexpected failure is not an allowed order. Deny by default reaches the transport
  // too: the agent gets a 500 and no decision, never a silent success.
  app.setErrorHandler((error: unknown, _request, reply) =>
    fail(reply, 500, 'INTERNAL', error instanceof Error ? error.message : String(error)),
  );
  return app;
}

function sendJsonLines(reply: FastifyReply, entries: readonly unknown[]): FastifyReply {
  return reply
    .code(200)
    .header('content-type', 'application/x-ndjson; charset=utf-8')
    .send(entries.map((entry) => canonicalJson(entry)).join('\n'));
}

function registerOperatorRoutes(
  app: FastifyInstance,
  token: string,
  guard: Guard,
  clock: () => number,
): void {
  const killSchema = z.object({ engaged: z.boolean() });
  const marketsSchema = z.object({ allowedMarkets: z.array(z.string().min(1)) });

  app.post('/guard/operator/kill-switch', (request, reply) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      return fail(reply, 401, 'BAD_REQUEST', 'operator token required');
    }
    const parsed = killSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'BAD_REQUEST', z.prettifyError(parsed.error));
    }
    return send(reply, 200, guard.setKillSwitch(parsed.data.engaged, clock()));
  });

  /**
   * Rotates the allowlist. Event Contract windows roll every few minutes and their ids go
   * with them, so a static allowlist denies everything within the hour — but the answer is
   * not to weaken deny-by-default, it is to let the operator's own supervisor keep the list
   * current. The route carries the operator token; no agent and no MCP tool reaches it.
   *
   * It changes the allowlist and nothing else. A route that could set the whole policy
   * would let a loop widen every limit it was written to respect.
   */
  app.post('/guard/operator/allowed-markets', (request, reply) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      return fail(reply, 401, 'BAD_REQUEST', 'operator token required');
    }
    const parsed = marketsSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'BAD_REQUEST', z.prettifyError(parsed.error));
    }
    return send(reply, 200, guard.setAllowedMarkets(parsed.data.allowedMarkets));
  });
}
