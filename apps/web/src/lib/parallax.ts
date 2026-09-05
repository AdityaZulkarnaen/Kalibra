/**
 * The arithmetic behind the dawn section's scroll parallax.
 *
 * Kept out of the component for the same reason `calibration-field.ts` is: the interesting
 * part is the numbers, and a function that reads `window` cannot be checked without a browser.
 * Nothing here touches the DOM, so the component is left holding only measurement and writes.
 */

/** Distance a layer travels is expressed as a fraction of this, not of the viewport. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How far a section has travelled through the viewport.
 *
 * 0 while its top edge is still below the fold, 1 once its bottom edge has passed the top of
 * the screen. Measured over `viewport + height` rather than over the section alone, so a
 * section taller than the screen and one shorter than it both run the full 0–1 range.
 */
export function scrollProgress(top: number, height: number, viewport: number): number {
  const travel = viewport + height;
  if (travel <= 0) return 0;
  return clamp01((viewport - top) / travel);
}

/**
 * One step of exponential smoothing toward `target`.
 *
 * The reader's scroll is the input and it arrives in jerks — a wheel notch is tens of pixels
 * at once. Moving a layer by a fraction of the remaining distance each frame is what turns
 * those steps into drift. `factor` is per frame rather than per second, which is the same
 * approximation the technique is normally written with; at 60fps a factor of 0.06 settles
 * visibly over about half a second.
 */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Map progress onto a layer's own travel, in pixels.
 *
 * `from` is where the layer sits when the section is still below the fold and `to` is where it
 * ends up once the section has left, so a layer that should appear to lag behind the page gets
 * a range narrower than the section's height and one that should outrun it gets a wider one.
 */
export function drift(progress: number, from: number, to: number): number {
  return from + (to - from) * clamp01(progress);
}

/**
 * Where a layer that enters and leaves should be, given a resting offset.
 *
 * Returns 0 while the section is the reader's subject and `offset` outside that window, which
 * is what makes the fog banks slide in from beyond the edges and retreat again rather than
 * hanging there at both ends of the page. The window is deliberately not the whole 0–1 range:
 * a bank that has already arrived by the time the section is on screen has no arrival to show.
 */
export function driftTarget(progress: number, entry: number, exit: number, offset: number): number {
  return progress > entry && progress < exit ? 0 : offset;
}

/**
 * How present a layer is, from how far it still has to travel.
 *
 * Tying opacity to distance rather than to progress is what keeps a fog bank from fading in
 * while it is still off-screen: it is invisible until it is nearly home, whichever direction
 * it is moving, and the same expression covers its exit.
 */
export function presence(distance: number, travel: number): number {
  if (travel <= 0) return 1;
  return clamp01(1 - Math.abs(distance) / travel);
}
