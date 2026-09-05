import type { ScoringParams } from '@/lib/api';
import { shortHash } from '@/lib/format';

/**
 * The parameter set that produced everything below it. `SCORING_SPEC.md` §9 asks for these to
 * be published with the scores rather than buried in a document, so a result can be reproduced
 * or contested without reading the source.
 */
export function ParamsBar({ params }: { params: ScoringParams }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card/40 px-5 py-3.5">
      <div className="mr-2 flex items-center gap-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
        Run parameters
      </div>
      <Param label="LAMBDA_MAX" value={String(params.lambdaMax)} />
      <Param label="SHRINK_K" value={String(params.shrinkK)} />
      <Param label="MIN_SAMPLE" value={String(params.minSample)} />
      <Param label="params hash" value={shortHash(params.paramsHash)} title={params.paramsHash} />
    </dl>
  );
}

function Param({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="font-mono text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  );
}
