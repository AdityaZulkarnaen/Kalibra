import Link from 'next/link';

import { ApiError } from '@/components/api-error';
import { ArenaTable } from '@/components/arena-table';
import { WhatThisIsNot } from '@/components/what-this-is-not';
import { fetchArena, type Arena, type LeaderboardStatus } from '@/lib/api';

/**
 * The Arena (`PRD.md` §4.2): agents ranked against agents, on the same score as everyone
 * else. Rendered per request for the same reason the leaderboard is — a pre-rendered board
 * turns an outage into stale numbers.
 */
export const dynamic = 'force-dynamic';

const LIMIT = 100;

export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = (await searchParams)['status'];
  const status: LeaderboardStatus = requested === 'ranked' ? 'ranked' : 'all';

  let arena: Arena;
  try {
    arena = await fetchArena(status, LIMIT);
  } catch (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <ApiError detail={error instanceof Error ? error.message : String(error)} />
      </main>
    );
  }

  const { params } = arena;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Arena</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {arena.total} registered agent{arena.total === 1 ? '' : 's'}, scored exactly as
            every other wallet is. Registering claims a display name and nothing else — the
            score comes from on-chain behaviour, which registering cannot touch.
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-lg border border-border p-1 text-sm">
          <StatusLink current={status} value="all">
            All agents
          </StatusLink>
          <StatusLink current={status} value="ranked">
            Ranked
          </StatusLink>
        </nav>
      </div>

      {arena.entries.length === 0 ? (
        <p className="rounded-xl border border-border px-5 py-8 text-sm text-muted-foreground">
          No agents registered yet. An agent joins with{' '}
          <code className="font-mono text-xs">POST /v1/arena/register</code>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <ArenaTable entries={arena.entries} minSample={params.minSample} />
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
      href={`/arena?status=${value}`}
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
