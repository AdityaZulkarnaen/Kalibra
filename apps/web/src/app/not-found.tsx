import Link from 'next/link';

import { PageBand } from '@/components/page-header';

/**
 * `API_SPEC.md` §2 draws a line the UI has to keep: a wallet with no positions at all is
 * unknown to the index, which is different from a wallet the index knows but cannot yet
 * measure. The second case is a profile page reading PROVISIONAL. This is the first.
 */
export default function NotFound() {
  return (
    <main>
      <PageBand>
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          404
        </p>
        <h1 className="mt-2.5 text-3xl font-semibold tracking-tight sm:text-4xl">
          Not in the index
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          No settled or excluded positions have been ingested for this address. That is not a claim
          that the wallet has never traded &mdash; only that nothing for it is in the window this
          index covers.
        </p>
      </PageBand>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/leaderboard"
            className="rounded-full border border-border px-5 py-2.5 text-sm transition-colors hover:bg-secondary"
          >
            Back to the leaderboard
          </Link>
          <Link
            href="/"
            className="rounded-full px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            What Kalibra measures
          </Link>
        </div>
      </div>
    </main>
  );
}
