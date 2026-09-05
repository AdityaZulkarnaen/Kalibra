import { ApiError } from '@/components/api-error';
import { LeaderboardTable } from '@/components/leaderboard-table';
import { PageHeader } from '@/components/page-header';
import { ParamsBar } from '@/components/params-bar';
import { Segmented, SegmentedLink } from '@/components/segmented';
import { WhatThisIsNot } from '@/components/what-this-is-not';
import { fetchLeaderboard, type Leaderboard, type LeaderboardStatus } from '@/lib/api';

/**
 * Rendered per request. Pre-rendering would bake a snapshot of the leaderboard into the
 * build and turn "the API is down" into "here are yesterday's numbers", which day 5's
 * acceptance criteria rule out.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Leaderboard — Kalibra',
  description: 'Wallets ranked by Kalibra Score, with the sample size behind every rank.',
};

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
    <main>
      <PageHeader
        eyebrow="Index"
        title="Leaderboard"
        actions={
          <Segmented>
            <SegmentedLink href="/leaderboard?status=ranked" active={status === 'ranked'}>
              Ranked
            </SegmentedLink>
            <SegmentedLink href="/leaderboard?status=all" active={status === 'all'}>
              All wallets
            </SegmentedLink>
          </Segmented>
        }
      >
        {board.total} wallet{board.total === 1 ? '' : 's'}
        {status === 'ranked'
          ? ` with at least ${params.minSample} settled positions`
          : ', ranked and provisional'}
        . Ranked on calibration against the market&rsquo;s own forecast, not on profit.
      </PageHeader>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <ParamsBar params={params} />

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
      </div>
    </main>
  );
}
