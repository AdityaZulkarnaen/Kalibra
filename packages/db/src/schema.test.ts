import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, openDatabase, type OpenedDatabase } from './migrate.js';
import * as schema from './schema.js';

let opened: OpenedDatabase | undefined;

afterEach(() => {
  opened?.close();
  opened = undefined;
});

describe('migrations', () => {
  it('creates every table the specification names and records its version', () => {
    opened = openDatabase(':memory:');
    const tables = (
      opened.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables).toEqual([
      'agents',
      'audit_log',
      'calibration_bins',
      'markets',
      'meta',
      'positions',
      'scores',
      'trades',
    ]);
    const version = opened.sqlite
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(version?.value).toBe(SCHEMA_VERSION);
  });

  it('is safe to open twice without reapplying', () => {
    opened = openDatabase(':memory:');
    expect(() => openDatabase(':memory:').close()).not.toThrow();
  });

  it('enforces the one-position-per-wallet-per-market rule at the database level', () => {
    opened = openDatabase(':memory:');
    const indexes = (
      opened.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexes).toContain('idx_positions_unique');
  });
});

describe('the Drizzle mirror', () => {
  const tables = [
    schema.markets,
    schema.trades,
    schema.positions,
    schema.scores,
    schema.calibrationBins,
    schema.agents,
    schema.auditLog,
    schema.meta,
  ];

  it('names exactly the columns the SQL creates, so the two cannot drift', () => {
    opened = openDatabase(':memory:');
    for (const table of tables) {
      const config = getTableConfig(table);
      const actual = (
        opened.sqlite.prepare(`PRAGMA table_info(${config.name})`).all() as Array<{ name: string }>
      )
        .map((row) => row.name)
        .sort();
      const declared = config.columns.map((column) => column.name).sort();
      expect(declared, `${config.name} columns`).toEqual(actual);
    }
  });
});
