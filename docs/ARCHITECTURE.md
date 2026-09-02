# Architecture — Kalibra

---

## 1. Shape of the system

```
                    ┌──────────────────────────────────────┐
                    │  DreamDEX  (REST + WebSocket)        │
                    │  Somnia    (JSON-RPC, settlement)    │
                    └──────────────────┬───────────────────┘
                                       │  UNVERIFIED SURFACE
        ═══════════════════════════════╪═══════════════════════════════
                                       │  ← the only crossing point
                    ┌──────────────────▼───────────────────┐
                    │  packages/adapter-dreamdex           │
                    │  LiveAdapter │ ReplayAdapter          │
                    │  → emits CANONICAL TYPES only         │
                    └────────┬──────────────────┬───────────┘
                             │                  │
              ┌──────────────▼──────┐   ┌───────▼──────────────┐
              │  apps/indexer       │   │  apps/guard          │
              │  stream → persist   │   │  policy → audit →    │
              │  → aggregate        │   │  forward             │
              └──────────┬──────────┘   └───────┬──────────────┘
                         │                      │
                         ▼                      ▼
              ┌───────────────────────────────────────────┐
              │  SQLite  (kalibra.db)                     │
              │  trades · positions · scores · audit_log  │
              └──────────┬────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  packages/core      │  ← PURE. no I/O, ever.
              │  brier · ece · auc  │
              │  score · aggregate  │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐      ┌────────────────────┐
              │  apps/api  (REST)   │◄─────┤  apps/guard MCP    │
              └──────────┬──────────┘      └────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  apps/web  (Next)   │
              └─────────────────────┘
```

The double line is the most important thing in this document. **Everything above it is
unverified. Everything below it is ours.** The adapter is the airlock.

---

## 2. Module boundaries and why they exist

### `packages/core` — pure computation

Contains all scoring mathematics and position aggregation. Zero dependencies on I/O,
clocks, randomness, or the database.

*Why:* the scoring math is the intellectual centre of the project and the thing a reviewer
will check hardest. Purity means it can be asserted against fixed numeric vectors with no
mocking, no setup, and no flakiness. It also means the math can be extracted and reused by
anyone, which supports the "infrastructure not app" positioning.

Enforced by lint rule: `packages/core` may not import from any other workspace package,
nor from `node:fs`, `node:http`, `node:crypto` (except pure hash functions), or any
network client.

### `packages/adapter-dreamdex` — the airlock

The only module that knows DreamDEX exists. Exports one interface, two implementations.

```ts
export interface DreamDexAdapter {
  streamTrades(opts: StreamOpts): AsyncIterable<CanonicalTrade>;
  streamSettlements(opts: StreamOpts): AsyncIterable<CanonicalSettlement>;
  listMarkets(): Promise<CanonicalMarket[]>;
  getQuote(marketId: string, at: number): Promise<CanonicalQuote>;
  placeOrder(order: CanonicalOrder): Promise<CanonicalOrderResult>;
}
```

`LiveAdapter` talks to the real API. `ReplayAdapter` reads from `fixtures/` and replays
with the recorded timing collapsed to zero delay.

*Why:* the DreamDEX API shape is unknown. Isolating it means that when reality contradicts
the specification, exactly one file changes and every test in the repository still passes.
Without this boundary, an API surprise on day 6 would require rewriting the indexer, the
scoring pipeline, and the tests simultaneously — which is how hackathon projects die.

Full canonical type definitions and the discovery protocol are in
[`DREAMDEX_ADAPTER.md`](DREAMDEX_ADAPTER.md).

### `packages/db` — schema and queries

Drizzle schema, migrations, and typed query functions. No business logic.

### `apps/indexer` — ingestion and scoring pipeline

Consumes the adapter's streams, persists raw trades and settlements, aggregates them into
positions, calls `packages/core` to score, and writes results.

Runs as a long-lived process in live mode and as a single batch pass in replay mode. The
same code path serves both, which is what makes the offline demo trustworthy rather than a
separate, divergent fake.

### `apps/api` — public read surface

Fastify. Read-only. No authentication. Serves the leaderboard, trader profiles,
calibration curves, and market statistics. Contract in [`API_SPEC.md`](API_SPEC.md).

### `apps/guard` — policy engine

Two transports over one core: an HTTP proxy and an MCP server. Both call the same
`evaluate(policy, state, order)` pure function from `packages/core`, so the enforcement
logic cannot drift between transports.

### `apps/web` — the interface

Next.js App Router. Server components fetch from `apps/api`. No data is hardcoded in the
frontend; if the API is down, the page shows an error state rather than stale mock data.

---

## 3. Data flow

### 3.1 Ingestion

```
adapter.streamTrades()
  → validate with Zod          (reject and log malformed, never coerce)
  → insert into `trades`       (idempotent on trade_id, ON CONFLICT DO NOTHING)
  → mark market as dirty
```

