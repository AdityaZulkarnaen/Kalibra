> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/event-contracts/gotchas.md).

# Gotchas

The things that bite people building on event contracts. All of these were hit and verified in real testing.

### 1. Gate on the on-chain market status, not the indexer

The indexer lags by seconds. Before every write, read the market's on-chain state and only trade a market in **Trading**. Orders on a market that just locked revert — or worse, appear to succeed (see #2).

### 2. Know how a revert reaches you

SDK writes sign with fixed fees and skip simulation. Through markets-sdk 0.22.0 they resolved even when the transaction reverted on-chain, so a mint on a just-locked market "succeeded" silently; from 0.23.0 the write throws a decoded revert error instead. On a supported version let that error propagate rather than checking a status flag, and on anything older check `receipt.status` yourself.

Where the receipt lives depends on the tier. `exchange.trader.*` returns it directly. The unified verbs (`createOrder`, `mintSet`, …) return a `UnifiedOrder` with **no `receipt` field of its own** — it wraps the raw result in `info`, so read `(order.info as PlaceOrderResult).receipt`. Reaching for `order.receipt` compiles against `unknown` in some setups and is always `undefined`, which silently disables the check.

### 3. Below 0.28.0, a float price reverts on an 18-decimal venue

Fixed in markets-sdk 0.28.0, which snaps to the venue's tick grid for you. Before it, `createOrder` converted with `parseUnits(price.toFixed(18), 18)`, and `(0.05).toFixed(18)` is `"0.050000000000000003"` — three wei off the grid, which the pool rejects with `InvalidPrice`. Of fifteen ordinary probabilities only 0.25, 0.5 and 0.75 survived, the ones binary floating point represents exactly. A 6-decimal venue never showed it, so testnet looked clean while every mainnet order failed. If you are pinned below 0.28.0, snap the price to whole ticks and send a bigint through `trader.placeOrder`.

### 4. Decide between taking and resting

The unfilled remainder of a limit order rests on the book with escrow locked — invisibly, if you are not tracking open orders. Taker-style bots should send IOC; resting liquidity should be a deliberate choice with cancel management around it.

### 5. Order expiry is mandatory — make it your dead-man's switch

Every order carries `expireTimestampNs`: unix time in **nanoseconds**, in the future, and no later than the market's own expiry. Set it just past your requote interval so a crashed bot's orders age off the book on their own.

There is no "no expiry" value: passing `0` reverts with `OrderAlreadyExpired`.

```ts
expireTimestampNs: BigInt(Math.floor(Date.now() / 1000) + 300) * 1_000_000_000n,
```

### 6. Size to the venue's lot grid

Through markets-sdk 0.23.0 the generic `amountToPrecision` skipped lot sizing on event-contract markets and snapped to whole contracts, which floors anything under one contract to zero on an 18-decimal venue. From 0.24.0 it reads the pool's lot size. If you build order params yourself for `trader.placeOrder`, you are still quantizing by hand: snap to the lot grid and skip when the result is 0.

### 7. Reconcile against the wallet, and check it before you sign

Escrow leaves the wallet and comes back to it. Cancel a resting bid and the exact escrow returns; cross a 0.945 ask with a 0.98 bid and you are charged 0.945, not 0.98. The per-pool vault is a payout **fallback** and reads 0 in normal operation, though placement draws it first when it does hold something.

Check the balance before you sign, because a reverted write does not throw (#2). An underfunded bot does not stop: it sends an order that reverts on every cycle and pays gas each time. The on-chain reason is a bare selector unless you decode it, `ERC20InsufficientBalance` for a buy with no collateral and `InsufficientBalance()` for a sell with no outcome tokens.

### 8. Scope to the venue

A deployment hosts more than one venue, and markets from all of them sit side by side in the indexer. Filter by the venue id (from the market row) or your bot will happily quote a venue you did not mean.

### 9. Pick markets with expiry headroom

A window minutes from close can lock between your snapshot and your send: orders expire silently and reads flip to Locked mid-flight. Skip markets with only a few minutes left.

### 10. `loadMarkets()` will not show you a settled market

Winnings live in markets that have already resolved, and the registry sweep behind `loadMarkets()` skips finalized binaries — so filtering it for inactive rows returns nothing and a redeem-by-scan bot reports no winnings while real ones sit unclaimed.

Ask the binary tier instead. A settled binary's terminal status is `"Finalized"`, and it is a filter like any other:

```ts
const settled = await exchange.client.listBinaryMarkets({ venueId, status: "Finalized" });
```

### 11. Winners pay out via the settlement rail

The protocol supports a one-time settlement fee on winning redemptions; **on dreamDEX it is set to zero**, so winners redeem 1:1. Redeeming a losing position succeeds and pays 0 — it does not revert. On a voided market, redeem both sides explicitly (each pays 0.5); there is no winning outcome to infer.

### 12. Pools are recycled, so key state by market id

Every window ends and the venue rolls a successor, but the pool the market traded on goes back to a free list and is reused by a later market. A pool serves one market at a time, never two concurrently, so `poolAddress` is a 1:1 binding that varies over time. State keyed by pool address will silently attach to a market you never traded.

Key by `marketId`, or by symbol, and treat the pool as something you read per market rather than remember. Where you do need to tell a pool's successive markets apart, the pair `(poolAddress, nonce)` identifies one of them, and `nonce` is what an outcome id carries. It can be `null` on a market discovered from a live event, in which case the next snapshot fills it in.

### 13. Do not parse the question text

The market's creation event carries `asset` and `intervalSec` as typed fields, and the indexer exposes both on `Market`. Read those. The question wording has changed several times, the fields have not, and a regex over "BTC closes at or above its opening price" breaks the next time someone rewords it.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/event-contracts/gotchas.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
