# API and Data Model Specification

---

## 1. Database schema

SQLite via Drizzle. Bigints are stored as `TEXT` holding a decimal string — SQLite's
integer type tops out at 64 bits signed and token base units can exceed that. Convert at
the query layer.

Timestamps are integer milliseconds since epoch, UTC.

```sql
-- Markets ---------------------------------------------------------------
CREATE TABLE markets (
  market_id        TEXT PRIMARY KEY,
  underlying       TEXT NOT NULL,
  window_start     INTEGER NOT NULL,
  window_end       INTEGER NOT NULL,
  strike           TEXT,
  strike_decimals  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED','SETTLED','VOID')),
  outcome          TEXT     CHECK (outcome IN ('UP','DOWN','VOID')),
  settlement_level TEXT,
  settled_at       INTEGER,
  settle_tx_hash   TEXT
);
CREATE INDEX idx_markets_status   ON markets(status);
CREATE INDEX idx_markets_settled  ON markets(settled_at);

-- Raw trades ------------------------------------------------------------
CREATE TABLE trades (
  trade_id         TEXT PRIMARY KEY,          -- idempotency key
  market_id        TEXT NOT NULL REFERENCES markets(market_id),
  wallet           TEXT NOT NULL,             -- lowercase 0x
  side             TEXT NOT NULL CHECK (side IN ('UP','DOWN')),
  implied_prob_up  REAL NOT NULL,
  quote_source     TEXT NOT NULL CHECK (quote_source IN ('MID','LAST')),
  stake            TEXT NOT NULL,
  stake_decimals   INTEGER NOT NULL,
  timestamp        INTEGER NOT NULL,
  tx_hash          TEXT,
  source           TEXT NOT NULL CHECK (source IN ('FEED','ONCHAIN','GUARD')),
  ingested_at      INTEGER NOT NULL
);
CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_wallet ON trades(wallet);

-- Aggregated, scored positions ------------------------------------------
CREATE TABLE positions (
  position_id      TEXT PRIMARY KEY,          -- sha256(wallet|market_id) hex, see §1.1
  wallet           TEXT NOT NULL,
  market_id        TEXT NOT NULL REFERENCES markets(market_id),
  side             TEXT NOT NULL CHECK (side IN ('UP','DOWN')),
  net_stake        TEXT NOT NULL,
  p                REAL NOT NULL,             -- clamped implied P(UP)
  raw_p            REAL NOT NULL,             -- pre-clamp, for audit
  quote_source     TEXT NOT NULL,
  lambda           REAL,                      -- null until scored
  forecast         REAL,                      -- null until scored
  outcome_y        INTEGER CHECK (outcome_y IN (0,1)),
  excluded_reason  TEXT,                      -- null if scored
  entered_at       INTEGER NOT NULL,
  settled_at       INTEGER
);
CREATE UNIQUE INDEX idx_positions_unique  ON positions(wallet, market_id);
CREATE INDEX idx_positions_wallet_settled ON positions(wallet, settled_at, position_id);

-- Per-wallet scores -----------------------------------------------------
CREATE TABLE scores (
  wallet            TEXT PRIMARY KEY,
  n                 INTEGER NOT NULL,
  bs_trader         REAL,
  bs_market         REAL,
  bss               REAL,
  bss_shrunk        REAL,
  ece_trader        REAL,
  ece_market        REAL,
  ece_excess        REAL,
  auc               REAL,
  score             INTEGER,                  -- null when PROVISIONAL
  score_internal    INTEGER NOT NULL,         -- always computed, see SCORING_SPEC §6.1
  status            TEXT NOT NULL CHECK (status IN ('RANKED','PROVISIONAL')),
  excluded_count    INTEGER NOT NULL DEFAULT 0,
  params_hash       TEXT NOT NULL,            -- hash of the constant set used
  computed_at       INTEGER NOT NULL
);
CREATE INDEX idx_scores_rank ON scores(status, score DESC);

-- Calibration bins, denormalised for cheap chart reads ------------------
CREATE TABLE calibration_bins (
  wallet         TEXT NOT NULL,
  bin_index      INTEGER NOT NULL CHECK (bin_index BETWEEN 0 AND 9),
  count          INTEGER NOT NULL,
  mean_forecast  REAL,
  observed_freq  REAL,
  PRIMARY KEY (wallet, bin_index)
);

-- Arena -----------------------------------------------------------------
CREATE TABLE agents (
  agent_id      TEXT PRIMARY KEY,
  wallet        TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  method        TEXT,                         -- free text: how it forecasts
  registered_at INTEGER NOT NULL
);

-- Guard -----------------------------------------------------------------
CREATE TABLE audit_log (
  seq             INTEGER PRIMARY KEY,        -- 1-based, contiguous
  timestamp       INTEGER NOT NULL,
  agent_id        TEXT NOT NULL,
  policy_id       TEXT NOT NULL,
  policy_version  INTEGER NOT NULL,
  order_json      TEXT NOT NULL,
  decision_json   TEXT NOT NULL,
  state_json      TEXT NOT NULL,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);
CREATE INDEX idx_audit_agent ON audit_log(agent_id, seq);

-- Pipeline metadata -----------------------------------------------------
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: 'ingest_start_block', 'last_seq_marker', 'mode', 'params_hash', 'schema_version'
```

