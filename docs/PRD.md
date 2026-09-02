# PRD — Kalibra

**Status:** approved for build
**Owner:** hackathon team
**Window:** 31 Aug – 9 Sep 2026
**Target:** Somnia × DreamDEX Event Contracts Hackathon

---

## 1. Problem

Every prediction market and trading venue ranks its users by profit and loss. PnL is a
broken measure of forecasting skill for three reasons:

**It measures capital.** A trader with 100× the size will outrank a more accurate trader
with a smaller book, permanently, regardless of who is actually better at predicting.

**It measures luck.** Over a small number of resolved contracts, PnL is dominated by
variance. A trader with a genuine 51% edge and a trader on a lucky run are
indistinguishable on a PnL board until hundreds of samples have accumulated.

**It does not compose.** A high PnL number tells another system nothing it can act on. It
cannot be used to weight a signal, size a copy-trade, or gate access to leverage.

Event Contracts have a property that makes this solvable: **every contract resolves to a
binary outcome inside a short, fixed window.** Outcomes arrive quickly and unambiguously.
This is precisely the setting where forecast verification — a discipline formalised by
Brier in 1950 and standard practice in operational meteorology — applies directly and
without adaptation.

Nobody has built this for on-chain markets.

---

## 2. Solution

Kalibra converts every Event Contract position into a scored probabilistic forecast and
publishes the result as public, composable reputation.

The core insight is that an Event Contract's price **is** the market's probability
estimate. When a trader takes a position at that price, they are asserting the market is
wrong in a specific direction. Kalibra measures whether that assertion, repeated over many
contracts, was informative or noise.

The output is a single number per wallet, anchored so that **500 means "exactly as good as
the market itself"**. This anchoring is the product. It converts an abstract statistical
quantity into a claim anyone can interpret in one second.

---

## 3. Users

**Primary: the agent builder.** Building an AI trading agent for Event Contracts. Needs a
way to prove the agent is skilled rather than lucky, and a way to run it without risking
catastrophic loss from a bad prompt. Uses Arena and Guard.

**Secondary: the discretionary trader.** Trades Event Contracts and wants to know where
their edge actually is. The calibration curve tells them something PnL never will: which
confidence bands they are overconfident in. Uses Index.

**Tertiary: the integrating protocol.** Building on DreamDEX and wants to weight signals,
gate features, or size copy-trades by proven forecasting ability rather than account
balance. Consumes the public score API.

---

## 4. Product surfaces

### 4.1 Kalibra Index

Ingests Event Contract trades and settlements, aggregates them into positions, scores
each position as a forecast, and computes per-wallet statistics.

Delivers:

- **Leaderboard** ranked by Kalibra Score, with sample size shown next to every entry so
  small-sample entries are visibly discounted rather than silently hidden.
- **Trader profile** at `/w/:address` showing score, Brier Skill Score, ECE, AUC, sample
  count, and the calibration curve.
- **Calibration curve** — the visual centrepiece. Ten bins of forecast confidence plotted
  against observed frequency, with the diagonal drawn for reference. Deviation from the
  diagonal is immediately legible as overconfidence or underconfidence.
- **Market efficiency panel** — aggregate ECE across all traders per market, showing where
  the book is systematically mispriced.

### 4.2 Kalibra Arena

A registry of AI agents competing on calibration.

- Agent registers with a name, a wallet address, and an optional description of its
  method.
- All of the agent's positions are scored identically to human traders.
- Arena leaderboard is separate from the main leaderboard, so agents compete against
  agents.
- Every agent's record is permanent and cannot be reset by the operator.

Arena requires no new scoring machinery. It is a filtered view over the Index plus a
registration table. This is deliberate: it costs almost nothing to build and it directly
addresses the hackathon's agent track.

### 4.3 Kalibra Guard

A policy engine that sits between an agent and DreamDEX. The agent cannot reach DreamDEX
except through Guard.

Enforces, per the full specification in [`RISK_POLICY_SPEC.md`](RISK_POLICY_SPEC.md):

- Maximum notional per order
- Maximum total open notional
- Maximum daily loss, realised and unrealised
- Maximum orders per time window
- Cooldown after N consecutive losing positions
- Market whitelist
- Kill switch, manual and automatic on breach

Every decision — allow, deny, or modify — is written to a **hash-chained audit log**. Each
entry contains the hash of its predecessor, so any retroactive edit is detectable. The log
is the artefact that makes an agent's track record trustworthy.

Guard is exposed two ways: an HTTP proxy, and an **MCP server**, so that any MCP-capable
LLM agent can trade Event Contracts inside guaranteed risk bounds without the operator
writing custom integration code.

---

## 5. What makes this defensible

**It is infrastructure, not an app.** Kalibra makes other people's trading applications
better. Most hackathon submissions will be applications competing for the same users.

