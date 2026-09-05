# Chain receipts for the five LIVE write rows, re-fetched 5 Sep 2026

The README's `LIVE` write rows cite five Shannon transaction hashes. Until now those hashes
appeared nowhere in the repository, so the claims could only be checked by leaving it. These are
the receipts, fetched from the Shannon Blockscout API at
`https://shannon-explorer.somnia.network/api/v2/transactions/<hash>` and committed unmodified.

| File | Sent by | Status | Block | Timestamp (UTC) |
|---|---|---|---|---|
| `0x76a5cd91.json` | `pnpm place-one`, directly | `ok` | 477687098 | 2026-09-02 09:36:23 |
| `0x0dec9ecb.json` | forwarded through Guard | `ok` | 478460478 | 2026-09-03 07:05:38 |
| `0x3c8b17d0.json` | forwarded through Guard | `ok` | 478460846 | 2026-09-03 07:06:14 |
| `0x74c7ccad.json` | forwarded through Guard | `ok` | 478461200 | 2026-09-03 07:06:50 |
| `0xf6552b9c.json` | forwarded through Guard | `ok` | 478461285 | 2026-09-03 07:06:58 |

Every one has `"status": "ok"`. The block numbers are the ones the README prints, which is the
point: the two can be compared without trusting either.

## What these bytes establish

**The write path reached the chain under agent keys.** Two signers appear:
`0x5219fFbF…8735`, the wallet `mid-anchored` is scored under, and `0xCF43cf2C…25ea`, the wallet
`momentum-lean` is scored under. Both appear on the main leaderboard in
`../live-index-2026-09-05/leaderboard-ranked.json`, so the address that signed an order and the
address that carries a Kalibra Score are the same address.

**All five call the same method,** `0x718c2d4d`, and carry tUSDC token transfers.

## What they do not establish

**Three agents trade; only two signed these five.** `contrarian-fade` (`0x36b9f702…ae4f`) sent
none of them. Its orders are refused by Guard far more often and, when allowed, frequently die
at the venue rather than crossing — the README's "allowed is not filled" paragraph is about
exactly this. Its trading is evidenced by its 51 scored positions, not by a hash here.

**A receipt is not a fill.** These say the transactions succeeded, not what they matched
against. Fills are counted from the venue tape.

Re-fetch any of them with:

```bash
curl -s https://shannon-explorer.somnia.network/api/v2/transactions/<hash>
```