### 1.1 Position identity

`position_id = sha256(lowercase(wallet) + '|' + market_id)` as lowercase hex.

Derived rather than random so that re-running aggregation is idempotent and produces
stable ids across machines. The `UNIQUE(wallet, market_id)` index enforces the netting
rule from `SCORING_SPEC.md` §4.3 at the database level: one wallet cannot hold two scored
positions in one market. A constraint violation there is a real bug, not something to
paper over with `ON CONFLICT`.

### 1.2 `params_hash`

`sha256` over the canonical JSON of the constant set in `SCORING_SPEC.md` §1. Stored on
every score row.

If a constant changes, `params_hash` changes, and it becomes immediately visible which
scores were computed under which parameter set. Without it, tuning `LAMBDA_MAX` mid-build
silently produces a leaderboard mixing incomparable numbers.

---

## 2. Public read API

Fastify, JSON, no authentication, `Cache-Control: public, max-age=10`.
Base path `/v1`.

### 2.1 Conventions

Errors:

```json
{ "error": { "code": "NOT_FOUND", "message": "no positions for that wallet" } }
```

Codes: `NOT_FOUND` (404), `BAD_REQUEST` (400), `INTERNAL` (500). Nothing else.

All bigints are JSON strings. All timestamps are integer milliseconds UTC. Wallet
addresses are lowercase in every response, regardless of request casing.

Pagination is `?limit=&offset=`, `limit` default 50, maximum 200.

---

### `GET /v1/leaderboard`

Query: `limit`, `offset`, `status` = `ranked` | `all` (default `ranked`).

```json
{
  "params": { "lambdaMax": 0.5, "shrinkK": 25, "minSample": 30, "paramsHash": "0x..." },
  "total": 128,
  "entries": [
    {
      "rank": 1,
      "wallet": "0xabc...",
      "score": 812,
      "status": "RANKED",
      "n": 147,
      "bss": 0.2104,
      "eceExcess": 0.0,
      "auc": 0.641,
      "isAgent": true,
      "agentName": "vol-lean-v2"
    }
  ]
}
```

`n` sits beside every score deliberately. A reader must never see a rank without the
sample size behind it — that is the exact failure mode the product exists to correct.

`params` is echoed on every leaderboard response so any result can be reproduced.

---

### `GET /v1/wallet/:address`

404 if the wallet has no positions at all. A wallet with only excluded positions returns
200 with `status: "PROVISIONAL"`, `n: 0`, and a non-zero `excludedCount` — the difference
between "unknown to us" and "known but not yet measurable" is meaningful and must be
visible.

```json
{
  "wallet": "0xabc...",
  "score": 812,
  "status": "RANKED",
  "n": 147,
  "excludedCount": 3,
  "stats": {
    "bsTrader": 0.1892, "bsMarket": 0.2397,
    "bss": 0.2104, "bssShrunk": 0.1798,
    "eceTrader": 0.0412, "eceMarket": 0.0688, "eceExcess": 0.0,
    "auc": 0.641
  },
  "calibration": [
    { "bin": 0, "range": [0.0, 0.1], "count": 0,  "meanForecast": null, "observedFreq": null },
    { "bin": 5, "range": [0.5, 0.6], "count": 31, "meanForecast": 0.5512, "observedFreq": 0.5806 }
  ],
  "agent": { "agentId": "ag_01", "name": "vol-lean-v2", "method": "realised vol term structure" },
  "paramsHash": "0x...",
  "computedAt": 1756400000000
}
```

`calibration` always returns all ten bins, including empty ones with `count: 0` and null
statistics. The chart renders gaps rather than interpolating across them, which is the
honest representation.

---

### `GET /v1/wallet/:address/positions`

Paginated. Includes excluded positions with their `excludedReason`, so the exclusion count
in §2.2 is auditable rather than asserted.

