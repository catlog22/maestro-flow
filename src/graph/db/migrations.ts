import type { DatabaseConnection } from './connection.js';

export const CURRENT_SCHEMA_VERSION = 1;

interface Migration {
  version: number;
  description: string;
  up: (conn: DatabaseConnection) => void;
}

const MIGRATIONS: Migration[] = [
  // Version 1 is the initial schema loaded from schema.sql
];

export function needsMigration(conn: DatabaseConnection): boolean {
  return conn.getSchemaVersion() < CURRENT_SCHEMA_VERSION;
}

export function runMigrations(conn: DatabaseConnection): void {
  const current = conn.getSchemaVersion();
  const pending = MIGRATIONS.filter(m => m.version > current);

  for (const migration of pending) {
    conn.transaction(() => {
      migration.up(conn);
      conn.raw.prepare(
        'INSERT OR REPLACE INTO schema_versions (version, description) VALUES (?, ?)'
      ).run(migration.version, migration.description);
    });
  }
}
