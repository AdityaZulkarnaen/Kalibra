import { ImageResponse } from 'next/og';

/**
 * The link preview.
 *
 * The mark is inlined as a data URI rather than fetched, and no font is named, so this renders
 * from what is already in the bundle. Invariant I3 applies here too: a build that reaches the
 * network to draw a preview image is a build an offline clone cannot run.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Kalibra — PnL leaderboards measure capital and luck. Kalibra measures skill.';

const INK = '#131313';
const SIGNAL = '#4fd1d9';
const MUTED = '#8f8f8f';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="360" height="360">
  <g stroke="#ffffff" stroke-opacity="0.14" stroke-width="0.5">
    ${[10, 20, 30, 40, 50, 60, 70, 80, 90]
      .map(
        (at) =>
          `<line x1="${at}" y1="0" x2="${at}" y2="100"/><line x1="0" y1="${at}" x2="100" y2="${at}"/>`,
      )
      .join('')}
  </g>
  <rect x="0" y="0" width="100" height="100" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="0.8"/>
  <line x1="0" y1="100" x2="100" y2="0" stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.8" stroke-dasharray="4 4"/>
  ${[
    [5, 11, 0.5],
    [15, 19, 0.7],
    [25, 29, 1],
    [35, 32, 0.85],
    [45, 48, 0.6],
    [65, 61, 0.9],
    [75, 79, 1],
    [85, 83, 0.75],
    [95, 93, 0.45],
  ]
    .map(
      ([x, y, w]) =>
        `<circle cx="${x}" cy="${100 - (y as number)}" r="${1.8 + 2.6 * (w as number)}" fill="${SIGNAL}" stroke="${INK}" stroke-width="0.9"/>`,
    )
    .join('')}
</svg>`;

const markUri = `data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}`;

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: INK,
        padding: '72px 80px',
        color: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 660 }}>
        <div style={{ fontSize: 20, letterSpacing: 4, color: SIGNAL, textTransform: 'uppercase' }}>
          Kalibra
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28 }}>
          <div style={{ fontSize: 56, lineHeight: 1.12 }}>
            PnL leaderboards measure capital and luck.
          </div>
          <div style={{ fontSize: 56, lineHeight: 1.12, color: SIGNAL, marginTop: 10 }}>
            Kalibra measures skill.
          </div>
        </div>
        <div style={{ fontSize: 24, color: MUTED, marginTop: 34 }}>
          A calibration layer for DreamDEX Event Contracts on Somnia
        </div>
      </div>

      <img src={markUri} width={360} height={360} alt="" />
    </div>,
    size,
  );
}