**The metric is anti-gameable by construction.** Wash trading cannot raise a score: taking
both sides of a market guarantees one side is wrong, which pulls the score toward 500.
Dust spam is excluded by a minimum stake. Small-sample farming is defeated by shrinkage.
This is not a bolt-on defence; it falls out of using a proper scoring rule.

**It consumes the whole API surface.** WebSocket for the live trade stream, REST for
historical order book state, and on-chain reads for settlement. The judging criterion
"how effectively does the project use DreamDEX Event Contracts and available APIs/SDKs"
is difficult to score higher on.

**The math is verifiable.** A reviewer can run `pnpm test` and see assertions against
hand-computed numeric vectors. That is a stronger signal of technical quality than any
amount of UI polish.

---

## 6. Scope

### In scope

| # | Requirement | Priority |
|---|---|---|
| R1 | Ingest Event Contract trades and settlements into a local store | P0 |
| R2 | Aggregate trades into positions per (wallet, market, side) | P0 |
| R3 | Compute forecast, Brier score, BSS, ECE, AUC, Kalibra Score per wallet | P0 |
| R4 | Public read API for scores, leaderboard, and calibration curves | P0 |
| R5 | Web leaderboard and trader profile with calibration chart | P0 |
| R6 | `ReplayAdapter` and synthetic fixture generator for offline operation | P0 |
| R7 | Guard policy engine with hash-chained audit log | P1 |
| R8 | Guard exposed as an MCP server | P1 |
| R9 | Arena agent registration and filtered leaderboard | P1 |
| R10 | Market efficiency panel | P2 |
| R11 | Score history over time per wallet | P2 |

P0 must ship. P1 should ship. P2 ships only if P0 and P1 are complete and tested.

### Explicitly out of scope

Listed so that no one spends time on them:

- Authentication or accounts on the read surface. The index is public and anonymous.
- Any token, points programme, or airdrop mechanic.
- A discretionary trading UI. Kalibra does not place orders on behalf of humans.
- Sybil-resistant identity. Documented as a known limitation, not solved.
- Historical backfill earlier than the ingestion start block recorded in `meta`.
- Multi-chain support.
- Native mobile.

---

## 7. Acceptance criteria

The project is complete when all of the following are demonstrable.

**A1.** `pnpm test` passes, including every numeric vector in `SCORING_SPEC.md` §8,
asserted to the documented precision.

**A2.** `pnpm demo` runs on a clean machine with networking disabled and no environment
file, ingests the committed fixtures, and prints a deterministic leaderboard identical to
`fixtures/expected/demo-output.json`.

**A3.** In live mode, the indexer connects to DreamDEX, ingests at least one real Event
Contract settlement, and produces a score. The README records the transaction hash.

**A4.** The web app renders a leaderboard and a trader profile with a calibration curve,
served from the API, with no hardcoded data in the frontend.

**A5.** Guard rejects an order that breaches each configured limit, returning the exact
reason code enumerated in `RISK_POLICY_SPEC.md` §4. One test per reason code.

**A6.** The Guard audit log verifies: `verifyChain(log)` returns true for an untouched log
and false when any entry is mutated. Both cases are tested.

**A7.** An LLM agent connects to the Guard MCP server, attempts an oversized order, is
refused, and the refusal appears in the audit log. Captured in the demo video.

**A8.** The README's "What is real vs mocked" table is accurate against the shipped code.

---

## 8. Non-goals for the score itself

Stated to prevent scope creep into research.

Kalibra does **not** claim to identify profitable traders. Calibration and profitability
are different properties; a well-calibrated trader can lose money through poor sizing, and
a badly calibrated one can profit through luck or favourable fills. The score measures
informational edge only, and the UI says so.

Kalibra does **not** attempt to infer a trader's true internal belief. It measures the
forecast implied by their revealed behaviour under an explicit, documented model
(`SCORING_SPEC.md` §3). The model's assumptions are stated in the UI, not hidden.

---

## 9. Known limitations

To be reproduced verbatim in the README. Acknowledged limitations do not cost points;
discovered ones do.

1. **Sybil.** One human can operate many wallets and register the best-performing one.
   Shrinkage and minimum sample size make this expensive but not impossible.
2. **The conviction model is a model.** Mapping position size to forecast confidence
   (`SCORING_SPEC.md` §3.2) is a defensible choice, not a ground truth. Different λ
   produces different scores. The parameter is documented and configurable.
3. **Short history.** Scores computed over a hackathon-length window have wide confidence
   intervals. The `PROVISIONAL` status and displayed sample size make this visible.
4. **Settlement trust.** Kalibra reads outcomes from DreamDEX settlement. It does not
   independently verify that settlement was correct.
5. **Testnet Only.** The current deployment operates on testnet. While the core logic and scoring
  mechanics are fully functional, user behavior without real economic stakes may not perfectly mirror mainnet dynamics. Formal security audits and mainnet deployment represent the next phase of development.
