/**
 * Order-book reconstruction, the decision recorded as U18 in DREAMDEX_ADAPTER.md §7.2.
 *
 * The venue serves no mid, and `SCORING_SPEC.md` §2 requires one: the fill price is the
 * trader's own execution, so scoring against it would record a trader who crossed a wide
 * spread as making a more confident forecast than they made.
 *
 * Pure. Given the same orders and block it returns the same book, forever.
 */

/** The venue quotes four sides on one book. This is the only place the NO frame exists. */
export type VenueSide = 'BUY_YES' | 'SELL_YES' | 'BUY_NO' | 'SELL_NO';

export interface RestingOrder {
  readonly side: VenueSide;
  /** Already scaled into [0, 1] — a YES price. */
  readonly price: number;
  readonly placedAtBlock: bigint;
  readonly lastUpdatedAtBlock: bigint;
  readonly rested: boolean;
  readonly quantityRemaining: bigint;
}

export interface ReconstructedBook {
  readonly bestBidUp: number | null;
  readonly bestAskUp: number | null;
  readonly midUp: number | null;
  /** How many orders were actually resting. Zero means no book, not a zero price. */
  readonly depth: number;
  /** True when the best bid is above the best ask, which must never be scored as a mid. */
  readonly crossed: boolean;
}

/**
 * The book as it stood at `atBlock`.
 *
 * Callers pass the block *before* the fill they are pricing. A fill and the order state
 * that produced it share a block, so reconstructing at the fill's own block sees the
 * incoming order and returns a crossed book — verified against three captured fills, where
 * `block - 1` is the only rule that comes back uncrossed every time. It is also the rule
 * that means something: the mid at execution is the book the taker faced.
 *
 * An order counts as liquidity only if it is resting and has quantity left. A fully filled
 * order keeps its price in the indexer's rows, and counting it silently crosses the book.
 */
export function reconstructBook(
  orders: readonly RestingOrder[],
  atBlock: bigint,
): ReconstructedBook {
  const bids: number[] = [];
  const asks: number[] = [];

  for (const order of orders) {
    if (!isResting(order, atBlock)) continue;
    // A NO order is the complement of a YES order: buying NO at q is selling YES at 1 - q.
    switch (order.side) {
      case 'BUY_YES':
        bids.push(order.price);
        break;
      case 'SELL_NO':
        bids.push(1 - order.price);
        break;
      case 'SELL_YES':
        asks.push(order.price);
        break;
      case 'BUY_NO':
        asks.push(1 - order.price);
        break;
    }
  }

  const bestBidUp = bids.length === 0 ? null : Math.max(...bids);
  const bestAskUp = asks.length === 0 ? null : Math.min(...asks);
  const crossed = bestBidUp !== null && bestAskUp !== null && bestBidUp > bestAskUp;
  const midUp =
    bestBidUp === null || bestAskUp === null || crossed ? null : (bestBidUp + bestAskUp) / 2;

  return { bestBidUp, bestAskUp, midUp, depth: bids.length + asks.length, crossed };
}

function isResting(order: RestingOrder, atBlock: bigint): boolean {
  return (
    order.rested &&
    order.quantityRemaining > 0n &&
    order.placedAtBlock <= atBlock &&
    order.lastUpdatedAtBlock >= atBlock
  );
}
