# The live index, read 5 Sep 2026 13:35 UTC

Three responses from the deployed read API, captured with `curl` and unmodified. They are the
committed evidence behind the `LIVE` grades on the `apps/indexer` and `apps/web` rows of the
README's real-vs-mocked table.

| File | What it is |
|---|---|
| `stats.json` | `GET /v1/stats` — the counters the landing page renders |
| `leaderboard-ranked.json` | `GET /v1/leaderboard?status=ranked&limit=100` — all 30 ranked wallets |
| `arena.json` | `GET /v1/arena` — the three registered agents |

## What these bytes establish

**The deployment runs live, not on fixtures.** `stats.json` carries `"mode":"live"`, with 8,107
markets settled, 3,630 positions scored and 1,491 wallets seen. Three reads a few minutes apart
returned 8,081, 8,085 and 8,107 markets, so it was still ingesting while this was written. A
replay-mode instance reports the fixture set's 60 markets and never moves.

**Ten of the thirty ranked wallets are real Somnia addresses.** The other twenty have addresses
beginning `0x0000…` and are the committed synthetic fixture set. The two populations share one
ranking and the UI does not distinguish them — the shortcoming is recorded in the README rather
than hidden, and this file is how you check the split yourself:

```
jq '[.entries[] | select(.wallet | startswith("0x0000000000000000") | not)]' leaderboard-ranked.json
```

**Seven of those ten are third parties.** Three are this project's own demo agents, and their
wallets are the same ones the `LIVE` write rows' transaction hashes were sent from — the Arena is
ranked on the scores those wallets earn on the main board, not on a separate number. `arena.json`
and `leaderboard-ranked.json` can be reconciled field by field to confirm it.

**`paramsHash` is `0x105f87e6…`,** the same value `pnpm demo` prints offline. The scoring
parameters that produced these live scores are the ones committed in `docs/SCORING_SPEC.md`.

## What they do not establish

These are our own API's responses, not the venue's. They show what Kalibra computed, not that the
underlying fills were read correctly — that claim rests on `dreamdex-testnet-2026-09-01/` for the
payload shapes and `attribution-2026-09-02/` for side attribution traced to the money.

The counts are a snapshot of a system still collecting. Re-read the endpoint rather than trusting
this directory's age.
