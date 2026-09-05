import Link from 'next/link';

import { ScoreCell } from '@/components/score-cell';
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

export function LeaderboardTable({
  entries,
  minSample,
}: {
  entries: readonly LeaderboardEntry[];
  minSample: number;
}) {
  return (
    <Table className="[&_td]:px-4 [&_td]:py-3.5 [&_th]:px-4">
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-14 text-right font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            #
          </TableHead>
          <TableHead className="font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            Wallet
          </TableHead>
          <TableHead className="w-56 font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            Score
          </TableHead>
          <TableHead className="text-right font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            BSS
          </TableHead>
          <TableHead className="text-right font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            ECE excess
          </TableHead>
          <TableHead className="text-right font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground uppercase">
            AUC
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const display = scoreDisplay(entry, minSample);
          return (
            <TableRow key={entry.wallet} className="transition-colors hover:bg-secondary/40">
              <TableCell
                className={`text-right tabular-nums ${
                  display.kind === 'score' && entry.rank <= 3
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
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
                <ScoreCell display={display} n={entry.n} />
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
