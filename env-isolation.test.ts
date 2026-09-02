import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Invariant I3, defended at the point it is actually at risk.
 *
 * Vitest loads `.env` into `process.env`, so before `vitest.setup.ts` existed a developer
 * with live settings on their machine ran a different test suite from CI — against a real
 * database, with a live venue URL, and no failure to say so. The suite passed either way,
 * which is the worst shape a problem can take.
 *
 * This asserts the stripping actually happened. It is deliberately written against the real
 * `.env` rather than a fixture: the file on this machine is the thing that could leak.
 */
const envPath = join(process.cwd(), '.env');

const declaredKeys = (): string[] => {
  if (!existsSync(envPath)) return [];
  return readFileSync(envPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.slice(0, line.indexOf('=')))
    .filter((key) => key !== '');
};

describe('the test suite is insulated from a local .env', () => {
  it('leaves no variable that .env declares in the environment', () => {
    const leaked = declaredKeys().filter((key) => process.env[key] !== undefined);
    expect(leaked).toEqual([]);
  });

  it('never runs the suite in live mode, whatever the machine is configured for', () => {
    // The suite reaches no network. If this is ever 'live', something upstream is loading
    // configuration the tests were supposed to supply themselves.
    expect(process.env['KALIBRA_MODE']).toBeUndefined();
  });
});
