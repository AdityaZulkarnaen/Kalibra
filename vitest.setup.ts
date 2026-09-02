import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strips the developer's `.env` back out of `process.env` before any test sees it.
 *
 * Vitest loads `.env` through Vite, so every variable in it lands in `process.env` for the
 * whole suite. That quietly couples the results to whatever the machine happens to be
 * configured for: pointing `KALIBRA_MODE` at live, or `KALIBRA_DB_PATH` at a real database,
 * changes what the tests exercise without changing a line of code. Invariant I3 says this
 * suite runs offline against committed fixtures, and a guarantee that depends on a file the
 * repository cannot see is not a guarantee.
 *
 * The keys come from `.env` itself rather than a list here, so a variable added later is
 * covered without anyone remembering. Tests that want configuration set it themselves,
 * explicitly, which is how every one of them already works.
 *
 * Resolved from the working directory rather than `import.meta.url`, because this file also
 * runs in the jsdom environment, where that is an http URL and not a path.
 */
let contents = '';
try {
  contents = readFileSync(join(process.cwd(), '.env'), 'utf8');
} catch {
  // No .env is the normal case, and the case CI runs in. Nothing to strip.
}

for (const line of contents.split('\n')) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const key = trimmed.slice(0, trimmed.indexOf('='));
  if (key !== '') delete process.env[key];
}
