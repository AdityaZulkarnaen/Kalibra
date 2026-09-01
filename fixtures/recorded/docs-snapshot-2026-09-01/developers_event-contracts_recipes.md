> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/event-contracts/recipes.md).

# Recipes

Every action an event-contract bot needs, as a short snippet. All of these assume an `exchange` built as in [Building on Event Contracts](/developers/event-contracts.md), and a signer for anything that writes. Types used below (`PlaceOrderResult`) come from the same package.

Three tiers are available and you will use all of them:

| Tier            | Reach it with       | Use it for                                                                            |
| --------------- | ------------------- | ------------------------------------------------------------------------------------- |
| Unified         | `exchange.*`        | Trading by symbol in human units. Most of your bot.                                   |
| Client (reads)  | `exchange.client.*` | On-chain truth: market status, outcome balances.                                      |
| Trader (writes) | `exchange.trader.*` | The few writes the unified tier does not model, notably redeeming a specific outcome. |

## Find a market worth trading

Gate on the **on-chain** status, and skip windows that are about to close.

`listLiveBinaryMarkets` returns only the windows that are currently open, already scoped to binary markets, so there is no spot or perp to fetch and discard:

```ts
const now = Date.now() / 1000;
const candidates = [];

for (const m of await exchange.client.listLiveBinaryMarkets({ limit: 50 })) {
  // The row carries an indexer status too, but that trails the chain.
  const onchain = await exchange.client.getMarketOnchain(m.marketId as `0x${string}`);
  if (onchain.status !== 1) continue;                 // 1 = Trading
  const secondsLeft = Number(m.expiry) - now;
  if (secondsLeft < 300) continue;                    // no time for anything useful
  candidates.push({ market: m, onchain, secondsLeft });
}
```

Pass a filter to narrow by venue, asset or cadence. `loadMarkets` still works if you want one symbol-keyed map across every market kind, but for a bot that only trades event contracts this is the direct route.

Keep the `onchain` snapshot you validated and reuse it for the rest of the pass. Pools are recycled between windows, so a snapshot taken now is the one generation your reads and writes agree on.

## Read the book

```ts
const [up, down] = market.outcomes ?? [];
if (!up || !down) return;                       // not a binary market
const { yes, no } = { yes: up.symbol, no: down.symbol };
const book = await exchange.fetchOrderBook(yes, 5);
const bestBid = book.bids[0]?.[0];
const bestAsk = book.asks[0]?.[0];
```

Prices are Up probabilities in (0, 1). The Down book is the same book read from the other side: quote `no` and the SDK converts to Up terms for you.

## Read a market's volume

Every market row carries its own traded volume, so per-contract volume is a read rather than something you aggregate yourself:

```ts
const rows = await exchange.client.listBinaryMarkets({ status: "Finalized", limit: 60 });

for (const m of rows.filter((r) => Number(r.tradeCount) > 0)) {
  console.log({
    asset: m.asset,                                       // "BTC" | "ETH"
    cadence: Number(m.intervalSec) / 60 + "m",
    volume: Number(m.cumulativeQuoteVolume) / 1e18,       // collateral, USDso
    contracts: Number(m.cumulativeBaseVolume) / 1e18,
    trades: Number(m.tradeCount),
    lastPrice: m.lastPrice ? Number(m.lastPrice) / 1e18 : null,
    lastTradeAt: m.lastTradeAt,
  });
}
```

To rank markets by volume rather than scan for it, pass `orderBy: "volume"`. The sort runs server-side; the keys are `newest`, `closingSoon`, `volume` and `tradeCount`.

`cumulativeQuoteVolume` is the collateral that changed hands, counting each fill once: a direct fill is worth one side's notional, and a mint or burn is worth the whole contract because the two sides each pay their share of it. Summing your own per-trader legs instead gives a larger number, because a direct fill has both a payer and a receiver.

Divide by the collateral's decimals, not by a constant: 18 on mainnet USDso, 6 on the testnet faucet token.

