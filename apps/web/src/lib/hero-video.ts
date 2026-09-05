import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether the hero has footage to play.
 *
 * The landing page ships with a drawn calibration field and no video file. Dropping an mp4 at
 * `apps/web/public/media/hero.mp4` and restarting the server puts it over the canvas; removing
 * it takes it away again. Asking the filesystem is what keeps the alternative from being a
 * request for a file that is not there on every single page load.
 *
 * Answered once per server process rather than per request. A file added while the server is
 * running needs a restart, which is the same rule the rest of `public/` follows.
 */
const PUBLIC_PATH = join(process.cwd(), 'public', 'media', 'hero.mp4');

const SRC = '/media/hero.mp4';

let resolved: string | null | undefined;

export function heroVideoSrc(): string | null {
  if (resolved === undefined) {
    resolved = existsSync(PUBLIC_PATH) ? SRC : null;
  }
  return resolved;
}
