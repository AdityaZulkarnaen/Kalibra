# Product

<!-- impeccable:product-schema 1 -->

Design-surface product record for `apps/web`. Upstream authority is
[`docs/PRD.md`](../../docs/PRD.md) for product content and [`CLAUDE.md`](../../CLAUDE.md)
for process; where this file and those disagree, they win and this file is corrected.
Facts below are drawn from them or confirmed with the owner on 5 September 2026.

## Platform

web

## Users

**Primary — the agent builder** (PRD §3). Building an AI trading agent for DreamDEX Event
Contracts. Needs to prove the agent is skilled rather than lucky, and to run it without a
bad prompt causing catastrophic loss. Uses Arena and Guard.

**Secondary — the discretionary trader.** Trades Event Contracts and wants to know where
their edge actually is. The calibration curve tells them what PnL never will: which
confidence bands they are overconfident in. Uses Index.

**Tertiary — the integrating protocol.** Wants to weight signals, gate features, or size
copy-trades by proven forecasting ability rather than account balance. Consumes the public
score API rather than the web surface.

**Near-term, confirmed 5 Sep 2026 — the hackathon judge.** Possibly automated, arriving
once via DoraHacks before the 9 September deadline, reading the repository and running the
code. Until that deadline a judging read wins ties against the three audiences above. This
is a moment, not a permanent audience: it does not license building anything a real trader
would never use.

## Product Purpose

Kalibra converts every Event Contract position into a scored probabilistic forecast and
publishes the result as public, composable reputation. An Event Contract's price *is* the
market's probability estimate; taking a position at that price asserts the market is wrong
in a specific direction. Kalibra measures whether that assertion, repeated over many
contracts, was informative or noise.

The output is one number per wallet, 0–1000, anchored so that **500 means "exactly as good
as the market itself"**. Above 500 the trader added information the order book did not
have; below it, their deviations were noise. Under 30 resolved positions the wallet is
`PROVISIONAL` and shows no number at all.

Success for this surface (PRD §7, A4): the web app renders a leaderboard and a trader
profile with a calibration curve, served from the API, with no hardcoded data in the
frontend.

## Positioning

**The anchoring is the product.** The statistics underneath — Brier Skill Score, ECE, AUC —
predate this project by decades. What Kalibra contributes is fixing them to a scale where
500 is the market's own forecast, which converts an abstract quantity into a claim anyone
can read in one second.

Three things a neighbouring product could not truthfully copy:

- **It is infrastructure, not an app.** Kalibra makes other people's trading applications
  better rather than competing with them for the same users.
- **The metric is anti-gameable by construction, not by defence.** Wash trading nets to
  zero stake, expresses no directional view, and is excluded — gaming the metric converges
  to the metric's null value. Dust is excluded by a minimum stake; small-sample farming is
  defeated by shrinkage. This falls out of using a proper scoring rule.
- **The math is verifiable by the reader.** `pnpm test` asserts against hand-computed
  numeric vectors from `docs/SCORING_SPEC.md` §8.

Kalibra does **not** claim to identify profitable traders (PRD §8). Calibration and
profitability are different properties, and the UI says so rather than letting the
leaderboard imply otherwise.

## Operating Context

Four public routes, no login on any of them:

| Route | What it is |
|---|---|
| `/` | Explains what the score measures |
| `/leaderboard` | The index itself, ranked by Kalibra Score |
| `/arena` | The AI agent board — a filtered view over the same scores |
| `/w/:address` | One wallet's profile and calibration curve |

The web app renders per request from `apps/api` on `:3001` and reads nothing else. There is
no hardcoded, cached, or fallback data: with the API killed, `/leaderboard` shows an error
rather than numbers, and the landing page drops its counters for a line saying the index is
not answering rather than keeping the ones it last saw. That behaviour is a verified claim
in the README's real-vs-mocked table, not an implementation detail.

The reviewer's entry point is `pnpm demo` — the full pipeline, offline, deterministic,
asserted byte-for-byte against `fixtures/expected/demo-output.json`. The browsable stack is
`pnpm ingest`, `pnpm api`, `pnpm web`.

Deployment is Somnia Shannon **testnet**. Whether a public URL is deployed for judging is
not recorded. Hackathon window 25 Aug – 9 Sep 2026; the build plan submits on 8 September
and treats the 9th as buffer.

## Capabilities and Constraints

**Binding invariants** (CLAUDE.md §2, enforced in CI): `packages/core` performs no I/O;
only `packages/adapter-dreamdex` knows DreamDEX exists; `pnpm demo` works offline; every
external boundary is validated with Zod; money is `bigint` in base units and converts to a
display string only at the display layer; scoring is deterministic.

**Display rules that are product truth, not styling choices:**

- The calibration chart's plot area is a fixed square. The diagonal only means perfect
  calibration when both axes are scaled alike; stretched to fit a container it becomes a
  slope that means nothing. This constraint survives any responsive work.
- Bands a trader never forecast in are **gaps** in the curve, never points interpolated
  between neighbours, and the bin table underneath shows counts so a gap can be told from a
  rendering fault.
- A `PROVISIONAL` wallet shows its status and sample count where the score would be, never
  a number.
- Sample size appears next to every leaderboard entry, so small-sample entries are visibly
  discounted rather than silently hidden.

