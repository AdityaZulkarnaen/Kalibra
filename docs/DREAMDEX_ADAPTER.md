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

**Provenance of the `doc:` rows.** Entries prefixed `doc:` were read from the public
documentation at `docs.dreamdex.io` on 1 Sep 2026 (see §7 for the page-by-page log). They
are *documentation, not capture*. Step 3 requires a recorded payload before any row is
marked Verified, and no row below is Verified. Nothing in this table has been written into
code; the adapter is still unimplemented.

| Canonical field | DreamDEX source | Transform | Verified |
|---|---|---|---|
| `CanonicalMarket.marketId` | doc: `bytes32 marketId`, a module-scoped counter | → hex string | ☐ |
| `CanonicalMarket.underlying` | `?` | uppercase | ☐ |
| `CanonicalMarket.windowStart` | `?` | → ms UTC | ☐ |
| `CanonicalMarket.windowEnd` | `?` | → ms UTC | ☐ |
| `CanonicalMarket.strike` | `?` | → bigint | ☐ |
| `CanonicalMarket.status` | doc: state enum Listed 0, Trading 1, Locked 2, Settling 3, Resolved 4, Voided 5 | enum map | ☐ |
| `CanonicalTrade.tradeId` | `?` | — | ☐ |
| `CanonicalTrade.wallet` | `?` — see U10, U15 | lowercase | ☐ |
| `CanonicalTrade.side` | doc: one book, two sides; a Down price is 1 − the Up price | → UP/DOWN | ☐ |
| `CanonicalTrade.impliedProbUp` | doc: prices are Up probabilities in (0, 1) | identity, then clamp per SCORING_SPEC §2 | ☐ |
| `CanonicalTrade.stake` | `?` — see U7 | → bigint base units | ☐ |
| `CanonicalTrade.timestamp` | `?` | → ms UTC | ☐ |
| `CanonicalSettlement.outcome` | doc: Resolved 4 → UP/DOWN, Voided 5 → VOID (both sides redeem at 0.5) | → UP/DOWN/VOID | ☐ |
| `CanonicalSettlement.settledAt` | `?` | → ms UTC | ☐ |
| `CanonicalQuote.midUp` | `?` | → P(UP) | ☐ |
| `CanonicalOrder` → venue request | `?` | — | ☐ |

---

## 7. Unknowns checklist

Track resolution here. Add rows as new unknowns surface; never delete one.

**Status vocabulary.** `OPEN` — no answer. `DOC` — answered by the public documentation
but **not** by a captured payload, so it may not be relied on in code. `VERIFIED` — a
payload in `fixtures/recorded/` demonstrates it. Only `VERIFIED` unblocks live mode.

| # | Question | Impact if wrong | Status |
|---|---|---|---|
| U1 | REST base URL and WS URL for testnet | Live mode cannot connect | DOC — see 7.1(a). Note U13: the documented HTTP API is spot-only |
| U2 | Auth scheme for public market data | Live mode cannot connect | DOC — Sign-In with Ethereum (ERC-4361) is documented for trading; whether public market data needs it is unstated |
| U3 | UP/DOWN as separate instruments or one with a side flag | Side normalisation inverted; **every score wrong and the error is invisible** | DOC — one book, two sides; a Down price is 1 minus the Up price. 7.1(b) |
| U4 | Price quote units | `impliedProbUp` out of range or silently scaled wrong | DOC — prices are Up probabilities in (0, 1). 7.1(b) |
| U5 | Historical trade endpoint and depth | No backfill; scores only from indexer start | OPEN — related: settled markets are hidden from `loadMarkets()`, see U16 |
| U6 | Settlement publication mechanism | Outcomes never arrive; nothing ever scores | DOC — an oracle posts the answer at expiry and Somnia on-chain reactivity delivers it to the module callback. On-chain, not a REST poll. 7.1(c) |
| U7 | Settlement token and its decimals | `MIN_STAKE_BASE` threshold wrong by orders of magnitude | OPEN — not found on any page read so far |
| U8 | Is mid-of-book available at trade time, or only last price | Falls back to `LAST`, degrading forecast accuracy | OPEN |
| U9 | Multiple strikes per window, or a single window-open reference | Affects market identity and grouping | OPEN |
| U10 | Are trades attributed to a wallet address in the public feed | **If not, Kalibra cannot function as designed.** See section 8 | OPEN — and U15 makes the on-chain route harder than assumed. **This is the day-2 blocker.** |
| U11 | Rate limits on REST and WS | Ingestion gets throttled or banned mid-demo | OPEN |
| U12 | Whether VOID or cancellation is possible | Void positions scored as real losses | DOC — yes. Voided (5); both sides redeem at 0.5; `voidExpired()` is permissionless once the settlement window has passed. 7.1(c) |
| U13 | Does any HTTP endpoint serve event contracts | Decides whether ingestion is REST, SDK, or chain logs — the shape of `LiveAdapter` | DOC — the documentation states the HTTP API covers spot only and has no event-contract endpoints, and points to the `@somnia-chain/markets-sdk` TypeScript SDK instead |
| U14 | Does the event-contract book emit the same `OrderFilled` events as the spot order book, or does the binary markets module emit its own | Decides which logs Plan A subscribes to | OPEN |
| U15 | `OrderFilled` carries taker and maker order ids, not addresses | Plan A attribution needs a join from fill back to placement to recover the owner: more work, more failure modes | OPEN — costed into the Plan A estimate in section 8 |
| U16 | `loadMarkets()` omits settled markets; documentation points to `listBinaryMarkets` with status Finalized | Settled markets — the only scoreable ones — would be invisible to the indexer | DOC |
| U17 | Somnia testnet chain id and RPC URL | Cannot point viem at the right chain | OPEN — mainnet chain id 5031 is documented; testnet is not |

