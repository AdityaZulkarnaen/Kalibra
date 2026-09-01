import { num } from '@/lib/format';

/** One statistic. A null value reads as a dash, never as zero. */
export function Stat({
  label,
  value,
  digits = 4,
  hint,
}: {
  label: string;
  value: number | null;
  digits?: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg tabular-nums">{num(value, digits)}</div>
      {hint !== undefined && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
