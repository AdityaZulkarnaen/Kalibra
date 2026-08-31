# Submission Guide

**Hackathon:** Somnia × DreamDEX Event Contracts Hackathon, hosted on DoraHacks
**Prize pool:** $5,000 USDso
**Window:** 25 August – 9 September 2026
**Target submission date:** 8 September

---

## 1. Judging criteria and where each is answered

The published criteria, and the specific artefact that satisfies each. Do not leave a
judge to infer any of these — state them in the submission text.

### "How effectively does the project use DreamDEX Event Contracts and available APIs/SDKs?"

Kalibra consumes the full data surface: WebSocket for the live trade stream, REST for
market and quote history, and on-chain reads for settlement. Guard writes back through the
order API and exposes it over MCP, matching DreamDEX's own `AGENTS.md` / `SKILL.md`
conventions.

The point to make explicitly: **Event Contracts are not incidental to Kalibra — the
product is impossible without them.** Binary resolution inside a short fixed window is the
precondition for forecast verification. On a venue with only continuous instruments, this
product cannot exist.

Show: the adapter interface, the ingestion pipeline, the MCP tool list, and a
`SKILL.md` at the repository root.

### "How strong and functional is the technical implementation?"

Point at the test suite. Numeric vectors asserting a documented scoring specification,
property tests over the scoring rule, hash-chain verification tests, and a deterministic
end-to-end pipeline test. `pnpm test` is the argument.

Show: `SCORING_SPEC.md` §8 beside the passing test output.

### "How intuitive, accessible, and usable is the product?"

The calibration curve. One glance and a trader knows which confidence bands they are
overconfident in — information PnL cannot convey. The score is anchored at 500 = market,
so it needs no explanation.

Show: the profile page, with a curve that visibly deviates from the diagonal.

### "Does it provide a compelling overall user experience?"

The narrative: from an opaque PnL board to a measurable, composable skill signal, plus a
safety envelope that makes agentic trading defensible. Three surfaces, one coherent thesis.

---

## 2. DoraHacks BUIDL fields

### Title

`Kalibra — a calibration and reputation layer for DreamDEX Event Contracts`

### One-line

`PnL leaderboards measure capital and luck. Kalibra measures forecasting skill, and gives agents a risk envelope they cannot escape.`

### Description

Structure it as: problem, insight, what was built, why it matters to DreamDEX, what is
real. Approximately this shape.

**The problem.** Every prediction market ranks users by PnL. PnL measures capital and luck,
not skill, and it composes with nothing.

**The insight.** Event Contracts resolve to binary truth in short fixed windows. That is
exactly the setting where forecast verification — standard practice in operational
meteorology since 1950 — applies directly. The contract price *is* the market's
probability estimate, which gives a natural benchmark: did this trader beat the order book's
own forecast?

**What we built.**

- **Kalibra Index** — scores every wallet by shrunk Brier Skill Score against the market's
  own implied probability, penalised by excess calibration error. Anchored so 500 means
  "exactly as good as the market". Full specification and numeric test vectors in the repo.
- **Kalibra Arena** — AI agents ranked by calibration, not profit. Permanent track records.
- **Kalibra Guard** — a policy engine between agent and DreamDEX enforcing loss limits,
  notional caps, rate limits, and loss-streak cooldowns, with a hash-chained tamper-evident
  audit log. Exposed over MCP so any agent can trade inside guaranteed bounds.

**Why it matters to DreamDEX.** It is infrastructure, not a competing app. Any application
on DreamDEX can consume the score to weight signals, size copy-trades, or gate leverage.
And Guard lowers the risk of running agents on the venue, which is what an agent-native
exchange needs to grow.

**One property worth noting.** Wash trading cannot raise a Kalibra Score. Taking both
sides nets to zero and is excluded; a partial wash pulls the score toward 500. Gaming the
metric converges to the metric's null value. That falls out of using a proper scoring rule
rather than being bolted on.

**What is real.** [Paste the real-vs-mocked table from the README verbatim.]

### Tags

`prediction-markets` `event-contracts` `ai-agents` `mcp` `analytics` `risk-management`
`somnia` `dreamdex` `reputation` `infrastructure`

