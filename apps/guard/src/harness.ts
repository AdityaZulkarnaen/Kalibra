import { join } from 'node:path';

import {
  ReplayAdapter,
  type CanonicalOrder,
  type CanonicalOrderResult,
  type DreamDexAdapter,
} from '@kalibra/adapter-dreamdex';
import type { GuardOrder, GuardPolicy } from '@kalibra/core';
import { openDatabase, type OpenedDatabase } from '@kalibra/db';
import { runIngest } from '@kalibra/indexer';

import { Guard } from './guard.js';
import { parsePolicy } from './policy-file.js';

/**
 * Shared scaffolding for Guard's tests. Not used by anything that ships.
 *
 * It builds the same world each time: the committed fixtures ingested into an in-memory
 * database, two markets put back into the OPEN state they were in mid-window, and a clock
 * reading inside both. Every test then breaks exactly one thing.
 */

const ROOT = process.cwd();
const INGESTED_AT = 1_787_620_000_000;

export const AGENT = 'ag_demo';
export const AGENT_WALLET = '0x00000000000000000000000000000000000000aa';

export const BASE_POLICY = {
  policyId: 'test',
  version: 1,
  maxNotionalPerOrder: '50000000',
  maxOpenNotional: '200000000',
  maxDailyLoss: '100000000',
  maxOrdersPerWindow: 10,
  rateWindowMs: 60_000,
  lossStreakThreshold: 3,
  cooldownMs: 300_000,
  allowedMarkets: [] as string[],
  minTimeToCloseMs: 5_000,
  killSwitch: false,
  autoKillOnDailyLoss: true,
};

export interface Harness {
  readonly opened: OpenedDatabase;
  readonly replay: DreamDexAdapter;
  readonly marketId: string;
  readonly secondMarketId: string;
  /** Mid-window: late enough for the replay to quote a last price, far from the close. */
  readonly now: number;
}

export async function setUpHarness(): Promise<Harness> {
  const opened = openDatabase(':memory:');
  const replay = await ReplayAdapter.fromDirectory(join(ROOT, 'fixtures', 'synthetic'));
  await runIngest(replay, opened.db, { ingestedAt: INGESTED_AT });

  const rows = opened.sqlite
    .prepare(
      'SELECT market_id, window_start, window_end FROM markets ORDER BY window_end DESC LIMIT 2',
    )
    .all() as Array<{ market_id: string; window_start: number; window_end: number }>;
  const [first, second] = rows as [(typeof rows)[0], (typeof rows)[0]];

  // The fixtures are settled by the time they are committed. Guard is being asked about
  // markets that were open at `now`, so both rows are put back into that state.
  for (const row of rows) reopen(opened, row.market_id);

  return {
    opened,
    replay,
    marketId: first.market_id,
    secondMarketId: second.market_id,
    now: first.window_start + Math.floor((first.window_end - first.window_start) / 2),
  };
}

export function reopen(opened: OpenedDatabase, marketId: string): void {
  opened.sqlite
    .prepare("UPDATE markets SET status='OPEN', outcome=NULL, settled_at=NULL WHERE market_id=?")
    .run(marketId);
}

export function settle(
  opened: OpenedDatabase,
  marketId: string,
  outcome: 'UP' | 'DOWN' | 'VOID',
  at: number,
): void {
  opened.sqlite
    .prepare("UPDATE markets SET status='SETTLED', outcome=?, settled_at=? WHERE market_id=?")
    .run(outcome, at, marketId);
}

export function guardTradeCount(opened: OpenedDatabase): number {
  const row = opened.sqlite
    .prepare("SELECT COUNT(*) AS n FROM trades WHERE source = 'GUARD'")
    .get() as { n: number };
  return row.n;
}

/** A venue that accepts everything, so the forwarding path runs offline. */
export function acceptingAdapter(replay: DreamDexAdapter): DreamDexAdapter {
  // Written out rather than spread: ReplayAdapter is a class, and spreading an instance
  // drops every method that lives on its prototype.
  return {
    streamTrades: (opts) => replay.streamTrades(opts),
    streamSettlements: (opts) => replay.streamSettlements(opts),
    listMarkets: () => replay.listMarkets(),
    getQuote: (marketId, at) => replay.getQuote(marketId, at),
    placeOrder: (submitted: CanonicalOrder): Promise<CanonicalOrderResult> =>
      Promise.resolve({
        accepted: true,
        venueOrderId: `venue-${submitted.clientOrderId}`,
        txHash: `0x${'ab'.repeat(32)}`,
        rejectReason: null,
      }),
  };
}

export function policyFor(harness: Harness, patch: Partial<typeof BASE_POLICY> = {}): GuardPolicy {
  return parsePolicy({
    ...BASE_POLICY,
    allowedMarkets: [harness.marketId, harness.secondMarketId],
    ...patch,
  });
}

export function orderFor(harness: Harness, patch: Partial<GuardOrder> = {}): GuardOrder {
  return {
    marketId: harness.marketId,
    side: 'UP',
    stake: 10_000_000n,
    limitProb: null,
    clientOrderId: 'coid-1',
    ...patch,
  };
}

export function guardFor(
  harness: Harness,
  adapter: DreamDexAdapter,
  policy: GuardPolicy = policyFor(harness),
  wallets: ReadonlyMap<string, string> = new Map([[AGENT, AGENT_WALLET]]),
): Guard {
  return new Guard({ db: harness.opened.db, adapter, policy, wallets });
}
