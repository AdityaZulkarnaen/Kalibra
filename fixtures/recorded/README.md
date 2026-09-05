# fixtures/recorded

Two different kinds of thing live here, and they are not interchangeable.

## `docs-snapshot-2026-09-01/`

Raw documentation pages, fetched verbatim with `curl` on 1 Sep 2026 from the public
documentation site. No credential was used and no page was modified — the bytes are as
served, GitBook footer boilerplate included.

They exist so that every claim in `docs/DREAMDEX_ADAPTER.md` §7.1 can be checked against
its source, and so that a later change to the published documentation is visible as a
diff rather than as a silent contradiction.

**Documentation is not verification.** A page describing a field is evidence about the
venue's intent; it is not evidence about what the venue actually returns. Nothing in this
directory may be used to mark a row Verified in the §6 mapping table.

## API payloads

Captured, and `LiveAdapter` is written against them.

### `dreamdex-testnet-2026-09-01/`

Real indexer payloads, fetched anonymously from `https://dev.smk.somnia.host/v1/graphql` on
1 Sep 2026 — one settled binary market, its three fills, the orders needed to reconstruct the
book at each fill, and six recent markets. Every row marked Verified in the §6 mapping table
rests on these bytes, and `packages/adapter-dreamdex/src/live.test.ts` parses them in CI.

### `attribution-2026-09-02/`

The output of `pnpm verify-attribution`: a four-source reconciliation of stored side against
oracle, payout vector, chain `winningOutcome` and an on-chain ERC-6909 balance, across two
markets that settled in opposite directions. Also `ingested-market-types.json`, the ten
markets a live ingest pulled in with the three fields that make each one an Event Contract.

**These directories were captured by hand with `curl` and by `pnpm verify-attribution`, not by
`scripts/record.ts`.** That script writes to `fixtures/recorded/dreamdex-live-<stamp>/` with a
`.graphql` sidecar per capture; no such directory exists here. The distinction matters if you
are trying to reproduce a file: match the method to the directory.