Settlements follow the same path into `settlements`.

> **Contradiction, noted 1 Sep 2026.** `API_SPEC.md` §1 defines no `settlements` table —
> a resolution lives in `outcome`, `settlement_level`, `settled_at` and `settle_tx_hash`
> on `markets`. Per `CLAUDE.md` §9 the more specific document wins, so the implementation
> follows `API_SPEC.md` and a settlement is an UPDATE on `markets`. A settlement for an
> unknown market therefore has nowhere to land: the indexer counts and warns rather than
> fabricating a market row from it.

Idempotency matters because a WebSocket reconnect will replay messages. Every insert is
keyed on a natural identifier from the source and ignores duplicates. This also makes the
whole pipeline safely re-runnable, which the demo depends on.

### 3.2 Aggregation

Triggered when a market settles. For that market:

```
SELECT trades WHERE market_id = ?
  → group by (wallet, side)
  → size-weighted average execution price, summed stake
  → net opposing sides within the same wallet   (see SCORING_SPEC §4.3)
  → drop positions below MIN_STAKE
  → write to `positions` with the settled outcome attached
```

One position per (wallet, market, side) after netting. This is what prevents a trader from
inflating their sample count by splitting one conviction into forty orders.

### 3.3 Scoring

Triggered after aggregation. For each affected wallet:

```
SELECT positions WHERE wallet = ? AND outcome IS NOT NULL
  → order by settled_at ASC, position_id ASC   (deterministic, see I6)
  → computeConviction()      → λ per position
  → computeForecast()        → f per position
  → brierScore(f, y) and brierScore(p, y)
  → brierSkillScore()
  → expectedCalibrationError()
  → rocAuc()
  → kalibraScore()
  → upsert into `scores`
```

Every step is a pure function in `packages/core`. The indexer supplies data and stores
results; it does no arithmetic itself.

### 3.4 Guard request path

```
agent → MCP or HTTP
      → load policy + current state from db
      → evaluate(policy, state, order)        ← pure
      → append decision to audit_log with prev_hash
      → if ALLOW: adapter.placeOrder()
      → if DENY:  return reason code, do not forward
```

The audit entry is written **before** the order is forwarded. A crash between logging and
forwarding leaves a log entry with no order, which is detectable. The reverse — an order
with no log entry — would be undetectable, and so is not permitted.

---

## 4. Technology decisions

Each of these is a decision, not a default. Rationale included so nobody relitigates them
on day 5.

| Choice | Why | Rejected alternative |
|---|---|---|
| **TypeScript, strict, ESM** | One language across indexer, API, web, and MCP server. Shared types across the boundary catch integration errors at compile time. | Python for the math. Rejected: the type sharing is worth more than the numeric library ergonomics at this scale. |
| **pnpm workspaces** | Enforces the module boundaries in §2 mechanically rather than by convention. | Single package. Rejected: nothing would stop the indexer importing an HTTP client into core. |
| **SQLite + better-sqlite3** | Single file, zero setup, no Docker. A reviewer clones and runs. Synchronous API removes a class of race conditions. Trivially committable as a fixture. | Postgres. Rejected: setup friction directly threatens invariant I3, and we have no scale requirement that SQLite cannot meet within a hackathon dataset. |
| **Drizzle ORM** | Schema in TypeScript, types flow to queries, migrations are plain SQL and reviewable. | Prisma. Rejected: heavier codegen step, and the generated client obscures the SQL a reviewer wants to read. |
| **Fastify** | Fast, first-class Zod integration via `fastify-type-provider-zod`, small surface. | Express. Rejected: weaker typing story at the boundary, which invariant I4 depends on. |
| **Next.js App Router + Tailwind + shadcn/ui** | Server components fetch directly, no client state library needed. shadcn gives credible visual quality without design time. | Vite SPA. Rejected: would require building a data-fetching layer we do not have time for. |
| **Recharts** | The calibration curve is a scatter plus a reference line. Recharts does this in twenty lines. | D3. Rejected: hours of work for a chart that is not the differentiator. |
| **viem** | Typed, modern, tree-shakeable Somnia JSON-RPC access for settlement reads. | ethers v6. Rejected: viem's type inference is stronger and matters at the adapter boundary. |
| **Vitest** | Fast, ESM-native, same config across all packages. | Jest. Rejected: ESM friction. |
| **Zod everywhere at boundaries** | Invariant I4. Runtime shape enforcement is the only defence against an unverified upstream API. | Trusting TypeScript types. Rejected: types are erased at runtime and DreamDEX is unverified. |
| **`@modelcontextprotocol/sdk`** | DreamDEX ships MCP support and `AGENTS.md` / `SKILL.md` conventions. Matching those conventions is itself a signal to judges that the docs were read. | Custom HTTP-only agent API. Rejected: forgoes a stated ecosystem primitive. |

---

## 5. Repository layout

