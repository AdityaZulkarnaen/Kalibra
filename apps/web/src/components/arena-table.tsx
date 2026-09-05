import Link from 'next/link';

import { ScoreCell } from '@/components/score-cell';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ArenaEntry } from '@/lib/api';
import { num, scoreDisplay, shortAddress } from '@/lib/format';

/**
 * The Arena board. Same columns as the leaderboard plus the agent's stated method, because
 * the interesting question about an agent is not only how it scored but what it claimed it
 * was doing when it scored that way.
 *
 * The method is the agent's own words, shown as such. Nothing verifies it, and nothing here
 * implies anything does.
 */
export function ArenaTable({
  entries,
  minSample,
}: {
  entries: readonly ArenaEntry[];
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
            Agent
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
            <TableRow key={entry.agentId} className="transition-colors hover:bg-secondary/40">
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {display.kind === 'score' ? entry.rank : '—'}
              </TableCell>
              <TableCell>
                <div className="max-w-md">
                  <Link
                    href={`/w/${entry.wallet}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {entry.agentName ?? entry.agentId}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {shortAddress(entry.wallet)}
                  </span>
                  {entry.method !== null && (
                    <p className="mt-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
                      {entry.method}
                    </p>
                  )}
                </div>
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
