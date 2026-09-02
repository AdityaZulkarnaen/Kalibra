# Side-attribution trace, 2 Sep 2026 — Gate 0.1 and Gate 0.2

Produced by `pnpm verify-attribution`, which reads the Shannon testnet indexer and the chain
anonymously. Regenerate it with that command; the two market ids are its defaults.

## What this answers

U3 was previously marked `VERIFIED` on the strength of a **field mapping**: the tape carries
four side values and three of them are unambiguous. That is not the same claim as *the side
stored in `trades` is the side that actually won money*, and the difference matters because
an inverted mapping is the one defect here that produces entirely plausible output — every
score flips, nothing throws, and no number looks wrong.

Checking the stored side against `Market.winningOutcome` would have been circular: that is
the field the adapter already trusts. So four sources that do not depend on each other are
read and reconciled, on **two markets that settled in opposite directions**, because a
symmetric inversion passes a one-direction check perfectly.

| File | What it is |
|---|---|
| `00ff46.json` | BTC 15-minute window that settled **UP**. Includes the mint-a-pair fill. |
| `010e48.json` | BTC 1-hour window that settled **DOWN**. |
| `ingested-market-types.json` | The ten markets a live ingest pulled in, with the fields that make them Event Contracts (G0.2). |

## The four layers

**A — the oracle's own numbers.** `getMarketResolution` returns the opening and closing
answers the contract settled on. The claim is "closes at or above its opening price, Up
wins", inclusive on the Up side, so the two numbers decide the direction without any label.

**B — the payout vector.** `payoutNumerators` names the *index* that pays and never names a
direction, so it is an independent check on `winningOutcome` rather than a restatement of it.

**C — the chain.** `getMarketOnchain` resolves the market through the module registry, so the
indexer does not get to supply its own alibi.

**D — an ERC-6909 balance.** The only layer that links "bought YES on the tape" to "holds the
token the payout vector pays". Read only for wallets that took one side in that market; a
wallet on both sides holds both tokens and proves nothing.

## The result

| | `0x…00ff46` | `0x…010e48` |
|---|---|---|
| A oracle, open → close | 7787732 → 7795872 = **UP** | 7763542 → 7758409 = **DOWN** |
| B payout vector | `[10000000, 0]` pays index **0** | `[0, 10000000]` pays index **1** |
| C chain `winningOutcome` | **0** | **1** |
| Adapter stored | **UP** | **DOWN** |

Layer D, on both markets, and the reason the loop closes:

| Wallet | Tape | Stored | Holds |
|---|---|---|---|
| `0x93e300…` in `00ff46` | `BUY_NO` | DOWN | `no = 6000000`, `yes = 0` |
| `0x93e300…` in `010e48` | `BUY_YES` | UP | `yes = 2000000`, `no = 0` |
| `0x540013…` in `010e48` | `BUY_YES` | UP | `yes = 1000000`, `no = 0` |

`0x93e300…` is the useful control: the same wallet appears in both markets on opposite sides,
and holds the matching outcome token each time. A `BUY_NO` buyer holds the NO id; a `BUY_YES`
buyer holds the YES id; the payout vector pays index 0 exactly when the oracle says Up won.

Wallets showing `yes = 0, no = 0` have redeemed or closed. That is reported as **unobserved**
rather than counted as a pass — the script prints an `UNOBSERVED` line if no wallet in a
market yields a reading, and refuses to report success on one direction alone.

## U21, closed by the same trace

`00ff46` contains the mint-a-pair fill `476784429_114`, where two buyers cross with no seller
and the pool mints a fresh pair. It is the one crossing path where attribution could have
been ambiguous. It is not:

- `takerSide: BUY_YES` → UP, stake 3,720,000; `makerSide: BUY_NO` → DOWN, stake 2,280,000.
- The two stakes sum to 6,000,000, the contract quantity — each buyer posts their own share
  of the collateral that funds the minted pair.
- The `BUY_NO` buyer, `0x93e300…`, holds **6,000,000** NO tokens: the whole minted side.

Each leg carries its own side whatever the crossing path, so no special case is needed.
