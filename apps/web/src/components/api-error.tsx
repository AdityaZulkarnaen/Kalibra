import { apiBaseUrl } from '@/lib/api';

/**
 * What a reader sees when `apps/api` is unreachable or off-contract.
 *
 * It says the index could not be read. It does not fall back to a cached copy or to fixture
 * data, because a leaderboard that silently shows yesterday's numbers is a worse failure
 * than one that admits it has none — `ARCHITECTURE.md` §2 makes that explicit for this app.
 */
export function ApiError({ detail }: { detail: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
        The index could not be read
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        This page renders from <code className="text-xs">{apiBaseUrl()}</code> and shows nothing
        when that is unavailable. No cached or placeholder numbers are substituted.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Start the API with <code className="rounded bg-muted px-1 py-0.5">pnpm api</code> after{' '}
        <code className="rounded bg-muted px-1 py-0.5">pnpm ingest</code>.
      </p>
      <pre className="mt-5 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        {detail}
      </pre>
    </div>
  );
}
