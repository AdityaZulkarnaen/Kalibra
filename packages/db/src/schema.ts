import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Drizzle mirror of `migrations/0001_init.sql`, which is itself extracted verbatim from
 * API_SPEC.md section 1. The SQL is the source of truth for the database; this file is the
 * source of truth for the types. `schema.test.ts` asserts the two agree, because a mirror
 * nobody checks is just a second place to be wrong.
 *
 * Bigints are TEXT holding a decimal string: SQLite integers top out at 64 bits signed and
 * token base units can exceed that. Conversion happens in `queries.ts`, never in callers.
 */

export const markets = sqliteTable(
  'markets',
  {
    marketId: text('market_id').primaryKey(),
    underlying: text('underlying').notNull(),
    windowStart: integer('window_start').notNull(),
    windowEnd: integer('window_end').notNull(),
    strike: text('strike'),
    strikeDecimals: integer('strike_decimals').notNull().default(0),
    status: text('status').notNull(),
    outcome: text('outcome'),
    settlementLevel: text('settlement_level'),
    settledAt: integer('settled_at'),
    settleTxHash: text('settle_tx_hash'),
  },
  (table) => [
    index('idx_markets_status').on(table.status),
    index('idx_markets_settled').on(table.settledAt),
  ],
);

export const trades = sqliteTable(
  'trades',
  {
    tradeId: text('trade_id').primaryKey(),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.marketId),
    wallet: text('wallet').notNull(),
    side: text('side').notNull(),
    impliedProbUp: real('implied_prob_up').notNull(),
    quoteSource: text('quote_source').notNull(),
    stake: text('stake').notNull(),
    stakeDecimals: integer('stake_decimals').notNull(),
    timestamp: integer('timestamp').notNull(),
    txHash: text('tx_hash'),
    source: text('source').notNull(),
    ingestedAt: integer('ingested_at').notNull(),
  },
  (table) => [
    index('idx_trades_market').on(table.marketId),
    index('idx_trades_wallet').on(table.wallet),
  ],
);

export const positions = sqliteTable(
  'positions',
  {
    positionId: text('position_id').primaryKey(),
    wallet: text('wallet').notNull(),
    marketId: text('market_id')
      .notNull()
      .references(() => markets.marketId),
    side: text('side').notNull(),
    netStake: text('net_stake').notNull(),
    p: real('p').notNull(),
    rawP: real('raw_p').notNull(),
    quoteSource: text('quote_source').notNull(),
    lambda: real('lambda'),
    forecast: real('forecast'),
    outcomeY: integer('outcome_y'),
    excludedReason: text('excluded_reason'),
    enteredAt: integer('entered_at').notNull(),
    settledAt: integer('settled_at'),
  },
  (table) => [
    uniqueIndex('idx_positions_unique').on(table.wallet, table.marketId),
    index('idx_positions_wallet_settled').on(table.wallet, table.settledAt, table.positionId),
  ],
);

export const scores = sqliteTable(
  'scores',
  {
    wallet: text('wallet').primaryKey(),
    n: integer('n').notNull(),
    bsTrader: real('bs_trader'),
    bsMarket: real('bs_market'),
    bss: real('bss'),
    bssShrunk: real('bss_shrunk'),
    eceTrader: real('ece_trader'),
    eceMarket: real('ece_market'),
    eceExcess: real('ece_excess'),
    auc: real('auc'),
    score: integer('score'),
    scoreInternal: integer('score_internal').notNull(),
    status: text('status').notNull(),
    excludedCount: integer('excluded_count').notNull().default(0),
    paramsHash: text('params_hash').notNull(),
    computedAt: integer('computed_at').notNull(),
  },
  // The DESC ordering lives in the SQL migration; Drizzle only needs the columns.
  (table) => [index('idx_scores_rank').on(table.status, table.score)],
);

export const calibrationBins = sqliteTable(
  'calibration_bins',
  {
    wallet: text('wallet').notNull(),
    binIndex: integer('bin_index').notNull(),
    count: integer('count').notNull(),
    meanForecast: real('mean_forecast'),
    observedFreq: real('observed_freq'),
  },
  (table) => [primaryKey({ columns: [table.wallet, table.binIndex] })],
);

export const agents = sqliteTable('agents', {
  agentId: text('agent_id').primaryKey(),
  wallet: text('wallet').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  method: text('method'),
  registeredAt: integer('registered_at').notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    seq: integer('seq').primaryKey(),
    timestamp: integer('timestamp').notNull(),
    agentId: text('agent_id').notNull(),
    policyId: text('policy_id').notNull(),
    policyVersion: integer('policy_version').notNull(),
    orderJson: text('order_json').notNull(),
    decisionJson: text('decision_json').notNull(),
    stateJson: text('state_json').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (table) => [index('idx_audit_agent').on(table.agentId, table.seq)],
);

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
