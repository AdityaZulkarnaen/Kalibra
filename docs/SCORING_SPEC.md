# Scoring Specification

This is the normative definition of every number Kalibra produces. Implementation lives in
`packages/core` and must match this document exactly. Where code and this document
disagree, this document is correct and the code is a defect.

Every formula here has a worked numeric vector in §8. Implement the vectors as tests
before implementing the functions.

---

## 1. Constants

Defined once in `packages/core/src/constants.ts`. Do not inline these anywhere else.

| Name | Value | Meaning |
|---|---|---|
| `LAMBDA_MAX` | `0.5` | Maximum conviction lean |
| `SHRINK_K` | `25` | Empirical-Bayes shrinkage constant |
| `MIN_SAMPLE` | `30` | Resolved positions required to leave `PROVISIONAL` |
| `ECE_BINS` | `10` | Equal-width calibration bins over [0, 1] |
| `MIN_STAKE_BASE` | `1_000_000n` | Minimum stake for a position to be scored (1 USDso at 6 dp — **verify decimals**, see `DREAMDEX_ADAPTER.md` U7) |
| `W_BSS` | `1500` | Weight on shrunk Brier Skill Score |
| `W_ECE` | `100` | Weight on excess calibration error |
| `SCORE_ANCHOR` | `500` | Score representing market-equivalent performance |
| `SCORE_MIN` / `SCORE_MAX` | `0` / `1000` | Clamp bounds |
| `EPSILON` | `1e-12` | Zero-comparison tolerance for float guards |

---

## 2. The market's probability

An Event Contract is a binary claim over a fixed window. Its price is the market's
probability estimate for that claim.

Let `p` denote **the market-implied probability that the outcome is UP**, taken at the
moment of execution.

```
p = mid price of the UP contract at execution time, expressed in [0, 1]
```

Two rules govern `p`:

**Normalisation.** If the venue quotes the DOWN contract instead, convert:
`p = 1 − p_down`. All downstream math is expressed in terms of P(UP) only. There is no
branch anywhere in the codebase that reasons about DOWN prices directly.

**Source.** `p` is the **mid** of the book at execution, not the trader's fill price.
Using the fill price would conflate forecasting skill with execution quality — a trader
who crosses a wide spread would be scored as making a more extreme forecast than they
actually made. If mid is unavailable, fall back to last-trade price and set
`quote_source = 'LAST'` on the position so the degradation is visible in the data.

**Clamping.** `p` is clamped to `[0.01, 0.99]` before use. A quoted probability of exactly
0 or 1 makes the log-scoring diagnostic infinite and gives the conviction model degenerate
behaviour. Record the pre-clamp value in `positions.raw_p` for audit.

---

## 3. From a position to a forecast

### 3.1 The model, stated plainly

A trade is not a point forecast. Buying UP at 0.60 asserts only that the true probability
exceeds 0.60. To score with a proper scoring rule we need a point estimate, so Kalibra
applies an explicit model:

> **A trader agrees with the market and leans further in the direction of their position,
> by an amount proportional to their conviction.**

This is a modelling choice, not a discovered truth. It is stated in the UI and in
`PRD.md` §9. It is the right choice because it is monotone in the two things we actually
observe — direction and size — and because it degrades gracefully: at zero conviction the
forecast equals the market price, which scores exactly zero skill. That is the correct
null behaviour.

### 3.2 Conviction λ

```
S_ref(w, t) = p90 of stake over wallet w's most recent 100 positions,
              inclusive of the position being scored,
              ordered by settled_at ASC then position_id ASC

λ = LAMBDA_MAX × min(1, stake / S_ref)
```

`p90` uses the **nearest-rank** method on the sorted ascending array:
`index = ceil(0.90 × N) − 1`, zero-based, clamped to `[0, N−1]`. Do not interpolate;
nearest-rank is deterministic across languages and interpolation is not.

Because the position being scored is always included, `S_ref ≥ stake` never holds
universally — a wallet's first position yields `S_ref = stake` and therefore
`λ = LAMBDA_MAX`. This is deterministic and documented. It is a known simplification: a
wallet's first scored position always receives maximum conviction. Shrinkage (§5.2) makes
this harmless at the score level.

