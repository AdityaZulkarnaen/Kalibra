/**
 * Deterministic synthetic fixtures, per DREAMDEX_ADAPTER.md section 9.
 *
 * One LCG seeded at 42 drives everything, and the draw order below is the specification:
 * change it and every fixture changes. Running this twice must produce byte-identical
 * files, which is asserted in `generate-fixtures.test.ts`.
 *
 * Draw order
 *   per market : base price, truth
 *   per wallet : trade count
 *   per trade  : market, stake, correctness, price jitter, time offset
 *
 * Nothing here fabricates venue identifiers. Trade ids are visibly synthetic and every
 * `txHash` is null, because no transaction happened.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalMarketSchema,
  canonicalSettlementSchema,
  canonicalTradeSchema,
  toJsonValue,
  type CanonicalMarket,
  type CanonicalSettlement,
  type CanonicalSide,
  type CanonicalTrade,
} from '@kalibra/adapter-dreamdex';
import { createLcg, roundTo } from '@kalibra/core';

const SEED = 42;
const EPOCH_MS = Date.UTC(2026, 7, 25, 0, 0, 0);
const WINDOW_MS = 15 * 60 * 1000;
const UNDERLYINGS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const;
const WINDOWS = 20;
const WALLET_COUNT = 25;
const EDGE_MIN = 0.42;
const EDGE_MAX = 0.68;
const MIN_TRADES = 40;
const MAX_TRADES = 120;
const STAKE_MIN_USD = 1;
const STAKE_MAX_USD = 500;

/** Testnet collateral scale — DREAMDEX_ADAPTER.md U7, and the project is testnet only. */
const STAKE_DECIMALS = 6;
const UNIT = 10 ** STAKE_DECIMALS;

/** Exercises the VOID exclusion path in SCORING_SPEC.md section 4.4. */
const VOID_MARKET_INDEX = 5;
/** Exercise netting, SCORING_SPEC.md 4.3. Each trade is emitted as a matched pair. */
const WASH_WALLETS = new Set([2, 10, 18]);
/** Exercise the sub-minimum-stake exclusion. */
const DUST_WALLETS = new Set([7, 15]);

interface MarketPlan {
  readonly market: CanonicalMarket;
  readonly basePriceUp: number;
  /** Which way the window actually went, independent of whether it settles or voids. */
  readonly truth: CanonicalSide;
}

const walletAddress = (index: number): string => `0x${(index + 1).toString(16).padStart(40, '0')}`;

const opposite = (side: CanonicalSide): CanonicalSide => (side === 'UP' ? 'DOWN' : 'UP');

function planMarkets(rng: { unit(): number }): MarketPlan[] {
  const plans: MarketPlan[] = [];
  for (let w = 0; w < WINDOWS; w += 1) {
    for (const underlying of UNDERLYINGS) {
      const windowStart = EPOCH_MS + w * WINDOW_MS;
      const basePriceUp = roundTo(0.3 + 0.4 * rng.unit(), 4);
      const truth: CanonicalSide = rng.unit() < basePriceUp ? 'UP' : 'DOWN';
      plans.push({
        market: {
          marketId: `${underlying}-${windowStart}`,
          underlying,
          windowStart,
          windowEnd: windowStart + WINDOW_MS,
          strike: null,
          strikeDecimals: 0,
          status: plans.length === VOID_MARKET_INDEX ? 'VOID' : 'SETTLED',
        },
        basePriceUp,
        truth,
      });
    }
  }
  return plans;
}

function stakeBaseUnits(draw: number, dust: boolean): bigint {
  if (dust) {
    // Deliberately below MIN_STAKE_BASE, so the exclusion path has something to exclude.
    return BigInt(Math.round((0.0001 + draw * 0.0008) * UNIT));
  }
  const logUniform = Math.exp(
    Math.log(STAKE_MIN_USD) + draw * (Math.log(STAKE_MAX_USD) - Math.log(STAKE_MIN_USD)),
  );
  return BigInt(Math.round(logUniform * UNIT));
}

