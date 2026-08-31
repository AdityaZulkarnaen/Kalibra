# CLAUDE.md — Operating instructions for the coding agent

This file governs how code is written in this repository. It outranks habit, convention,
and inference. Where it conflicts with a document in `docs/`, this file wins on *process*
and the `docs/` file wins on *content*.

---

## 1. The prime directive

**Do not invent facts about DreamDEX.**

The DreamDEX Event Contracts API was not available when this specification was written.
Endpoint paths, field names, response shapes, authentication, rate limits, and settlement
semantics are all **unverified**.

When you need a DreamDEX detail that is not written down in
[`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md):

1. **Stop.** Do not guess a plausible endpoint. Do not write `/api/v1/eventContracts`
   because it looks right.
2. Add the question to the Unknowns Checklist in `docs/DREAMDEX_ADAPTER.md`.
3. Implement against the **canonical internal types** instead, and continue working
   through `ReplayAdapter`.
4. Report the blocker to the human in your summary.

A hallucinated endpoint costs a day of debugging. An honest `TODO(unknown)` costs nothing.

---

## 2. Non-negotiable invariants

These are checked in CI. Breaking one is a build failure, not a style nit.

**I1. `packages/core` performs no I/O.**
No network, no filesystem, no database, no clock, no randomness. Every function is pure:
same input, same output, forever. Time and randomness are passed in as arguments. This is
what makes the scoring math testable against fixed numeric vectors.

**I2. Only `packages/adapter-dreamdex` knows DreamDEX exists.**
No other package may import an HTTP client pointed at DreamDEX, reference a DreamDEX URL,
or mention a DreamDEX-specific field name. Everything downstream consumes the canonical
types defined in `docs/DREAMDEX_ADAPTER.md` §3.

**I3. `pnpm demo` works offline.**
No network, no credentials, no external services. It runs the full pipeline against
committed fixtures and prints a deterministic result. If a change breaks offline demo,
the change is wrong.

**I4. Every external boundary is validated with Zod.**
HTTP request bodies, HTTP responses from DreamDEX, WebSocket messages, and environment
variables. Parse, do not cast. `as any` at a boundary is a defect.

**I5. Money is never a float.**
All monetary and stake quantities are `bigint` in base units. Probabilities and scores are
numbers, because they are dimensionless and bounded. Convert at the display layer only.

**I6. Determinism in scoring.**
Given the same set of positions, the scoring pipeline produces byte-identical output.
No `Date.now()`, no `Math.random()`, no map-iteration-order dependence. Sort explicitly
before any reduction that is order-sensitive.

---

## 3. Definition of done

A task is not done until all of the following hold. Do not report completion otherwise.

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero warnings
- [ ] `pnpm test` passes, including the numeric vectors in `docs/SCORING_SPEC.md` §8
- [ ] `pnpm demo` completes offline and prints the expected deterministic summary
- [ ] New behaviour has a test that would fail if the behaviour were removed
- [ ] No new `TODO` without an owner and a linked section in `docs/`
- [ ] The README "What is real vs mocked" table is still accurate

That last one matters more than it looks. See §6.

---

## 4. When the specification is silent

The specs are detailed but not exhaustive. When you hit a gap, classify it:

**Cosmetic gap** (button placement, log wording, variable naming) — decide yourself, move
on, do not ask.

**Behavioural gap** (what happens when a position resolves twice, what the API returns for
an unknown wallet) — pick the most conservative behaviour, implement it, and write a note
in the PR description under `## Decisions made`. Conservative means: fail loudly rather
than silently, return empty rather than fabricate, reject rather than coerce.

**Semantic gap** (what a DreamDEX field actually means, whether settlement is inclusive of
the boundary tick) — **do not decide**. Stop and ask. Getting this wrong invalidates every
score in the system and the error is invisible until someone checks the math by hand.

---

## 5. Code conventions

- TypeScript strict mode, `noUncheckedIndexedAccess` on.
- ESM only. No CommonJS.
- Named exports. No default exports except where a framework demands it.
- Files under 300 lines. Split when longer.
- Functions under 50 lines. Extract when longer.
- Errors: throw typed errors from `packages/core/src/errors.ts`. Never throw a bare string.
- Comments explain *why*, never *what*. If the *what* is unclear, rewrite the code.
- Test files sit beside their source: `brier.ts` → `brier.test.ts`.

**Commits.** Conventional commits, one logical change each. `feat(core): add Brier skill
score`, not `wip`. Small commits are how a reviewing agent reconstructs your reasoning.

---

## 6. Honesty requirements

This project will be reviewed by a judge — plausibly an automated one — that reads the
code and runs it. Discovered overclaiming is fatal. Acknowledged limitation is not.

Maintain a **"What is real vs mocked"** table in the README, updated in the same commit
that changes the underlying truth. Every row is one of:

- `LIVE` — talks to real DreamDEX / Somnia testnet, verified with a transaction hash
- `REPLAY` — works against recorded real data
- `SYNTHETIC` — works against generated data, real integration not yet verified
- `STUB` — interface exists, implementation does not

Never write `LIVE` without a transaction hash or a captured response in `fixtures/`.

Do not write marketing language in code comments or the README. No "blazing fast", no
"revolutionary". State what the thing does.

---

## 7. What not to build

Scope discipline decides whether this ships. These are explicitly out of scope; do not
add them even if they seem quick.

- Authentication, user accounts, sessions, or wallet login on the read surface. The index
  is public and anonymous.
- Any token, points program, or airdrop mechanic.
- Mobile apps or responsive work beyond what Tailwind gives for free.
- A trading UI. Kalibra does not place discretionary orders for humans.
- Historical backfill beyond the window defined in `docs/PRD.md` §6.
- Multi-chain support. Somnia only.
- Sybil-resistant identity. It is listed as a known limitation and stays that way.

---

## 8. Working rhythm

Follow [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) day by day. Each day has acceptance
criteria. Do not start day N+1 while day N's criteria are unmet — the plan is ordered so
that later work depends on earlier guarantees, and skipping ahead produces work that has
to be redone against a changed foundation.

At the end of each work session, output:

1. What was completed, mapped to the day's acceptance criteria
2. Decisions made under §4
3. New entries added to the Unknowns Checklist
4. What is blocked and on whom

---

## 9. Reference order

When you need to know something, look here in this order:

1. This file, for process
2. `docs/SCORING_SPEC.md`, for anything numeric
3. `docs/DREAMDEX_ADAPTER.md`, for anything about external data
4. `docs/API_SPEC.md`, for anything about our own interfaces
5. `docs/ARCHITECTURE.md`, for where code belongs
6. `docs/PRD.md`, for whether something should exist at all

If two documents disagree, the more specific one wins, and you file an issue noting the
contradiction.
