import Link from 'next/link';

import { ApiError } from '@/components/api-error';
import { LeaderboardTable } from '@/components/leaderboard-table';
import { WhatThisIsNot } from '@/components/what-this-is-not';
import { fetchLeaderboard, type Leaderboard, type LeaderboardStatus } from '@/lib/api';
import { shortHash } from '@/lib/format';

/**
 * Rendered per request. Pre-rendering would bake a snapshot of the leaderboard into the
 * build and turn "the API is down" into "here are yesterday's numbers", which day 5's
 * acceptance criteria rule out.
 */
export const dynamic = 'force-dynamic';

const LIMIT = 100;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = (await searchParams)['status'];
  const status: LeaderboardStatus = requested === 'all' ? 'all' : 'ranked';

  let board: Leaderboard;
  try {
    board = await fetchLeaderboard(status, LIMIT);
  } catch (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <ApiError detail={error instanceof Error ? error.message : String(error)} />
      </main>
    );
  }

  const { params } = board;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {board.total} wallet{board.total === 1 ? '' : 's'}
            {status === 'ranked'
              ? ` with at least ${params.minSample} settled positions`
              : ', ranked and provisional'}
            .
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-lg border border-border p-1 text-sm">
          <StatusLink current={status} value="ranked">
            Ranked
          </StatusLink>
          <StatusLink current={status} value="all">
            All wallets
          </StatusLink>
        </nav>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-border bg-card/40 px-5 py-4 text-sm">
        <Param label="LAMBDA_MAX" value={String(params.lambdaMax)} />
        <Param label="SHRINK_K" value={String(params.shrinkK)} />
        <Param label="MIN_SAMPLE" value={String(params.minSample)} />
        <Param label="params hash" value={shortHash(params.paramsHash)} title={params.paramsHash} />
      </dl>

      {board.entries.length === 0 ? (
        <p className="rounded-xl border border-border px-5 py-8 text-sm text-muted-foreground">
          No wallets to show. The pipeline has run but nothing met the filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <LeaderboardTable entries={board.entries} minSample={params.minSample} />
        </div>
      )}

      <WhatThisIsNot params={params} />
    </main>
  );
}

function StatusLink({
  current,
  value,
  children,
}: {
  current: LeaderboardStatus;
  value: LeaderboardStatus;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <Link
      href={`/?status=${value}`}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-md bg-secondary px-3 py-1 text-secondary-foreground'
          : 'rounded-md px-3 py-1 text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}

function Param({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  );
}
