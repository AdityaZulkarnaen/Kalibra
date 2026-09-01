> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/event-contracts.md).

# Event Contracts

Event Contracts trade on the Somnia Markets on-chain order book. The developer surface is the **`@somnia-chain/markets-sdk`** (TypeScript) — the [HTTP API](/developers/http-api.md) covers spot only and has no event-contract endpoints.

With the SDK you can:

* Discover live markets and stream order books, fills, and candles in real time
* Place and cancel orders by symbol in human units (prices are Up probabilities in (0, 1))
* Mint and merge complete sets (1 USDso ⇄ 1 Up + 1 Down) for sell-side inventory
* Redeem winning positions after settlement

## Install

The SDK is public on npm. Nothing else to configure:

```bash
npm install @somnia-chain/markets-sdk viem
```

Use version 0.28.0 or newer. Two floors matter: below 0.23.0 nothing reads at all, because the indexer dropped the `longOpenInterest` column those versions still ask for and `loadMarkets` and `listBinaryMarkets` both fail; and below 0.28.0 an ordinary float price lands off the tick grid and the pool rejects it. The examples here are TypeScript, so run them with a TypeScript runner such as [`tsx`](https://tsx.is) (`npx tsx bot.ts`).

## A minimal loop

Discover a market, gate on its live on-chain state, read the book, take a position:

```ts
import { SomniaMarkets, isBinaryMarket, type PlaceOrderResult } from "@somnia-chain/markets-sdk";

const exchange = new SomniaMarkets({ indexerUrl, chain, wsRpcUrl, addresses, privateKey });
const markets = Object.values(await exchange.loadMarkets(true));

for (const m of markets) {
  // `info` is a union across market kinds; isBinaryMarket narrows it.
  if (!m.active || !isBinaryMarket(m.info)) continue;

  // The indexer lags: gate every write on the live on-chain status (1 = Trading).
  // Row ids are plain strings; the client wants them hex-typed.
  const onchain = await exchange.client.getMarketOnchain(m.info.marketId as `0x${string}`);
  if (onchain.status !== 1) continue;

  const upSymbol = m.outcomes?.[0]?.symbol;   // e.g. "BTC-0-12AUG26-1600/USDso#YES"
  if (!upSymbol) continue;
  const book = await exchange.fetchOrderBook(upSymbol, 5);
  const ask = book.asks[0]?.[0];
  if (ask === undefined) continue;                    // no resting liquidity yet

  // Cross the touch; IOC so the unfilled remainder never rests silently.
  // From 0.23.0 a reverted write throws a decoded revert error, so let it
  // propagate or catch it here rather than testing a status flag.
  const order = await exchange.createOrder(upSymbol, "limit", "buy", 5, ask + 0.02, { timeInForce: "IOC" });

  // The receipt rides on `info`; the order itself has no `receipt` field.
  const { receipt } = order.info as PlaceOrderResult;
  console.log("filled in", receipt.transactionHash);
}
```

The package README on [npm](https://www.npmjs.com/package/@somnia-chain/markets-sdk) covers the rest of the surface: realtime watches, the React hooks, and the raw trader tier. Types ship with the package, so an editor with TypeScript will autocomplete the whole API.

Go deeper: [Recipes](/developers/event-contracts/recipes.md) has a snippet for every action a bot needs, from resting a quote to redeeming after settlement; [Market Structure & Lifecycle](/developers/event-contracts/market-structure.md) explains the contract family, the four fill paths, and escrow; [Contracts & Addresses](/developers/event-contracts/contracts-and-addresses.md) lists the deployed core.

{% hint style="info" %}
There are no API rate limits: market data is the chain itself, and the public RPC endpoints are unthrottled. A trading system should snapshot once and stay current from on-chain events — the SDK's live watches do exactly this.
{% endhint %}

Two mechanics worth understanding before you build:

* **One book, two sides.** Up and Down trade on a single order book; a Down price is always 1 minus the Up price. Two opposite-side buyers can cross with no seller at all — the pool mints a fresh Up/Down pair from their combined collateral (so you can quote both sides with zero inventory).
* **Markets die on schedule and respawn.** Every window has a hard expiry; the venue rolls a successor automatically. Track the successor via the market list, and note that a settled market leaves the live list — winnings are claimed by scanning recently settled markets.

Read the [Gotchas](/developers/event-contracts/gotchas.md) before sending a real order.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/event-contracts.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