For a ccxt-shaped view of the same numbers, `fetchTicker(outcomeSymbol)` returns `baseVolume` and `quoteVolume` already scaled.

## Size to the venue's lot grid

From markets-sdk 0.24.0 `amountToPrecision` reads the pool's lot size, so the unified verbs size correctly on their own. Anything below one lot floors to **zero**: ask for 0.0004 contracts on mainnet and you get `0`, with nothing thrown. Check the result and skip the order when it comes back 0, or you will send an order for nothing and wonder why the book never shows it.

You still quantize by hand when you build params for the raw trader tier, which takes exact units:

```ts
const LOT = 1_000_000_000_000_000n;           // 1e15 on an 18-decimal venue
const decimals = 18;

function quantize(human: number): number {
  const raw = BigInt(Math.floor(human * 10 ** decimals));
  const snapped = (raw / LOT) * LOT;
  return Number(snapped) / 10 ** decimals;    // 0 means "below one lot, skip"
}
```

## Price and size on the venue's grid

The pool accepts prices on a tick grid and sizes on a lot grid. Read them rather than hardcoding them, because they scale with the collateral's decimals:

```ts
const { tickSize, lotSize, minQuantity } = await exchange.client.getBinaryBookParams(pool);
// mainnet today: all three are 1e15, so 0.001 in probability and 0.001 contracts
```

From markets-sdk 0.28.0 the unified verbs snap for you. `priceToPrecision` takes `0.0512` to `0.051`, and `amountToPrecision` takes `0.137` to `0.137`, both on the venue's own grid, so ordinary numbers convert onto the grid instead of a few wei off it.

{% hint style="warning" %}
Below 0.28.0 an ordinary float price did not land. `createOrder` converted with `parseUnits(price.toFixed(18), 18)`, and `(0.05).toFixed(18)` is `"0.050000000000000003"`, three wei off the grid, which the pool rejects with `InvalidPrice`. Only 0.25, 0.5 and 0.75 survived that conversion. If you are pinned below 0.28.0, snap prices to whole ticks and send bigints through the raw trader tier.
{% endhint %}

When you want exact units rather than the unified verbs, build them yourself and send them through the raw trader tier:

```ts
const ONE = 10n ** 18n;                 // collateral scale, 1e6 on testnet
const TICK = 1_000_000_000_000_000n;    // 1e15 = 0.001 here, 1e3 on testnet
const LOT = TICK;

const ticks = (p: number) => BigInt(Math.round(p * Number(ONE / TICK))) * TICK;
const lots = (q: number) => BigInt(Math.floor(q * Number(ONE / LOT) + 1e-9)) * LOT;

await exchange.trader.placeOrder({
  pool: onchain.pool,
  side: "BUY_YES",                      // or SELL_YES / BUY_NO / SELL_NO
  price: ticks(0.05),                   // always in YES terms: a NO price is ONE - ticks(p)
  quantity: lots(5),
  orderType: ORDER_TYPE.POST_ONLY,      // LIMIT | MARKET (IOC) | FILL_OR_KILL | POST_ONLY
  expireTimestampNs: BigInt(Math.floor(Date.now() / 1000) + 300) * 1_000_000_000n,
});
```

## Take liquidity

Cross the touch with IOC so the remainder never rests behind your back.

```ts
const size = quantize(5);
if (size > 0 && bestAsk !== undefined) {
  const order = await exchange.createOrder(yes, "limit", "buy", size, bestAsk + 0.02, {
    timeInForce: "IOC",
  });
  // The unified result has no `receipt` of its own: it wraps the raw tx result
  // in `info`, and that is where the on-chain status lives.
  const { receipt } = order.info as PlaceOrderResult;
  if (receipt.status === "reverted") throw new Error("reverted on-chain");
  console.log(`filled ${order.filled} of ${order.amount}`);
}
```

## Rest a quote

Post-only means the order refuses to cross, so a quoting loop never pays the spread.

