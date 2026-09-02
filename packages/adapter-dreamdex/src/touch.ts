import { withSomniaClient, type SomniaConfig } from './somnia.js';

/**
 * The live top of book, read from the pool contract.
 *
 * This is deliberately **not** `LiveAdapter.getQuote`, and the difference is the whole
 * reason this file exists. `getQuote` reconstructs the book as it stood at the block of a
 * past fill, because `SCORING_SPEC.md` §2 wants the mid a trader actually faced when they
 * traded. That is the right number for scoring and the wrong number for quoting: on a market
 * that has not traded for a while it can be minutes or hours stale, and an order priced
 * against it is priced against history.
 *
 * The first real order this repository sent was refused with `PostOnlyWouldCross()` for
 * exactly that reason — a resting bid two ticks under a reconstructed best bid of 0.623,
 * placed into a live book whose ask had since fallen through it.
 *
 * So: reconstruct to score, read the contract to trade.
 */

export interface LiveTouch {
  readonly marketId: string;
  readonly pool: string;
  /** Somnia's MarketStatus: 0 Listed, 1 Trading, 2 Locked, 3 Settling, 4 Resolved, 5 Voided. */
  readonly status: number;
  readonly windowEnd: number;
  /** Best resting bid and ask in UP terms, and their midpoint. Null when a side is empty. */
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
  /** The pool's own grid, so a caller can size and price onto it. */
  readonly tickSize: bigint;
  readonly lotSize: bigint;
  readonly minQuantity: bigint;
  readonly decimals: number;
}

export async function readLiveTouch(config: SomniaConfig, marketId: string): Promise<LiveTouch> {
  return withSomniaClient(config, async (client) => {
    const onchain = await client.getMarketOnchain(marketId as `0x${string}`);
    const [book, params] = await Promise.all([
      client.getBinaryOrderBook(onchain.pool, { decimals: onchain.decimals }),
      client.getBinaryBookParams(onchain.pool),
    ]);

    const scale = 10 ** onchain.decimals;
    const bid = book.yesBids[0]?.price;
    const ask = book.yesAsks[0]?.price;
    const bestBidUp = bid === undefined ? null : Number(bid) / scale;
    const bestAskUp = ask === undefined ? null : Number(ask) / scale;

    return {
      marketId,
      pool: onchain.pool,
      status: onchain.status,
      windowEnd: Number(onchain.expiry) * 1000,
      bestBidUp,
      bestAskUp,
      // A mid needs both sides. One-sided is reported as null rather than as the one price
      // that happens to be there, which would read as a market consensus that does not exist.
      midUp: bestBidUp === null || bestAskUp === null ? null : (bestBidUp + bestAskUp) / 2,
      tickSize: params.tickSize,
      lotSize: params.lotSize,
      minQuantity: params.minQuantity,
      decimals: onchain.decimals,
    };
  });
}