If `stake = 0`, then `λ = 0`. If `S_ref = 0`, then `λ = 0` — never divide by zero.

### 3.3 The forecast

```
UP   position:  f = p + λ(1 − p)
DOWN position:  f = p(1 − λ)
```

Both branches are the same operation seen from either end: move `p` toward the certainty
implied by the position, by fraction `λ` of the remaining distance.

Properties that must hold, and must be asserted as property tests:

- `λ = 0`  ⟹ `f = p` for both sides
- `λ = 1`  ⟹ `f = 1` for UP and `f = 0` for DOWN
- `f ∈ (0, 1)` always, given `p ∈ [0.01, 0.99]` and `λ ∈ [0, 0.5]`
- `f > p` for UP, `f < p` for DOWN, whenever `λ > 0`

### 3.4 The outcome

```
y = 1 if the contract settled UP
y = 0 if the contract settled DOWN
```

`y` is always expressed relative to UP, matching `p` and `f`. A DOWN position that wins
has `y = 0`, and its forecast `f` is low, so the squared error is small. The math handles
sides symmetrically with no special-casing. **Do not introduce a "was the trader right"
boolean anywhere in the scoring path** — it is not needed and it invites sign errors.

---

## 4. From trades to positions

### 4.1 Aggregation

Group all trades by `(wallet, market_id, side)`. For each group:

```
stake      = Σ stake_i                                    (bigint, base units)
p          = Σ (p_i × stake_i) / Σ stake_i                (stake-weighted mean)
entered_at = min(timestamp_i)
```

The stake weighting means a trader who adds to a position at a worse price has their
forecast pulled toward that price, which is correct: they revealed a willingness to
transact there.

### 4.2 Why aggregate at all

One position per market per side prevents sample-count farming. Without it, a trader could
split one conviction across forty small orders and multiply their `n`, which both inflates
the shrinkage factor and dilutes any single error. Aggregation makes `n` mean "number of
independent forecasts", which is what the statistics assume.

### 4.3 Netting opposing sides

If a wallet holds both UP and DOWN on the same market:

```
if stake_up > stake_down:
    net side = UP,   net stake = stake_up − stake_down,   p = p_up
elif stake_down > stake_up:
    net side = DOWN, net stake = stake_down − stake_up,   p = p_down_normalised
else:
    excluded entirely — the wallet expressed no directional view
```

The surviving side keeps its own weighted `p`. Do not blend the two.

This is what makes wash trading unprofitable at the score level: a wash nets to zero and
is excluded, so it cannot manufacture sample count. A partial wash reduces net stake,
which reduces λ, which pulls the forecast toward the market price and the score toward
500. **Gaming the metric converges to the metric's null value.** Note this in the README;
it is a genuinely elegant property and reviewers notice it.

### 4.4 Exclusions

A position is not scored if any of:

- `net stake < MIN_STAKE_BASE`
- the market has not settled (`outcome IS NULL`)
- the market settled as void or was cancelled
- `p` could not be determined from either mid or last trade

Excluded positions are persisted with `excluded_reason` set, never deleted. The count of
exclusions per wallet is exposed in the API so the number is auditable.

---

## 5. Statistics

### 5.1 Brier score

For a set of `n` scored positions with forecasts `f_i` and outcomes `y_i`:

```
BS_trader = (1/n) Σ (f_i − y_i)²
BS_market = (1/n) Σ (p_i − y_i)²
```

`BS_market` is the market's own Brier score **over exactly the same set of positions**.
It is the reference forecast, playing the role climatology plays in meteorological
verification. Computing it over a different set — all markets, say — would make the
comparison meaningless.

Lower is better. Range `[0, 1]`.

### 5.2 Brier Skill Score and shrinkage

```
BSS = 1 − BS_trader / BS_market
```

`BSS > 0` means the trader's deviations from market price carried information.
`BSS = 0` means market-equivalent. `BSS < 0` means the deviations were noise.
Range: `(−∞, 1]`.

Shrinkage toward the null:

