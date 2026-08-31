# Risk Policy Specification — Kalibra Guard

Guard sits between an agent and DreamDEX. The agent cannot reach DreamDEX except through
it. Guard evaluates every order against a policy, records the decision in a tamper-evident
log, and only then forwards or refuses.

The problem it solves: an LLM agent given a private key and an exchange API can lose
everything to a single bad reasoning step, and there is no way to prove afterwards what it
was and was not allowed to do. Guard makes the risk envelope explicit, enforced outside the
model, and auditable after the fact.

---

## 1. Design principles

**Deny by default.** An order passes only if it satisfies every rule. An unknown market, a
malformed field, an unparseable policy — all deny.

**The agent cannot modify the policy.** Policy is loaded from configuration at startup and
from the operator's HTTP surface. No MCP tool exposes policy mutation. This is the entire
point: a compromised or confused agent must not be able to widen its own limits. There is
no MCP tool named `set_policy`, `update_limits`, or anything similar, and none may be
added.

**Log before acting.** The audit entry is written before the order is forwarded. A crash
between logging and forwarding leaves a log entry with no order — detectable, and safe.
The reverse would be an order with no record, which is undetectable, and is therefore not
permitted to be possible.

**Evaluation is pure.** `evaluate(policy, state, order)` lives in `packages/core/policy.ts`
and performs no I/O. It receives the current state as an argument. Both transports — HTTP
and MCP — call the same function, so enforcement cannot drift between them.

---

## 2. Policy

```ts
export interface GuardPolicy {
  policyId: string;
  /** Bumped on every change. Recorded in each audit entry. */
  version: number;

  /** Largest single order, base units. */
  maxNotionalPerOrder: bigint;
  /** Largest total stake across all unsettled positions, base units. */
  maxOpenNotional: bigint;
  /** Largest cumulative loss in a UTC day, base units. Realised plus unrealised. */
  maxDailyLoss: bigint;

  /** Rate limit. */
  maxOrdersPerWindow: number;
  rateWindowMs: number;

  /** Cooldown after consecutive losing settled positions. */
  lossStreakThreshold: number;
  cooldownMs: number;

  /** Empty array means no market is permitted. Deny by default. */
  allowedMarkets: string[];

  /** Refuse orders inside this many ms of window close. */
  minTimeToCloseMs: number;

  /** Operator kill switch. */
  killSwitch: boolean;
  /** Trip the kill switch automatically when maxDailyLoss is breached. */
  autoKillOnDailyLoss: boolean;
}
```

Defaults for the demo, in `guard.policy.json`:

```json
{
  "policyId": "demo-conservative",
  "version": 1,
  "maxNotionalPerOrder": "50000000",
  "maxOpenNotional": "200000000",
  "maxDailyLoss": "100000000",
  "maxOrdersPerWindow": 10,
  "rateWindowMs": 60000,
  "lossStreakThreshold": 3,
  "cooldownMs": 300000,
  "allowedMarkets": [],
  "minTimeToCloseMs": 5000,
  "killSwitch": false,
  "autoKillOnDailyLoss": true
}
```

Bigints are JSON strings. Parsing them as numbers loses precision above 2⁵³ and must not
happen; the Zod schema uses `z.string().transform(BigInt)`.

`allowedMarkets` is empty by default. The operator must explicitly permit markets. An
agent starting with access to nothing and being granted specific markets is the correct
default; the reverse is not.

---

## 3. State

```ts
export interface GuardState {
  /** ms since epoch, UTC. Passed in — never read from a clock inside evaluate(). */
  now: number;
  openNotional: bigint;
  dailyRealisedPnl: bigint;    // negative is a loss
  dailyUnrealisedPnl: bigint;
  ordersInWindow: number;
  consecutiveLosses: number;
  cooldownUntil: number | null;
  killSwitchTrippedAt: number | null;
}
```

`now` is an argument because `evaluate` is pure (invariant I1). This is also what makes
time-dependent rules — rate limiting, cooldown, window proximity — testable without fake
timers.

---

## 4. Rules and reason codes

Evaluated **in this order**. The first failure short-circuits and is the sole reason
returned. Order matters and is part of the contract: a killed agent must see
`KILL_SWITCH_ACTIVE`, not `MARKET_NOT_ALLOWED`, because the first is actionable and the
second is misleading.

| # | Reason code | Condition | Severity |
|---|---|---|---|
| 1 | `KILL_SWITCH_ACTIVE` | `policy.killSwitch === true` | FATAL |
| 2 | `IN_COOLDOWN` | `state.cooldownUntil !== null && now < cooldownUntil` | BLOCK |
| 3 | `MARKET_NOT_ALLOWED` | `!policy.allowedMarkets.includes(order.marketId)` | BLOCK |
| 4 | `MARKET_NOT_OPEN` | market status is not `OPEN` | BLOCK |
| 5 | `TOO_CLOSE_TO_CLOSE` | `market.windowEnd − now < policy.minTimeToCloseMs` | BLOCK |
| 6 | `RATE_LIMIT_EXCEEDED` | `state.ordersInWindow >= policy.maxOrdersPerWindow` | BLOCK |
| 7 | `ORDER_TOO_LARGE` | `order.stake > policy.maxNotionalPerOrder` | BLOCK |
| 8 | `OPEN_NOTIONAL_EXCEEDED` | `state.openNotional + order.stake > policy.maxOpenNotional` | BLOCK |
| 9 | `DAILY_LOSS_EXCEEDED` | `−(realised + unrealised) >= policy.maxDailyLoss` | FATAL if `autoKillOnDailyLoss` |
| 10 | `INVALID_ORDER` | stake ≤ 0, `limitProb` outside [0,1], missing `clientOrderId`, duplicate `clientOrderId` | BLOCK |
| 11 | `UPSTREAM_UNAVAILABLE` | adapter unreachable at forward time | BLOCK |
| — | `ALLOWED` | every rule passed | — |

