/**
 * The simulation behind the hero backdrop: forecasts settling onto a reliability curve.
 *
 * This is the same geometry the product measures. `x` is the probability the book was quoting
 * and `y` is how often forecasts at that probability came true, so the diagonal is perfect
 * calibration and vertical distance from it is the miscalibration a score is docked for. The
 * curve is decorative in the sense that it plots nobody's record, and the hero says so — but
 * the shape it draws is the real one, not an abstract swarm.
 *
 * Kept out of the component so the motion can be tested without a canvas.
 */

/** How far the curve may bow away from the diagonal at its widest. */
const AMPLITUDE = 0.14;

/** Radians per second the bow travels through. Slow: this sits behind readable text. */
const RATE = 0.55;

/** Spring constant pulling a forecast onto the curve, and the friction that settles it. */
const STIFFNESS = 3.4;
const DAMPING = 0.9;

/** Probability drifts rightward, so a still field never looks frozen. */
const DRIFT = 0.014;

/** Seconds a settlement flash takes to fade. */
const FLASH_DECAY = 1.4;

export interface Forecast {
  /** The market's quoted probability. Also the horizontal position. */
  x: number;
  /** Observed frequency, chasing the curve. */
  y: number;
  vy: number;
  /** Stake, as a fraction of the wallet's own recent size. Drives the dot's area. */
  weight: number;
  /** Per-forecast offset, so the field does not pulse in unison. */
  phase: number;
  /** 1 immediately after this position settled, decaying to 0. */
  flash: number;
}

/**
 * Where a forecast of `x` lands at time `t`.
 *
 * Pinned to the diagonal at 0 and 1 because `sin(pi x)` vanishes there, which is the property
 * that makes the shape read as a calibration curve rather than as a sine wave laid over a plot.
 */
export function reliabilityCurve(x: number, t: number): number {
  const bow = AMPLITUDE * Math.sin(Math.PI * x) * Math.sin(t * RATE + x * 3.2);
  return Math.min(1, Math.max(0, x + bow));
}

/** A deterministic generator, so the field opens the same way on every load. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function createForecasts(count: number, random: () => number): Forecast[] {
  return Array.from({ length: count }, () => {
    const x = random();
    return {
      x,
      // Away from the curve at rest, so the first seconds show the field settling onto it.
      y: Math.min(1, Math.max(0, x + (random() - 0.5) * 0.55)),
      vy: 0,
      weight: 0.15 + random() * 0.85,
      phase: random() * Math.PI * 2,
      flash: 0,
    };
  });
}

/**
 * Advance the field by `dt` seconds.
 *
 * Mutates in place. This runs once per frame over a few hundred forecasts, and allocating a
 * replacement array each time is the one thing here that would show up in a profile.
 */
export function stepForecasts(forecasts: readonly Forecast[], t: number, dt: number): void {
  for (const forecast of forecasts) {
    forecast.x += DRIFT * dt * (0.4 + forecast.weight);
    if (forecast.x > 1) forecast.x -= 1;

    const target = reliabilityCurve(forecast.x, t + forecast.phase);
    forecast.vy += (target - forecast.y) * STIFFNESS * dt;
    forecast.vy *= DAMPING;
    forecast.y += forecast.vy;

    forecast.flash = Math.max(0, forecast.flash - dt / FLASH_DECAY);
  }
}

/**
 * Resolve one position: it settles to a binary outcome and re-enters as a new forecast.
 *
 * The flash is the only moment in the animation that stands for an event rather than a state,
 * which is why it is loud relative to everything else on the field.
 */
export function settle(forecast: Forecast, random: () => number): void {
  forecast.x = random();
  forecast.y = Math.min(1, Math.max(0, forecast.x + (random() - 0.5) * 0.5));
  forecast.vy = 0;
  forecast.weight = 0.15 + random() * 0.85;
  forecast.flash = 1;
}