function planTrades(plans: readonly MarketPlan[], rng: { unit(): number }): CanonicalTrade[] {
  const trades: CanonicalTrade[] = [];
  let counter = 0;
  const nextTradeId = (): string => {
    counter += 1;
    return `SYN-${counter.toString().padStart(6, '0')}`;
  };

  for (let w = 0; w < WALLET_COUNT; w += 1) {
    const wallet = walletAddress(w);
    const edge = EDGE_MIN + ((EDGE_MAX - EDGE_MIN) * w) / (WALLET_COUNT - 1);
    const isWash = WASH_WALLETS.has(w);
    const isDust = DUST_WALLETS.has(w);
    const tradeCount = MIN_TRADES + Math.floor(rng.unit() * (MAX_TRADES - MIN_TRADES + 1));

    for (let t = 0; t < tradeCount; t += 1) {
      const plan = plans[Math.floor(rng.unit() * plans.length)];
      if (plan === undefined) throw new Error('market index out of range');
      const stake = stakeBaseUnits(rng.unit(), isDust);
      const correct = rng.unit() < edge;
      const jitter = rng.unit();
      const offset = rng.unit();

      const side = correct ? plan.truth : opposite(plan.truth);
      const impliedProbUp = roundTo(
        Math.min(0.95, Math.max(0.05, plan.basePriceUp + (jitter - 0.5) * 0.06)),
        4,
      );
      const base = {
        marketId: plan.market.marketId,
        wallet,
        impliedProbUp,
        quoteSource: 'MID' as const,
        stake,
        stakeDecimals: STAKE_DECIMALS,
        timestamp: plan.market.windowStart + Math.floor(offset * (WINDOW_MS - 1)),
        txHash: null,
      };

      if (isWash) {
        // A matched pair at one price and one size nets to zero, so section 4.3 excludes
        // the wallet entirely and no sample count is manufactured.
        trades.push({ tradeId: nextTradeId(), side: 'UP', ...base });
        trades.push({ tradeId: nextTradeId(), side: 'DOWN', ...base });
      } else {
        trades.push({ tradeId: nextTradeId(), side, ...base });
      }
    }
  }
  return trades;
}

const planSettlements = (plans: readonly MarketPlan[]): CanonicalSettlement[] =>
  plans.map((plan) => ({
    marketId: plan.market.marketId,
    outcome: plan.market.status === 'VOID' ? ('VOID' as const) : plan.truth,
    settlementLevel: null,
    settledAt: plan.market.windowEnd + 1000,
    txHash: null,
  }));

export interface GeneratedFixtures {
  readonly markets: CanonicalMarket[];
  readonly trades: CanonicalTrade[];
  readonly settlements: CanonicalSettlement[];
}

/** Generates and validates. A fixture that cannot survive its own schema is a defect. */
export function generateFixtures(): GeneratedFixtures {
  const rng = createLcg(SEED);
  const plans = planMarkets(rng);
  return {
    markets: plans.map((plan) => canonicalMarketSchema.parse(plan.market)),
    trades: planTrades(plans, rng).map((trade) => canonicalTradeSchema.parse(trade)),
    settlements: planSettlements(plans).map((s) => canonicalSettlementSchema.parse(s)),
  };
}

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'synthetic',
);

/** Serialised exactly as written to disk, so a test can compare bytes without file I/O. */
export function serialiseFixtures(fixtures: GeneratedFixtures): Record<string, string> {
  return {
    'markets.json': `${JSON.stringify(toJsonValue(fixtures.markets), null, 2)}\n`,
    'trades.json': `${JSON.stringify(toJsonValue(fixtures.trades), null, 2)}\n`,
    'settlements.json': `${JSON.stringify(toJsonValue(fixtures.settlements), null, 2)}\n`,
  };
}

async function main(): Promise<void> {
  const fixtures = generateFixtures();
  await mkdir(FIXTURE_DIR, { recursive: true });
  for (const [name, body] of Object.entries(serialiseFixtures(fixtures))) {
    await writeFile(join(FIXTURE_DIR, name), body, 'utf8');
  }
  const wallets = new Set(fixtures.trades.map((trade) => trade.wallet)).size;
  console.log(
    `seed ${SEED}: ${fixtures.markets.length} markets, ${wallets} wallets, ` +
      `${fixtures.trades.length} trades, ${fixtures.settlements.length} settlements`,
  );
}

// Only when run as a script. Importing this module from a test must not write files.
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main();
}
