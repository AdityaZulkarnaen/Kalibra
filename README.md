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
pnpm demo          # deterministic offline run — scoring core only today, see the table below
pnpm typecheck     # tsc, strict
pnpm lint          # eslint, including the rules that enforce CLAUDE.md I1 and I2
# pnpm dev         # live mode against Somnia testnet — not implemented yet, day 4
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

**As of day 4 of nine (`docs/BUILD_PLAN.md`).** Nothing below has touched real market data.

| Component | Status | Evidence |
|---|---|---|
| Kalibra Score math (`packages/core`) | SYNTHETIC | Every numeric vector in `docs/SCORING_SPEC.md` §8 — V1 through V6 — implemented and green. V1 anchors at exactly 500, V3 scores 528, V4 scores 557, and V5 is strictly monotone across all six edge thresholds. |
| Aggregation (`packages/core/src/aggregate.ts`) | SYNTHETIC | Stake-weighted price, netting and all five exclusion reasons, asserted against `docs/SCORING_SPEC.md` §4. Output is invariant to the order trades arrive in. |
| Canonical types and Zod schemas (`packages/adapter-dreamdex`) | SYNTHETIC | Every fixture is parsed by the same schemas a live payload would meet; a checksummed address, an out-of-range probability or a float stake is rejected rather than coerced. The mapping to real venue fields is unverified — `docs/DREAMDEX_ADAPTER.md` §6 has no Verified row. |
| `ReplayAdapter` | SYNTHETIC | Streams the 60 markets, 2,386 trades and 60 settlements in `fixtures/synthetic/`. Deliberately **not** labelled REPLAY: that data is generated, not recorded. |
| `LiveAdapter` | STUB | The `DreamDexAdapter` interface exists; `live.ts` does not. Day 4. No API payload has been captured, and live mode refuses to start rather than pretending. |
| Persistence (`packages/db`) | SYNTHETIC | Schema extracted verbatim from `docs/API_SPEC.md` §1 into plain SQL and applied to SQLite; a test asserts the Drizzle mirror names exactly the columns the SQL creates. |
| Ingestion and scoring pipeline (`apps/indexer`) | SYNTHETIC | Ingests every fixture, aggregates 1,112 positions, scores 861 of them, and writes 25 score rows with 250 calibration bins. A second run changes nothing. |
| Public read API (`apps/api`) | SYNTHETIC | Every endpoint in `docs/API_SPEC.md` §2, with responses parsed by their published Zod schema before they are sent in test mode. The example payloads in that document are parsed by the same schemas, so the spec and the server cannot drift apart without a test failing. |
| `pnpm demo` | SYNTHETIC | Runs the whole pipeline offline into an in-memory database and asserts the result byte-for-byte against `fixtures/expected/demo-output.json`. |

The web app, Guard and Arena do not exist yet, so they are not listed — there is nothing to
claim about them. Rows are added as components land.

### What the demo shows

Twenty of the twenty-five wallets clear `MIN_SAMPLE` and are `RANKED`, scoring from 308 to
678 over 31 to 51 resolved positions each — a spread that runs from measurably worse than
the market to a real edge over it.

The five that stay `PROVISIONAL` are exactly the three wash traders and the two
sub-minimum-stake wallets, and that is the product's central claim made visible: a wash
nets to zero stake, so it expresses no directional view, so it is excluded and cannot
manufacture a sample count. **Gaming the metric converges to the metric's null value.**

`docs/DREAMDEX_ADAPTER.md` §9 originally specified 12 markets, which could not work:
aggregation keeps one position per wallet per market, so twelve markets capped every wallet
at twelve resolved positions while `MIN_SAMPLE` is 30, and nobody could ever be ranked. The
fixture set was widened to 60 markets and 40–120 trades per wallet, and the arithmetic
behind those numbers is recorded in that section.

The DreamDEX integration remains **unverified**. Documentation was located and captured on
1 Sep 2026 — the raw pages are archived in
[`fixtures/recorded/docs-snapshot-2026-09-01/`](fixtures/recorded/) — and most of the open
questions now have documented answers, including the two flagged as existential. **None is
answered by a captured API payload**, so no live claim is made anywhere in this repository
and no adapter code has been written against it. Checklist and discovery log:
[`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md) §7.

The attribution plan required by day 2 is not recorded here yet. Documentation says the
fill tape is wallet-attributed, which points at Plan A; what remains is whether that read
is permissionless for an arbitrary wallet (U20). That is the one question still worth
asking a human.

---

## Decisions in effect

**Attribution: Plan A** (`docs/DREAMDEX_ADAPTER.md` §8). Kalibra reads fills from the
venue's own indexer, which serves a wallet-attributed fill tape — a pool-wide tape and the
same tape filtered to one account. That is cheaper and more direct than decoding raw chain
logs, which carry order ids rather than addresses and would need a join back to the
placement to recover an owner.

The open risk is whether reading another wallet's fills is permissionless (`U20`). If it
turns out to be privileged, Plan A degrades to Plan B (opt-in registration) and Plan C
(Arena-only, where Guard placed the order and attribution is guaranteed) remains the
floor. The project cannot fail to ship, only ship smaller.

**Network: Somnia Shannon testnet only**, chain id 50312. `MIN_STAKE_BASE` stays a literal
at six decimals, which is correct for the testnet collateral token. Mainnet collateral
carries eighteen decimals, so the same literal would be wrong by a factor of 10^12 there —
and nothing would revert to say so. Kalibra does not target mainnet, and this is recorded
as a limitation rather than engineered around. It joins the known-limitations list copied
verbatim from `docs/PRD.md` §9 into this README on day 8.

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
