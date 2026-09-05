import { Badge } from '@/components/ui/badge';
import { scoreBand } from '@/lib/band';
import type { ScoreDisplay } from '@/lib/format';

/**
 * The score, and the sample it rests on, in one cell.
 *
 * `API_SPEC.md` §2 puts it plainly: a rank must never be seen without the sample size behind
 * it, and that is the failure this product exists to correct. Keeping them in a single cell is
 * what stops the second one being a column a reader can skip.
 *
 * The band colour comes from the published table in `SCORING_SPEC.md` §6.2, and only a RANKED
 * score has one — a PROVISIONAL wallet gets neither a number nor a colour.
 */
export function ScoreCell({ display, n }: { display: ScoreDisplay; n: number }) {
  if (display.kind === 'provisional') {
    return (
      <div className="flex items-baseline gap-2">
        <Badge variant="secondary">PROVISIONAL</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {display.n} / {display.minSample} positions
        </span>
      </div>
    );
  }

  const band = scoreBand(display.value);
  return (
    <div className="flex items-baseline gap-2.5">
      <span className={`text-xl tabular-nums ${band.text}`}>{display.value}</span>
      <span className="text-xs tabular-nums text-muted-foreground">n = {n}</span>
    </div>
  );
}
