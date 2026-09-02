import type { DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import {
  deny,
  evaluate,
  nextAuditEntry,
  verifyChain,
  type AuditEntry,
  type ChainVerification,
  type GuardDecision,
  type GuardOrder,
  type GuardPolicy,
  type GuardState,
} from '@kalibra/core';
import {
  appendAuditEntry,
  lastAuditEntry,
  readAuditLog,
  readGuardMarkets,
  type KalibraDatabase,
} from '@kalibra/db';

import { recordFill } from './fill.js';
import {
  deriveState,
  emptyLedger,
  type AgentLedger,
  type ForwardedOrder,
  type MarketFacts,
} from './ledger.js';
import { withKillSwitch } from './policy-file.js';

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

    const fill = await recordFill({
      db: this.options.db,
      adapter: this.options.adapter,
      agentId,
      wallet: this.options.wallets.get(agentId),
      order,
      txHash: accepted.txHash,
      now,
    });
    if (fill.forwarded !== null) this.remember(agentId, fill.forwarded);

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

  private ledgerFor(agentId: string): AgentLedger {
    return this.ledgers.get(agentId) ?? emptyLedger();
  }

  private remember(agentId: string, forwarded: ForwardedOrder): void {
    const ledger = this.ledgerFor(agentId);
    this.ledgers.set(agentId, { ...ledger, forwarded: [...ledger.forwarded, forwarded] });
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
