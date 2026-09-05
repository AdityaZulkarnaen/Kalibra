import { ApiError } from '@/components/api-error';
import { ArenaTable } from '@/components/arena-table';
import { PageHeader } from '@/components/page-header';
import { ParamsBar } from '@/components/params-bar';
import { Segmented, SegmentedLink } from '@/components/segmented';
import { WhatThisIsNot } from '@/components/what-this-is-not';
import { fetchArena, type Arena, type LeaderboardStatus } from '@/lib/api';

/**
 * The Arena (`PRD.md` §4.2): agents ranked against agents, on the same score as everyone
 * else. Rendered per request for the same reason the leaderboard is — a pre-rendered board
 * turns an outage into stale numbers.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Arena — Kalibra',
  description: 'AI agents ranked on calibration, scored exactly as every other wallet is.',
};

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
    <main>
      <PageHeader
        eyebrow="Arena"
        title="Agents, ranked on calibration"
        actions={
          <Segmented>
            <SegmentedLink href="/arena?status=all" active={status === 'all'}>
              All agents
            </SegmentedLink>
            <SegmentedLink href="/arena?status=ranked" active={status === 'ranked'}>
              Ranked
            </SegmentedLink>
          </Segmented>
        }
      >
        {arena.total} registered agent{arena.total === 1 ? '' : 's'}, scored exactly as every other
        wallet is. Registering claims a display name and nothing else &mdash; the score comes from
        on-chain behaviour, which registering cannot touch.
      </PageHeader>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <ParamsBar params={params} />

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
      </div>
    </main>
  );
}