```json
{
  "total": 150,
  "positions": [
    {
      "positionId": "a3f...",
      "marketId": "BTC-USD-1756400000",
      "underlying": "BTC-USD",
      "side": "UP",
      "netStake": "25000000",
      "stakeDecimals": 6,
      "p": 0.58, "lambda": 0.5, "forecast": 0.79,
      "outcomeY": 1,
      "brierContribution": 0.0441,
      "marketBrierContribution": 0.1764,
      "excludedReason": null,
      "settledAt": 1756400900000
    }
  ]
}
```

`brierContribution` alongside `marketBrierContribution` lets a trader see, per position,
whether their lean helped or hurt. This is the single most useful view in the product for
a discretionary trader and costs nothing to compute — both numbers already exist.

---

### `GET /v1/markets`

Query: `status`, `underlying`, `limit`, `offset`.

```json
{
  "markets": [
    {
      "marketId": "BTC-USD-1756400000",
      "underlying": "BTC-USD",
      "windowStart": 1756400000000,
      "windowEnd": 1756400900000,
      "status": "SETTLED",
      "outcome": "UP",
      "tradeCount": 412,
      "uniqueWallets": 87,
      "marketEce": 0.0731
    }
  ]
}
```

`marketEce` is the aggregate calibration error of the market's own prices for that
underlying — the market efficiency panel (`PRD.md` R10).

---

### `GET /v1/arena`

The leaderboard filtered to registered agents, same response shape, plus each agent's
`method` string.

### `POST /v1/arena/register`

The only write endpoint on the read surface. Body:

```json
{ "wallet": "0x...", "name": "vol-lean-v2", "description": "...", "method": "..." }
```

Rate limited to 5 per hour per IP. Duplicate wallet returns 400. No authentication:
registration claims nothing except a display name, and the score itself is derived from
on-chain behaviour that cannot be faked by registering.

### `GET /v1/stats`

Pipeline health. Total wallets, ranked wallets, positions scored, markets settled,
ingestion mode, last ingested timestamp, `paramsHash`, and the rejected-payload count from
`ARCHITECTURE.md` §7.

Exposing the rejected count publicly is deliberate. It is the honest signal that ingestion
is or is not clean, and a reviewer checking it finds a real number rather than a claim.

---

## 3. WebSocket

`ws://host/v1/stream`. Subscribe by message:

```json
{ "op": "subscribe", "channels": ["scores", "settlements"] }
```

Server pushes:

```json
{ "channel": "scores", "data": { "wallet": "0x...", "score": 812, "previousScore": 798, "n": 147 } }
{ "channel": "settlements", "data": { "marketId": "...", "outcome": "UP", "positionsScored": 87 } }
```

Used by the web app to animate the leaderboard as markets settle. This is a P2 feature —
build it only after everything in P0 and P1 is done, because a static leaderboard that is
correct beats a live one that is wrong.

---

## 4. Guard API

Separate service, separate port. Two surfaces over one policy engine.

### `POST /guard/order`

Body is a `CanonicalOrder` plus `agentId`. Returns:

```json
{
  "verdict": "DENY",
  "reason": "ORDER_TOO_LARGE",
  "detail": "stake 75000000 exceeds maxNotionalPerOrder 50000000",
  "severity": "BLOCK",
  "auditSeq": 1043
}
```

`auditSeq` is returned even on denial, so the agent can cite the exact entry recording
the refusal.

### `GET /guard/risk/:agentId`

Remaining headroom under every limit, plus cooldown and kill-switch state. Mirrors the
`get_risk_status` MCP tool — one implementation, two transports.

### `GET /guard/audit/:agentId`

JSON Lines, one `AuditEntry` per line, ordered by `seq`. Streamed, not buffered.

### `GET /guard/audit/:agentId/verify`

```json
{ "valid": true, "entries": 1043, "headHash": "0x..." }
```

Runs `verifyChain` server-side. On failure returns `valid: false` with `brokenAt`,
`expected`, and `found`.

### `POST /guard/kill` and `POST /guard/policy`

Operator only, guarded by `GUARD_ADMIN_TOKEN` as a bearer token. **Never exposed as MCP
tools** — see `RISK_POLICY_SPEC.md` §1.

---

## 5. Contract testing

The API contract is defined by Zod schemas in `packages/core/src/api-types.ts`, shared by
server and web app. The server validates its own responses against them in test mode, so a
response shape that drifts from this document fails a test rather than reaching the
frontend.

Every example payload in this document is committed to `fixtures/api/` and asserted
against its schema. If this document and the code disagree, that test fails — which is
the mechanism that keeps the specification honest as the code moves.
