# Captured from the DreamDEX testnet indexer, 1 Sep 2026

Real payloads, fetched anonymously with `curl` from `https://dev.smk.somnia.host/v1/graphql`
(the Shannon testnet indexer named in the `@somnia-chain/markets-sdk` README). No API key,
no wallet, no signature — the read surface is public, which is itself the answer to U20.

These are the first captured payloads in the repository. Everything in
`docs/DREAMDEX_ADAPTER.md` §6 marked Verified rests on the bytes in this directory.

| File | What it is |
|---|---|
| `market.json` | One settled binary market, `0x…ff46` — a 15-minute BTC window |
| `fills.json` | All three fills in that market |
| `orders.json` | The orders needed to reconstruct the book at each fill, plus four fully-filled and two never-rested orders as negative cases |
| `markets-recent.json` | Six recent binary markets, showing the range of strike and status values |

`orders.json` is reduced from the 2,313 rows the market actually has, to the 21 that the
reconstruction touches. The reduction is by construction, not by sampling: every order
resting at one of the three reconstruction blocks is present.

## What these bytes establish

**Fills carry wallet addresses.** Every fill row has `maker` and `taker`. No join back to
the placement is needed, which retires the concern recorded as U15 and answers U10 outright.

**Prices are probabilities.** `fillPrice: "614000"` against `quoteDecimals: 6` is 0.614.

**Sides are four-valued.** `BUY_YES`, `SELL_YES`, `BUY_NO`, `SELL_NO`, with `kind` on the
fill naming the crossing path (`DIRECT_YES` here). A NO order folds into the UP frame as
its complement, and that inversion happens in exactly one place in the codebase.

**Timestamps are seconds.** `1788251474`, not milliseconds. The adapter multiplies.

**Strike is real and varies.** This market carries `strike: "0"` with the question *"BTC
closes at or above its opening price"*, while `markets-recent.json` shows sibling markets
with concrete strikes such as `245100`. Both shapes exist; see U22.

## The mid reconstruction, and why block B − 1

`SCORING_SPEC.md` §2 wants the mid of the book at execution, and the venue serves no mid.
Orders carry `placedAtBlock`, `lastUpdatedAtBlock`, `quantityRemaining` and `rested`, so the
resting book at a block is derivable. Three rules were tested against these three fills:

| Rule | Result |
|---|---|
| Book at the fill's own block | Crossed at 2 of 3 fills |
| Book at the fill's block, minus the taker's own order | Crossed at 1 of 3 |
| **Book at block B − 1** | **Clean at 3 of 3** |

Block B − 1 is also the rule that means something: the mid at execution is the book the
taker faced, which is its state before their transaction landed.

| Fill block | Best bid | Best ask | Mid | Fill price |
|---|---|---|---|---|
| 476784269 | 0.585 | 0.614 | **0.5995** | 0.614 |
| 476784429 | 0.579 | 0.608 | **0.5935** | 0.620 |
| 476786702 | 0.681 | 0.725 | **0.7030** | 0.709 |

Every mid sits below its fill price, and all three takers were buying. That gap is exactly
what §2 exists to keep out of the score: charged the fill price, each of these traders would
be recorded as making a more confident forecast than they actually made.

An order is only liquidity if `rested` is true and `quantityRemaining` is above zero. A
fully-filled order lingers in the data with its original price and will silently cross the
book if counted — that mistake was made and caught while writing this, which is why the
negative cases are committed alongside.
