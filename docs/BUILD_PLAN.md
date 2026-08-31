# Build Plan

**31 August – 9 September 2026.** Submission deadline 9 September; the plan targets
completion on 8 September so that the last day is buffer, not crunch.

Days are ordered by dependency. Do not start day N+1 until day N's acceptance criteria
pass — later work assumes earlier guarantees, and building on an unverified foundation
means redoing it.

---

## Ordering principle

The riskiest unknown is the DreamDEX API. The plan therefore front-loads two things:

1. **Discovery on day 1**, in parallel with scaffolding, so the answer to U3 and U10
   (`DREAMDEX_ADAPTER.md` §7) arrives while there is still time to change course.
2. **The synthetic fixture path before the live path**, so that every subsequent day's
   work can proceed at full speed whether or not the API cooperates.

By end of day 2, the project is guaranteed to ship something complete. Everything after
that increases scope, never rescues the deadline.

---

## Day 1 — Monday 31 Aug — foundation and discovery

Two tracks. Run the discovery track first thing; it has external latency.

**Track A — discovery** (`DREAMDEX_ADAPTER.md` §5)

- Post the six questions in the hackathon Telegram
- Locate DreamDEX docs, `SKILL.md`, `AGENTS.md` if published
- Request testnet STT from the faucet
- Fill in whatever of §6 and §7 can be answered

**Track B — scaffold and core math**

- pnpm workspace, TypeScript strict, Vitest, ESLint, Prettier
- Lint rule enforcing invariant I2 (no DreamDEX imports outside the adapter)
- `packages/core`: constants, types, errors
- `conviction.ts`, `forecast.ts`, `brier.ts`, `calibration.ts`, `discrimination.ts`,
  `score.ts`
- **Test vectors V1, V2, V3, V6 from `SCORING_SPEC.md` §8 implemented and green**

**Acceptance**

- [ ] `pnpm test` green with V1, V2, V3, V6 passing
- [ ] V1 produces exactly 500 — if not, stop and fix before anything else
- [ ] Lint fails when a test file imports `axios` into `packages/core`
- [ ] `DREAMDEX_ADAPTER.md` §7 updated with whatever discovery returned

Write V1 first. It is three positions and it validates the entire anchoring of the metric.
Everything else is meaningless if V1 does not land on 500.

---

## Day 2 — Tuesday 1 Sep — adapter, fixtures, persistence

- `packages/adapter-dreamdex`: canonical types, Zod schemas, the interface
- `ReplayAdapter` reading `fixtures/synthetic/`
- `scripts/generate-fixtures.ts` per `DREAMDEX_ADAPTER.md` §9, LCG seed 42
- `packages/db`: Drizzle schema per `API_SPEC.md` §1, migrations
- `apps/indexer`: ingest from adapter → persist trades and settlements, idempotent

**Decide the attribution plan.** Based on U10, choose Plan A, B, or C from
`DREAMDEX_ADAPTER.md` §8 and record it in the README. This decision cannot slip past
today; every later day depends on it.

**Acceptance**

- [ ] `pnpm generate-fixtures` produces deterministic output — running twice yields
      byte-identical files
- [ ] Indexer ingests all synthetic fixtures into SQLite
- [ ] Re-running ingestion produces zero duplicate rows
- [ ] Attribution plan recorded in the README
- [ ] V4 and V5 test vectors green (they need the LCG, which lands today)

---

## Day 3 — Wednesday 2 Sep — aggregation and scoring pipeline

- `aggregate.ts`: trades → positions, stake-weighted `p`, netting, exclusions
- Scoring pipeline in the indexer, ordered per `SCORING_SPEC.md` §7
- `scores` and `calibration_bins` populated
- `params_hash` computed and stored

**Acceptance**

- [ ] Full pipeline runs over synthetic fixtures and produces scores for all 25 wallets
- [ ] Wash-trading wallets net out correctly — verified by an explicit test asserting
      those wallets are either excluded or score near 500
- [ ] Sub-minimum-stake wallets are excluded with `excluded_reason` set
- [ ] The VOID market excludes all its positions
- [ ] Running the pipeline twice produces identical `scores` rows
- [ ] `fixtures/expected/demo-output.json` generated and committed

---

## Day 4 — Thursday 3 Sep — API and live adapter

- `apps/api`: every endpoint in `API_SPEC.md` §2
- Zod response validation in test mode
- Contract tests against the committed example payloads
- `LiveAdapter` against whatever discovery produced
- `scripts/record.ts` to capture live payloads into `fixtures/recorded/`

**Acceptance**

- [ ] Every documented endpoint returns a schema-valid response
- [ ] `GET /v1/wallet/:address` returns a full calibration array with all ten bins
- [ ] Live mode connects and ingests at least one real trade, **or** the blocker is
      documented in the Unknowns Checklist with the fallback plan in effect
- [ ] `pnpm demo` still works offline

That last box is checked every single day from here on. It is the guarantee the whole plan
rests on.

---

## Day 5 — Friday 4 Sep — the web app

- Next.js App Router, Tailwind, shadcn/ui
- Leaderboard page with sample size shown beside every score
- `/w/:address` profile: score, stats, calibration curve
- Calibration chart in Recharts: scatter plus the diagonal reference line
- The "what this score is not" text from `SCORING_SPEC.md` §9, on the page, not in a
  tooltip

**Acceptance**

