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

**None captured yet.** `scripts/record.ts` (day 4) writes them here. Until it has run
against the real venue, `LiveAdapter` is unwritten and live mode stays blocked — see
`docs/DREAMDEX_ADAPTER.md` §5 Step 3.
