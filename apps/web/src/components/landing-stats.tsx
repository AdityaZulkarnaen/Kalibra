import { apiBaseUrl, fetchStats, type Stats } from '@/lib/api';

/**
 * The pipeline's own counters, read from `/v1/stats` on every request.
 *
 * This is the one part of the landing page that makes a factual claim about how much data
 * exists, so it is the one part that must not be written down anywhere in this file. Nothing
 * here has a fallback value.
 *
 * When the API is unreachable this strip says so and the rest of the page still renders. The
 * boards take the opposite decision and fail whole, because there the numbers are the page —
 * here the argument stands without them.
 */
export async function LandingStats() {
  let stats: Stats;
  try {
    stats = await fetchStats();
  } catch {
    return (
      <div className="rounded-2xl border border-border bg-card/80 px-5 py-4 text-sm text-muted-foreground shadow-2xl shadow-black/50 backdrop-blur-xl">
        The index at <code className="text-xs">{apiBaseUrl()}</code> is not answering, so this page
        has no counts to show.
      </div>
    );
  }

  return (
    <div>
      {/*
       * Glass rather than a solid panel: the strip is lifted over the bottom of the dawn
       * section, and a card opaque enough to hide what it sits on would read as a lid on the
       * page rather than as the first thing standing on the ground under that sky.
       */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-2xl shadow-black/50 sm:grid-cols-4">
        <Counter label="Markets settled" value={stats.marketsSettled} />
        <Counter label="Positions scored" value={stats.positionsScored} />
        <Counter label="Wallets ranked" value={stats.rankedWallets} of={stats.totalWallets} />
        <Counter label="Score anchor" value={500} note="market-equivalent" />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Read from <code className="text-[11px]">/v1/stats</code> when this page was requested
        {stats.mode !== null && (
          <>
            {' '}
            &middot; ingest mode <span className="font-mono text-foreground">{stats.mode}</span>
          </>
        )}
        {stats.lastIngestedAt !== null && (
          <>
            {' '}
            &middot; last ingest{' '}
            <time
              dateTime={new Date(stats.lastIngestedAt).toISOString()}
              className="tabular-nums text-foreground"
            >
              {new Date(stats.lastIngestedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
            </time>
          </>
        )}
        .
      </p>
    </div>
  );
}

function Counter({
  label,
  value,
  of,
  note,
}: {
  label: string;
  value: number;
  of?: number;
  note?: string;
}) {
  return (
    <div className="bg-background/80 px-5 py-6 backdrop-blur-xl">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-3xl leading-none tabular-nums">
        {value.toLocaleString('en-US')}
        {of !== undefined && (
          <span className="text-base text-muted-foreground"> / {of.toLocaleString('en-US')}</span>
        )}
      </dd>
      {note !== undefined && <div className="mt-1.5 text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}
