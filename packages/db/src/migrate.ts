import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

/** Bumped whenever `migrations/` gains a file. Stored in `meta` under `schema_version`. */
export const SCHEMA_VERSION = '1';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRATIONS = ['0001_init.sql'] as const;

export type KalibraDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenedDatabase {
  readonly db: KalibraDatabase;
  /** The raw handle, for pragmas and for closing. Prefer `db` for everything else. */
  readonly sqlite: Database.Database;
  close(): void;
}

/**
 * Opens a database and brings it up to `SCHEMA_VERSION`, creating it if absent. Pass
 * ':memory:' for a throwaway one.
 *
 * Migrations are plain SQL applied in a single transaction: either the schema is complete
 * or the file is untouched. A half-migrated database is the one state that would be worse
 * than no database at all, because it fails later and somewhere else.
 */
export function openDatabase(path: string): OpenedDatabase {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const applied = currentVersion(sqlite);
  if (applied !== SCHEMA_VERSION) {
    const statements = MIGRATIONS.map((name) =>
      readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
    ).join('\n');
    sqlite.transaction(() => {
      sqlite.exec(statements);
      sqlite
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('schema_version', SCHEMA_VERSION);
    })();
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

function currentVersion(sqlite: Database.Database): string | null {
  const metaExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (metaExists === undefined) return null;
  const row = sqlite.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    { value: string } | undefined;
  return row?.value ?? null;
}
