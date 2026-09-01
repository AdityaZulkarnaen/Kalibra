'use client';

import { CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import type { CalibrationPoint } from '@/lib/calibration';

/**
 * Forecast confidence against observed frequency, with the diagonal drawn for reference.
 *
 * The plot area is square on purpose. The diagonal is the whole point of the chart — it is
 * where a forecast of 0.7 comes true seventy percent of the time — and it only reads as
 * perfect calibration when it sits at 45°, which requires the two axes to be scaled alike.
 * A responsive container would stretch it into a slope that means nothing, so the size is
 * fixed and the container scrolls on a narrow screen instead.
 *
 * WIDTH - MARGIN.left - MARGIN.right - AXIS_WIDTH equals
 * HEIGHT - MARGIN.top - MARGIN.bottom - AXIS_HEIGHT. Change one, change the other.
 */

const WIDTH = 460;
const HEIGHT = 444;
const MARGIN = { top: 16, right: 16, bottom: 4, left: 4 };
const AXIS_WIDTH = 44;
const AXIS_HEIGHT = 28;

const TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

interface DotProps {
  readonly cx?: number;
  readonly cy?: number;
  readonly payload?: CalibrationPoint;
}

/** Radius by square root of count, so area tracks sample size rather than radius. */
function makeDot(maxCount: number) {
  return function CalibrationDot({ cx, cy, payload }: DotProps) {
    if (cx === undefined || cy === undefined || payload === undefined) return null;
    if (payload.observedFreq === null) return null;
    const radius = 3.5 + 5.5 * Math.sqrt(payload.count / Math.max(maxCount, 1));
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className="fill-foreground stroke-background"
        strokeWidth={1.5}
      />
    );
  };
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CalibrationPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">bin {point.label}</div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 tabular-nums text-muted-foreground">
        <span>positions</span>
        <span className="text-right text-foreground">{point.count}</span>
        <span>mean forecast</span>
        <span className="text-right text-foreground">{point.meanForecast?.toFixed(4) ?? '—'}</span>
        <span>observed</span>
        <span className="text-right text-foreground">{point.observedFreq?.toFixed(4) ?? '—'}</span>
      </div>
    </div>
  );
}

export function CalibrationChart({ points }: { points: readonly CalibrationPoint[] }) {
  const maxCount = points.reduce((most, point) => Math.max(most, point.count), 0);

  return (
    <ComposedChart
      width={WIDTH}
      height={HEIGHT}
      margin={MARGIN}
      data={[...points]}
      role="img"
      aria-label="Calibration curve: mean forecast against observed frequency, with the perfect-calibration diagonal"
    >
      <CartesianGrid className="stroke-border/60" strokeDasharray="2 4" />
      <XAxis
        type="number"
        dataKey="x"
        domain={[0, 1]}
        ticks={TICKS}
        height={AXIS_HEIGHT}
        tickLine={false}
        className="text-[11px]"
        stroke="currentColor"
        label={{ value: 'forecast', position: 'insideBottomRight', dy: 12, fontSize: 11 }}
      />
      <YAxis
        type="number"
        domain={[0, 1]}
        ticks={TICKS}
        width={AXIS_WIDTH}
        tickLine={false}
        className="text-[11px]"
        stroke="currentColor"
        label={{ value: 'observed', angle: -90, position: 'insideTopLeft', dx: -2, fontSize: 11 }}
      />

      {/* Perfect calibration. Everything on the chart is read as distance from this line. */}
      <ReferenceLine
        segment={[
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]}
        stroke="currentColor"
        strokeOpacity={0.45}
        strokeDasharray="5 5"
        ifOverflow="visible"
      />

      <Tooltip content={<ChartTooltip />} cursor={false} />

      {/*
        connectNulls stays false: an empty bin is a gap in the trader's record, and a
        segment drawn across it would claim calibration in a band they never forecast in.
        Animation is off so the rendered SVG is the same every time it is drawn.
      */}
      <Line
        type="linear"
        dataKey="observedFreq"
        connectNulls={false}
        isAnimationActive={false}
        className="stroke-primary"
        stroke="currentColor"
        strokeWidth={2}
        dot={makeDot(maxCount)}
        activeDot={false}
      />
    </ComposedChart>
  );
}
