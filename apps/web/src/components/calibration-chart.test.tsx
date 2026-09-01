// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CalibrationBin } from '@/lib/api';
import { toCalibrationSeries } from '@/lib/calibration';

import { CalibrationChart } from './calibration-chart';

/**
 * The chart is the screenshot in the submission, and two of day 5's acceptance criteria are
 * facts about the rendered SVG rather than about the data behind it: the diagonal has to be
 * drawn, and an empty bin has to be a gap. Both are asserted here against real output.
 */

afterEach(cleanup);

const bin = (
  index: number,
  count: number,
  meanForecast: number | null,
  observedFreq: number | null,
): CalibrationBin => ({
  bin: index,
  range: [index / 10, (index + 1) / 10],
  count,
  meanForecast,
  observedFreq,
});

const empty = (index: number): CalibrationBin => bin(index, 0, null, null);

/** Populated at 2, 5, 6. Bins 3 and 4 are the hole a careless line would draw across. */
const bins: CalibrationBin[] = [
  empty(0),
  empty(1),
  bin(2, 12, 0.2611, 0.25),
  empty(3),
  empty(4),
  bin(5, 31, 0.5512, 0.5806),
  bin(6, 20, 0.6402, 0.7),
  empty(7),
  empty(8),
  empty(9),
];

const draw = () => render(<CalibrationChart points={toCalibrationSeries(bins)} />).container;

/** The path the curve traces and the dots on it — the drawing, without the chrome. */
const geometry = (container: Element) => ({
  curve: container.querySelector('.recharts-line-curve')?.getAttribute('d'),
  dots: [...container.querySelectorAll('.recharts-line-dots circle')].map((circle) =>
    ['cx', 'cy', 'r'].map((attribute) => circle.getAttribute(attribute)).join(),
  ),
});

describe('CalibrationChart', () => {
  it('draws the perfect-calibration diagonal', () => {
    const line = draw().querySelector('.recharts-reference-line line');
    expect(line).not.toBeNull();

    // The reference line runs corner to corner of the plot area: x rises left to right as
    // y falls top to bottom, because SVG y grows downward.
    const x1 = Number(line?.getAttribute('x1'));
    const y1 = Number(line?.getAttribute('y1'));
    const x2 = Number(line?.getAttribute('x2'));
    const y2 = Number(line?.getAttribute('y2'));
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeLessThan(y1);

    // At 45°, which is the only slope on which the line means perfect calibration.
    expect(Math.abs(x2 - x1)).toBeCloseTo(Math.abs(y2 - y1), 6);
  });

  it('draws one dot per populated bin and none for an empty one', () => {
    expect(draw().querySelectorAll('.recharts-line-dots circle')).toHaveLength(3);
  });

  it('breaks the curve at the empty bins instead of interpolating across them', () => {
    const path = draw().querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
    // A break is a second move command. One M is a single unbroken line through the hole.
    expect((path.match(/M/g) ?? []).length).toBe(2);
  });

  it('sizes a dot by its sample count', () => {
    const radii = [...draw().querySelectorAll('.recharts-line-dots circle')].map((circle) =>
      Number(circle.getAttribute('r')),
    );
    // Bins 2, 12 positions; 5, 31; 6, 20. The busiest band is the largest dot.
    expect(radii[1]).toBeGreaterThan(radii[2] as number);
    expect(radii[2]).toBeGreaterThan(radii[0] as number);
  });

  it('draws the same picture twice, because nothing on it is animated', () => {
    // Only the geometry is compared: Recharts numbers its internal clip-path ids per
    // instance, and those change between renders without moving a single pixel.
    expect(geometry(draw())).toEqual(geometry(draw()));
  });
});
