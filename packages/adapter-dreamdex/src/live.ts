import { z } from 'zod';

import { MalformedPayloadError, type DreamDexAdapter, type StreamOpts } from './adapter.js';
import { reconstructBook, type RestingOrder, type VenueSide } from './book.js';
import type {
  CanonicalMarket,
  CanonicalOrder,
  CanonicalOrderResult,
  CanonicalQuote,
  CanonicalSettlement,
  CanonicalSide,
  CanonicalTrade,
} from './canonical.js';
import {
  FILL_FIELDS,
  MARKET_FIELDS,
  ORDER_FIELDS,
  fillsResponse,
  marketsResponse,
  ordersResponse,
  type VenueFill,
  type VenueMarket,
  type VenueOrder,
} from './venue.js';
import { noSignerError, type SomniaWriter } from './writer.js';

/**
 * The live half of the airlock. Reads the venue's GraphQL indexer and emits canonical
 * types; nothing else in the repository knows any of these names.
 *
 * It queries the indexer directly rather than through the vendor SDK. Reads need no signer,
 * the book reconstruction needs the raw order rows anyway, and a direct query is what lets
 * the unit tests replay the captured payloads with no network at all — which is what keeps
 * invariant I3 intact while `LiveAdapter` is under test. The cost is that a schema change
 * at the venue lands here rather than being absorbed by the SDK, and that is the trade this
 * boundary exists to contain.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LiveAdapterConfig {
  /** Shannon testnet: https://dev.smk.somnia.host/v1/graphql — see DREAMDEX_ADAPTER U19. */
  readonly indexerUrl: string;
  /** Injected so tests replay recorded payloads instead of reaching the network. */
  readonly fetch?: FetchLike;
  /** Cap on markets read in one pass. */
  readonly marketLimit?: number;
  /**
   * Supplied only when this adapter is allowed to write. Absent, `placeOrder` throws, which
   * keeps live ingestion runnable with no credential at all — the venue's read surface is
   * permissionless (U20) and nothing about reading it should require a funded wallet.
   */
  readonly writer?: SomniaWriter;
}

export class LiveAdapter implements DreamDexAdapter {
  private readonly config: Required<Omit<LiveAdapterConfig, 'fetch' | 'writer'>> & {
    fetch: FetchLike;
  };
  private readonly writer: SomniaWriter | undefined;

  constructor(config: LiveAdapterConfig) {
    this.config = {
      indexerUrl: config.indexerUrl,
      fetch: config.fetch ?? ((url, init) => globalThis.fetch(url, init)),
      marketLimit: config.marketLimit ?? 200,
    };
    this.writer = config.writer;
  }

  async listMarkets(): Promise<CanonicalMarket[]> {
    return (await this.fetchMarkets()).map(toCanonicalMarket);
  }

  async *streamTrades(opts: StreamOpts): AsyncIterable<CanonicalTrade> {
    for (const market of await this.fetchMarkets()) {
      const [fills, orders] = await Promise.all([
        this.fetchFills(market.marketId),
        this.fetchOrders(market.marketId),
      ]);
      const resting = orders.map((order) => toRestingOrder(order, market.quoteDecimals));

      for (const fill of fills) {
        const at = Number(fill.timestamp) * 1000;
        if (!withinWindow(at, opts)) continue;
        for (const trade of toCanonicalTrades(fill, market, resting)) yield trade;
      }
    }
  }

  async *streamSettlements(opts: StreamOpts): AsyncIterable<CanonicalSettlement> {
    for (const market of await this.fetchMarkets()) {
      const settlement = toCanonicalSettlement(market);
      if (settlement !== null && withinWindow(settlement.settledAt, opts)) yield settlement;
    }
  }

