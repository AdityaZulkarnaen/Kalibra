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

**As of day 6 of nine, complete (`docs/BUILD_PLAN.md`).** One row below is `LIVE`; the rest
run on generated data.

| Component | Status | Evidence |
|---|---|---|
| Kalibra Score math (`packages/core`) | SYNTHETIC | Every numeric vector in `docs/SCORING_SPEC.md` §8 — V1 through V6 — implemented and green. V1 anchors at exactly 500, V3 scores 528, V4 scores 557, and V5 is strictly monotone across all six edge thresholds. |
| Aggregation (`packages/core/src/aggregate.ts`) | SYNTHETIC | Stake-weighted price, netting and all five exclusion reasons, asserted against `docs/SCORING_SPEC.md` §4. Output is invariant to the order trades arrive in. |
| Canonical types and Zod schemas (`packages/adapter-dreamdex`) | SYNTHETIC | Every fixture is parsed by the same schemas a live payload would meet; a checksummed address, an out-of-range probability or a float stake is rejected rather than coerced. The mapping to real venue fields is unverified — `docs/DREAMDEX_ADAPTER.md` §6 has no Verified row. |
| `ReplayAdapter` | SYNTHETIC | Streams the 60 markets, 2,386 trades and 60 settlements in `fixtures/synthetic/`. Deliberately **not** labelled REPLAY: that data is generated, not recorded. |
| `LiveAdapter` | **LIVE** | Reads the Shannon testnet indexer and has ingested real trades: 6 markets, 14 fills, 10 distinct wallets. Evidence in [`fixtures/recorded/dreamdex-testnet-2026-09-01/`](fixtures/recorded/) and transaction hash `0xe3299c8843bebddb104aae2b3ae0a10c5c37f7cfc379cc9fd47050162cf7e842`. Read-only: writing needs a funded signer, which is day 7. |
| Persistence (`packages/db`) | SYNTHETIC | Schema extracted verbatim from `docs/API_SPEC.md` §1 into plain SQL and applied to SQLite; a test asserts the Drizzle mirror names exactly the columns the SQL creates. |
| Ingestion and scoring pipeline (`apps/indexer`) | SYNTHETIC | Ingests every fixture, aggregates 1,112 positions, scores 861 of them, and writes 25 score rows with 250 calibration bins. A second run changes nothing. |
| Public read API (`apps/api`) | SYNTHETIC | Every endpoint in `docs/API_SPEC.md` §2, with responses parsed by their published Zod schema before they are sent in test mode. The example payloads in that document are parsed by the same schemas, so the spec and the server cannot drift apart without a test failing. |
| Web app (`apps/web`) | SYNTHETIC | Leaderboard and `/w/:address` profile, rendered per request from `apps/api` with no hardcoded, cached or fallback data — verified by killing the API and confirming the page shows an error rather than numbers. The data it displays is the synthetic fixture set. |
| Guard policy engine (`packages/core/src/policy.ts`) | SYNTHETIC | All eleven reason codes from `docs/RISK_POLICY_SPEC.md` §4, one test each asserting that code and no other, plus the rule ordering: a killed agent over its daily loss sees `KILL_SWITCH_ACTIVE`. Pure — the clock is an argument. |
| Guard audit chain (`packages/core/src/audit.ts`) | SYNTHETIC | Keccak-256 over canonical JSON. Verified in both directions: a clean log passes, and insertion, deletion, reordering and a single rewritten field each fail at the right index. Demonstrated against a live SQLite log, below. |
| Guard transport (`apps/guard`) | SYNTHETIC | HTTP surface, orders forwarded through the adapter, fills written to `trades` with `source = 'GUARD'`. Runs against `ReplayAdapter`; no order has been sent to a real venue, which needs a funded signer on day 7. |
| `pnpm demo` | SYNTHETIC | Runs the whole pipeline offline into an in-memory database and asserts the result byte-for-byte against `fixtures/expected/demo-output.json`. |

Arena does not exist yet, so it is not listed — there is nothing to claim about it. Rows
are added as components land.

### What "LIVE" means here, and what it does not

`LiveAdapter` reads the venue and produces canonical trades from real fills. Every one of
the fourteen it ingested got a **reconstructed mid**, not a fill price — the quote source
column reads `MID` on all of them — which is the whole point of the decision recorded as
U18 in [`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md) §7.2.

Both counterparties to a fill are scored, and their stakes are complements: on one captured
fill the UP leg risks 99.80 and the DOWN leg risks 100.20, summing to the 200.00 contract
quantity. A trader long UP at probability p risks p·q; a trader long DOWN risks (1−p)·q.
Using the premium for both would have overstated every DOWN position's conviction.

It is read-only. Nothing in this repository has ever sent a transaction, and `placeOrder`
throws rather than returning a plausible-looking rejection. The scoring the demo shows still
runs on synthetic fixtures, because a hackathon-length live window has too few resolved
positions to rank anyone.

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
