import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether a display face has been dropped in for the landing page.
 *
 * The same contract `hero-video.ts` gives hero footage, and for the same reason: a webfont
 * fetched at build time would mean an offline clone cannot build the app, which is the failure
 * invariant I3 exists to rule out. A file committed to `public/fonts/` costs no network at any
 * point, and with no file the `--font-display` stack in `globals.css` falls through to the
 * system serif behind it.
 *
 * `@font-face` is emitted only when the file is there. Emitting it unconditionally would make
 * every page load ask for a font that does not exist, which is a 404 in the console of a
 * repository whose whole argument is that it does not overstate what it has.
 *
 * Answered once per server process. A file added while the server is running needs a restart,
 * which is the rule the rest of `public/` follows.
 */
const PUBLIC_PATH = join(process.cwd(), 'public', 'fonts', 'display.woff2');

const SRC = '/fonts/display.woff2';

let resolved: string | null | undefined;

export function displayFontSrc(): string | null {
  if (resolved === undefined) {
    resolved = existsSync(PUBLIC_PATH) ? SRC : null;
  }
  return resolved;
}

/** The rule that binds a present file to the family name `globals.css` asks for. */
export function displayFontFace(src: string): string {
  return `@font-face{font-family:'Kalibra Display';src:url('${src}') format('woff2');font-weight:300 700;font-style:normal;font-display:swap}`;
}
