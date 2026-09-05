import type { ScoringParams } from '@/lib/api';
import { shortHash } from '@/lib/format';

/**
 * `SCORING_SPEC.md` §9, reproduced next to every score. The spec asks for it on the page
 * rather than behind a tooltip, and `BUILD_PLAN.md` day 5 repeats the requirement: a reader
 * has to meet the limitation without going looking for it.
 *
 * The parameter values are the live ones from the API rather than repeated prose, so the
 * claim that they are published is checkable on the page that makes it.
 */
export function WhatThisIsNot({ params }: { params: ScoringParams }) {
  return (
    <section
      aria-labelledby="what-this-is-not"
      className="rounded-xl border border-border border-l-2 border-l-signal/60 bg-card/40 p-6"
    >
      <h2
        id="what-this-is-not"
        className="font-mono text-[11px] tracking-[0.14em] text-signal uppercase"
      >
        What this score is not
      </h2>
      <div className="mt-3.5 max-w-3xl space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Kalibra measures <strong className="text-foreground">informational edge</strong>: whether
          a trader&rsquo;s deviations from the market&rsquo;s own probability were, on average, in
          the right direction. It does not measure profitability. A well-calibrated trader can lose
          money through poor sizing or bad fills, and a badly calibrated one can profit through
          luck.
        </p>
        <p>
          The forecast model is an assumption. A different{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">LAMBDA_MAX</code> produces
          different scores. This index used{' '}
          <span className="tabular-nums text-foreground">{params.lambdaMax}</span>, with shrinkage k
          = <span className="tabular-nums text-foreground">{params.shrinkK}</span> and a minimum
          sample of <span className="tabular-nums text-foreground">{params.minSample}</span>. The
          full parameter set hashes to{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs" title={params.paramsHash}>
            {shortHash(params.paramsHash)}
          </code>
          , which is returned with every score so any result here can be reproduced or contested.
        </p>
      </div>
    </section>
  );
}