  /**
   * The book is keyed on blocks, not wall-clock time, so the nearest fill at or before `at`
   * supplies the block to reconstruct against. A market with no fills yet has no book to
   * report, and reports nulls rather than a guess.
   */
  async getQuote(marketId: string, at: number): Promise<CanonicalQuote> {
    const [market] = (await this.fetchMarkets()).filter((row) => row.marketId === marketId);
    const empty: CanonicalQuote = {
      marketId,
      bestBidUp: null,
      bestAskUp: null,
      midUp: null,
      lastUp: null,
      timestamp: at,
    };
    if (market === undefined) return empty;

    const fills = (await this.fetchFills(marketId)).filter(
      (fill) => Number(fill.timestamp) * 1000 <= at,
    );
    const last = fills.at(-1);
    if (last === undefined) return empty;

    const orders = await this.fetchOrders(marketId);
    const scale = 10 ** market.quoteDecimals;
    const book = reconstructBook(
      orders.map((order) => toRestingOrder(order, market.quoteDecimals)),
      BigInt(last.blockNumber) - 1n,
    );
    return {
      marketId,
      bestBidUp: book.bestBidUp,
      bestAskUp: book.bestAskUp,
      midUp: book.midUp,
      lastUp: Number(last.fillPrice) / scale,
      timestamp: at,
    };
  }

  placeOrder(order: CanonicalOrder): Promise<CanonicalOrderResult> {
    if (this.writer === undefined) throw noSignerError(order.clientOrderId);
    return this.writer.placeOrder(order);
  }

  private async query<T>(body: string, schema: z.ZodType<T>, label: string): Promise<T> {
    const response = await this.config.fetch(this.config.indexerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: body }),
    });
    if (!response.ok) {
      throw new MalformedPayloadError(label, `indexer returned HTTP ${response.status}`);
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new MalformedPayloadError(label, z.prettifyError(parsed.error));
    }
    return parsed.data;
  }

  private async fetchMarkets(): Promise<VenueMarket[]> {
    const result = await this.query(
      // Markets that have actually traded, most recently active first. A freshly listed
      // window has nothing to ingest, and pulling its order rows would cost a round trip
      // to learn that.
      `{ Market(where: {marketType: {_eq: "BINARY"}, tradeCount: {_gt: 0}},
         limit: ${this.config.marketLimit}, order_by: {lastTradeAt: desc})
         { ${MARKET_FIELDS} } }`,
      marketsResponse,
      'Market',
    );
    return failOnErrors(result, 'Market').Market;
  }

  private async fetchFills(marketId: string): Promise<VenueFill[]> {
    const result = await this.query(
      `{ Fill(where: {market_id: {_eq: "${marketId}"}}, order_by: {blockNumber: asc})
         { ${FILL_FIELDS} } }`,
      fillsResponse,
      'Fill',
    );
    return failOnErrors(result, 'Fill').Fill;
  }

  private async fetchOrders(marketId: string): Promise<VenueOrder[]> {
    const result = await this.query(
      `{ Order(where: {market_id: {_eq: "${marketId}"}}, order_by: {placedAtBlock: asc})
         { ${ORDER_FIELDS} } }`,
      ordersResponse,
      'Order',
    );
    return failOnErrors(result, 'Order').Order;
  }
}

interface Envelope<T> {
  data?: T | undefined;
  errors?: Array<{ message: string }> | undefined;
}

function failOnErrors<T>(envelope: Envelope<T>, label: string): T {
  if (envelope.errors !== undefined && envelope.errors.length > 0) {
    throw new MalformedPayloadError(label, envelope.errors.map((e) => e.message).join('; '));
  }
  if (envelope.data === undefined) {
    throw new MalformedPayloadError(label, 'no data in response');
  }
  return envelope.data;
}

const withinWindow = (at: number, opts: StreamOpts): boolean =>
  (opts.since === undefined || at >= opts.since) && (opts.until === undefined || at < opts.until);

/** DREAMDEX_ADAPTER §4.1: the one place UP/DOWN normalisation happens. */
export function toCanonicalSide(side: VenueSide): CanonicalSide {
  return side === 'BUY_YES' || side === 'SELL_NO' ? 'UP' : 'DOWN';
}

