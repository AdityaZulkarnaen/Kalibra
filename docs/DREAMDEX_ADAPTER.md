# DreamDEX Adapter — the integration boundary

**This is the most dangerous document in the repository.** Everything in it about DreamDEX
is unverified. Read §1 before writing a line of adapter code.

---

## 1. What is actually known

At specification time, the DreamDEX Event Contracts API documentation was not accessible.
The following is what could be established from public sources, and nothing beyond it
should be treated as fact.

**Update, 1 Sep 2026.** Documentation has since been located and read. It resolves several
of the questions below on paper. Read this section for the framing and then read the
discovery log in §7.1 for what is now documented — but note that documented is not
verified, and §5 Step 3 still governs what may be relied on in code.

**Established:**

- DreamDEX is a fully on-chain central limit order book on Somnia, covering spot, perps,
  and event contracts, with zero protocol fees.
- Event Contracts are an Up / Down feature: traders take a position on market direction
  over a fixed window. They trade on the same CLOB and resolve on-chain.
- The platform ships REST and WebSocket APIs, CCXT-compatible infrastructure, MCP
  support, and native `AGENTS.md` / `SKILL.md` integrations aimed at bots and agents.
- Somnia provides on-chain reactivity, letting contracts and agents respond to fills,
  price movements, and order book events.
- The Somnia mainnet WebSocket endpoint is `wss://api.infra.mainnet.somnia.network/ws`.
  Testnet STT tokens are available from a faucet linked on the hackathon page.

**Not established — every one of these is an open question:**

Endpoint paths. Field names. Authentication scheme. Rate limits. Pagination. Whether
prices are quoted in probability units or elsewhere. Token decimals. Whether both UP and
DOWN are separately quoted instruments or one instrument with a side flag. How settlement
is published. Whether historical trades are queryable at all. Whether there is more than
one strike per window.

**Because CCXT compatibility is claimed, the CCXT unified API is the highest-probability
starting point for the discovery in §5.** Do not assume it covers event contracts; CCXT's
unified model has no native binary-option concept, so event contracts are likely served by
a bespoke endpoint even if spot follows CCXT conventions.

---

## 2. The rule

> Nothing outside `packages/adapter-dreamdex` may know that DreamDEX exists.

No URL, no field name, no header, no DreamDEX-specific type. Downstream code consumes the
canonical types in §3 and nothing else.

The reason is scheduling, not aesthetics. When the real API contradicts this document —
and it will — the blast radius must be one directory. If the indexer, the scoring
pipeline, and the tests all speak DreamDEX's native shapes, a surprise on day 6 requires
rewriting all three at once, and there is no time for that.

---

## 3. Canonical types

These are ours. They are chosen for what Kalibra needs, not for what any API returns.
They are stable. If DreamDEX turns out to be shaped differently, the mapping changes and
these do not.

