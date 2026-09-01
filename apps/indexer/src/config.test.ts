import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig (ARCHITECTURE 6)', () => {
  it('runs offline with no configuration at all, which invariant I3 depends on', () => {
    expect(loadConfig({})).toEqual({ KALIBRA_MODE: 'replay', KALIBRA_DB_PATH: './kalibra.db' });
  });

  it('accepts an explicit mode and path', () => {
    expect(loadConfig({ KALIBRA_MODE: 'live', KALIBRA_DB_PATH: '/tmp/k.db' })).toEqual({
      KALIBRA_MODE: 'live',
      KALIBRA_DB_PATH: '/tmp/k.db',
    });
  });

  it('crashes on a malformed value rather than falling back to a default', () => {
    expect(() => loadConfig({ KALIBRA_MODE: 'LIVE' })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ KALIBRA_MODE: 'backfill' })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ KALIBRA_DB_PATH: '' })).toThrow(/invalid configuration/);
  });
});
