import { describe, expect, it } from 'vitest';

import { clamp01, drift, driftTarget, lerp, presence, scrollProgress } from './parallax';

/**
 * The dawn section's motion is the one authored moment on the landing page, and every property
 * that makes it read as motion rather than as jitter is a property of these six functions: it
 * runs the full range whatever the section's height, it never overshoots, and it settles.
 * Asserting that here is cheaper than reading a transform out of a headless browser.
 */

describe('scrollProgress', () => {
  it('is 0 while the section is still below the fold', () => {
    expect(scrollProgress(900, 800, 800)).toBe(0);
  });

  it('is 1 once the section has passed above the viewport', () => {
    expect(scrollProgress(-900, 800, 800)).toBe(1);
  });

  it('is a half when the section is centred on the screen', () => {
    // top = (viewport - height) / 2 puts a shorter section in the middle of the screen.
    expect(scrollProgress(100, 600, 800)).toBeCloseTo(0.5, 10);
  });

  it('runs the full range for a section taller than the viewport', () => {
    const viewport = 800;
    const height = 2400;
    expect(scrollProgress(viewport, height, viewport)).toBe(0);
    expect(scrollProgress(-height, height, viewport)).toBe(1);
  });

  it('does not divide by zero on a section measured before layout', () => {
    expect(scrollProgress(0, 0, 0)).toBe(0);
  });
});

describe('lerp', () => {
  it('settles toward the target without overshooting', () => {
    let current = 0;
    for (let frame = 0; frame < 240; frame += 1) current = lerp(current, 100, 0.06);
    expect(current).toBeGreaterThan(99.9);
    expect(current).toBeLessThanOrEqual(100);
  });

  it('approaches from above as well as below, to under a pixel', () => {
    let current = 200;
    for (let frame = 0; frame < 240; frame += 1) current = lerp(current, -50, 0.04);
    expect(current).toBeGreaterThan(-50);
    expect(current + 50).toBeLessThan(0.05);
  });

  it('is a no-op once it has arrived', () => {
    expect(lerp(42, 42, 0.5)).toBe(42);
  });
});

describe('drift', () => {
  it('spans its whole range across the section', () => {
    expect(drift(0, 120, -160)).toBe(120);
    expect(drift(1, 120, -160)).toBe(-160);
    expect(drift(0.5, 120, -160)).toBe(-20);
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(drift(-3, 120, -160)).toBe(120);
    expect(drift(3, 120, -160)).toBe(-160);
  });
});

describe('driftTarget', () => {
  it('rests at home while the section is the subject', () => {
    expect(driftTarget(0.5, 0.12, 0.92, -240)).toBe(0);
  });

  it('waits off-screen before the window and returns to it after', () => {
    expect(driftTarget(0.05, 0.12, 0.92, -240)).toBe(-240);
    expect(driftTarget(0.97, 0.12, 0.92, -240)).toBe(-240);
  });

  it('excludes the boundaries, so a layer parked exactly on one is still away', () => {
    expect(driftTarget(0.12, 0.12, 0.92, -240)).toBe(-240);
    expect(driftTarget(0.92, 0.12, 0.92, -240)).toBe(-240);
  });
});

describe('presence', () => {
  it('is invisible at full travel and solid at home', () => {
    expect(presence(-240, 240)).toBe(0);
    expect(presence(0, 240)).toBe(1);
  });

  it('reads the same distance in either direction', () => {
    expect(presence(-90, 240)).toBe(presence(90, 240));
  });

  it('never goes negative when a layer is pushed past its own travel', () => {
    expect(presence(-1000, 240)).toBe(0);
  });
});

describe('clamp01', () => {
  it('bounds both ends and passes the middle through', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.37)).toBe(0.37);
  });
});