```
kalibra/
├── README.md
├── CLAUDE.md
├── AGENTS.md                    → symlink to CLAUDE.md (DreamDEX convention)
├── package.json                 workspace root, all scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
├── .env.example
│
├── docs/                        this specification set
│
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── types.ts           canonical domain types
│   │       ├── errors.ts          typed error classes
│   │       ├── conviction.ts      λ from stake
│   │       ├── forecast.ts        f from p, side, λ
│   │       ├── brier.ts           BS, BSS
│   │       ├── calibration.ts     bins, ECE
│   │       ├── discrimination.ts  ROC-AUC
│   │       ├── score.ts           KalibraScore composition
│   │       ├── aggregate.ts       trades → positions
│   │       ├── policy.ts          Guard evaluate()
│   │       └── audit.ts           hash chain build + verify
│   │
│   ├── adapter-dreamdex/
│   │   └── src/
│   │       ├── canonical.ts       canonical types + Zod schemas
│   │       ├── adapter.ts         the interface
│   │       ├── live.ts            real implementation
│   │       ├── replay.ts          fixture-backed implementation
│   │       └── record.ts          capture live traffic → fixtures
│   │
│   └── db/
│       └── src/
│           ├── schema.ts
│           ├── migrate.ts
│           └── queries.ts
│
├── apps/
│   ├── indexer/
│   ├── api/
│   ├── guard/
│   └── web/
│
├── fixtures/
│   ├── synthetic/               generated, deterministic seed
│   ├── recorded/                captured from live DreamDEX
│   └── expected/
│       └── demo-output.json     the assertion target for `pnpm demo`
│
└── scripts/
    ├── generate-fixtures.ts
    └── demo.ts
```

---

## 6. Configuration

All configuration is environment variables, parsed once at startup with Zod. A missing or
malformed variable is a startup crash, never a silent default.

```
KALIBRA_MODE=replay|live         default: replay
KALIBRA_DB_PATH=./kalibra.db     indexer, api and guard all open this
DREAMDEX_INDEXER_URL=            live mode only, no default; testnet value in
                                 DREAMDEX_ADAPTER.md U19, read surface needs no key
DREAMDEX_MARKET_LIMIT=10         markets per live pass, 1..500
API_PORT=3001
GUARD_PORT=3002
GUARD_POLICY_PATH=./guard.policy.json
GUARD_OPERATOR_TOKEN=            unset means the operator routes are not registered
GUARD_AGENT_WALLETS=             agentId=0xwallet pairs, comma separated
KALIBRA_API_URL=http://127.0.0.1:3001   apps/web reads the index from here
```

That list is exhaustive: it is every variable any package reads. Nothing loads a `.env`
file automatically — there is no dotenv in the runtime path and the `package.json`
scripts pass no `--env-file`.

Live writes are not built, so there is no signing key here yet. When `LiveAdapter` gains
a write path this section gains the variable in the same commit, and not before.

`KALIBRA_MODE` defaults to `replay`. Running the repository with no configuration at all
produces a working offline demo rather than a connection error. This is a deliberate
choice in service of invariant I3.

---

## 7. Failure behaviour

**DreamDEX WebSocket drops.** Reconnect with exponential backoff capped at 30s. On
reconnect, re-request from the last persisted sequence marker. Duplicates are absorbed by
idempotent inserts (§3.1), so over-fetching is safe and under-fetching is not — always
re-request from before the gap.

**Malformed upstream message.** Zod rejects it. Log the raw payload to
`fixtures/rejected/` with a timestamp, increment a counter, continue. Never coerce, never
crash the stream. The rejected payloads are evidence for the Unknowns Checklist.

**Settlement arrives for an unknown market.** Persist it. Aggregate what exists. Record a
warning. Do not fabricate the missing trades.

**A wallet has zero resolved positions.** The API returns `status: "PROVISIONAL"` with
`score: null`. It does not return 0, because 0 means "measurably bad" and absence of
evidence is not evidence of absence.

**`BS_market` is zero.** The market predicted perfectly; BSS is undefined by division.
Handled explicitly in `SCORING_SPEC.md` §5.3. Never allowed to produce `NaN` or `Infinity`
downstream.

**Guard cannot reach DreamDEX.** Deny the order with `UPSTREAM_UNAVAILABLE`, log it. Never
queue for later retry — a delayed fill on a fixed-window contract is worse than no fill,
because the window may have closed.

---

## 8. Performance

Not a constraint at hackathon scale, and no time should be spent on it. For the record:
the expected dataset is thousands of trades, not millions. SQLite with indexes on
`(market_id)`, `(wallet)`, and `(settled_at)` is more than sufficient. Scoring recomputes
a wallet's full history on each settlement, which is O(n) per wallet with small n.

If a reviewer asks about scale, the answer is that the scoring functions are pure and
stateless, so horizontal partitioning by wallet is trivial. Do not build it.
