import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError } from '@/components/api-error';
import { CalibrationPanel } from '@/components/calibration-panel';
import { PageBand } from '@/components/page-header';
import { ScoreScale } from '@/components/score-scale';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { WhatThisIsNot } from '@/components/what-this-is-not';
import {
  ApiNotFoundError,
  fetchLeaderboard,
  fetchWallet,
  type ScoringParams,
  type Wallet,
} from '@/lib/api';
import { scoreBand } from '@/lib/band';
import { scoreDisplay, shortAddress, shortHash } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  let wallet: Wallet;
  let scoring: ScoringParams;
  try {
    // The wallet endpoint echoes only the hash of the parameter set, not its values. The
    // leaderboard echoes both, so one extra call buys a disclosure with real numbers in it
    // rather than a repeated constant that could drift from what actually scored this page.
    const [walletResult, board] = await Promise.all([
      fetchWallet(address),
      fetchLeaderboard('ranked', 1),
    ]);
    wallet = walletResult;
    scoring = board.params;
  } catch (error) {
    if (error instanceof ApiNotFoundError) notFound();
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <ApiError detail={error instanceof Error ? error.message : String(error)} />
      </main>
    );
  }

  const minSample = scoring.minSample;
  const display = scoreDisplay(wallet, minSample);
  const { stats } = wallet;
  // A wallet scored under an older parameter set is a real condition, and saying so is
  // cheaper than a reader discovering it by hand.
  const staleParams = wallet.paramsHash !== scoring.paramsHash;

  return (
    <main>
      <PageBand>
        <Link
          href="/leaderboard"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          &larr; Leaderboard
        </Link>
        <p className="mt-4 font-mono text-[11px] tracking-[0.18em] text-signal uppercase">Wallet</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl break-all sm:text-2xl">
            <span className="lg:hidden">{shortAddress(wallet.wallet)}</span>
            <span className="hidden lg:inline">{wallet.wallet}</span>
          </h1>
          {wallet.agent !== null && <Badge variant="outline">{wallet.agent.name}</Badge>}
        </div>
      </PageBand>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <ScoreCard wallet={wallet} display={display} minSample={minSample} />

        <CalibrationPanel bins={wallet.calibration} />

        <section>
          <h2 className="text-sm font-semibold tracking-tight">Statistics</h2>
          <div className="mt-4 space-y-5">
            <StatGroup
              title="Brier"
              note="Mean squared error of the forecast against what happened. The market's own score over the same positions is the baseline everything else is measured from."
            >
              <Stat label="Brier, trader" value={stats.bsTrader} hint="lower is better" />
              <Stat label="Brier, market" value={stats.bsMarket} hint="the baseline" />
              <Stat label="Brier skill score" value={stats.bss} hint="vs the market" />
              <Stat label="BSS, shrunk" value={stats.bssShrunk} hint="empirical Bayes" />
            </StatGroup>
            <StatGroup
              title="Calibration"
              note="Whether a forecast of 0.7 comes true about seventy percent of the time. Only the excess over the market's own miscalibration reaches the score."
            >
              <Stat label="ECE, trader" value={stats.eceTrader} />
              <Stat label="ECE, market" value={stats.eceMarket} />
              <Stat label="ECE excess" value={stats.eceExcess} hint="trader over market" />
            </StatGroup>
            <StatGroup
              title="Discrimination"
              note="Whether winners and losers can be told apart at all. Reported, but deliberately left out of the score so it is not counted twice alongside BSS."
            >
              <Stat label="ROC AUC" value={stats.auc} digits={3} hint="not scored" />
            </StatGroup>
          </div>
        </section>

        {staleParams && (
          <p className="rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground">
            This wallet was scored under parameter set{' '}
            <code className="font-mono">{shortHash(wallet.paramsHash)}</code>, which is not the set
            the index is currently publishing. Re-run the pipeline to bring it forward.
          </p>
        )}

        <WhatThisIsNot params={scoring} />
      </div>
    </main>
  );
}

function ScoreCard({
  wallet,
  display,
  minSample,
}: {
  wallet: Wallet;
  display: ReturnType<typeof scoreDisplay>;
  minSample: number;
}) {
  // Only a RANKED score has a band. A PROVISIONAL wallet has no number to place on the scale,
  // and giving it a colour would be the same claim as giving it a rank.
  const band = display.kind === 'score' ? scoreBand(display.value) : null;

  return (
    <section
      className={`rounded-xl border ${band?.border ?? 'border-border'} ${band?.background ?? 'bg-card/40'} px-6 py-6`}
    >
      <div className="flex flex-wrap items-end gap-x-12 gap-y-5">
        <div>
          <div className="text-xs text-muted-foreground">Kalibra Score</div>
          {display.kind === 'score' && band !== null ? (
            <>
              <div className={`mt-1.5 text-6xl leading-none tabular-nums ${band.text}`}>
                {display.value}
              </div>
              <div className="mt-2.5 text-sm text-muted-foreground">{band.label}</div>
            </>
          ) : (
            <div className="mt-2.5 flex items-center gap-3">
              <Badge variant="secondary">PROVISIONAL</Badge>
              <span className="text-sm text-muted-foreground">no score is published</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Scored positions</div>
          <div className="mt-1.5 text-2xl tabular-nums">
            {wallet.n}
            {display.kind === 'provisional' && (
              <span className="text-base text-muted-foreground"> / {minSample}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Excluded</div>
          <div className="mt-1.5 text-2xl tabular-nums">{wallet.excludedCount}</div>
        </div>
      </div>

      {display.kind === 'score' && (
        <div className="mt-8 max-w-xl">
          <ScoreScale marker={display.value} bands={false} />
        </div>
      )}
    </section>
  );
}

function StatGroup({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-mono text-[11px] tracking-[0.14em] text-signal uppercase">{title}</h3>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{note}</p>
      </div>
      <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}
