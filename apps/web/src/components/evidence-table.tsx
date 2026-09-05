import {
  countByStatus,
  EVIDENCE_ROWS,
  splitCode,
  type EvidenceRow,
  type EvidenceStatus,
} from '@/lib/evidence';
import { docLink, REPO_URL } from '@/lib/links';

/**
 * The README's real-vs-mocked table, on the page rather than one link away.
 *
 * `CLAUDE.md` §6 treats discovered overclaiming as fatal and acknowledged limitation as free,
 * which makes this the section with the least to lose by being the most prominent. Most of the
 * rows say the integration is unverified; putting that where a reader meets it without going
 * looking is the point, and hiding it behind a link would be the version of this page that has
 * something to hide. The counts above the table are counted from the rows for the same reason
 * a figure is not written into this comment: a total nobody recomputes is a total that drifts.
 *
 * The rows come from `lib/evidence.ts`, which a test holds against `README.md` itself.
 */

const STATUS_MEANING: Record<EvidenceStatus, string> = {
  LIVE: 'A real DreamDEX or Somnia interaction, with a transaction hash or a captured response.',
  REPLAY: 'Recorded real data.',
  SYNTHETIC: 'Generated data, with the real integration unverified.',
  STUB: 'The interface exists and the implementation does not.',
};

/** The order the grades are defined in, strongest evidence first. */
const STATUS_ORDER: readonly EvidenceStatus[] = ['LIVE', 'REPLAY', 'SYNTHETIC', 'STUB'];

export function EvidenceTable() {
  const counts = countByStatus(EVIDENCE_ROWS);
  const present = STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0);
  const absent = STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) === 0);

  return (
    <div>
      <dl className="flex flex-wrap gap-x-10 gap-y-5">
        {present.map((status) => (
          <div key={status} className="max-w-72">
            <dt className="flex items-baseline gap-2.5">
              <span className="text-2xl leading-none tabular-nums">{counts.get(status)}</span>
              <StatusLabel status={status} />
            </dt>
            <dd className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {STATUS_MEANING[status]}
            </dd>
          </div>
        ))}
      </dl>

      {/*
       * The component column is module paths as often as it is prose, and the longest of them
       * is wider than a phone once the grade beside it has taken its share. Breaking inside a
       * path is the lesser evil: a table that scrolls sideways hides the column that matters.
       */}
      <table className="mt-10 w-full border-collapse text-left">
        <caption className="sr-only">
          Every component of Kalibra and the grade of evidence behind it
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="pb-2.5 text-xs font-normal text-muted-foreground">
              Component
            </th>
            <th scope="col" className="pb-2.5 text-right text-xs font-normal text-muted-foreground">
              Evidence
            </th>
          </tr>
        </thead>
        <tbody>
          {EVIDENCE_ROWS.map((row) => (
            <Row key={row.component} row={row} />
          ))}
        </tbody>
      </table>

      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        {absent.length > 0 && (
          <>
            No row is graded{' '}
            {absent.map((status, index) => (
              <span key={status}>
                {index > 0 && ' or '}
                <code className="text-xs">{status}</code>
              </span>
            ))}
            .{' '}
          </>
        )}
        The evidence behind each row &mdash; the transaction hashes, the captured payloads, the test
        vectors, and the reason two of the three demo agents score zero &mdash; is the third column
        of the same table in the{' '}
        <a
          href={`${REPO_URL}#what-is-real-vs-mocked`}
          target="_blank"
          rel="noreferrer"
          className="text-signal underline-offset-4 hover:underline"
        >
          README
        </a>
        , kept there because those figures move as the agents keep collecting. The four grades are
        defined in{' '}
        <a
          href={docLink('CLAUDE.md')}
          target="_blank"
          rel="noreferrer"
          className="text-signal underline-offset-4 hover:underline"
        >
          CLAUDE.md
        </a>{' '}
        §6.
      </p>
    </div>
  );
}

function Row({ row }: { row: EvidenceRow }) {
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <th scope="row" className="py-2.5 pr-4 text-sm font-normal [overflow-wrap:anywhere] sm:pr-6">
        {splitCode(row.component).map((segment, index) =>
          segment.code ? (
            <code key={index} className="font-mono text-[0.8125rem] text-foreground/80">
              {segment.text}
            </code>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </th>
      <td className="py-2.5 text-right whitespace-nowrap">
        <StatusLabel status={row.status} />
      </td>
    </tr>
  );
}

/**
 * A grade, not a badge.
 *
 * `LIVE` is the only one that carries the accent, because it is the only one that had to be
 * earned with a hash. Giving all four a coloured pill would make the page's most important
 * distinction the least visible thing on it.
 */
function StatusLabel({ status }: { status: EvidenceStatus }) {
  const live = status === 'LIVE';
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase ${
        live ? 'text-signal' : 'text-muted-foreground'
      }`}
    >
      {live && <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />}
      {status}
    </span>
  );
}