```
BSS_shrunk = BSS × n / (n + SHRINK_K)
```

With `SHRINK_K = 25`, a wallet with 5 positions keeps 17% of its measured skill, one with
25 keeps 50%, one with 100 keeps 80%. This is standard empirical-Bayes regression toward
the prior mean of zero, and it is what stops three lucky trades from topping the board.

### 5.3 Degenerate cases

These must be handled explicitly. `NaN` or `Infinity` must never reach the database.

| Condition | `BSS` |
|---|---|
| `n = 0` | `null`; wallet status is `PROVISIONAL`, score is `null` |
| `BS_market < EPSILON` and `BS_trader < EPSILON` | `0` — both perfect, no skill demonstrated over the market |
| `BS_market < EPSILON` and `BS_trader ≥ EPSILON` | `−1` — the market was perfect and the trader was not |
| otherwise | `1 − BS_trader / BS_market` |

`BSS` is clamped to `[−5, 1]` before shrinkage, to bound the effect of a single
pathological market on the score.

### 5.4 Expected Calibration Error

Assign each forecast to one of `ECE_BINS` equal-width bins over `[0, 1]`:

```
bin(f) = min(floor(f × ECE_BINS), ECE_BINS − 1)
```

Bins are left-closed, right-open, except the last which is closed. `f = 0.80` with 10 bins
falls in bin 8, not bin 7. This convention must be tested; off-by-one here silently
corrupts every calibration curve.

For each non-empty bin `b` with `n_b` members:

```
mean_forecast(b)  = (1/n_b) Σ f_i
observed_freq(b)  = (1/n_b) Σ y_i
```

```
ECE = Σ_b (n_b / n) × |mean_forecast(b) − observed_freq(b)|
```

Empty bins contribute nothing and are omitted from the sum. They are still returned by the
API with `count: 0` so the chart can render gaps honestly rather than interpolating
across them.

### 5.5 Excess calibration error

```
ECE_market = ECE computed over (p_i, y_i) — the market's own forecasts, same positions
ECE_excess = max(0, ECE_trader − ECE_market)
```

The penalty is on being **less calibrated than the market**, not on absolute
miscalibration.

This matters. The conviction model in §3 deliberately pushes forecasts away from `p`, so a
skilled trader will show non-trivial absolute ECE purely as an artefact of λ. Penalising
absolute ECE would punish traders for our modelling choice. Penalising excess ECE
penalises only genuine overconfidence relative to the available benchmark.

The `max(0, ·)` means being better calibrated than the market earns no bonus here — that
information is already captured in BSS, and double-counting it would let one property
dominate the score.

### 5.6 Discrimination

ROC-AUC over `(f_i, y_i)`, computed by exhaustive pair counting:

```
AUC = [ Σ_{i ∈ pos} Σ_{j ∈ neg} ( 1 if f_i > f_j ; 0.5 if f_i = f_j ; 0 otherwise ) ]
      / (|pos| × |neg|)
```

If either class is empty, `AUC = null`.

Pair counting is O(n²) and that is fine at this scale. It is chosen over a sort-based
rank method because ties are handled correctly and obviously, and the implementation reads
identically to the definition.

AUC is **reported but not scored**. It answers "can this trader separate winners from
losers at all", which is a useful diagnostic on the profile page, but it is scale-free and
would double-count what BSS already measures.

---

## 6. The Kalibra Score

```
raw   = SCORE_ANCHOR + W_BSS × BSS_shrunk − W_ECE × ECE_excess
score = clamp(round(raw), SCORE_MIN, SCORE_MAX)
```

Rounding is **half away from zero**. JavaScript's `Math.round` rounds half toward positive
infinity, which differs for negative values. Since `raw` can be negative before clamping,
implement rounding explicitly:

```ts
const roundHalfAwayFromZero = (x: number) =>
  Math.sign(x) * Math.round(Math.abs(x));
```

### 6.1 Status

```
status = n >= MIN_SAMPLE ? 'RANKED' : 'PROVISIONAL'
```