```ts
// packages/adapter-dreamdex/src/canonical.ts

/** A tradeable Event Contract window. */
export interface CanonicalMarket {
  /** Stable unique id. If the venue has no such id, synthesise one and document how. */
  marketId: string;
  /** Underlying symbol, e.g. "BTC-USD". Venue-native string, uppercased. */
  underlying: string;
  /** Window open, ms since epoch, UTC. */
  windowStart: number;
  /** Window close, ms since epoch, UTC. Settlement is evaluated at this instant. */
  windowEnd: number;
  /**
   * Reference level the UP/DOWN claim is measured against, in underlying quote units,
   * scaled by `strikeDecimals`. Null if the venue defines UP purely as
   * "higher than window-open price".
   */
  strike: bigint | null;
  strikeDecimals: number;
  status: 'OPEN' | 'CLOSED' | 'SETTLED' | 'VOID';
}

/** One executed trade against an Event Contract. */
export interface CanonicalTrade {
  /** Venue-native unique trade id. Used as the idempotency key. */
  tradeId: string;
  marketId: string;
  /** Lowercased 0x-prefixed EVM address. */
  wallet: string;
  /** Normalised to the UP frame. See §4.1. */
  side: 'UP' | 'DOWN';
  /**
   * Market-implied P(UP) at execution, in [0,1]. Mid of book preferred.
   * See SCORING_SPEC §2 for normalisation and clamping rules.
   */
  impliedProbUp: number;
  quoteSource: 'MID' | 'LAST';
  /** Amount risked, base units of the settlement token. */
  stake: bigint;
  stakeDecimals: number;
  /** ms since epoch, UTC. */
  timestamp: number;
  /** Somnia transaction hash if available. Null if the feed does not expose it. */
  txHash: string | null;
}

/** Resolution of a market. */
export interface CanonicalSettlement {
  marketId: string;
  /** 'UP' | 'DOWN' | 'VOID'. VOID excludes every position in the market from scoring. */
  outcome: 'UP' | 'DOWN' | 'VOID';
  /** Final observed level, same scaling as CanonicalMarket.strike. */
  settlementLevel: bigint | null;
  settledAt: number;
  txHash: string | null;
}

/** Point-in-time book state, for backfilling `impliedProbUp` when the trade feed omits it. */
export interface CanonicalQuote {
  marketId: string;
  bestBidUp: number | null;
  bestAskUp: number | null;
  midUp: number | null;
  lastUp: number | null;
  timestamp: number;
}

/** An order Kalibra Guard may forward. */
export interface CanonicalOrder {
  marketId: string;
  side: 'UP' | 'DOWN';
  stake: bigint;
  /** Null for market orders. Probability units, [0,1]. */
  limitProb: number | null;
  clientOrderId: string;
}

export interface CanonicalOrderResult {
  accepted: boolean;
  venueOrderId: string | null;
  txHash: string | null;
  /** Venue's own rejection text, verbatim. Never parsed for control flow. */
  rejectReason: string | null;
}
```

Every one of these has a matching Zod schema in the same file, and **every value crossing
the boundary is parsed, not cast** (invariant I4).

---

## 4. Normalisation rules

The adapter is responsible for all of these. Downstream code assumes they have happened.

**4.1 Side normalisation.** Whatever the venue calls it — `buy`/`sell`, `yes`/`no`,
`long`/`short`, `call`/`put` — the adapter maps to `UP`/`DOWN`. If UP and DOWN are separate
instruments, a trade in the DOWN instrument becomes `side: 'DOWN'` with
`impliedProbUp = 1 − priceDown`. There is exactly one place in the codebase where this
inversion happens, and it is here.

**4.2 Probability normalisation.** `impliedProbUp` is always P(UP) in `[0,1]`. If the venue
quotes in basis points, cents, or ticks, convert here. Record the raw venue value in the
adapter's debug log, not in the canonical type.

**4.3 Address normalisation.** Lowercase, `0x`-prefixed. Never checksummed. Case-mismatched
addresses would silently split one trader into two wallets, which corrupts every score.

**4.4 Time normalisation.** Milliseconds since epoch, UTC, always. If the venue sends
seconds, multiply here. If it sends an ISO string, parse here. Downstream code never sees
a string timestamp.

**4.5 Decimals.** Carry `stakeDecimals` explicitly rather than assuming 6 or 18. Do not
normalise stakes to a common scale in the adapter — carry the scale and let the display
layer divide. Premature scaling loses precision irrecoverably.

---

## 5. Discovery protocol

Run this **before** writing `LiveAdapter`. It is roughly two hours of work and it replaces
a week of debugging.

**Step 1 — Find the documentation.** Check, in order: `docs.dreamdex.io`, a `/docs` path
on the main site, the hackathon page's resource links, and the pinned messages in the
hackathon Telegram (`https://t.me/+XHq0F0JXMyhmMzM0`). The DreamDEX `SKILL.md` and
`AGENTS.md` files, if published, are the highest-value artefacts — they are written for
exactly this purpose.

**Step 2 — Ask.** Post in the Telegram dev channel. Ask these six questions verbatim:

1. What is the REST base URL and the WebSocket URL for Event Contracts on testnet?
2. Is authentication required for public market data, and if so what scheme?
3. Are UP and DOWN separate instruments, or one instrument with a side field?
4. In what units is an Event Contract price quoted — probability, cents, or ticks?
5. Is there an endpoint for historical trades, and how far back does it reach?
6. How is settlement published — a WebSocket event, a REST poll, or an on-chain log only?

