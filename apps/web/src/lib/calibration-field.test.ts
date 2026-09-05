import { describe, expect, it } from 'vitest';

import {
  createForecasts,
  reliabilityCurve,
  seededRandom,
  settle,
  stepForecasts,
  type Forecast,
} from './calibration-field';

describe('reliabilityCurve', () => {
  it('meets the diagonal at both ends, at every time', () => {
    for (const t of [0, 0.7, 3.1, 12.5]) {
      expect(reliabilityCurve(0, t)).toBe(0);
      expect(reliabilityCurve(1, t)).toBe(1);
    }
  });

  it('leaves the diagonal in between, or the shape is not a calibration curve', () => {
    // Swept over a full period rather than sampled at one time, because the curve crosses the
    // diagonal on the way past and any single `t` can land on a crossing.
    let widest = 0;
    for (let i = 0; i < 400; i += 1) {
      const t = (i / 400) * 24;
      widest = Math.max(widest, Math.abs(reliabilityCurve(0.5, t) - 0.5));
    }

    expect(widest).toBeGreaterThan(0.1);
  });

  it('stays inside the unit square', () => {
    for (let i = 0; i <= 100; i += 1) {
      for (const t of [0, 2.3, 5.9, 40]) {
        const y = reliabilityCurve(i / 100, t);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('seededRandom', () => {
  it('gives the same field on every load', () => {
    expect(createForecasts(20, seededRandom(7))).toStrictEqual(
      createForecasts(20, seededRandom(7)),
    );
  });

  it('stays in [0, 1)', () => {
    const random = seededRandom(99);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('stepForecasts', () => {
  it('pulls a forecast toward the curve', () => {
    const forecast: Forecast = { x: 0.5, y: 0.95, vy: 0, weight: 0.5, phase: 0, flash: 0 };
    const before = Math.abs(forecast.y - reliabilityCurve(forecast.x, 0));

    for (let i = 0; i < 60; i += 1) stepForecasts([forecast], 0, 1 / 60);

    expect(Math.abs(forecast.y - reliabilityCurve(forecast.x, 0))).toBeLessThan(before);
  });

  it('wraps drift back to the left edge instead of running off the field', () => {
    const forecast: Forecast = { x: 0.999, y: 0.999, vy: 0, weight: 1, phase: 0, flash: 0 };

    for (let i = 0; i < 600; i += 1) stepForecasts([forecast], 0, 1 / 60);

    expect(forecast.x).toBeGreaterThanOrEqual(0);
    expect(forecast.x).toBeLessThanOrEqual(1);
  });

  it('decays a settlement flash to nothing', () => {
    const forecast: Forecast = { x: 0.3, y: 0.3, vy: 0, weight: 0.5, phase: 0, flash: 1 };

    for (let i = 0; i < 180; i += 1) stepForecasts([forecast], 0, 1 / 60);

    expect(forecast.flash).toBe(0);
  });
});

describe('settle', () => {
  it('flashes and re-enters inside the field', () => {
    const forecast: Forecast = { x: 0.2, y: 0.2, vy: 4, weight: 0.5, phase: 0, flash: 0 };

    settle(forecast, seededRandom(3));

    expect(forecast.flash).toBe(1);
    expect(forecast.vy).toBe(0);
    expect(forecast.x).toBeGreaterThanOrEqual(0);
    expect(forecast.x).toBeLessThanOrEqual(1);
    expect(forecast.y).toBeGreaterThanOrEqual(0);
    expect(forecast.y).toBeLessThanOrEqual(1);
  });
});