**U3 and U10 are existential.** U3 is answered by documentation and needs a captured
payload to be closed. **U10 is still open and is the gating input to the day-2 attribution
decision in section 8.**

### 7.1 Discovery log

Read 1 Sep 2026 by the coding agent, from public pages only. No credential was used, no
message was posted, and nothing below has been written into code. Every line here is
documentation, not capture; section 5 Step 3 still applies before `LiveAdapter` is written.

**(a) Index and base URLs.** `docs.dreamdex.io` exists and publishes a full page index at
`docs.dreamdex.io/llms.txt`, including a developer section for event contracts:
`developers/event-contracts.md`, `market-structure.md`, `contracts-and-addresses.md`,
`recipes.md`, `gotchas.md`, plus `developers/http-api/*`, `developers/websocket-api/*`,
`developers/contracts/*`, and `trading/event-contracts/settlement-and-voids.md`. The quick
start page documents REST `https://api.dreamdex.io/v0` (testnet
`https://stg.api.dreamdex.io/v0`) and WebSocket `wss://api.dreamdex.io/v0/ws/public`
(testnet `wss://stg.api.dreamdex.io/v0/ws/public`), Somnia mainnet chain id 5031, and
Sign-In with Ethereum (ERC-4361) authentication.

**(b) Event contract shape.** One order book with two sides; a Down price is 1 minus the Up
price. Prices are Up probabilities in (0, 1) — the venue quote is already the quantity that
`SCORING_SPEC.md` section 2 calls `p`, so section 4.2 normalisation may reduce to a clamp.
Markets are identified by a `bytes32 marketId`, a module-scoped counter.

**(c) Lifecycle and settlement.** States are Listed 0, Trading 1, Locked 2, Settling 3
(described as effectively never observable), Resolved 4, Voided 5. An oracle posts the
settlement answer at expiry and on-chain reactivity delivers it to the module callback;
resolution is described as permissionless to observe. Voided markets redeem both sides at
0.5, and `voidExpired()` may be called by anyone once the settlement window has passed.

**(d) Fill attribution.** The documented order-book events include `OrderFilled` with
indexed taker and maker order ids, a filled quantity and a fill price, and `OrderPlaced`
with an indexed order id and the placed order struct. The fill event carries order ids, not
addresses, so recovering a wallet means joining a fill back to the placement that created
the order id. Whether the event-contract book emits these same events is U14.

**(e) Not answered by any page read.** Settlement token and decimals (U7), historical trade
depth (U5), rate limits (U11), mid-of-book availability at trade time (U8), strikes per
window (U9), and — critically — whether any public feed attributes a trade to a wallet
address (U10).

**(f) Not done, needs a human.** Posting the six questions of section 5 Step 2 in the
hackathon Telegram, and requesting testnet STT from the faucet. Both require an account the
agent does not have. See the session report.

---

## 8. Contingency for U10

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