Question 6 matters most. If settlement is on-chain only, the adapter needs a viem log
subscription against Somnia and the contract address, which is a different piece of work
from a WebSocket subscription. Find out on day 1, not day 5.

**Step 3 — Capture, do not transcribe.** For each endpoint discovered, save a raw
response into `fixtures/recorded/` with `scripts/record.ts`. The captured payload is the
source of truth for the mapping. Reading the docs and typing what they say produces
transcription errors; capturing the actual bytes does not.

**Step 4 — Write the mapping table.** Fill in §6 below. One row per canonical field. An
unfilled row is a blocker, not a detail.

**Step 5 — Write `LiveAdapter` against the captured fixtures.** Its unit tests parse the
recorded payloads and assert canonical output. This means `LiveAdapter` is tested without
network access, which keeps invariant I3 intact.

---

## 6. Mapping table

**Fill this in during Step 4. Do not delete rows. `?` means unknown and blocks live mode.**

**Provenance.** Rows marked ☑ are backed by payloads captured from the Shannon testnet
indexer on 1 Sep 2026 and committed under
`fixtures/recorded/dreamdex-testnet-2026-09-01/`. Rows still marked ☐ are documentation
only. The source column names GraphQL fields on the indexer at
`https://dev.smk.somnia.host/v1/graphql`; the read surface needs no key.

