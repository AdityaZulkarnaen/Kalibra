# Kalibra

**A calibration and reputation layer for DreamDEX Event Contracts.**

PnL leaderboards measure capital and luck. Kalibra measures skill.

Every Event Contract resolves to a binary truth inside a short, fixed window. That is
exactly the condition under which forecast verification — a mature discipline in
meteorology since 1950 — can be applied directly. Kalibra turns every trade into a
scored probabilistic forecast and publishes the result as composable on-chain-anchored
reputation.

Built for the **Somnia × DreamDEX Event Contracts Hackathon** (25 Aug – 9 Sep 2026).

---

## The one-number summary

Every wallet that trades Event Contracts gets a **Kalibra Score** from 0 to 1000.

| Score | Meaning |
|---|---|
| 500 | Exactly as good as the market's own forecast |
| > 500 | You added information the order book did not have |
| < 500 | Your deviations from market price were noise |
| `PROVISIONAL` | Fewer than 30 resolved positions — not enough evidence |

The score is a shrunk **Brier Skill Score** against the market's own implied
probability, penalised by **Expected Calibration Error**. Full math in
[`docs/SCORING_SPEC.md`](docs/SCORING_SPEC.md).

---

## Three surfaces

**Kalibra Index** — ingests every Event Contract trade and settlement, converts positions
into forecasts, computes Brier Skill Score, calibration curves, ECE, and discrimination
(AUC). Public read API.

**Kalibra Arena** — an AI agent competition ranked by calibration rather than PnL. Each
agent carries a permanent, verifiable track record.

**Kalibra Guard** — a policy engine between an agent and DreamDEX. Enforces max daily
loss, max notional, order rate limits, loss-streak cooldowns, and a kill switch. Every
decision is written to a hash-chained, tamper-evident audit log. Exposed over HTTP and
as an MCP server, so any LLM agent can trade inside guaranteed risk bounds.

---

## Quickstart

```bash
pnpm install
pnpm test          # all unit tests, no network required
pnpm demo          # deterministic offline run — the full pipeline, see the table below
pnpm typecheck     # tsc, strict
pnpm lint          # eslint, including the rules that enforce CLAUDE.md I1 and I2
```

To browse the index instead of reading a summary of it, run the three pieces in order:

```bash
pnpm ingest        # fixtures -> ./kalibra.db  (KALIBRA_MODE=live reads the testnet instead)
pnpm api           # read-only HTTP on :3001
pnpm web           # Next.js on :3000, reading that API and nothing else
pnpm guard         # policy engine on :3002, between an agent and the venue
```

`/` explains what the score measures, `/leaderboard` is the index itself, `/arena` is the
agent board, and `/w/:address` is one wallet's profile and calibration curve.

To put agents in front of it:

```bash
pnpm register-agents  # enters the demo agents in the Arena, through the public endpoint
pnpm agents           # the three demo agents, trading through Guard
pnpm mcp              # Guard as an MCP server over stdio, for any MCP-capable agent
```

An agent connecting over MCP should read [`SKILL.md`](SKILL.md): the six tools, the order to
call them in, how to read a refusal, and what the score actually rewards. An agent working
*on* this repository should read [`AGENTS.md`](AGENTS.md) and then
[`CLAUDE.md`](CLAUDE.md).

`pnpm demo` is the canonical entry point for reviewers. It must succeed on a clean
machine with no network access and no credentials. See
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for what that guarantee costs and why it is
non-negotiable.

---

## What is real vs mocked

Updated in the same commit as the code it describes. `LIVE` means a real DreamDEX or
Somnia interaction with a transaction hash or a captured response in `fixtures/`;
`REPLAY` means recorded real data; `SYNTHETIC` means generated data with the real
integration unverified; `STUB` means the interface exists and the implementation does not.

**As of day 8 of nine, complete (`docs/BUILD_PLAN.md`).** Five rows below are `LIVE`; the
rest run on generated data. The agents are still collecting, so every count in those rows is
a snapshot taken on 4 September and will have grown since; the transaction hashes will not.