export function toCanonicalMarket(market: VenueMarket): CanonicalMarket {
  const settled = market.finalized || market.voided;
  return {
    marketId: market.marketId.toLowerCase(),
    underlying: market.asset.toUpperCase(),
    windowStart: Number(market.tradingStart) * 1000,
    windowEnd: Number(market.expiry) * 1000,
    // "0" is the venue saying the line is the window's opening price, not a listed level.
    strike: market.strike === null || market.strike === '0' ? null : BigInt(market.strike),
    strikeDecimals: 0,
    status: market.voided ? 'VOID' : settled ? 'SETTLED' : 'OPEN',
  };
}

export function toCanonicalSettlement(market: VenueMarket): CanonicalSettlement | null {
  if (!market.finalized && !market.voided) return null;
  if (market.resolvedAtTimestamp === null) return null;
  return {
    marketId: market.marketId.toLowerCase(),
    outcome: market.voided ? 'VOID' : market.winningOutcome === 0 ? 'UP' : 'DOWN',
    settlementLevel: null,
    settledAt: Number(market.resolvedAtTimestamp) * 1000,
    txHash: null,
  };
}

function toRestingOrder(order: VenueOrder, quoteDecimals: number): RestingOrder {
  return {
    side: order.side,
    price: Number(order.price) / 10 ** quoteDecimals,
    placedAtBlock: BigInt(order.placedAtBlock),
    lastUpdatedAtBlock: BigInt(order.lastUpdatedAtBlock),
    rested: order.rested,
    quantityRemaining: BigInt(order.quantityRemaining),
  };
}

/**
 * One fill is two positions. Both counterparties took a directional view, so both are
 * scored; a maker who rests a bid and is hit has bought just as deliberately as the taker.
 *
 * Stake is what each side actually risks. A wallet long UP at implied probability p on
 * quantity q risks p·q, which the venue already reports as `quoteQuantity`. A wallet long
 * DOWN risks the complement, (1−p)·q, which is `quantity − quoteQuantity`. Using
 * `quoteQuantity` for both would overstate every DOWN position's conviction.
 */
export function toCanonicalTrades(
  fill: VenueFill,
  market: VenueMarket,
  resting: readonly RestingOrder[],
): CanonicalTrade[] {
  const scale = 10 ** market.quoteDecimals;
  const book = reconstructBook(resting, BigInt(fill.blockNumber) - 1n);

  // SCORING_SPEC §2 prefers the mid and permits the last trade price when it is
  // unavailable, provided the degradation is visible. It is, in `quoteSource`.
  const mid = book.midUp;
  const impliedProbUp = mid ?? Number(fill.fillPrice) / scale;
  const quoteSource = mid === null ? ('LAST' as const) : ('MID' as const);

  const quantity = BigInt(fill.quantity);
  const quoteQuantity = BigInt(fill.quoteQuantity);
  const timestamp = Number(fill.timestamp) * 1000;
  const txHash = fill.txHash === null ? null : fill.txHash.toLowerCase();

  const legs: Array<{ suffix: string; wallet: string; side: VenueSide | null }> = [
    { suffix: 'taker', wallet: fill.taker, side: fill.takerSide },
    { suffix: 'maker', wallet: fill.maker, side: fill.makerSide },
  ];

  const trades: CanonicalTrade[] = [];
  for (const leg of legs) {
    if (leg.side === null) continue;
    const side = toCanonicalSide(leg.side);
    trades.push({
      tradeId: `${fill.id}:${leg.suffix}`,
      marketId: market.marketId.toLowerCase(),
      wallet: leg.wallet.toLowerCase(),
      side,
      impliedProbUp,
      quoteSource,
      stake: side === 'UP' ? quoteQuantity : quantity - quoteQuantity,
      stakeDecimals: market.quoteDecimals,
      timestamp,
      txHash,
    });
  }
  return trades;
}