| Canonical field | DreamDEX source | Transform | Verified |
|---|---|---|---|
| `CanonicalMarket.marketId` | `Market.marketId`, a `bytes32` counter | lowercase hex, as given | ☑ |
| `CanonicalMarket.underlying` | `Market.asset`, e.g. `"BTC"` | uppercase | ☑ |
| `CanonicalMarket.windowStart` | `Market.tradingStart`, seconds | × 1000 | ☑ |
| `CanonicalMarket.windowEnd` | `Market.expiry`, seconds | × 1000 | ☑ |
| `CanonicalMarket.strike` | `Market.strike` | `"0"` → null (the line is the window's opening price); otherwise → bigint. See U22 | ☑ |
| `CanonicalMarket.strikeDecimals` | `?` — the scale of a non-zero strike is unconfirmed | see U22 | ☐ |
| `CanonicalMarket.status` | `Market.clobStatus`, plus `finalized` and `voided` | `Finalized` + `voided` → VOID, `Finalized` → SETTLED, else OPEN/CLOSED | ☑ |
| `CanonicalTrade.tradeId` | `Fill.id`, already `${blockNumber}_${logIndex}` | as given — a natural idempotency key | ☑ |
| `CanonicalTrade.wallet` | `Fill.taker`, and `Fill.maker` for the other leg | lowercase | ☑ |
| `CanonicalTrade.side` | `Fill.takerSide` / `makerSide`: `BUY_YES`, `SELL_YES`, `BUY_NO`, `SELL_NO` | BUY_YES and SELL_NO → UP; SELL_YES and BUY_NO → DOWN | ☑ |
| `CanonicalTrade.impliedProbUp` | **not** `Fill.fillPrice` — the reconstructed mid at block − 1. See 7.2 | already in [0,1] at `quoteDecimals`; clamp per `SCORING_SPEC.md` §2 | ☑ |
| `CanonicalTrade.stake` | `Fill.quoteQuantity`, the collateral that changed hands | as given, bigint base units | ☑ |
| `CanonicalTrade.stakeDecimals` | `Market.quoteDecimals` — **6** on testnet | carry, never normalise | ☑ |
| `CanonicalTrade.timestamp` | `Fill.timestamp`, seconds | × 1000 | ☑ |
| `CanonicalTrade.txHash` | `Fill.txHash` | lowercase | ☑ |
| `CanonicalSettlement.outcome` | `Market.voided`, `Market.winningOutcome` (0 = YES) | voided → VOID, 0 → UP, 1 → DOWN | ☑ |
| `CanonicalSettlement.settledAt` | `Market.resolvedAtTimestamp`, seconds | × 1000 | ☑ |
| `CanonicalQuote.midUp` | derived from `Order` rows: `price`, `side`, `rested`, `quantityRemaining`, `placedAtBlock`, `lastUpdatedAtBlock` | reconstruct at block − 1; see 7.2 | ☑ |
| `CanonicalOrder` → venue request | `exchange.createOrder(symbol, 'limit', side, qty, price)` | quantise to tick and lot first | ☐ |

## 7. Unknowns checklist

Track resolution here. Add rows as new unknowns surface; never delete one.

**Status vocabulary.** `OPEN` — no answer. `DOC` — answered by the published
documentation, whose bytes are archived in `fixtures/recorded/docs-snapshot-2026-09-01/`,
but **not** by a captured API payload. `VERIFIED` — a recorded payload demonstrates it.
Only `VERIFIED` unblocks live mode. A `DOC` row may guide design; it may not be trusted by
code without a fallback.

| # | Question | Impact if wrong | Status |
|---|---|---|---|
| U1 | REST base URL and WS URL for testnet | Live mode cannot connect | DOC, but **not the path we need** — the spot HTTP API is `https://stg.api.dreamdex.io/v0` on testnet with WS `wss://stg.api.dreamdex.io/v0/ws/public`, and per U13 it serves no event contracts. The event-contract surface is the SDK. See U19 |
| U2 | Auth scheme for public market data | Live mode cannot connect | DOC — SIWE (ERC-4361) is documented for the spot HTTP API. Event-contract market data is chain and indexer reads; no authentication is documented for reading, and a private key is documented only for writes |
| U3 | UP/DOWN as separate instruments or one with a side flag | Side normalisation inverted; **every score wrong and the error is invisible** | **VERIFIED** — one book, four side values: `BUY_YES`, `SELL_YES`, `BUY_NO`, `SELL_NO` |
| U4 | Price quote units | `impliedProbUp` out of range or silently scaled wrong | **VERIFIED** — `fillPrice: "614000"` at `quoteDecimals: 6` is 0.614 |
| U5 | Historical trade endpoint and depth | No backfill; scores only from indexer start | **VERIFIED** — a settled market returns its full fill tape and every order that ever rested on it |
| U6 | Settlement publication mechanism | Outcomes never arrive; nothing ever scores | DOC — an oracle posts the answer at expiry and on-chain reactivity delivers it to the module callback; no keeper. Backstops: `pokeOracle(questionId)` and permissionless `voidExpired()`. 7.1(c) |
| U7 | Settlement token and its decimals | `MIN_STAKE_BASE` threshold wrong by orders of magnitude | **VERIFIED on testnet** — `Market.quoteDecimals: 6`, which is what `MIN_STAKE_BASE` assumes. Mainnet is 18 and out of scope |
| U8 | Is mid-of-book available at trade time, or only last price | Falls back to `LAST`, degrading forecast accuracy | **VERIFIED** — no mid is served, and the book is reconstructable. Resolved by U18 and 7.2 |
| U9 | Multiple strikes per window, or a single window-open reference | Affects market identity and grouping | **VERIFIED, and more complicated than documented** — see U22 |
| U10 | Are trades attributed to a wallet address in the public feed | **If not, Kalibra cannot function as designed.** See section 8 | **VERIFIED** — every `Fill` row carries `maker` and `taker`. Plan A stands |
| U11 | Rate limits on REST and WS | Ingestion gets throttled or banned mid-demo | DOC — documented as none. Not stress-tested, and not worth stress-testing |
| U12 | Whether VOID or cancellation is possible | Void positions scored as real losses | DOC — yes. Voided (5); both sides redeem at 0.5; `voidExpired()` is permissionless once the settlement window has passed. 7.1(c) |
| U13 | Does any HTTP endpoint serve event contracts | Decides whether ingestion is REST, SDK, or chain logs — the shape of `LiveAdapter` | DOC — no. The documentation states the HTTP API covers spot only and has no event-contract endpoints; the developer surface is the `@somnia-chain/markets-sdk` TypeScript package, version 0.28.0 or newer |
| U14 | Does the event-contract book emit the same `OrderFilled` events as the spot order book | Decides which logs a raw-chain ingestion path would subscribe to | DOC-partial — the per-market pool is documented as extending the same on-chain matching engine as spot, which makes the same events likely, but it is not stated outright. Now low priority: U10 means the indexer serves attributed fills directly, so raw log decoding is a fallback rather than the plan |
| U15 | `OrderFilled` carries taker and maker order ids, not addresses | A raw-chain path needs a join from fill back to placement | **CLOSED** — moot. The indexer attributes fills directly, so no join is needed |
| U16 | `loadMarkets()` omits settled markets | Settled markets — the only scoreable ones — would be invisible to the indexer | DOC — use `listPastBinaryMarkets({ status: "Finalized" })`. Note `Resolved` returns an empty list, because resolution auto-finalizes |
| U17 | Somnia testnet chain id and RPC URL | Cannot point viem at the right chain | **VERIFIED** — Shannon, chain id 50312, RPC `wss://api.infra.testnet.somnia.network/ws` |
| U18 | `SCORING_SPEC.md` §2 wants the **mid at execution**, but the venue serves a fill tape and derivable order rows, not a mid time series | Using the fill price instead conflates forecasting skill with execution quality — the exact error §2 exists to prevent | **DECIDED 1 Sep 2026: reconstruct the book.** See 7.2 |
| U19 | The `indexerUrl` the SDK client is constructed with | Without it `LiveAdapter` cannot be constructed at all | **VERIFIED** — testnet `https://dev.smk.somnia.host/v1/graphql`; a GraphQL indexer, queried directly in the capture |
| U20 | Is reading another wallet's fills permissionless | If privileged, U10 collapses back to Plan B or C | **VERIFIED — permissionless.** The capture was taken anonymously: no key, no wallet, no signature |
| U21 | How a mint-a-pair fill appears in the tape | Buy Up × Buy Down crosses with no seller and the pool mints a fresh pair. If it is one row, side attribution for one of the two counterparties is ambiguous | OPEN — affects `CanonicalTrade` construction and therefore §4.1 aggregation |

| U22 | `Market.strike` is `"0"` on the captured market, whose question reads "closes at or above its opening price", but sibling markets carry concrete strikes such as `245100` | A strike read as an opening-price reference, or the reverse, mislabels what the contract actually claims | OPEN — both shapes exist on testnet. The scale of a non-zero strike is also unconfirmed. Only the `"0"` shape has been captured end to end |
| U23 | The book is four-sided, and a `BUY_YES` can cross a `BUY_NO` by minting a pair rather than matching a seller | Folding NO orders into the UP frame is the one inversion in the codebase; getting it backwards inverts every reconstructed mid | **VERIFIED for the fold** — the reconstruction is uncrossed at all three captured fills. Mint-a-pair crossing is documented but not yet observed in a capture |
| U24 | A fully-filled order keeps its price in the order rows | Counted as liquidity it silently crosses the book and corrupts the mid | **VERIFIED** — filter on `rested` and `quantityRemaining > 0`. This mistake was made and caught during the capture |

**U3 and U10 were the existential pair. Both are now VERIFIED by capture**, and so is U20,
the question they rested on. Reading another wallet's fills needs no key: the payloads in
`fixtures/recorded/dreamdex-testnet-2026-09-01/` were taken anonymously. Plan A stands
without a fallback being needed.

What remains open is narrower and none of it is existential: U22 (what a non-zero strike
means and at what scale), U23 (mint-a-pair crossing, documented but not yet observed), and
the write path, which is untested because it needs a funded wallet.

### 7.1 Discovery log

Captured 1 Sep 2026 with `curl`, from public pages only. No credential was used and no
message was posted. **The bytes are archived verbatim in
`fixtures/recorded/docs-snapshot-2026-09-01/`**, so every line below can be checked
against its source. Nothing here has been written into code.

**(a) What exists.** `docs.dreamdex.io` publishes a page index at `/llms.txt`, a full
corpus at `/llms-full.txt`, and markdown for any page by appending `.md`. There is a
developer section specific to event contracts. `SKILL.md` and `AGENTS.md` are **not**
published there — both URLs return a GitBook "Page Not Found" body under HTTP 200, which
is a soft 404 and must not be mistaken for a hit. A real `SKILL.md` exists in the
`somnia-chain/somnia-dex-cli` repository, but it documents the spot CLI and does not
mention event contracts at all.

**(b) The instrument.** Up and Down trade on a single order book quoted in Up terms; a
Down price is always 1 minus the Up price. Outcome symbols look like
`BTC-0-12AUG26-1600/USDso#YES`. Prices are Up probabilities in (0, 1). Four crossing paths
exist — direct Up, direct Down, mint-a-pair (two buyers, no seller) and burn-a-pair — of
which mint-a-pair is the one with consequences for us; see U21.

**(c) Lifecycle.** Listed 0, Trading 1, Locked 2, Settling 3 (documented as effectively
never observable), Resolved 4, Voided 5. Markets are keyed by a `bytes32 marketId` from
the module registry; pools are **recycled across successive windows**, so a pool address is
a time-varying binding and must never be used as an identity. Resolution needs no keeper.
Voided markets redeem both sides at 0.5.

**(d) What the contract actually claims.** "If the asset closes the window at or above its
opening price, Up wins; below, Down wins." The reference is the window's own opening
price, not a listed strike, so there is one line per window and the boundary is inclusive
on the Up side. `getMarketResolution(marketId)` returns `openingAnswer.numericValue` and
`closingAnswer.numericValue`; comparing those two reproduces the settlement. Each market
carries an `oracleQuestionId` that deep-links to a public resolution graph.

**(e) History and attribution.** `getFills(pool, { since, until })` is the trade tape and
`getUserFills(account, opts)` is the same tape filtered to one wallet. Fills carry
`blockNumber` and `logIndex` for exact ordering — a natural idempotency key. Fills, orders
and candles all survive settlement, and a five-week-old finalized market still returns its
full tape. Two traps: history reads are keyed on the **pool**, which serves many markets,
so every read must be scoped to the market's own window; and there is no order-book
snapshot table, which is what makes U18 a decision rather than a lookup.

**(f) Collateral.** Testnet collateral is tUSDC at 6 decimals; mainnet is USDso at 18. The
documentation is explicit that the scale must be derived from the token's `decimals()`
rather than a literal, because a wrong constant misprices everything and nothing reverts.
This directly concerns `MIN_STAKE_BASE` in `SCORING_SPEC.md` §1, which assumes 6 — correct
for testnet, wrong by 10^12 for mainnet. Testnet collateral has no faucet page: the token
mints on demand via `faucet(uint256)`, capped at 10,000 tUSDC, crediting `msg.sender`. STT
for gas comes from the Somnia testnet faucet.

### 7.2 Decision on U18 — the quote source

`LiveAdapter` reconstructs the order book at each fill's block and takes the **mid**, per
`SCORING_SPEC.md` §2. It does not use the fill price.

Every resting order carries `placedAtBlock` and `lastUpdatedAtBlock`, so the set of orders
alive at a given block is derivable: take every order placed at or before that block whose
last update is after it, split by side, and the best bid and best ask give the mid. Fills
carry `blockNumber` and `logIndex`, so each one has an exact block to reconstruct against.

The cheaper path was available and was **not** taken. §2 permits falling back to the last
trade price with `quote_source = 'LAST'`, and that would have cost almost nothing. It was
rejected because the fill price is the trader's own execution, so a trader who crosses a
wide spread would be scored as making a more extreme forecast than they actually made —
the precise error §2 exists to prevent, and one that is invisible in the output.

Consequences, stated plainly:

- This is the expensive option. It is roughly a day of adapter work and it is the reason
  `LiveAdapter` is the largest single piece of remaining risk.
- It depends on venue behaviour that is documented but **not captured** (U19, U20). If the
  order rows turn out not to carry what the documentation says, the fallback is
  `quote_source = 'LAST'`, and that degradation must be visible in the data and stated in
  the UI rather than absorbed silently.
- Replay mode is unaffected. Synthetic fixtures carry `quoteSource: 'MID'` by construction,
  so nothing already built changes.

**(g) Still needs a human.** The six questions of §5 Step 2 in the hackathon Telegram —
now reducible to essentially one, U20 — and a funded testnet wallet. Both require an
account the agent does not have.

---

## 8. Contingency for U10

> **Decided 1 Sep 2026: Plan A is in effect.** U10 came back documented — the venue's own
> indexer serves a wallet-attributed fill tape, pool-wide and filtered per account — so
> attribution does not need the raw-log route this section was written to anticipate.
> Plan A therefore means *read the indexer's fill tape*, which is cheaper than the on-chain
> decoding described below; the log path stays documented as the fallback if the indexer
> read turns out to be privileged (U20). Plan C remains the floor. Also decided: the
> project targets **Somnia Shannon testnet only** (chain id 50312), which fixes the
> collateral scale at six decimals and makes `MIN_STAKE_BASE` correct as written — see U7.
> Both decisions are recorded in the README.

If the public trade feed does not attribute trades to wallet addresses, the design as
written cannot work. Do not improvise. The fallback, in order of preference:

**Plan A — on-chain attribution.** Read fills from Somnia logs with viem. The CLOB settles
on-chain, so the taker address is almost certainly recoverable from event logs even if the
REST feed omits it. This becomes the primary ingestion path and the WebSocket becomes a
latency optimisation. Costs roughly a day.

**Plan B — opt-in attribution.** Traders register a wallet with Kalibra and Kalibra reads
their positions through an authenticated endpoint. Reduces coverage to registered users
only, which weakens the leaderboard but leaves Arena and Guard fully intact — agents
register anyway.

**Plan C — Arena-only.** Kalibra scores only agents that trade through Guard, where
attribution is guaranteed because Guard placed the order. The Index becomes a view over
Arena. This is a smaller product but it is complete, honest, and still demonstrates the
full scoring stack.

Plan C is always available and requires no external cooperation. Treat it as the floor:
**the project cannot fail to ship, only ship smaller.** Decide by end of day 2 which plan
is in effect and record it in the README.

---

## 9. ReplayAdapter and fixtures

`ReplayAdapter` implements the same interface from files in `fixtures/`. It is not a mock
in the testing sense — it is a first-class adapter that the demo and most tests run
against.

```
fixtures/
├── synthetic/          generated by scripts/generate-fixtures.ts, LCG seed 42
│   ├── markets.json
│   ├── trades.json
│   └── settlements.json
├── recorded/           captured from live DreamDEX via scripts/record.ts
└── expected/
    └── demo-output.json
```

**Synthetic generation** uses the same LCG defined in `SCORING_SPEC.md` §8 V4, so fixture
data and test vectors come from one reproducible source. Generate:

- 60 markets across 3 underlyings, sequential 15-minute windows (20 windows each)
- 25 wallets with edges spread over `[0.42, 0.68]`, assigned deterministically by index
- 40 to 120 trades per wallet, stakes log-uniform over `[1, 500]` USDso
- 3 wallets that wash trade, to exercise the netting path in `SCORING_SPEC` §4.3
- 2 wallets below `MIN_STAKE_BASE`, to exercise exclusion
- 1 market that settles `VOID`

**Why these numbers, revised 1 Sep 2026.** The first version specified 12 markets and 8 to
40 trades per wallet, and it could not work. Aggregation keeps one position per wallet per
market (`SCORING_SPEC.md` §4.2), so 12 markets cap a wallet at 12 resolved positions while
`MIN_SAMPLE` is 30 — every wallet was `PROVISIONAL` by construction and no leaderboard
could rank anyone. Sixty markets with 40 to 120 trades gives a typical wallet roughly 30 to
50 distinct positions, so some wallets cross the threshold and some do not, which is what
the product needs to demonstrate. **Do not shrink these back without re-checking that
arithmetic.**

`ReplayAdapter` yields events in timestamp order with delays collapsed to zero, so
`pnpm demo` finishes in seconds.

**`fixtures/expected/demo-output.json` is regenerated only by deliberate act.** If a code
change alters it, that is either a bug or an intended change to the scoring math, and the
diff must be explained in the commit message. This file is the regression test for the
entire pipeline.

---

## 10. Somnia access

Independent of DreamDEX and therefore lower risk.

- Chain access via viem with a custom chain definition for Somnia testnet
- WebSocket for logs; mainnet is `wss://api.infra.mainnet.somnia.network/ws`, testnet URL
  to be confirmed from Somnia's docs
- Test STT from the faucet linked on the hackathon page
- Used for: settlement verification, transaction hashes for the README's evidence table,
  and Plan A attribution under §8

Somnia's on-chain reactivity is **not required** by this design. If time remains after P0
and P1 are complete, the highest-value use of it would be an on-chain score attestation —
publishing a wallet's Kalibra Score to a contract so other protocols can read it. That is
a P2 stretch goal and must not be started before `SUBMISSION.md` is fully checked off.