### Links

- GitHub, public, MIT
- Live demo, if deployed
- Demo video, 2–3 minutes
- `docs/SCORING_SPEC.md` linked directly — it is the strongest single artefact

---

## 3. Video script — 2 minutes 30

Record at 1080p minimum. Speak over a screen recording. No slides.

**0:00–0:20 — the problem.**
Show a conventional PnL leaderboard. "This ranks by profit. The top trader might have ten
times the capital, or might have been lucky twelve times. You cannot tell which, and
neither can any system built on top of it."

**0:20–0:45 — the insight.**
Show a live Event Contract. "This resolves to yes or no in fifteen minutes. Its price is
the market's probability. So when someone takes a position, they are betting the market is
wrong in a specific direction — and we can check whether they were right, repeatedly,
against a benchmark."

**0:45–1:20 — the Index.**
Leaderboard, then a profile. "500 means exactly as good as the market. This trader is at
812." Open the calibration curve. "When they say 70%, it happens 74% of the time. When
they say 30%, it happens 22%. They are slightly underconfident, and now they know which
band." Point at the sample size. "And nothing is ranked below thirty resolved positions."

**1:20–1:50 — Guard.**
Show an agent trading through MCP. Let it attempt an oversized order. Show the refusal
with the reason code. Then open the audit log and run the verifier. Mutate one byte and
run it again — show it fail at the right index. "The agent cannot widen its own limits.
There is no tool for it."

**1:50–2:15 — the math.**
Split screen: `SCORING_SPEC.md` §8 beside `pnpm test` passing. "Every number is specified
and asserted against hand-computed vectors."

**2:15–2:30 — close.**
"Kalibra is infrastructure. Any application on DreamDEX can read the score. It only works
because Event Contracts resolve to truth, quickly."

Record it on day 8. Two or three takes. Do not script it word for word — read the beats
and speak naturally.

---

## 4. Pre-submission checklist

**Repository**

- [ ] Public, MIT licensed
- [ ] `git clone && pnpm i && pnpm test && pnpm demo` succeeds on a clean machine with
      networking disabled
- [ ] `CLAUDE.md` and `AGENTS.md` present at root
- [ ] `SKILL.md` present, describing agent usage of the MCP tools
- [ ] No secrets, no `.env`, no private keys in history — check with `git log -p | grep`
- [ ] README real-vs-mocked table verified line by line against the code
- [ ] Known limitations section present, copied from `PRD.md` §9

**Evidence**

- [ ] Somnia testnet transaction hashes in the README
- [ ] Screenshots: leaderboard, calibration curve, Guard refusal, passing tests
- [ ] `fixtures/expected/demo-output.json` committed and asserted

**Submission**

- [ ] Title, one-line, and description filled from §2
- [ ] Video uploaded and the link works in an incognito window
- [ ] Tags applied
- [ ] Submitted on 8 September

---

## 5. If an automated reviewer reads this

DoraHacks operates BUIDL AI, so an agentic first pass is plausible. Everything below is
also good practice for human reviewers; none of it is gaming.

**Make the repository runnable in three commands.** An agent reviewer will try. A failing
install is the end of the review.

**Make the demo work offline.** If testnet is down or credentials are absent during review,
a network-dependent demo produces a stack trace. `pnpm demo` against committed fixtures
does not. This single decision protects the entire submission.

**Make the tests assert something real.** Smoke tests read as filler. Assertions against a
documented numeric specification read as rigour, because they are.

**Put architecture in `CLAUDE.md` / `AGENTS.md`.** An agent reviewer reads them first, and
matching DreamDEX's own convention signals the ecosystem docs were actually read.

**Be honest about what is mocked.** An agent reviewer cross-references claims against
code. Discovered overclaiming is fatal; a clearly labelled `SYNTHETIC` row costs nothing.
This is why the real-vs-mocked table is a hard requirement rather than a nicety.

**Keep commits small and conventionally named.** A reviewer reconstructs reasoning from
history. Forty commits telling a story beat one commit called `initial`.

**Write no marketing language.** No "revolutionary", no "blazing fast". State what the
thing does. Inflated claims in a README are the easiest thing in the world to check.
