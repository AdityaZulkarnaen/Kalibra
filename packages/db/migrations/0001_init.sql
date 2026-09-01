-- Kalibra schema, extracted verbatim from docs/API_SPEC.md section 1.
-- Do not hand-edit. If the schema changes, change API_SPEC.md and re-extract, so the
-- specification and the database cannot drift apart.

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
