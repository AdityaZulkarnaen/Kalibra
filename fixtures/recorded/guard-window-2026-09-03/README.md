# Guard decisions, 3 Sep 2026 07:00–13:39 UTC

Exported from the `audit_log` table of a local `kalibra.db` that `apps/guard` wrote while the
three demo agents traded against Shannon testnet. 1,178 decisions: 608 allowed, 570 refused.

| File | What it is |
|---|---|
| `decisions-by-agent.json` | Per-agent allowed / refused / allow rate, and the reason-code histogram |
| `audit-entries.json` | Every entry's sequence number, timestamp, agent and decision, in chain order |

The order payloads and hashes are not exported. What is being evidenced here is *which
decisions Guard made*, and an order body adds wallet-level trading detail without adding to
that claim. `packages/core/src/audit.ts` and its tests are where the chain construction is
verified.

## What these bytes establish

**Guard sorted the agents by quality without being shown a score.** The policy engine reads
losses, exposure, order size and the clock. It never reads `scores`. Over this window it
nevertheless ordered the three agents the same way the scoring pipeline does:

| agent | Kalibra Score | allowed | refused | allow rate |
|---|---|---|---|---|
| `momentum-lean` | 392 | 96 | 21 | **82%** |
| `mid-anchored` | 0 | 339 | 289 | 54% |
| `contrarian-fade` | 0 | 173 | 260 | **40%** |

The two mechanisms are independent: `packages/core/src/policy.ts` never reads a score and
`packages/core/src/score.ts` never reads a policy. Two measurements of the same behaviour
agreeing is the point.

**Ten of the eleven reason codes fired against real orders.** `IN_COOLDOWN`,
`ORDER_TOO_LARGE`, `UPSTREAM_UNAVAILABLE`, `OPEN_NOTIONAL_EXCEEDED`, `KILL_SWITCH_ACTIVE`,
`MARKET_NOT_OPEN`, `DAILY_LOSS_EXCEEDED`, `TOO_CLOSE_TO_CLOSE`, `MARKET_NOT_ALLOWED` and
`INVALID_ORDER`. The eleventh, `RATE_LIMIT_EXCEEDED`, does not appear: the agents pace
themselves below it, so the limit is never reached rather than never implemented.

`contrarian-fade` earns 63 `ORDER_TOO_LARGE` refusals because it sizes past the limit on
purpose. Those refusals are produced by an agent trading, not by a script staging them.

## What they do not establish

**This is not the twelve-hour window the README's Guard section describes.** That one is dated
4 September, ran 5,119 decisions, and was written by the deployed instance, whose database is
not in this repository. The numbers here are smaller and the allow rates less extreme. What
this window does show is the same ordering by the same mechanism on data that can be checked,
which is why it is the one that got committed.

**Allowed is not filled.** Guard's record says what it forwarded, not what the venue crossed.
Fills are counted from the chain, never from this table.