A post-only that would have crossed **reverts** with `PostOnlyWouldCross()`, and the call throws. It does not come back with a status for you to inspect, on either tier: the unified `createOrder` and the raw `trader.placeOrder` both raise it. Catch it and treat it as "the book moved into me", which on a quoting loop is a normal event rather than a fault.

```ts
try {
  await exchange.createOrder(yes, "limit", "buy", size, 0.45, { postOnly: true });
} catch (err) {
  if (String(err).includes("PostOnlyWouldCross")) {
    // the touch moved through our price between the read and the send; requote
  } else {
    throw err;
  }
}
```

Every order carries an expiry capped at the market's own. Set it just past your requote interval and a crashed bot's orders age off the book on their own.

## Get inventory so you can sell

You can only sell an outcome you hold, and there is no naked short. New tokens come from minting a **complete set**: collateral in, one Up plus one Down out.

```ts
await exchange.mintSet(market.symbol, 10);    // 10 collateral -> 10 Up + 10 Down
// ...later, to unwind an unsold pair back to collateral:
await exchange.burnSet(market.symbol, 10);
```

You do not need this to quote both sides. Two opposite-side buyers cross with no seller at all (the pool mints the pair from their combined collateral), so a resting Buy Up at *p* plus a Buy Down at *1 − p* is already a two-sided quote with zero inventory.

## Manage working orders

```ts
const open = await exchange.fetchOpenOrders(yes);
for (const o of open) await exchange.cancelOrder(o.id, yes);
```

Cancel refunds return to your **wallet**, in the exact amount that was escrowed, so reconcile there. The per-pool vault is a payout fallback and normally reads 0, though placement draws it first when it does hold something.

## Know what actually filled

Treat your own trade history as the source of truth for position, not what you asked for.

```ts
const trades = await exchange.fetchMyTrades(yes, since);
const shares = trades.filter((t) => t.side !== "sell").reduce((n, t) => n + t.amount, 0);
```

Indexer rows land a few seconds after the transaction confirms, so poll with a deadline rather than trusting a single read.

## Check your positions

Outcome tokens are ids on one shared ERC-6909 contract, not per-market ERC-20s, so read them by id:

```ts
const me = exchange.walletAddress;
if (!me) throw new Error("no signer");
const up = await exchange.client.getOutcomeBalance(onchain.outcomeToken, me, onchain.yesId);
const down = await exchange.client.getOutcomeBalance(onchain.outcomeToken, me, onchain.noId);
```

## Redeem after settlement

This is the step people miss, and `loadMarkets()` will not help you find it.

A settled market leaves the live list, and the registry sweep behind `loadMarkets()` skips finalized binary markets outright — so filtering it for inactive rows returns an empty set and a redeem-by-scan bot silently reports nothing to claim while real winnings sit unredeemed.

The binary tier still has them, under the terminal status `"Finalized"`:

```ts
const settled = await exchange.client.listBinaryMarkets({
  venueId,
  status: "Finalized",
  limit: 120,
});
const settledMarketIds = settled
  // The server sorts newest-created; you want newest-expired. Those agree within
  // a series but not across cadences, so over-fetch and sort before you cut.
  .sort((a, b) => Number(b.expiry ?? 0) - Number(a.expiry ?? 0))
  .slice(0, 40)
  .map((m) => m.marketId);
```

Then redeem through the trader with an explicit outcome index. The convenience method infers the winner from the market, which is meaningless on a voided market where both sides pay 0.5.

