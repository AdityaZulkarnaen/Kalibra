# AGENTS.md

Kalibra is a calibration and reputation layer for DreamDEX Event Contracts on Somnia. This
file is the entry point for an agent working in or against this repository. There are two
kinds, and they want different documents.

---

## If you are writing code in this repository

**Read [`CLAUDE.md`](CLAUDE.md).** It is the operating contract and it outranks habit,
convention and inference. It is not a summary of this file; this file is a pointer to it.

The four things it will tell you that are most often got wrong:

1. **Do not invent facts about DreamDEX.** The Event Contracts API was unverified when the
   specification was written. If a detail is not in [`docs/DREAMDEX_ADAPTER.md`](docs/DREAMDEX_ADAPTER.md),
   add it to that file's Unknowns Checklist and implement against the canonical internal
   types instead. A hallucinated endpoint costs a day; an honest `TODO(unknown)` costs
   nothing.
2. **`packages/core` performs no I/O.** No network, no filesystem, no clock, no randomness.
   Time and randomness are arguments. This is what makes the scoring math testable against
   fixed numeric vectors, and it is enforced by lint.
3. **Only `packages/adapter-dreamdex` knows the venue exists.** Everything downstream
   consumes canonical types. Also enforced by lint.
4. **Money is `bigint` in base units, never a float.** Probabilities and scores are numbers,
   because they are dimensionless and bounded.

Then read [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for what day it is and what that day
has to satisfy, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for where code belongs.

Before reporting anything complete: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm demo`.
`pnpm verify` runs all of them. `pnpm demo` must work offline — that guarantee is load
bearing and a change that breaks it is the wrong change.

**On honesty.** The README carries a "what is real vs mocked" table, updated in the same
commit as the code it describes. Do not write `LIVE` without a transaction hash or a
captured response in `fixtures/`. Acknowledged limitation is fine here; discovered
overclaiming is not.

---

## If you are an agent trading through Kalibra Guard

**Read [`SKILL.md`](SKILL.md).** It covers the six MCP tools, the order to call them in, how
to read a refusal, and — the part that changes how you should trade — what the Kalibra Score
actually rewards, which is calibration against the market rather than profit.

Two things worth knowing before you get there:

- You cannot reach DreamDEX except through Guard. Guard holds the signing key; you do not.
- There is no tool that changes the risk policy. That is deliberate and there is no way
  around it.

---

## Repository map

```
packages/core/              scoring math, policy engine, audit chain — pure, no I/O
packages/adapter-dreamdex/  the only place that knows the venue exists
packages/db/                SQLite schema and queries
apps/indexer/               ingest -> aggregate -> score
apps/api/                   public read API (:3001)
apps/web/                   Next.js leaderboard, profile, arena (:3000)
apps/guard/                 policy engine over HTTP (:3002)
apps/mcp/                   Guard as an MCP server, over stdio
apps/agent/                 three demo agents that trade through Guard
docs/                       the specification set
fixtures/                   synthetic fixtures, recorded payloads, expected demo output
```

---

## Quickstart

```bash
pnpm install
pnpm test          # no network required
pnpm demo          # the full pipeline over committed fixtures, offline, deterministic
```

To run the stack instead of reading a summary of it:

```bash
pnpm ingest        # fixtures -> ./kalibra.db  (KALIBRA_MODE=live reads the testnet)
pnpm api           # :3001
pnpm web           # :3000
pnpm guard         # :3002
```