`FATAL` trips the kill switch. `BLOCK` refuses this order only.

Rule 9 uses `>=` deliberately: reaching the limit exactly stops trading. A limit that must
be exceeded before it binds is not a limit.

**Every reason code has its own test** (`PRD.md` A5). Eleven codes, eleven tests, each
constructing the minimal state that triggers exactly that code and asserting no other code
fires.

---

## 5. Decision

```ts
export type GuardDecision =
  | { verdict: 'ALLOW' }
  | { verdict: 'DENY'; reason: ReasonCode; detail: string; severity: 'BLOCK' | 'FATAL' };
```

There is no `MODIFY`. Silently resizing an agent's order would mean the agent's stated
intent and its executed action differ, which corrupts both the audit trail and the
attribution of any resulting score. Guard refuses or forwards, never negotiates.

`detail` is a human-readable string carrying the actual numbers — `"stake 75000000 exceeds
maxNotionalPerOrder 50000000"`. It is for humans and logs. **Never parse `detail` for
control flow;** branch on `reason`.

---

## 6. Audit log

Append-only, hash-chained. This is the artefact that makes an agent's record trustworthy,
and it is a large part of why Guard is worth building.

```ts
export interface AuditEntry {
  seq: number;                 // 1-based, contiguous, no gaps
  timestamp: number;           // ms UTC
  agentId: string;
  policyId: string;
  policyVersion: number;
  order: CanonicalOrder;       // as received, before any processing
  decision: GuardDecision;
  stateSnapshot: GuardState;   // the exact state evaluate() saw
  prevHash: string;            // 0x-prefixed, 64 hex chars
  hash: string;                // 0x-prefixed, 64 hex chars
}
```

### 6.1 Hash construction

```
hash = keccak256(utf8(canonicalJson({
  seq, timestamp, agentId, policyId, policyVersion,
  order, decision, stateSnapshot, prevHash
})))
```

`canonicalJson` must be deterministic:

- object keys sorted lexicographically at every depth
- no whitespace
- `bigint` serialised as a decimal string
- `undefined` fields omitted; `null` fields retained
- numbers serialised with JavaScript's default `toString`

The genesis entry has `prevHash = '0x' + '00'.repeat(32)`.

Non-deterministic serialisation is the classic failure here. Two runs producing different
JSON for identical data means the chain cannot be verified, and the bug appears only when
someone actually checks. Test `canonicalJson` directly with key-order-shuffled inputs.

### 6.2 Verification

```ts
export function verifyChain(entries: AuditEntry[]): 
  | { valid: true }
  | { valid: false; brokenAt: number; expected: string; found: string };
```

Checks, in order:

1. `seq` starts at 1 and increments by exactly 1 with no gaps
2. `entries[0].prevHash` is the genesis value
3. for every `i > 0`, `entries[i].prevHash === entries[i-1].hash`
4. for every entry, recomputing the hash reproduces the stored `hash`

Check 4 is what catches content mutation. Checks 1–3 catch insertion, deletion, and
reordering. All four are needed; any three leave a hole.

`PRD.md` A6 requires both directions tested: an untouched log verifies, and a log with any
single mutated byte fails at the correct index.

### 6.3 Storage

SQLite table `audit_log`, ordered by `seq`. Exported as JSON Lines by
`GET /guard/audit/:agentId`, one entry per line, so a reviewer can pipe it to a verifier
without loading it all into memory.

---

## 7. MCP surface

Guard is exposed as an MCP server so any MCP-capable agent can trade Event Contracts
inside guaranteed bounds. This matches DreamDEX's own agent conventions.

**Tools:**

| Tool | Purpose |
|---|---|
| `list_markets` | Open Event Contract markets the agent is permitted to trade |
| `get_quote` | Current implied probability for a market |
| `place_order` | Submit an order. Returns the decision, including the reason code if denied. |
| `get_positions` | The agent's open positions |
| `get_risk_status` | Remaining budget under every limit, and cooldown state |
| `get_my_score` | The agent's current Kalibra Score and calibration curve |

`get_risk_status` exists because an agent that cannot see its limits will waste turns
hitting them. Exposing remaining headroom turns the policy from an obstacle into
information the agent can plan against, and it makes the demo far more legible — the agent
visibly reasons about its budget.

**There is no policy-mutation tool.** See §1.

**Resources:** `kalibra://policy/current` (read-only) and `kalibra://audit/recent`.

Ship a `SKILL.md` at the repository root describing how an agent should use these tools,
following DreamDEX's stated convention. It costs twenty minutes and it is a direct signal
to judges that the ecosystem's conventions were read and followed.

---

## 8. Guard and Arena

Orders placed through Guard are attributed to a registered `agentId`, so Arena scoring
works even if the public trade feed lacks wallet attribution. This is why Plan C in
`DREAMDEX_ADAPTER.md` §8 is always available: Guard generates its own ground truth.

Every Guard-forwarded order that results in a fill is written to `trades` with the agent's
wallet, joining the same pipeline as ingested trades. There is no separate scoring path for
agents. One scoring implementation, two sources of trades — which is also the honest
answer when a judge asks whether agents are scored the same way as humans.
