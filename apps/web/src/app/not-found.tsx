import Link from 'next/link';

/**
 * `API_SPEC.md` §2 draws a line the UI has to keep: a wallet with no positions at all is
 * unknown to the index, which is different from a wallet the index knows but cannot yet
 * measure. The second case is a profile page reading PROVISIONAL. This is the first.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Not in the index</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        No settled or excluded positions have been ingested for this address. That is not a claim
        that the wallet has never traded &mdash; only that nothing for it is in the window this
        index covers.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-sm underline underline-offset-4 hover:no-underline"
      >
        Back to the leaderboard
      </Link>
    </main>
  );
}
