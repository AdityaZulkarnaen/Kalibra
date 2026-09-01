> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/event-contracts/market-structure.md).

# Market Structure & Lifecycle

## One market, four contracts

Every event-contract market is a small family of contracts deployed per window:

| Piece                 | Role                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `BinaryMarketsModule` | The registry and user entry point. Holds every market's record (`markets(marketId)`), routes complete-set mints/merges and redemptions. |
| Market contract       | Per-window lifecycle state: trading window, resolution, winning outcome.                                                                |
| Pool (order book)     | The CLOB you trade on. Extends the same on-chain matching engine as spot, and owns all escrow.                                          |
| `OutcomeToken6909`    | One shared ERC-6909 singleton for all markets — Up and Down positions are token *ids* on it, not separate ERC-20 deploys.               |

Markets are identified by a `bytes32 marketId` (a module-scoped counter). **Key your state by `marketId` or symbol, never by pool address**: pools are recycled across successive windows of a series, so a pool address is a time-varying binding.

## Lifecycle

```
Listed → Trading → Locked → Resolved | Voided
  0        1          2         4        5
```

* **Listed (0)** — deployed, not yet open.
* **Trading (1)** — the only state that accepts orders. Mint/merge of complete sets is live.
* **Locked (2)** — the window ended; no new orders, cancels still work. Awaiting the settlement price.
* **Resolved (4)** — winning side fixed; winners redeem 1 USDso per contract (less the venue settlement fee — 0 on dreamDEX).
* **Voided (5)** — no reliable settlement price inside the settlement window; both sides redeem at 0.5.

Status transitions are time-derived on-chain — read the market's live status before every write; the indexed status lags by seconds. (An intermediate `Settling (3)` exists in the enum but is effectively never observable.)

## The order book: one book, two sides

Up and Down trade on a **single** order book quoted in Up terms; a Down price is always `1 − up price`. Crossing orders settle by one of four paths:

| Crossing pair        | Path            | What happens                                                            |
| -------------------- | --------------- | ----------------------------------------------------------------------- |
| Buy Up × Sell Up     | direct          | Up tokens ↔ collateral swap                                             |
| Buy Down × Sell Down | direct          | Down tokens ↔ collateral swap                                           |
| Buy Up × Buy Down    | **mint-a-pair** | Both pay collateral; the pool mints a fresh Up/Down pair, one side each |
| Sell Up × Sell Down  | burn-a-pair     | Both positions burn; each seller is paid their share                    |

Mint-a-pair is the cold-start mechanism: two opposite-side buyers need no seller and no market maker — which also means you can quote **both sides with zero inventory** (a resting Buy Up at *p* plus Buy Down at *1 − p* is a complete two-sided quote).

## Escrow and complete sets

* **Buys** escrow collateral at placement (worst case, vault-first: your per-pool vault balance is spent before your wallet).
* **Sells** escrow the outcome tokens themselves — you can only sell what you hold. New tokens come from minting a **complete set**: 1 USDso mints 1 Up + 1 Down (`mintCompleteSet`), and merging a pair returns 1 USDso (`mergeCompleteSet`).
* Refunds settle in your **wallet**. Cancelling a resting bid returns the exact escrow to it, and a taker is charged the fill price rather than the price it offered. The pool vault is a payout fallback that reads 0 in normal operation, which is why placement can draw it first without you ever seeing a balance there.

## Settlement rail

Resolution is oracle-driven and permissionless to observe: the settlement reference for each market is published, results are checked against the window's opening price, and redemption is served on-chain. The protocol supports a one-time settlement fee on winning redemptions; dreamDEX sets every fee — maker, taker, and settlement — to zero.

### Who triggers resolution

Nobody has to — the chain does. Each market's settlement question is scheduled on the oracle hub at creation, with the gas for its future resolution reserved up front. When the oracle posts the settlement answer at expiry, **Somnia's on-chain reactivity delivers that event straight to the hub's callback** — no keeper, no cron job, no operator in the loop. The hub hands the result to the `BinaryMarketsModule` (the only address a market trusts as its settler), the market flips to Resolved or Voided, and finalization happens in the same flow, so redemption opens immediately.

Two permissionless backstops cover a missed callback:

* `pokeOracle(questionId)` pulls a posted answer manually and resolves the market.
* Once the settlement window passes with no answer, anyone can call the market's `voidExpired()` — it voids, and both sides redeem at 0.5.

A market can never strand funds waiting on someone's permission.

### Auditing a resolution

How the *answer itself* is produced is public. A market row carries an `oracleQuestionId`, and that id is the question's number on the oracle explorer, so you can deep-link any market straight to its own resolution:

```
https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph
```

The Graph tab walks the pipeline for that market: the on-chain question definition, every price source with the value it returned and a receipt, the median across them, the minimum number of sources that had to succeed, and the interval the median fell into. Worth surfacing in any interface you build on top of event contracts.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/event-contracts/market-structure.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
