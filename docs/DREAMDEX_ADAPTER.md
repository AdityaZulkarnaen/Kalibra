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

**Provenance.** Rows prefixed `doc:` come from the documentation archived verbatim in
`fixtures/recorded/docs-snapshot-2026-09-01/`, read 1 Sep 2026. They are *documentation,
not capture*: Step 3 requires a recorded payload before any row is marked Verified, and
**no row below is Verified**. Nothing in this table has been written into code — the
adapter is still unimplemented. Names in the `source` column are the SDK's, and the SDK is
the only documented event-contract surface (U13).

| Canonical field | DreamDEX source | Transform | Verified |
|---|---|---|---|
| `CanonicalMarket.marketId` | doc: `bytes32 marketId` from the module registry. Never the pool address — pools are recycled across windows | → lowercase hex string | ☐ |
| `CanonicalMarket.underlying` | doc: the market's asset, also the symbol prefix, e.g. `BTC` in `BTC-0-12AUG26-1600/USDso#YES` | uppercase | ☐ |
| `CanonicalMarket.windowStart` | doc: the market row's trading start | → ms UTC | ☐ |
| `CanonicalMarket.windowEnd` | doc: the market row's expiry | → ms UTC | ☐ |
| `CanonicalMarket.strike` | doc: **null.** There is no listed strike — the line is the window's own opening price (`getOpeningPrices`, `getMarketResolution().openingAnswer`) | always null; carry the opening price separately if needed | ☐ |
| `CanonicalMarket.status` | doc: Listed 0, Trading 1, Locked 2, Settling 3, Resolved 4, Voided 5 | 0/1 → OPEN, 2/3 → CLOSED, 4 → SETTLED, 5 → VOID | ☐ |
| `CanonicalTrade.tradeId` | doc: fills carry `blockNumber` and `logIndex` | compose `${blockNumber}:${logIndex}` — stable, and the natural idempotency key | ☐ |
| `CanonicalTrade.wallet` | doc: fill rows are wallet-attributed — `getUserFills(account)` filters the same tape to one account. Subject to U20 | lowercase, never checksummed | ☐ |
| `CanonicalTrade.side` | doc: one book quoted in Up terms; outcome symbol suffix `#YES` / `#NO`; a Down price is 1 − the Up price | → UP/DOWN | ☐ |
| `CanonicalTrade.impliedProbUp` | doc: prices are Up probabilities in (0, 1). **But a fill price is not a mid** — see U18 | clamp per `SCORING_SPEC.md` §2; set `quoteSource` honestly | ☐ |
| `CanonicalTrade.stake` | doc: collateral risked, quantity × price, in base units of the pool's collateral token | → bigint, no scaling | ☐ |
| `CanonicalTrade.stakeDecimals` | doc: 6 on testnet (tUSDC), 18 on mainnet (USDso) — read `decimals()`, never a literal (U7) | carry, do not normalise | ☐ |
| `CanonicalTrade.timestamp` | doc: fill row block time; `getFills(pool, { since, until })` bounds in ms | → ms UTC | ☐ |
| `CanonicalSettlement.outcome` | doc: state 4 → compare `closingAnswer.numericValue` with `openingAnswer.numericValue`, **at or above → UP**, below → DOWN. State 5 → VOID | compare, inclusive on the Up side | ☐ |
| `CanonicalSettlement.settledAt` | doc: lifecycle `events` on `getMarketResolution(marketId)` | → ms UTC | ☐ |
| `CanonicalQuote.midUp` | doc: **not served.** No order-book snapshot table; derivable from order rows via `placedAtBlock` / `lastUpdatedAtBlock`, or approximable from candles | see U18 before implementing | ☐ |
| `CanonicalOrder` → venue request | doc: `createOrder(symbol, 'limit', side, qty, price, { timeInForce })`, or the raw trader tier for exact bigint units | quantise to tick and lot first | ☐ |

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
| U3 | UP/DOWN as separate instruments or one with a side flag | Side normalisation inverted; **every score wrong and the error is invisible** | DOC — one book quoted in Up terms; a Down price is always 1 − the Up price. Outcome symbols carry `#YES` / `#NO`. 7.1(b) |
| U4 | Price quote units | `impliedProbUp` out of range or silently scaled wrong | DOC — prices are Up probabilities in (0, 1), already the quantity `SCORING_SPEC.md` §2 calls `p`. 7.1(b) |
| U5 | Historical trade endpoint and depth | No backfill; scores only from indexer start | DOC — answered well. Fills, orders and candles all survive settlement; a five-week-old finalized market still returns its full trade tape. `listPastBinaryMarkets` pages with limit and offset, `countBinaryMarkets` gives the tail length. 7.1(e) |
| U6 | Settlement publication mechanism | Outcomes never arrive; nothing ever scores | DOC — an oracle posts the answer at expiry and on-chain reactivity delivers it to the module callback; no keeper. Backstops: `pokeOracle(questionId)` and permissionless `voidExpired()`. 7.1(c) |
| U7 | Settlement token and its decimals | `MIN_STAKE_BASE` threshold wrong by orders of magnitude | DOC — **answered, and it bites.** Testnet collateral is tUSDC at **6** decimals; mainnet collateral is USDso at **18**. A factor of 10^12, and the documentation warns that nothing reverts to tell you. 7.1(f) |
| U8 | Is mid-of-book available at trade time, or only last price | Falls back to `LAST`, degrading forecast accuracy | DOC — there is no order-book snapshot table. The book at any block is *derivable* from order rows via `placedAtBlock` / `lastUpdatedAtBlock`, but nothing serves a mid directly. Promoted to a design decision as U18 |
| U9 | Multiple strikes per window, or a single window-open reference | Affects market identity and grouping | DOC — **single reference, no strike.** The line is the window's own opening price: at or above it Up wins, below it Down wins. So `CanonicalMarket.strike` is null and the boundary is inclusive on the Up side. 7.1(d) |
| U10 | Are trades attributed to a wallet address in the public feed | **If not, Kalibra cannot function as designed.** See §8 | DOC — **yes.** The SDK indexer exposes `getFills(pool, opts)` as a pool-wide tape and `getUserFills(account, opts)` as the same tape filtered to one wallet, so fill rows carry an account. Residual risk is U20 |
| U11 | Rate limits on REST and WS | Ingestion gets throttled or banned mid-demo | DOC — documentation states there are no API rate limits: market data is the chain itself and the public RPC endpoints are unthrottled |
| U12 | Whether VOID or cancellation is possible | Void positions scored as real losses | DOC — yes. Voided (5); both sides redeem at 0.5; `voidExpired()` is permissionless once the settlement window has passed. 7.1(c) |
| U13 | Does any HTTP endpoint serve event contracts | Decides whether ingestion is REST, SDK, or chain logs — the shape of `LiveAdapter` | DOC — no. The documentation states the HTTP API covers spot only and has no event-contract endpoints; the developer surface is the `@somnia-chain/markets-sdk` TypeScript package, version 0.28.0 or newer |
| U14 | Does the event-contract book emit the same `OrderFilled` events as the spot order book | Decides which logs a raw-chain ingestion path would subscribe to | DOC-partial — the per-market pool is documented as extending the same on-chain matching engine as spot, which makes the same events likely, but it is not stated outright. Now low priority: U10 means the indexer serves attributed fills directly, so raw log decoding is a fallback rather than the plan |
| U15 | `OrderFilled` carries taker and maker order ids, not addresses | A raw-chain path needs a join from fill back to placement to recover the owner | DOC — confirmed against the events page, and **no longer on the critical path** for the same reason as U14 |
| U16 | `loadMarkets()` omits settled markets | Settled markets — the only scoreable ones — would be invisible to the indexer | DOC — use `listPastBinaryMarkets({ status: "Finalized" })`. Note `Resolved` returns an empty list, because resolution auto-finalizes |
| U17 | Somnia testnet chain id and RPC URL | Cannot point viem at the right chain | DOC-partial — testnet is Somnia Shannon, chain id **50312** (mainnet 5031), explorer `shannon-explorer.somnia.network`. Protocol addresses are identical on both networks via CREATE3. The testnet RPC URL itself was not on any page read |
| U18 | `SCORING_SPEC.md` §2 wants the **mid at execution**, but the venue serves a fill tape and derivable order rows, not a mid time series | Using the fill price instead conflates forecasting skill with execution quality — the exact error §2 exists to prevent | OPEN — **a design decision, not a lookup.** Options: reconstruct the book from order rows at each fill's block; use the enclosing candle; or accept `quote_source = 'LAST'` and say so in the UI. Decide before the scoring pipeline lands |
| U19 | The `indexerUrl` the SDK client is constructed with | Without it `LiveAdapter` cannot be constructed at all | OPEN — the documentation site shows `new SomniaMarkets({ indexerUrl, chain, wsRpcUrl, addresses, privateKey })` but never gives the value; it points to the package README on npm |
| U20 | Is `getUserFills(account)` permissionless for an arbitrary wallet, or only for one's own | If privileged, U10 collapses back to Plan B or C and the leaderboard covers registered wallets only | OPEN — **the one that still matters.** The spot CLI marks its equivalent (`mytrades --trader <addr>`) as privileged; the event-contract SDK documentation marks `getUserFills` as neither. Do not assume |
| U21 | How a mint-a-pair fill appears in the tape | Buy Up × Buy Down crosses with no seller and the pool mints a fresh pair. If it is one row, side attribution for one of the two counterparties is ambiguous | OPEN — affects `CanonicalTrade` construction and therefore §4.1 aggregation |

**U3 and U10 were the existential pair.** Both are now answered by documentation. U10's
residual risk is U20, which is the single question most worth asking a human at the venue.

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

- 12 markets across 3 underlyings, sequential 15-minute windows
- 25 wallets with edges spread over `[0.42, 0.68]`, assigned deterministically by index
- 8 to 40 trades per wallet, stakes log-uniform over `[1, 500]` USDso
- 3 wallets that wash trade, to exercise the netting path in `SCORING_SPEC` §4.3
- 2 wallets below `MIN_STAKE_BASE`, to exercise exclusion
- 1 market that settles `VOID`

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
