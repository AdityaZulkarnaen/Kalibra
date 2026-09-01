import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError } from '@/components/api-error';
import { CalibrationPanel } from '@/components/calibration-panel';
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
import { scoreDisplay, shortHash } from '@/lib/format';

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
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div>
        <Link href="/" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          &larr; Leaderboard
        </Link>
        <h1 className="mt-2 font-mono text-lg break-all">{wallet.wallet}</h1>
      </div>

      <section className="flex flex-wrap items-end gap-x-10 gap-y-4 rounded-xl border border-border bg-card/40 px-6 py-5">
        <div>
          <div className="text-xs text-muted-foreground">Kalibra Score</div>
          {display.kind === 'score' ? (
            <div className="mt-1 text-5xl leading-none tabular-nums">{display.value}</div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <Badge variant="secondary">PROVISIONAL</Badge>
              <span className="text-sm text-muted-foreground">no score is published</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Scored positions</div>
          <div className="mt-1 text-2xl tabular-nums">
            {wallet.n}
            {display.kind === 'provisional' && (
              <span className="text-base text-muted-foreground"> / {minSample}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Excluded</div>
          <div className="mt-1 text-2xl tabular-nums">{wallet.excludedCount}</div>
        </div>
        {wallet.agent !== null && (
          <div>
            <div className="text-xs text-muted-foreground">Arena agent</div>
            <div className="mt-1 text-sm">{wallet.agent.name}</div>
          </div>
        )}
      </section>

      <CalibrationPanel bins={wallet.calibration} />

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Statistics</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Brier, trader" value={stats.bsTrader} hint="lower is better" />
          <Stat label="Brier, market" value={stats.bsMarket} hint="the baseline" />
          <Stat label="Brier skill score" value={stats.bss} hint="vs the market" />
          <Stat label="BSS, shrunk" value={stats.bssShrunk} hint="empirical Bayes" />
          <Stat label="ECE, trader" value={stats.eceTrader} />
          <Stat label="ECE, market" value={stats.eceMarket} />
          <Stat label="ECE excess" value={stats.eceExcess} hint="trader over market" />
          <Stat label="ROC AUC" value={stats.auc} digits={3} hint="discrimination" />
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
    </main>
  );
}