| Component | Status | Evidence |
|---|---|---|
| Kalibra Score math (`packages/core`) | SYNTHETIC | Every numeric vector in `docs/SCORING_SPEC.md` §8 — V1 through V6 — implemented and green. V1 anchors at exactly 500, V3 scores 528, V4 scores 557, and V5 is strictly monotone across all six edge thresholds. |
| Aggregation (`packages/core/src/aggregate.ts`) | SYNTHETIC | Stake-weighted price, netting and all five exclusion reasons, asserted against `docs/SCORING_SPEC.md` §4. Output is invariant to the order trades arrive in. |
| Canonical types and Zod schemas (`packages/adapter-dreamdex`) | SYNTHETIC | Every fixture is parsed by the same schemas a live payload would meet; a checksummed address, an out-of-range probability or a float stake is rejected rather than coerced. The mapping to real venue fields is verified against captured payloads — `docs/DREAMDEX_ADAPTER.md` §6, where the side and settlement rows are additionally traced end to end in §6.1. |
| `ReplayAdapter` | SYNTHETIC | Streams the 60 markets, 2,386 trades and 60 settlements in `fixtures/synthetic/`. Deliberately **not** labelled REPLAY: that data is generated, not recorded. |
| `LiveAdapter` reads | **LIVE** | Reads the Shannon testnet indexer. A live ingest on 2 Sep pulled 10 markets, 56 fills and 16 distinct wallets, every market an Event Contract — see below. Evidence in [`fixtures/recorded/dreamdex-testnet-2026-09-01/`](fixtures/recorded/). |
| `LiveAdapter` writes (`placeOrder`) | **LIVE** | One real order, signed by the `mid-anchored` agent wallet and accepted by the pool: [`0x76a5cd91…`](https://shannon-explorer.somnia.network/tx/0x76a5cd914e10ee54f19e31cea8efd6e950bc2bac3fd372215c39d6605e4996c0), block 477687098, status success, venue order id `147573952589676548652`. Sent by `pnpm place-one`. |
| Persistence (`packages/db`) | SYNTHETIC | Schema extracted verbatim from `docs/API_SPEC.md` §1 into plain SQL and applied to SQLite; a test asserts the Drizzle mirror names exactly the columns the SQL creates. |
| Ingestion and scoring pipeline (`apps/indexer`) | SYNTHETIC | Ingests every fixture, aggregates 1,112 positions, scores 861 of them, and writes 25 score rows with 250 calibration bins. A second run changes nothing. |
| Public read API (`apps/api`) | SYNTHETIC | Every endpoint in `docs/API_SPEC.md` §2, with responses parsed by their published Zod schema before they are sent in test mode. The example payloads in that document are parsed by the same schemas, so the spec and the server cannot drift apart without a test failing. |
| Web app (`apps/web`) | SYNTHETIC | Landing page, leaderboard, Arena board and `/w/:address` profile, rendered per request from `apps/api` with no hardcoded, cached or fallback data — verified by killing the API and confirming that `/leaderboard` shows an error rather than numbers, and that the landing page drops its counters for a line saying the index is not answering rather than keeping the ones it last saw. Every quantity on the landing page is either read from `/v1/stats` at request time or is the committed V3 vector of `docs/SCORING_SPEC.md` §8, which it cites where it shows it; the explanatory prose around them is static, and the hero backdrop and the second screen's sky are labelled schematic because they are drawn, not measured. The landing page also reproduces the component and status columns of the table you are reading, held to this file by `apps/web/src/lib/evidence.test.ts`, which fails if the two disagree. The data displayed is the synthetic fixture set. |
| Guard policy engine (`packages/core/src/policy.ts`) | SYNTHETIC | All eleven reason codes from `docs/RISK_POLICY_SPEC.md` §4, one test each asserting that code and no other, plus the rule ordering: a killed agent over its daily loss sees `KILL_SWITCH_ACTIVE`. Pure — the clock is an argument. |
| Guard audit chain (`packages/core/src/audit.ts`) | SYNTHETIC | Keccak-256 over canonical JSON. Verified in both directions: a clean log passes, and insertion, deletion, reordering and a single rewritten field each fail at the right index. Demonstrated against a live SQLite log, below. |
| Guard transport (`apps/guard`) | **LIVE** | Orders from the demo agents are evaluated by Guard and forwarded to the pool under each agent's own key. Four Guard-forwarded fills are on Shannon, every one status `success`, each sent from the wallet its agent is scored under: [`0x0dec9ecb…`](https://shannon-explorer.somnia.network/tx/0x0dec9ecbb4aae319c8b66cf6c41a5f9ccca4b176899b8872608134cdb1c734a4) (block 478460478), [`0x3c8b17d0…`](https://shannon-explorer.somnia.network/tx/0x3c8b17d0fc6ac66e19f6924c41def312f75bc81bf8e3ffb8b247c89b979690e6), [`0x74c7ccad…`](https://shannon-explorer.somnia.network/tx/0x74c7ccadb1135698b3e8548a4d95ad5ef9326f6746fe25cd32c4aaf60fa6d017), [`0xf6552b9c…`](https://shannon-explorer.somnia.network/tx/0xf6552b9c208cd550a313321a686c8af075097e1cabfe4f0eb609c629d48a2924). Receipts re-checked against the chain, not read back from our own log. |
| Guard enforcement in the live loop | **LIVE** | Ten of the eleven reason codes have fired against real orders. A single twelve-hour window on 4 Sep produced 5,119 audit entries — 2,575 allowed, 2,544 refused — including 370 `ORDER_TOO_LARGE` from `contrarian-fade`, which sizes past the limit on purpose so the refusals are produced by an agent trading rather than by a script staging them. The eleventh, `RATE_LIMIT_EXCEEDED`, has never been reached: the agents pace themselves below it. What the refusals correlate with is below. |
| Kalibra Arena (`/v1/arena`) | **LIVE** | The three demo agents registered through the public `POST /v1/arena/register` endpoint — no row was inserted behind it — and are ranked on the same scores their wallets earn on the main leaderboard, verified field by field against `/v1/wallet/:address` by a test. All three are past the thirty-position minimum: `mid-anchored` `RANKED` **0** at n=170, `contrarian-fade` `RANKED` **0** at n=51, `momentum-lean` `RANKED` **392** at n=49. Two of the three sit on the floor of the scale and genuinely earned it — see below. |
| MCP server (`apps/mcp`) | SYNTHETIC | A real MCP client connects over the SDK transport and lists exactly the six tools of `docs/RISK_POLICY_SPEC.md` §7, in CI; the stdio entrypoint was additionally driven by hand against the running Guard and listed the same six. No policy-mutation tool exists, asserted by driving every tool and both resources through a recording transport and checking that the only write any of them produced was `POST /guard/order`. **No order has yet been placed through MCP against the live venue** — the tools reach Guard, and Guard's write path is the LIVE row above. |
| `pnpm demo` | SYNTHETIC | Runs the whole pipeline offline into an in-memory database and asserts the result byte-for-byte against `fixtures/expected/demo-output.json`. |

Rows are added as components land. The Arena numbers move as more windows settle; the
transaction hashes do not.

### The demo agents scored 0, and that is the most useful thing they produced

Two of the three agents sit at the floor of the scale. The arithmetic is not in doubt —
`contrarian-fade` has BSS −0.532, which shrinks to −0.350, giving a raw score of −30 before
the clamp — but the reason is worth more than the number.

It is no longer a small-sample story either. `mid-anchored` has since reached **n = 170**,
where shrinkage still passes **87%** of the measured skill through, and it is still 0. The
agent that sizes by conviction, `momentum-lean`, is the only one of the three with a real
number: **392** at n = 49.

`mid-anchored` was written to be the control that lands on the 500 anchor by expressing
almost no view. It scores 0, worse than the agent that deliberately fades the book. Two
separate mistakes, both of which survived code review and were caught only by running it:

**It cannot see book depth.** Its `method` string claimed it leaned "toward the thinner side
of the book". The strategy receives best bid and ask *prices* and never sizes, and the test
it actually performed — `bestBidUp < 1 − bestAskUp` — rearranges to `mid < 0.5`. It was
leaning toward even odds. The live data agrees without exception: all 25 of its DOWN
positions were taken at `p > 0.5`.

**A flat staker is read as maximally convicted.** `SCORING_SPEC.md` §3.2 measures conviction
as `λ = LAMBDA_MAX × stake / p90(that wallet's own trailing stakes)`. Bet one size every time
and your own p90 *is* that size, so every position reads as full conviction — measured λ ran
0.125 to 0.500, and a two-point intended lean was scored as a nineteen-point one.

The second one has a sting: **sizing by conviction does not fix it.** λ is scale-free, so
multiplying every stake by a constant leaves `stake / p90` untouched and only the shape of the
distribution moves it. Against this agent's own signal spread, linear conviction sizing gives
λ ≈ 0.245 where flat staking gives 0.250 — no material change. Reaching λ ≈ 0 needs a strongly
right-skewed stake distribution, near-nothing usually and occasionally large, which is an
aggressive sizing policy rather than the absence of a view.

So **the scale has no cheap anchor**: a trader cannot demonstrate "exactly as good as the
market" by declining to express one, because the metric reads their sizing and not their
restraint. That is a real limitation of the conviction model, recorded as `PRD.md` §9 item 3
rather than repaired — amending §3.2 would change every score in the system and needs a
`params_hash` bump, and that choice belongs to whoever owns the metric.

The agent has been left scoring 0, with its `method` string corrected to describe what it
does and why it fails. Tuning it until it reached 500 would have produced a better-looking
leaderboard and a worse project.

### Guard throttled the worst agent hardest, without being told which one it was

The policy engine has no access to a score. It sees losses, exposure, order size and the
clock. Over a twelve-hour window on 4 Sep it nevertheless sorted the three agents by
quality:

| agent | Kalibra Score | allowed | refused | allow rate |
|---|---|---|---|---|
| `momentum-lean` | **392** | 654 | 47 | **93%** |
| `mid-anchored` | 0 | 1,569 | 1,033 | 60% |
| `contrarian-fade` | 0 | 352 | 1,464 | **19%** |

The best-scoring agent is barely touched. The worst is refused four times out of five, and
the reasons say why: 661 `IN_COOLDOWN` from consecutive losses, 409
`OPEN_NOTIONAL_EXCEEDED` from positions that never came good, 370 `ORDER_TOO_LARGE`.

Two independent measurements of the same behaviour agreeing is the point. Neither mechanism
knows about the other — `packages/core/src/policy.ts` never reads a score, and
`packages/core/src/score.ts` never reads a policy.

**Allowed is not filled.** Worth stating because the numbers invite the wrong reading:
`contrarian-fade` has 352 allowed orders in that window against 81 recorded fills for its
whole life. Its orders die at the venue, not at Guard — it takes rather than rests, sized up
to the 50 tUSDC limit, at the extreme prices where a testnet book is thinnest, so there is
often nothing to cross with. Fills are counted from the chain, never from Guard's own record
of what it forwarded.

### These are Event Contracts, not spot

Worth stating outright, because the whole hackathon is about Event Contracts and "we ingested
some markets" does not say which kind. Every market the live ingest pulls in is an Event
Contract, and three independent fields say so: `marketType: "BINARY"`, an `oracleQuestionId`
naming the question it resolves against, and a distinct `yesTokenId`/`noTokenId` pair on the
shared ERC-6909 outcome-token singleton. A spot market carries none of the three.

Checked on all ten markets of a live ingest on 2 Sep, with the raw response committed at
[`fixtures/recorded/attribution-2026-09-02/ingested-market-types.json`](fixtures/recorded/attribution-2026-09-02/).
The venue's own documentation is independently explicit that its HTTP API covers spot only
and has no event-contract endpoints; this repository never calls it.

### Side attribution is traced to the money, not just mapped

The dangerous failure in a system like this is an inverted UP/DOWN mapping: every score flips,
nothing throws, and no number looks wrong. Checking the stored side against the venue's own
`winningOutcome` would be circular, so `pnpm verify-attribution` reconciles four sources that
do not depend on each other, across two markets that settled in **opposite** directions —
because a symmetric inversion passes a one-direction check perfectly.

| | `0x…00ff46` | `0x…010e48` |
|---|---|---|
| Oracle, open → close | 7787732 → 7795872 = **UP** | 7763542 → 7758409 = **DOWN** |
| Payout vector | `[10000000, 0]` pays index **0** | `[0, 10000000]` pays index **1** |
| Chain `winningOutcome` | **0** | **1** |
| What Kalibra stored | **UP** | **DOWN** |

The layer that closes the loop is an on-chain ERC-6909 balance, and one wallet is the control:
`0x93e300…` appears in both markets on opposite sides and holds the matching outcome token each
time. A wallet that has redeemed holds nothing, and that is reported as unobserved rather than
counted as a pass. Full trace in
[`fixtures/recorded/attribution-2026-09-02/`](fixtures/recorded/attribution-2026-09-02/).

### What "LIVE" means here, and what it does not

`LiveAdapter` reads the venue and produces canonical trades from real fills. Every one of
the fourteen it ingested got a **reconstructed mid**, not a fill price — the quote source
column reads `MID` on all of them — which is the whole point of the decision recorded as
U18 in [`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md) §7.2.

Both counterparties to a fill are scored, and their stakes are complements: on one captured
fill the UP leg risks 99.80 and the DOWN leg risks 100.20, summing to the 200.00 contract
quantity. A trader long UP at probability p risks p·q; a trader long DOWN risks (1−p)·q.
Using the premium for both would have overstated every DOWN position's conviction.

`placeOrder` is implemented as of 2 Sep and the write path has since been exercised against
Shannon: one order sent directly by `pnpm place-one`, and four more forwarded through Guard
under each agent's own key. All five hashes are in the table above, and their receipts were
re-checked against the chain rather than read back from our own log. The write path needs a
funded signer to do any of this: with no `GUARD_SIGNER_KEY`, Guard still evaluates and logs
every order and the adapter refuses to write, which is visible at startup rather than silent.

`LIVE` on a row means that row's interaction happened, not that the whole system runs on
chain data. It does not.

The scoring the demo shows still runs on synthetic fixtures, because a hackathon-length live
window has too few resolved positions to rank anyone.

### What the demo shows

Twenty of the twenty-five wallets clear `MIN_SAMPLE` and are `RANKED`, scoring from 308 to
678 over 31 to 51 resolved positions each — a spread that runs from measurably worse than
the market to a real edge over it.

The five that stay `PROVISIONAL` are exactly the three wash traders and the two
sub-minimum-stake wallets, and that is the product's central claim made visible: a wash
nets to zero stake, so it expresses no directional view, so it is excluded and cannot
manufacture a sample count. **Gaming the metric converges to the metric's null value.**

### The audit chain, checked rather than claimed

Guard writes its decision to a hash-chained log **before** forwarding the order. A crash
between the two leaves an entry with no order, which is detectable; the reverse would leave
an order with no record, which is not, and is therefore not permitted to be possible.

The chain was tampered with on purpose against a running server. Two orders were refused
and logged, `GET /guard/verify` returned `{"valid": true}`, and then a `DENY` was rewritten
to an `ALLOW` directly in SQLite &mdash; the forgery an operator would actually attempt:

```
{"brokenAt":0,
 "expected":"0xf7ef582a8b39a9b366734db6675f8730d82a756498f2c4a5267171087cf7d129",
 "found":"0x4b5eed20804184061b6d1d032f030af1649690effd8b4b555b50c5abcce49561",
 "valid":false}
```

Both orders in that run were refused `MARKET_NOT_ALLOWED`, because `allowedMarkets` in
[`guard.policy.json`](guard.policy.json) is empty and stays empty until an operator adds a
market. Deny by default is the shipped default, not a test fixture.

The operator's kill switch answers 401 without a token, and the routes are not registered
at all when no token is configured &mdash; an agent that finds the port cannot widen its own
limits. There is no `set_policy` anywhere in the codebase.

### The calibration curve

The chart on a profile page plots each confidence band's mean forecast against how often
those forecasts came true, with the diagonal drawn for reference. Its plot area is a fixed
square rather than a responsive rectangle, because the diagonal only means perfect
calibration when the axes are scaled alike; stretched to fit a container it becomes a slope
that means nothing.

Bands the trader never forecast in are gaps in the curve, not points interpolated between
their neighbours, and the bin table underneath shows the counts so a gap can be told from a
rendering fault. A `PROVISIONAL` wallet shows its status and sample count where the score
would be, never a number.

`docs/DREAMDEX_ADAPTER.md` §9 originally specified 12 markets, which could not work:
aggregation keeps one position per wallet per market, so twelve markets capped every wallet
at twelve resolved positions while `MIN_SAMPLE` is 30, and nobody could ever be ranked. The
fixture set was widened to 60 markets and 40–120 trades per wallet, and the arithmetic
behind those numbers is recorded in that section.

The DreamDEX integration is **partly verified**. Real payloads were captured anonymously
from the Shannon testnet indexer on 1 Sep 2026 and are committed under
[`fixtures/recorded/dreamdex-testnet-2026-09-01/`](fixtures/recorded/), with a README
explaining what each byte establishes. Eleven questions in
[`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md) §7 moved from documentation to
capture, including both that were marked existential: fills carry `maker` and `taker`
addresses, and reading another wallet's fills needs no key.

That capture is what `LiveAdapter` was written against, and it is the evidence behind the
one `LIVE` row in the table above. What it bought is a mapping table with verified rows
instead of guesses.

---

## Known limitations

Reproduced verbatim from [`docs/PRD.md`](docs/PRD.md) §9, and checked against it by a
test so the two cannot drift. Acknowledged limitations do not cost points; discovered
ones do.

1. **Sybil.** One human can operate many wallets and register the best-performing one.
   Shrinkage and minimum sample size make this expensive but not impossible.
2. **The conviction model is a model.** Mapping position size to forecast confidence
   (`SCORING_SPEC.md` §3.2) is a defensible choice, not a ground truth. Different λ
   produces different scores. The parameter is documented and configurable.
3. **A flat staker is scored as maximally convicted, on every position.** λ is measured
   against the wallet's *own* trailing p90 stake, so a trader who bets one size every time
   has a p90 equal to that size and receives near-maximum λ throughout. §3.2 anticipates
   this for a wallet's *first* position and argues shrinkage makes it harmless; that
   argument does not extend to a wallet where it holds for every position, because
   shrinkage moves a uniformly bad BSS toward the anchor only slowly.

   Measured on the `mid-anchored` demo agent: a two-point intended lean is scored as a
   nineteen-point one, and the agent lands at 0 rather than the 500 it was built to
   demonstrate. Confirmed at scale rather than inferred from a short run — it is still 0 at
   n = 170, where shrinkage passes 87% of the measured skill through, while the one agent
   that sizes by conviction scores 392.

   **Sizing by conviction does not fix it.** λ is scale-free — multiplying every stake by a
   constant leaves `stake / p90` unchanged — so only the shape of the distribution matters,
   and against that agent's signal spread linear sizing gives λ ≈ 0.245 where flat gives
   0.250. Reaching λ ≈ 0 requires a strongly right-skewed stake distribution: near-nothing
   usually, occasionally large. That is an aggressive sizing policy rather than the absence
   of a view.

   The consequence worth stating plainly is that **the scale has no cheap anchor**. A
   trader cannot demonstrate "exactly as good as the market" by declining to express a
   view, because the metric reads their sizing, not their restraint. Left as a limitation
   rather than repaired: changing §3.2 would change every score in the system and require a
   `params_hash` bump, and the choice belongs to whoever owns the metric.
4. **Short history.** Scores computed over a hackathon-length window have wide confidence
   intervals. The `PROVISIONAL` status and displayed sample size make this visible.
5. **Settlement trust.** Kalibra reads outcomes from DreamDEX settlement. It does not
   independently verify that settlement was correct.
6. **Testnet Only.** The current deployment operates on testnet. While the core logic and scoring
  mechanics are fully functional, user behavior without real economic stakes may not perfectly mirror mainnet dynamics. Formal security audits and mainnet deployment represent the next phase of development.

---

## Document index

Read in this order.

| Document | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **Read first.** Operating rules for the coding agent: invariants, conventions, definition of done, and what to do when the spec is silent. |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements. Problem, users, scope, explicit non-goals, acceptance criteria. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, module boundaries, data flow, technology decisions with rationale. |
| [`docs/SCORING_SPEC.md`](docs/SCORING_SPEC.md) | The mathematics. Exact formulas, every edge case, and numeric test vectors to assert against. |
| [`docs/RISK_POLICY_SPEC.md`](docs/RISK_POLICY_SPEC.md) | Kalibra Guard rules, enumerated reason codes, audit log format. |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | Internal database schema and the public HTTP/WebSocket API contract. |
| [`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md) | **The integration boundary.** Canonical types, adapter interface, unknowns checklist, and the discovery protocol for filling them in. |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) | Nine-day plan with per-day acceptance criteria and test strategy. |
| [`docs/SUBMISSION.md`](docs/SUBMISSION.md) | DoraHacks submission checklist mapped to the published judging criteria. |

---

## Status of external knowledge

The DreamDEX Event Contracts API surface was **not available** at specification time.
Every assumption about it is isolated behind a single adapter module and tracked as an
open question in [`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md).

Nothing in this repository should invent a DreamDEX endpoint, field name, or response
shape. If the real API contradicts the canonical types, the fix belongs in the adapter
and nowhere else.

---

## License

MIT.
