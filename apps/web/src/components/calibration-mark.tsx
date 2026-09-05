/**
 * The calibration field as a figure: the plot, with the perfect-calibration diagonal drawn
 * across it. It is the product's central image but it is no longer the brand mark — the logo
 * is a raster at `public/icon/icon.png`, and this draws the thing the product measures.
 *
 * Unlike `calibration-chart.tsx`, this one may scale freely. A `viewBox` with a square aspect
 * and `preserveAspectRatio` keeps the diagonal at 45° at every size, so the geometry the real
 * chart has to pin to 460×444 comes free here.
 *
 * The plotted points are schematic. They are not a wallet's record and the hero says so on the
 * page — a decorative curve presented as somebody's calibration would be a fabricated result.
 */

/** Forecast, observed frequency, and relative weight. Bin 0.55–0.65 is left empty on purpose. */
const POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.05, 0.11, 0.5],
  [0.15, 0.19, 0.7],
  [0.25, 0.29, 1],
  [0.35, 0.32, 0.85],
  [0.45, 0.48, 0.6],
  [0.65, 0.61, 0.9],
  [0.75, 0.79, 1],
  [0.85, 0.83, 0.75],
  [0.95, 0.93, 0.45],
];

const GRID = [10, 20, 30, 40, 50, 60, 70, 80, 90];

/** SVG y runs downward; observed frequency runs upward. */
const px = (value: number) => value * 100;
const py = (value: number) => 100 - value * 100;

export function CalibrationMark({ className }: { className?: string }) {
  const path = POINTS.map(([f, o], i) => `${i === 0 ? 'M' : 'L'}${px(f)} ${py(o)}`).join(' ');

  return (
    <svg
      viewBox="-6 -6 112 112"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label="A calibration field: plotted points against the perfect-calibration diagonal"
    >
      <defs>
        <radialGradient id="mark-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.16" />
          <stop offset="55%" stopColor="var(--signal)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="-6" y="-6" width="112" height="112" fill="url(#mark-glow)" />

      <g stroke="currentColor" strokeOpacity="0.16" strokeWidth="0.5">
        {GRID.map((at) => (
          <line key={`v${at}`} x1={at} y1={0} x2={at} y2={100} />
        ))}
        {GRID.map((at) => (
          <line key={`h${at}`} x1={0} y1={at} x2={100} y2={at} />
        ))}
      </g>

      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="0.8"
      />

      {/* Perfect calibration. Every point on the field is read as distance from this line. */}
      <line
        x1="0"
        y1="100"
        x2="100"
        y2="0"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="0.8"
        strokeDasharray="4 4"
      />

      <path
        d={path}
        fill="none"
        stroke="var(--signal)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.55"
      />

      {POINTS.map(([f, o, weight]) => (
        <circle
          key={f}
          cx={px(f)}
          cy={py(o)}
          r={1.8 + 2.6 * weight}
          fill="var(--signal)"
          stroke="var(--background)"
          strokeWidth="0.9"
        />
      ))}
    </svg>
  );
}

/**
 * The field at glyph size, for captioning a calibration field rather than for branding. The
 * full plot turns to mud below about 24px, so this keeps only what survives at that size: the
 * frame, the diagonal, and one point sitting off it.
 */
export function CalibrationGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.5"
      />
      <line
        x1="4"
        y1="20"
        x2="20"
        y2="4"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
      <circle cx="15.5" cy="6.5" r="2.6" fill="var(--signal)" />
    </svg>
  );
}
