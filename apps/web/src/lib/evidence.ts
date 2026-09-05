/**
 * The README's real-vs-mocked table, as data.
 *
 * `CLAUDE.md` §6 makes that table the project's honesty contract and requires it to stay
 * accurate. Putting a second copy on the landing page is therefore the riskiest thing on the
 * page: a copy drifts, the interesting edit always lands in the other file, and a stale
 * evidence grade is exactly the discovered overclaiming §6 calls fatal.
 *
 * So this copy is not trusted, it is checked. `evidence.test.ts` parses `README.md` and
 * asserts that these rows are that table — same components, same order, same statuses — and
 * fails the build if either file moves without the other. It is the same argument that puts
 * `PRD.md` §9 through `docs-consistency.test.ts`.
 *
 * Only the two columns that can be checked exactly are held here. The evidence column is prose
 * with links and figures that move as the agents collect, so the page links to it rather than
 * reproducing it.
 */

/** The four grades `CLAUDE.md` §6 defines. No fifth word is a status. */
export type EvidenceStatus = 'LIVE' | 'REPLAY' | 'SYNTHETIC' | 'STUB';

export interface EvidenceRow {
  /** The component name exactly as the README writes it, backticks included. */
  readonly component: string;
  readonly status: EvidenceStatus;
}

/** In README order, which runs roughly from the scoring core outward to the demo. */
export const EVIDENCE_ROWS: readonly EvidenceRow[] = [
  { component: 'Kalibra Score math (`packages/core`)', status: 'SYNTHETIC' },
  { component: 'Aggregation (`packages/core/src/aggregate.ts`)', status: 'SYNTHETIC' },
  {
    component: 'Canonical types and Zod schemas (`packages/adapter-dreamdex`)',
    status: 'SYNTHETIC',
  },
  { component: '`ReplayAdapter`', status: 'SYNTHETIC' },
  { component: '`LiveAdapter` reads', status: 'LIVE' },
  { component: '`LiveAdapter` writes (`placeOrder`)', status: 'LIVE' },
  { component: 'Persistence (`packages/db`)', status: 'SYNTHETIC' },
  { component: 'Ingestion and scoring pipeline (`apps/indexer`)', status: 'LIVE' },
  { component: 'Public read API (`apps/api`)', status: 'SYNTHETIC' },
  { component: 'Web app (`apps/web`)', status: 'LIVE' },
  { component: 'Guard policy engine (`packages/core/src/policy.ts`)', status: 'SYNTHETIC' },
  { component: 'Guard audit chain (`packages/core/src/audit.ts`)', status: 'SYNTHETIC' },
  { component: 'Guard transport (`apps/guard`)', status: 'LIVE' },
  { component: 'Guard enforcement in the live loop', status: 'LIVE' },
  { component: 'Kalibra Arena (`/v1/arena`)', status: 'LIVE' },
  { component: 'MCP server (`apps/mcp`)', status: 'SYNTHETIC' },
  { component: '`pnpm demo`', status: 'SYNTHETIC' },
];

/** How many rows carry each grade. Counted, so the summary line cannot contradict the table. */
export function countByStatus(rows: readonly EvidenceRow[]): Map<EvidenceStatus, number> {
  const counts = new Map<EvidenceStatus, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return counts;
}

/**
 * Split a component name into plain and code runs on its backticks.
 *
 * The names are module paths as often as they are prose, and rendering ``` `apps/web` ``` as
 * literal backticks would be the one place on the site where markdown leaked through. Odd
 * segments are the code ones, which is what an even number of delimiters guarantees.
 */
export function splitCode(name: string): ReadonlyArray<{ code: boolean; text: string }> {
  return name
    .split('`')
    .map((text, index) => ({ code: index % 2 === 1, text }))
    .filter((segment) => segment.text !== '');
}