`PROVISIONAL` wallets return `score: null` from the API and are excluded from the
leaderboard ranking. The score **is still computed and stored** so that history is
continuous when a wallet crosses the threshold — but it is not published, because
publishing a number computed from 4 samples invites exactly the misreading the whole
project exists to correct.

### 6.2 Interpretation, as shown in the UI

| Range | Label |
|---|---|
| 800–1000 | Strong edge over the market |
| 600–799 | Measurable edge |
| 450–599 | Approximately market-equivalent |
| 250–449 | Deviations from market were noise |
| 0–249 | Systematically worse than the market |

500 is the anchor: exactly market-equivalent, no excess miscalibration.

---

## 7. Order of operations

Scoring is deterministic. It must produce byte-identical output for identical input.

1. Load positions where `outcome IS NOT NULL AND excluded_reason IS NULL`
2. **Sort by `settled_at` ASC, then `position_id` ASC.** Never rely on database or map
   ordering. λ depends on position history, so order changes results.
3. For each position in order: compute `S_ref` from the trailing window, then λ, then `f`
4. Compute `BS_trader`, `BS_market`, `BSS`, `BSS_shrunk`
5. Compute `ECE_trader`, `ECE_market`, `ECE_excess`
6. Compute `AUC`
7. Compose `score`, derive `status`
8. Upsert

Floating point sums are accumulated in the sorted order above. Do not parallelise a
reduction; the result would vary with scheduling.

---

## 8. Test vectors

**These are normative.** Implement them as tests first. Assert to 10 significant figures
using `toBeCloseTo(expected, 9)` for floats, and exact equality for integer scores.

### V1 — zero-lean tracker

λ = 0 for every position, so `f = p` and the trader is exactly the market.

| p | side | λ | y |
|---|---|---|---|
| 0.60 | UP | 0.0 | 1 |
| 0.40 | DOWN | 0.0 | 0 |
| 0.70 | UP | 0.0 | 0 |

```
BS_trader  = BS_market
BSS        = 0            exactly
BSS_shrunk = 0            exactly
ECE_excess = 0            exactly
raw        = 500
score      = 500
status     = 'PROVISIONAL'   (n = 3 < 30)
```

This is the most important test in the suite. If it does not produce exactly 500, the
anchoring is broken and every other number is meaningless.

### V2 — conviction

`LAMBDA_MAX = 0.5`.

| stake | S_ref | λ |
|---|---|---|
| 100 | 100 | 0.5 |
| 50 | 100 | 0.25 |
| 200 | 100 | 0.5 (clamped by `min(1, ·)`) |
| 1 | 100 | 0.005 |
| 0 | 100 | 0.0 |
| 100 | 0 | 0.0 (guard, no division) |

### V3 — four positions, full pipeline

| p | side | λ | y | f |
|---|---|---|---|---|
| 0.60 | UP | 0.5 | 1 | 0.80 |
| 0.50 | UP | 0.5 | 1 | 0.75 |
| 0.40 | DOWN | 0.5 | 0 | 0.20 |
| 0.55 | DOWN | 0.5 | 1 | 0.275 |

```
BS_trader   = 0.16703125
BS_market   = 0.193125
BSS         = 0.13511326860841422
shrink      = 4 / 29           = 0.13793103448275862
BSS_shrunk  = 0.018636312911505408
ECE_trader  = 0.24374999999999997
ECE_market  = 0.4375
ECE_excess  = 0.0
AUC         = 1.0
raw         = 527.9544693672581
score       = 528
status      = 'PROVISIONAL'
```

Calibration bins for the trader (bin index, count, mean forecast, observed frequency):

```
bin 2 : n=2, mean_f=0.2375, obs=0.5   →  contribution 0.13125
bin 7 : n=1, mean_f=0.75,   obs=1.0   →  contribution 0.0625
bin 8 : n=1, mean_f=0.80,   obs=1.0   →  contribution 0.05
```

Note that `f = 0.80` lands in bin 8. This vector exists partly to pin that boundary.

### V4 — sixty positions, ranked

Generated deterministically so it can be reproduced in any language without shipping a
sixty-row table.

**Generator.** Linear congruential, 32-bit, Numerical Recipes parameters:

```
state  = seed                      seed = 42
next() = state = (1664525 × state + 1013904223) mod 2³²
unit() = next() / 2³²              → [0, 1)
```

In TypeScript, use `Number` arithmetic with an explicit `>>> 0` after each step, or
`BigInt` masked to 32 bits. Verify the first three `unit()` values before trusting the
rest of the vector.

**Construction**, sixty iterations, drawing in exactly this order per iteration:

```
p     = round(0.30 + 0.40 × unit(), 4)
side  = unit() < 0.5 ? 'UP' : 'DOWN'
hit   = unit() < 0.58
y     = hit ? (side === 'UP' ? 1 : 0) : (side === 'UP' ? 0 : 1)
λ     = 0.5                                (fixed for this vector)
```

The first six rows, for checking the generator before running the whole vector:

```
1. p=0.4009  side=UP    y=1
2. p=0.3890  side=UP    y=1
3. p=0.4789  side=UP    y=0
4. p=0.6979  side=DOWN  y=0
5. p=0.5568  side=DOWN  y=1
6. p=0.3363  side=UP    y=0
```

**Expected results:**

```
n            = 60
BS_trader    = 0.269694941
BS_market    = 0.2850730973333333
BSS          = 0.05394460746098306
shrink       = 60 / 85         = 0.5454545454545454
BSS_shrunk   = 0.03807854644304687
ECE_trader   = 0.15024166666666666
ECE_market   = 0.1848066666666667
ECE_excess   = 0.0
AUC          = 0.5656108597285068
raw          = 557.1178196645703
score        = 557
status       = 'RANKED'
```

Note `ECE_excess = 0`: this trader is better calibrated than the market, so no penalty
applies. The score comes entirely from BSS.

### V5 — monotonicity property test

Using the V4 generator with `seed = 42`, `n = 60`, and varying only the `hit` threshold:

| edge | score |
|---|---|
| 0.40 | 63 |
| 0.50 | 351 |
| 0.55 | 393 |
| 0.58 | 557 |
| 0.65 | 767 |
| 0.75 | 859 |

Assert both the exact values and the property that the sequence is strictly increasing.
A trader who is right more often must never score lower.

That `edge = 0.50` yields 351 rather than 500 is correct and worth understanding: a
coin-flipper who bets with `λ = 0.5` conviction is making confident forecasts backed by no
information, which is genuinely worse than simply quoting the market price. The score says
so.

**Caveat on this generator.** Outcomes are drawn independently of `p`, whereas in a real
market price and outcome correlate. `BS_market` is therefore pessimistic here relative to
reality. This does not affect the vector's use as a regression test — it only means the
absolute score levels in V4 and V5 should not be read as calibrated against live data.

### V6 — degenerate inputs

| Input | Expected |
|---|---|
| `n = 0` | `BSS = null`, `score = null`, `status = 'PROVISIONAL'` |
| all `y = 1`, `f` varied | `AUC = null` (no negative class), everything else computes |
| `BS_market = 0`, `BS_trader = 0` | `BSS = 0` |
| `BS_market = 0`, `BS_trader > 0` | `BSS = −1` |
| `BSS = −40` before clamp | clamped to `−5`, then shrunk |
| `p = 0` supplied | clamped to `0.01`; `raw_p = 0` recorded |
| `p = 1` supplied | clamped to `0.99`; `raw_p = 1` recorded |

No case in this table may produce `NaN`, `Infinity`, or a thrown error.

---

## 9. What the score is not

Reproduce this in the UI next to every score. It costs one paragraph and it is the
difference between a credible metric and an overclaim.

Kalibra measures **informational edge**: whether a trader's deviations from the market's
own probability were, on average, in the right direction. It does not measure
profitability. A well-calibrated trader can lose money through poor sizing or bad fills,
and a badly calibrated one can profit through luck. The two properties are related but
distinct, and conflating them is the error Kalibra exists to correct — in the other
direction.

The forecast model in §3 is an assumption. Different `LAMBDA_MAX` produces different
scores. The parameter is published, and the API returns the parameter set used for every
score so any result can be reproduced or contested.