```ts
type OutcomeIdx = 0 | 1;
const UP: OutcomeIdx = 0, DOWN: OutcomeIdx = 1;

// marketIds from the query above.
for (const marketId of settledMarketIds) {
  const oc = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
  if (!oc.isResolved && !oc.isVoided) continue;

  const held: Record<OutcomeIdx, bigint> = {
    [UP]: await exchange.client.getOutcomeBalance(oc.outcomeToken, me, oc.yesId),
    [DOWN]: await exchange.client.getOutcomeBalance(oc.outcomeToken, me, oc.noId),
  };

  // Voided: claim both sides at 0.5. Resolved: only the winning side pays.
  const toClaim: OutcomeIdx[] = oc.isVoided ? [UP, DOWN] : [oc.winningOutcome === 0 ? UP : DOWN];

  for (const outcome of toClaim) {
    if (held[outcome] === 0n) continue;
    const res = await exchange.trader.redeem({
      marketId: marketId as `0x${string}`,
      market: oc.marketAddress,
      outcomeToken: oc.outcomeToken,
      outcomeIdx: outcome,
      amount: held[outcome],
    });
    if (res.receipt?.status === "reverted") throw new Error("redeem reverted");
  }
}
```

Redeeming a losing position does not revert. It succeeds and pays nothing, so check the outcome before you spend gas.

## Read a settled market's history

Settled markets are not in `loadMarkets()`, and `listBinaryMarkets({ status: "Finalized" })` is only the start of what the indexer keeps. There is a purpose-built history surface:

```ts
// most-recently-expired first; filter by venue, asset, cadence; page with limit + offset
const past = await exchange.client.listPastBinaryMarkets({ status: "Finalized", asset: "BTC", limit: 50 });

const total = await exchange.client.countBinaryMarkets({});      // how far the tail goes
const res   = await exchange.client.getMarketResolution(marketId);
const open  = await exchange.client.getOpeningPrices([marketId]);
const pnl   = await exchange.client.getBinaryPositionPnL(account, marketId);
```

`getMarketResolution` returns objects rather than bare prices. The number you want is `numericValue`: compare `openingAnswer.numericValue` against `closingAnswer.numericValue` and you have the comparison the market settled on, alongside `events` for the lifecycle.

Use **`Finalized`** to reach settled markets. Resolution auto-finalizes, so markets do not linger in `Resolved`, and asking for that status returns an empty list.

{% hint style="warning" %}
`getCandles` and `getFills` are keyed on the **pool**, and a pool serves many successive markets. One live pool has already carried 100 of them, so `getCandles(poolAddress, 60)` happily returns candles from dozens of markets that are not the one you asked about.

Scope every history read to the market's own window, or filter the rows by `market` afterwards. Note the option names differ between the two calls:

```ts
const candles = await exchange.client.getCandles(pool, 60, { from: m.tradingStart, to: m.expiry });
const fills   = await exchange.client.getFills(pool, { since: m.tradingStart, until: m.expiry });
```

{% endhint %}

Candle buckets come at 60, 300, 900, 3600, 14400 and 86400 seconds. `getUserFills(account, opts)` is the same tape filtered to one wallet.

### What is kept

Fills, orders and candles all survive settlement. A five-week-old finalized market still returns its full trade tape, its candles, and every order that ever rested on it, including the ones that were cancelled without trading.

There is no order-book snapshot table, but you do not need one: every order carries `placedAtBlock` and `lastUpdatedAtBlock`, so the resting book at any block is derivable from the order rows, and the fills carry `blockNumber` and `logIndex` for exact ordering.

Two things not to assume. `fetchPriceCandles` reads an external price feed rather than the book, and needs `priceFeed` configured. And `getMarketStatusHistory` currently returns the `Locked` transition rather than a full `Listed → Trading → … → Resolved` trail.

## Follow a series as it rolls

Windows expire on a schedule and the venue opens a successor automatically. Key your state by `marketId` or by symbol, never by pool address, and re-resolve the current window each cycle rather than caching it.

```ts
// Every cycle: re-read the market list, pick the live window for your series,
// and start a fresh position count when the symbol changes.
if (currentSymbol !== previousSymbol) resetPositionState();
```

## Where to go next

The full API surface, including realtime watches and the React hooks, is documented in the package README on [npm](https://www.npmjs.com/package/@somnia-chain/markets-sdk). Types ship with the package, so an editor with TypeScript will autocomplete everything above.

Read the [Gotchas](/developers/event-contracts/gotchas.md) before sending a real order.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/event-contracts/recipes.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
