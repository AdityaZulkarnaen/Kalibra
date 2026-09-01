import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { LeaderboardEntry } from '@/lib/api';
import { num, scoreDisplay, shortAddress } from '@/lib/format';

/**
 * The sample size sits in the same cell as the score, not in a column a reader can skip.
 * `API_SPEC.md` §2 puts it plainly: a rank must never be seen without the sample behind it,
 * and that is the failure this product exists to correct.
 */
export function LeaderboardTable({
  entries,
  minSample,
}: {
  entries: readonly LeaderboardEntry[];
  minSample: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14 text-right">#</TableHead>
          <TableHead>Wallet</TableHead>
          <TableHead className="w-52">Score</TableHead>
          <TableHead className="text-right">BSS</TableHead>
          <TableHead className="text-right">ECE excess</TableHead>
          <TableHead className="text-right">AUC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const display = scoreDisplay(entry, minSample);
          return (
            <TableRow key={entry.wallet}>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {display.kind === 'score' ? entry.rank : '—'}
              </TableCell>
              <TableCell>
                <Link
                  href={`/w/${entry.wallet}`}
                  className="font-mono text-sm underline-offset-4 hover:underline"
                >
                  {shortAddress(entry.wallet)}
                </Link>
                {entry.isAgent && (
                  <Badge variant="outline" className="ml-2">
                    {entry.agentName ?? 'agent'}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {display.kind === 'score' ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl tabular-nums">{display.value}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      n = {entry.n}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <Badge variant="secondary">PROVISIONAL</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {display.n} / {display.minSample} positions
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{num(entry.bss)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(entry.eceExcess)}</TableCell>
              <TableCell className="text-right tabular-nums">{num(entry.auc, 3)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