**Vocabulary the UI uses precisely:** Kalibra Score, Brier Skill Score (BSS), Expected
Calibration Error (ECE), AUC, `RANKED`, `PROVISIONAL`, `MIN_SAMPLE` (30), λ (conviction),
`params_hash`, Event Contract, UP/DOWN, and the four evidence grades LIVE / REPLAY /
SYNTHETIC / STUB.

**Stack** (existing, not a decision to revisit): Next.js 16 App Router, React 19, Tailwind
4, shadcn with Base UI primitives, Recharts, lucide-react, Zod. Server-rendered per
request.

**Explicitly out of scope — do not build** (PRD §6, CLAUDE.md §7): authentication, accounts,
sessions, or wallet login on the read surface; any token, points programme, or airdrop
mechanic; a discretionary trading UI; sybil-resistant identity; multi-chain support; native
mobile; responsive work beyond what Tailwind gives for free; historical backfill earlier
than the recorded ingestion start block.

**Undecided, confirmed 5 Sep 2026:** whether Kalibra continues after the 9 September
deadline. Future work does not invest in a durability or growth story nobody has committed
to, and does not describe one as if it existed.

## Brand Commitments

- **Name:** Kalibra. Three named surfaces: **Index**, **Arena**, **Guard**.
- **Mark:** [`src/app/icon.svg`](src/app/icon.svg) — a dark rounded square, a dashed
  diagonal, and a single cyan dot sitting off it. The diagonal is the product's central
  image: the calibration reference line, and deviation from it is the whole subject.
- **Dark theme is the shipped default**, pinned rather than preferred: `layout.tsx` sets
  `.dark` on `<html>` and there is no toggle. The whole palette, including the landing
  page's night-to-dawn ramp, is authored for it.
- **Voice is governed by CLAUDE.md §6 and is binding.** No marketing language in code
  comments, the README, or the UI. No "blazing fast", no "revolutionary". State what the
  thing does. Discovered overclaiming is treated as fatal; acknowledged limitation is not.
  The project already writes about its own failures at length and in plain language — that
  register is the house voice, not an exception to it.
- **LIVE / REPLAY / SYNTHETIC / STUB is a public honesty contract**, defined in the README.
  Where the UI grades its own data it uses those four words with exactly those meanings.
  `LIVE` requires a transaction hash or a captured response in `fixtures/`.
- **The landing page carries no footage, by decision.** Confirmed with the owner on
  5 September 2026: the video slot was removed rather than left empty. Both opening screens
  are drawn — an animated calibration field over one continuous night-to-dawn sky — and the
  page must stay that way, because footage over the field would make the two screens two
  media pretending to be one.

## Evidence on Hand

**Real, with receipts.** Five `LIVE` rows in the README table, each carrying a Shannon
explorer transaction hash — one order sent directly by `pnpm place-one`, four forwarded
through Guard under each agent's own key. Captured testnet payloads in
`fixtures/recorded/dreamdex-testnet-2026-09-01/`. A four-source side-attribution trace
across two markets that settled in opposite directions, in
`fixtures/recorded/attribution-2026-09-02/`.

**Generated, and labelled as such.** `fixtures/synthetic/` holds 60 markets, 2,386 trades
and 60 settlements. The demo run scores 25 wallets: 20 `RANKED` from 308 to 678 over 31–51
resolved positions, and 5 `PROVISIONAL` — exactly the three wash traders and the two
sub-minimum-stake wallets.

**Arena, snapshot 4 September 2026.** `mid-anchored` `RANKED` 0 at n=170; `contrarian-fade`
`RANKED` 0 at n=51; `momentum-lean` `RANKED` 392 at n=49. Two of three agents sit on the
floor of the scale and earned it; the README explains why at length and the project chose
not to tune them upward. Guard refused `contrarian-fade` four times in five over a
twelve-hour window while barely touching the best-scoring agent, without ever reading a
score.

**Absences that must not be filled by invention.** There is no hero video, no logo beyond
the 32px mark, no photography, no illustration set, no testimonials, no customers, no
press, no pricing, no mainnet deployment, and no recorded public demo URL. Every count
above is a dated snapshot from a system still collecting — restating one as current
requires re-measuring it, and the transaction hashes are the only figures that do not move.

## Product Principles

1. **The anchor is the message.** A score means nothing without the sentence that says 500
   is the market's own forecast. Wherever a number appears, its scale is legible.
2. **Sample size travels with the score.** No rank is shown without its n, and below
   `MIN_SAMPLE` there is no number to show. Confidence is never implied by presentation
   that the evidence does not support.
3. **Show the limitation where the number is.** The score's failure modes — the conviction
   model, the flat-staker problem, the absent cheap anchor — are documented product truth.
   Surfacing them near the numbers they affect is the project's stated strategy, not a
   disclaimer to tuck away.
4. **Nothing on the read surface is fabricated or remembered.** Every quantity is read from
   the API at request time or is a cited committed vector. When the index cannot answer,
   the surface says so rather than showing a number it can no longer justify.
5. **The reader is not a customer.** The index is public, anonymous, and read-only. No
   account, no capture, no conversion mechanic, no incentive layer.

## Accessibility & Inclusion

No standard established — asked and left open on 5 September 2026, to be decided per
surface. The existing code already honours `prefers-reduced-motion` in `globals.css` and
`hero-backdrop.tsx` and carries roughly twenty ARIA attributes; that is current practice,
not a commitment, and no accessibility claim is made in the UI.
