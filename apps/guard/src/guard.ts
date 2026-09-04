import type { DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import {
  deny,
  evaluate,
  nextAuditEntry,
  unrealisedPnl,
  verifyChain,
  type AuditEntry,
  type ChainVerification,
  type GuardDecision,
  type GuardOrder,
  type GuardPolicy,
  type GuardState,
  type Side,
} from '@kalibra/core';
import {
  appendAuditEntry,
  lastAuditEntry,
  readAuditLog,
  readGuardLedger,
  readGuardMarkets,
  readOpenMarkets,
  type KalibraDatabase,
} from '@kalibra/db';

import { recordFill } from './fill.js';
import { deriveState, type AgentLedger, type MarketFacts } from './ledger.js';
import { withAllowedMarkets, withKillSwitch } from './policy-file.js';

/**
 * Guard. `RISK_POLICY_SPEC.md`, all of it.
 *
 * The order of operations here is the specification's §1, and it is not negotiable:
 * evaluate, **write the audit entry**, then act. A crash between the write and the forward
 * leaves an entry with no order — visible to anyone reading the log. The reverse leaves an
 * order with no record, which is invisible, and is therefore not permitted to be possible.
 */

export interface GuardOptions {
  readonly db: KalibraDatabase;
  /** Reads: quotes and marks. Shared across agents, and needs no signer. */
  readonly adapter: DreamDexAdapter;
  /**
   * Writes: the adapter that signs as this agent. Each agent trades from its own wallet, so
   * the order has to leave through its own signer or Arena would rank one trader many times.
   * Absent, every agent shares `adapter`, which is what replay mode wants.
   */
  readonly adapterFor?: (agentId: string) => DreamDexAdapter;
  readonly policy: GuardPolicy;
  /** agentId to the wallet its fills are attributed to, for Arena scoring. */
  readonly wallets: ReadonlyMap<string, string>;
  /**
   * Whether a forwarded order is also written to `trades` for scoring.
   *
   * True against a replay adapter, which has no tape of its own, so without this the agent's
   * positions would not exist at all. **False against a real venue**, where the tape already
   * records what filled and the indexer ingests it: writing here as well would put the order
   * the agent asked for and the fill it actually got into the same wallet and market, and
   * aggregation would net them into one position of roughly twice the size. Both numbers
   * look reasonable, which is what makes it worth guarding against rather than noticing later.
   */
  readonly recordFills?: boolean;
}

export interface SubmitResult {
  readonly decision: GuardDecision;
  /** Where in the chain this decision was written. */
  readonly auditSeq: number;
  readonly venueOrderId: string | null;
  readonly txHash: string | null;
  /** The venue accepted the forwarded order. False whenever the verdict was DENY. */
  readonly forwarded: boolean;
  /** The fill was written to `trades` and will be scored on the next pipeline run. */
  readonly recorded: boolean;
  /** Why it was not recorded, when it was not. */
  readonly note: string | null;
}

/** A market this agent may trade right now, and how long it has left. */
export interface PermittedMarket {
  readonly marketId: string;
  readonly underlying: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly closesInMs: number;
}

/**
 * A quote as the canonical type carries it, mid included — and a mid can be absent, because
 * an empty book has no midpoint. An agent that cannot see that would price against a
 * fabricated 0.5.
 */
export interface Quote {
  readonly marketId: string;
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
  readonly lastUp: number | null;
  readonly at: number;
}

/** One open exposure, marked at the current mid where one is available. */
export interface OpenPosition {
  readonly marketId: string;
  readonly side: Side;
  readonly stake: bigint;
  readonly entryProbUp: number;
  readonly markProbUp: number | null;
  readonly unrealisedPnl: bigint;
  readonly openedAt: number;
}

export interface RiskStatus {
  readonly agentId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly killSwitch: boolean;
  readonly state: GuardState;
  readonly remaining: {
    readonly notionalPerOrder: bigint;
    readonly openNotional: bigint;
    readonly dailyLoss: bigint;
    readonly ordersInWindow: number;
  };
}

export class Guard {
  private policy: GuardPolicy;
  private readonly ledgers = new Map<string, AgentLedger>();

  constructor(private readonly options: GuardOptions) {
    this.policy = options.policy;
  }

  currentPolicy(): GuardPolicy {
    return this.policy;
  }

  /** The operator's lever, and the only way `killSwitch` ever changes. No agent reaches it. */
  setKillSwitch(engaged: boolean, now: number): GuardPolicy {
    this.policy = withKillSwitch(this.policy, engaged);
    if (!engaged) {
      for (const [agentId, ledger] of this.ledgers) {
        this.ledgers.set(agentId, { ...ledger, killSwitchTrippedAt: null });
      }
    } else {
      for (const [agentId, ledger] of this.ledgers) {
        this.ledgers.set(agentId, { ...ledger, killSwitchTrippedAt: now });
      }
    }
    return this.policy;
  }

  /**
   * The operator's other lever: which markets an agent may touch.
   *
   * Deliberately narrower than "set the policy". A supervisor has to rotate this every few
   * minutes, because Event Contract windows roll and yesterday's market id is gone; giving
   * that loop the power to rewrite every limit would mean the risk envelope was set by
   * automation rather than by a human, which is the opposite of what Guard is for. Limits
   * are changed by editing guard.policy.json and restarting.
   */
  setAllowedMarkets(markets: readonly string[]): GuardPolicy {
    this.policy = withAllowedMarkets(this.policy, markets);
    return this.policy;
  }

  setPolicy(policy: GuardPolicy): GuardPolicy {
    this.policy = policy;
    return this.policy;
  }

  auditLog(agentId?: string): AuditEntry[] {
    return readAuditLog(this.options.db, agentId);
  }

  /** Verification runs on the whole chain: a per-agent slice has gaps by construction. */
  verify(): ChainVerification {
    return verifyChain(readAuditLog(this.options.db));
  }

  async riskStatus(agentId: string, now: number, marketId?: string): Promise<RiskStatus> {
    const probe: GuardOrder = {
      marketId: marketId ?? '',
      side: 'UP',
      stake: 0n,
      limitProb: null,
      clientOrderId: '',
    };
    const state = await this.stateFor(agentId, probe, now);
    const loss = -(state.dailyRealisedPnl + state.dailyUnrealisedPnl);
    return {
      agentId,
      policyId: this.policy.policyId,
      policyVersion: this.policy.version,
      killSwitch: this.policy.killSwitch,
      state,
      remaining: {
        notionalPerOrder: this.policy.maxNotionalPerOrder,
        openNotional: max0(this.policy.maxOpenNotional - state.openNotional),
        dailyLoss: max0(this.policy.maxDailyLoss - loss),
        ordersInWindow: Math.max(0, this.policy.maxOrdersPerWindow - state.ordersInWindow),
      },
    };
  }

  /**
   * What this agent may trade, right now.
   *
   * Open markets intersected with the policy allowlist, minus the ones too close to close.
   * Offering a market that `evaluate` would refuse as TOO_CLOSE_TO_CLOSE or
   * MARKET_NOT_ALLOWED would spend the agent's turn on a certain denial, which is the same
   * argument `RISK_POLICY_SPEC.md` §7 makes for exposing remaining headroom rather than
   * only the limits.
   *
   * `minTimeToCloseMs` is the whole filter, and briefly was not. An order's expiry of
   * `now + orderTtlMs` used to be able to land past the market's own close, which the pool
   * rejects, so this filter was widened to the larger of the two — and then offered almost
   * nothing, because the supervisor allowlists the markets nearest to closing. The expiry is
   * now clamped where it is built (`writer.ts`), so a short window takes a short-lived order
   * instead of a doomed one, and the operator's knob is the only limit again.
   */
  markets(now: number): PermittedMarket[] {
    const allowed = new Set(this.policy.allowedMarkets);
    return readOpenMarkets(this.options.db, now)
      .filter((row) => allowed.has(row.marketId))
      .filter((row) => row.windowEnd - now > this.policy.minTimeToCloseMs)
      .map((row) => ({
        marketId: row.marketId,
        underlying: row.underlying,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        closesInMs: row.windowEnd - now,
      }));
  }

  /**
   * The venue's current mid for one market, read through the same adapter Guard marks
   * positions with. It goes through Guard rather than letting the agent hold an adapter of
   * its own, so that "the agent cannot reach DreamDEX except through Guard" stays true of
   * reads as well as of orders.
   */
  async quote(marketId: string, now: number): Promise<Quote> {
    const quote = await this.options.adapter.getQuote(marketId, now);
    return {
      marketId,
      bestBidUp: quote.bestBidUp,
      bestAskUp: quote.bestAskUp,
      midUp: quote.midUp,
      lastUp: quote.lastUp,
      at: quote.timestamp,
    };
  }

  /**
   * The agent's open exposure, derived from the orders Guard forwarded exactly as the risk
   * counters are. A position leaves this list when its market settles, which is when it
   * stops consuming open notional.
   */
  async positions(agentId: string, now: number): Promise<OpenPosition[]> {
    const forwarded = readGuardLedger(this.options.db, agentId);
    const rows = readGuardMarkets(this.options.db, [
      ...new Set(forwarded.map((row) => row.marketId)),
    ]);

    const open: OpenPosition[] = [];
    for (const row of forwarded) {
      const facts = rows.get(row.marketId);
      if (facts !== undefined && facts.outcome !== null) continue;
      const markProbUp = facts === undefined ? null : await this.mark(facts, now);
      open.push({
        marketId: row.marketId,
        side: row.side,
        stake: row.stake,
        entryProbUp: row.impliedProbUp,
        markProbUp,
        // Marking at cost when there is no quote gives exactly zero, which is what
        // `unrealisedPnl` documents as the honest degradation. Spelled out rather than
        // passed through, so the choice is visible here too.
        unrealisedPnl: markProbUp === null ? 0n : unrealisedPnl(row, markProbUp),
        openedAt: row.at,
      });
    }
    return open;
  }

  async submit(agentId: string, order: GuardOrder, now: number): Promise<SubmitResult> {
    const state = await this.stateFor(agentId, order, now);
    const decision = evaluate(this.policy, state, order);
    const auditSeq = this.append(agentId, order, decision, state, now);

    if (decision.verdict === 'DENY') {
      if (decision.severity === 'FATAL') this.trip(agentId, now);
      return refused(decision, auditSeq);
    }

    const venue = this.venueFor(agentId);
    let accepted: Awaited<ReturnType<DreamDexAdapter['placeOrder']>>;
    try {
      accepted = await venue.placeOrder(order);
    } catch (cause) {
      // Rule 11. The order never reached the venue, and the agent must not treat it as
      // placed, so the failure is written to the chain as a decision of its own.
      const upstream = deny(
        'UPSTREAM_UNAVAILABLE',
        `forwarding ${order.clientOrderId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return refused(upstream, this.append(agentId, order, upstream, state, now));
    }

    if (!accepted.accepted) {
      // The venue refused an order Guard allowed. That is the venue's decision, not
      // Guard's, so it does not become an audit entry; the ALLOW above already stands.
      return {
        decision,
        auditSeq,
        venueOrderId: accepted.venueOrderId,
        txHash: accepted.txHash,
        forwarded: false,
        recorded: false,
        note: accepted.rejectReason ?? 'the venue refused the order',
      };
    }

    const fill =
      this.options.recordFills === false
        ? { recorded: false, note: 'scored from the venue tape, not from Guard', forwarded: null }
        : await recordFill({
            db: this.options.db,
            adapter: this.options.adapter,
            agentId,
            wallet: this.options.wallets.get(agentId),
            order,
            txHash: accepted.txHash,
            now,
          });

    return {
      decision,
      auditSeq,
      venueOrderId: accepted.venueOrderId,
      txHash: accepted.txHash,
      forwarded: true,
      recorded: fill.recorded,
      note: fill.note,
    };
  }

  private async stateFor(agentId: string, order: GuardOrder, now: number): Promise<GuardState> {
    const ledger = this.ledgerFor(agentId);
    const ids = new Set(ledger.forwarded.map((row) => row.marketId));
    if (order.marketId !== '') ids.add(order.marketId);

    const rows = readGuardMarkets(this.options.db, [...ids]);
    const markets = new Map<string, MarketFacts>();
    for (const [marketId, row] of rows) {
      markets.set(marketId, { ...row, markProbUp: await this.mark(row, now) });
    }
    return deriveState({ ledger, markets, policy: this.policy, now, order });
  }

  /** An open market is marked at its current mid; a settled one needs no mark. */
  private async mark(
    row: { marketId: string; outcome: string | null },
    now: number,
  ): Promise<number | null> {
    if (row.outcome !== null) return null;
    try {
      return (await this.options.adapter.getQuote(row.marketId, now)).midUp;
    } catch {
      // A quote Guard could not fetch marks the position at cost, which contributes zero.
      return null;
    }
  }

  private append(
    agentId: string,
    order: GuardOrder,
    decision: GuardDecision,
    stateSnapshot: GuardState,
    now: number,
  ): number {
    const entry = nextAuditEntry(lastAuditEntry(this.options.db), {
      timestamp: now,
      agentId,
      policyId: this.policy.policyId,
      policyVersion: this.policy.version,
      order,
      decision,
      stateSnapshot,
    });
    appendAuditEntry(this.options.db, entry);
    return entry.seq;
  }

  private venueFor(agentId: string): DreamDexAdapter {
    return this.options.adapterFor?.(agentId) ?? this.options.adapter;
  }

  /**
   * A cold ledger is rebuilt from disk rather than started empty. Every counter in
   * `GuardState` is derived from the forwarded list, so an empty one hands a restarted agent
   * a fresh daily loss, a zero open notional and no loss streak — a limit-breaching agent
   * would get a clean slate from a crash, and the numbers would look entirely plausible.
   */
  /**
   * Derived on every evaluation rather than carried in memory. `ledger.ts` already argues
   * for this: there is no counter to drift out of step with reality, nothing to forget to
   * decrement, and a restart reproduces the same state because it reads the same rows. The
   * only thing held in memory is the kill switch, which is an operator action rather than a
   * consequence of the orders themselves.
   */
  private ledgerFor(agentId: string): AgentLedger {
    return {
      forwarded: readGuardLedger(this.options.db, agentId),
      killSwitchTrippedAt: this.ledgers.get(agentId)?.killSwitchTrippedAt ?? null,
    };
  }

  private trip(agentId: string, now: number): void {
    this.policy = withKillSwitch(this.policy, true);
    const ledger = this.ledgerFor(agentId);
    this.ledgers.set(agentId, { ...ledger, killSwitchTrippedAt: now });
  }
}

const max0 = (value: bigint): bigint => (value < 0n ? 0n : value);

const refused = (decision: GuardDecision, auditSeq: number): SubmitResult => ({
  decision,
  auditSeq,
  venueOrderId: null,
  txHash: null,
  forwarded: false,
  recorded: false,
  note: null,
});
