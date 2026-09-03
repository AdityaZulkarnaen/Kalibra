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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14 text-right">#</TableHead>
          <TableHead>Agent</TableHead>
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
            <TableRow key={entry.agentId}>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {display.kind === 'score' ? entry.rank : '—'}
              </TableCell>
              <TableCell className="max-w-md">
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
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {entry.method}
                  </p>
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
