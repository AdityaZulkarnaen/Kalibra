import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig (ARCHITECTURE 6)', () => {
  it('runs offline with no configuration at all, which invariant I3 depends on', () => {
    const config = loadConfig({});
    expect(config.KALIBRA_MODE).toBe('replay');
    expect(config.KALIBRA_DB_PATH).toBe('./kalibra.db');
    // No default endpoint: replay must never be one typo away from reaching a network.
    expect(config.DREAMDEX_INDEXER_URL).toBeUndefined();
  });

  it('accepts an explicit mode, path and indexer', () => {
    const config = loadConfig({
      KALIBRA_MODE: 'live',
      KALIBRA_DB_PATH: '/tmp/k.db',
      DREAMDEX_INDEXER_URL: 'https://example.invalid/v1/graphql',
    });
    expect(config.KALIBRA_MODE).toBe('live');
    expect(config.KALIBRA_DB_PATH).toBe('/tmp/k.db');
    expect(config.DREAMDEX_INDEXER_URL).toBe('https://example.invalid/v1/graphql');
  });

  it('rejects an indexer URL that is not a URL', () => {
    expect(() => loadConfig({ DREAMDEX_INDEXER_URL: 'dev.smk.somnia.host' })).toThrow(
      /invalid configuration/,
    );
  });

  it('crashes on a malformed value rather than falling back to a default', () => {
    expect(() => loadConfig({ KALIBRA_MODE: 'LIVE' })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ KALIBRA_MODE: 'backfill' })).toThrow(/invalid configuration/);
    expect(() => loadConfig({ KALIBRA_DB_PATH: '' })).toThrow(/invalid configuration/);
  });
});
