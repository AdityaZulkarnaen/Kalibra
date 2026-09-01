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

**As of day 1 of nine (`docs/BUILD_PLAN.md`), one component exists.**

| Component | Status | Evidence |
|---|---|---|
| Kalibra Score math (`packages/core`) | SYNTHETIC | Test vectors V1, V2, V3 and V6 from `docs/SCORING_SPEC.md` §8 are implemented and green. V1 anchors at exactly 500 and V3 at 528. No market data has passed through it. |

Nothing else is built. The adapter, the indexer, the database, the API, the web app, Guard
and Arena do not exist yet — they are not listed above because there is nothing to claim
about them. Rows are added as components land.

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
