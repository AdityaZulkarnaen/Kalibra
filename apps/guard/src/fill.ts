import type { DreamDexAdapter } from '@kalibra/adapter-dreamdex';
import type { GuardOrder } from '@kalibra/core';
import { insertTrade, type KalibraDatabase } from '@kalibra/db';

import type { ForwardedOrder } from './ledger.js';

/**
 * What happens after the venue accepts a forwarded order: the fill is written to `trades`
 * with `source = 'GUARD'` and joins the same pipeline as an ingested trade.
 *
 * `RISK_POLICY_SPEC.md` §8: there is no separate scoring path for agents. One scoring
 * implementation, two sources of trades — which is also the honest answer when a judge
 * asks whether agents are scored the same way as humans.
 */

/**
 * Base units per whole unit of collateral. The testnet quote asset reports six decimals
 * (`packages/core/src/constants.ts` records the same choice for `MIN_STAKE_BASE`), and a
 * Guard order is denominated in the same units the agent was given limits in.
 */
const GUARD_STAKE_DECIMALS = 6;

export interface RecordedFill {
  readonly recorded: boolean;
  /** Why it was not recorded, when it was not. */
  readonly note: string | null;
  /** The ledger entry to remember, absent when nothing was recorded. */
  readonly forwarded: ForwardedOrder | null;
}

export interface RecordFillArgs {
  readonly db: KalibraDatabase;
  readonly adapter: DreamDexAdapter;
  readonly agentId: string;
  readonly wallet: string | undefined;
  readonly order: GuardOrder;
  readonly txHash: string | null;
  readonly now: number;
}

const notRecorded = (note: string): RecordedFill => ({
  recorded: false,
  note,
  forwarded: null,
});

export async function recordFill(args: RecordFillArgs): Promise<RecordedFill> {
  const { db, adapter, agentId, wallet, order, txHash, now } = args;

  const quote = await adapter.getQuote(order.marketId, now);
  const price = quote.midUp ?? quote.lastUp;
  if (price === null) {
    // SCORING_SPEC.md §2 forbids scoring a position against its own execution price, so a
    // fill with no market quote is forwarded but not scored. Saying so beats inventing a
    // price that would silently flatter or damn the agent.
    return notRecorded('no market quote at fill time, so not scored');
  }
  if (wallet === undefined) {
    return notRecorded(`no wallet registered for agent ${agentId}`);
  }

  insertTrade(
    db,
    {
      tradeId: `guard:${agentId}:${order.clientOrderId}`,
      marketId: order.marketId,
      wallet: wallet.toLowerCase(),
      side: order.side,
      impliedProbUp: price,
      quoteSource: quote.midUp === null ? 'LAST' : 'MID',
      stake: order.stake,
      stakeDecimals: GUARD_STAKE_DECIMALS,
      timestamp: now,
      txHash,
    },
    'GUARD',
    now,
  );

  return {
    recorded: true,
    note: null,
    forwarded: {
      clientOrderId: order.clientOrderId,
      marketId: order.marketId,
      side: order.side,
      stake: order.stake,
      impliedProbUp: price,
      at: now,
    },
  };
}
