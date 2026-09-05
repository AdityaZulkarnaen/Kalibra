import { CalibrationChart } from '@/components/calibration-chart';
import type { CalibrationBin } from '@/lib/api';
import { populatedBins, signedDeviation, toCalibrationSeries } from '@/lib/calibration';
import { num } from '@/lib/format';

/**
 * The chart and the numbers behind it, together.
 *
 * The bin table is not decoration. It is how a reader checks that a gap in the curve is an
 * empty bin rather than a rendering fault, which is the difference between an honest chart
 * and one that merely looks tidy.
 */
export function CalibrationPanel({ bins }: { bins: readonly CalibrationBin[] }) {
  const points = toCalibrationSeries(bins);
  const populated = populatedBins(points);
  const deviation = signedDeviation(points);

  return (
    <section className="rounded-xl border border-border bg-card/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Calibration</h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          {populated.length} of {points.length} bins populated
        </p>
      </div>

      {populated.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No settled positions, so there is no calibration to plot.
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-8">
          <div className="min-w-0">
            <div className="overflow-x-auto">
              <CalibrationChart points={points} />
            </div>
            <p className="mt-3 max-w-[460px] text-xs leading-relaxed text-muted-foreground">
              Each point is one confidence band: mean forecast against how often those forecasts
              came true. The dashed diagonal is perfect calibration. Points above it are forecasts
              that came true more often than claimed; points below came true less often. Dot area is
              the number of positions in the band. Empty bands are gaps, not interpolated.
              {deviation !== null && (
                <>
                  {' '}
                  Count-weighted mean deviation from the diagonal:{' '}
                  <span className="tabular-nums text-foreground">
                    {deviation > 0 ? '+' : ''}
                    {deviation.toFixed(4)}
                  </span>
                  .
                </>
              )}
            </p>
          </div>

          <table className="w-full min-w-[340px] flex-1 text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 text-left font-normal">Band</th>
                <th className="py-2 text-right font-normal">Positions</th>
                <th className="py-2 text-right font-normal">Mean forecast</th>
                <th className="py-2 text-right font-normal">Observed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => {
                const empty = point.observedFreq === null;
                return (
                  <tr
                    key={point.bin}
                    className={`border-b border-border/50 ${empty ? 'text-muted-foreground/60' : ''}`}
                  >
                    <td className="py-1.5 font-mono text-xs">{point.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{point.count}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(point.meanForecast)}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(point.observedFreq)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