- [ ] Leaderboard renders from the API with zero hardcoded data
- [ ] Profile page renders the calibration curve with the diagonal visible
- [ ] Empty bins render as gaps, not interpolated
- [ ] `PROVISIONAL` wallets show the status and the sample count, never a number
- [ ] API down produces an error state, never stale mock data

The calibration curve is the screenshot that will appear in the submission. Spend the
polish budget here rather than spreading it evenly.

---

## Day 6 — Saturday 5 Sep — Guard

- `policy.ts`: `evaluate()`, pure, all eleven reason codes
- `audit.ts`: `canonicalJson`, hash chain, `verifyChain`
- `apps/guard` HTTP transport
- Guard-forwarded fills written into `trades` with `source = 'GUARD'`

**Acceptance**

- [ ] Eleven tests, one per reason code, each asserting that code and no other
- [ ] Rule ordering tested: a killed agent over its daily loss sees `KILL_SWITCH_ACTIVE`
- [ ] `verifyChain` returns true for a clean log
- [ ] `verifyChain` returns false with the correct `brokenAt` when one byte is mutated
- [ ] `canonicalJson` tested with key-shuffled inputs producing identical output
- [ ] A Guard fill appears in `trades` and flows into scoring

---

## Day 7 — Sunday 6 Sep — MCP, Arena, agent demo

- MCP server with the six tools in `RISK_POLICY_SPEC.md` §7
- `SKILL.md` and `AGENTS.md` at the repository root
- Arena registration endpoint and filtered leaderboard view
- A demo agent that trades through Guard and deliberately trips a limit

**Acceptance**

- [ ] An MCP client connects and lists all six tools
- [ ] The demo agent places an allowed order and it reaches the adapter
- [ ] The demo agent attempts an oversized order, is refused with `ORDER_TOO_LARGE`, and
      the refusal appears in the audit log
- [ ] The agent appears on the Arena leaderboard with a score
- [ ] No MCP tool can mutate policy — asserted by a test over the tool list

---

## Day 8 — Monday 7 Sep — hardening and demo

No new features. This day exists because the difference between a working project and a
winning one is made here.

- `pnpm demo` produces a clean deterministic run asserted against
  `fixtures/expected/demo-output.json`
- README complete: what it is, the score explained in one paragraph, quickstart, the
  "what is real vs mocked" table, known limitations verbatim from `PRD.md` §9
- Real Somnia testnet transaction hashes in the README as evidence
- Screenshots: leaderboard, calibration curve, a Guard refusal
- Demo video, 2–3 minutes, script in `SUBMISSION.md` §3
- Full test suite green, typecheck clean, lint clean

**Acceptance**

- [ ] `git clone && pnpm i && pnpm test && pnpm demo` works on a clean machine with
      **networking disabled**
- [ ] Every claim in the README is true — check each row of the real-vs-mocked table
      against the code
- [ ] Video recorded

---

## Day 9 — Tuesday 8 Sep — submit

- DoraHacks BUIDL submission per `SUBMISSION.md`
- Repository public, license added, description written
- Final read of `SUBMISSION.md` checklist

**Submit today, not on the 9th.** Platform issues, upload failures, and timezone
confusion are ordinary and they are fatal at the deadline.

**9 September is buffer.** If everything is done, use it for a P2 item — score history
(`PRD.md` R11), the market efficiency panel (R10), or the on-chain score attestation from
`DREAMDEX_ADAPTER.md` §10. Only after the submission is confirmed received.

---

## Cut list

If time compresses, cut in this order. Decide by end of day 6.

1. WebSocket live updates (`API_SPEC.md` §3)
2. Market efficiency panel (R10)
3. Score history over time (R11)
4. Arena as a separate view — fold agents into the main leaderboard with a badge
5. MCP server — keep the HTTP Guard, note MCP as future work

**Never cut:** the scoring math, the calibration curve, the offline demo, or the
real-vs-mocked table. Those four are the project. Everything else is surface area.

---

## Test strategy

**Unit — `packages/core`.** Pure functions, fixed inputs, exact expected outputs. This is
where the numeric vectors live. Target: every function in core has a test asserting a
value from `SCORING_SPEC.md` §8. No mocking anywhere, because there is nothing to mock.

**Property tests.** A handful, high value:

- forecast monotonicity: `f` increases with λ for UP, decreases for DOWN
- `λ = 0 ⟹ f = p` for both sides
- score monotonicity in edge (V5)
- `verifyChain` rejects any single-byte mutation at any position, over generated logs
- `canonicalJson` is invariant to key insertion order

**Integration — the pipeline.** `ReplayAdapter` → indexer → scoring → API, asserted
against `fixtures/expected/demo-output.json`. One test, high coverage, catches wiring
errors that unit tests structurally cannot.

**Contract — the API.** Every example payload in `API_SPEC.md` parsed by its Zod schema.
Keeps documentation and implementation from drifting.

**Adapter — recorded fixtures.** `LiveAdapter` parses captured real payloads and produces
canonical types. Real data, no network.

**Not tested:** the web app beyond a smoke render. UI tests are expensive and the reviewer
will look at the screen, not at a testing-library assertion.

---

## Daily rhythm

Start each day by re-reading that day's acceptance criteria. End each day by reporting
against them per `CLAUDE.md` §8. If a criterion cannot be met, say so explicitly and
choose from the cut list rather than silently carrying the gap forward — a gap carried
forward compounds, and by day 7 it is unrecoverable.
