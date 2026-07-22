import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import { TenantMigrator } from '../tenant-migrator.js';

// ---------------------------------------------------------------------------
// Fixture helpers — real temp dirs for the template directory, mocked Pool.
// ---------------------------------------------------------------------------

function makePool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  return { pool: pool as unknown as Pool, client, poolMock: pool };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tenant-migrator-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('TenantMigrator.runMigrationForTenant', () => {
  it('rejects an invalid slug without acquiring a connection', async () => {
    const { pool, poolMock } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);
    await expect(migrator.runMigrationForTenant('Bad-Slug!')).rejects.toThrow('Invalid tenant slug');
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('fails loudly when the template directory does not exist (no false success)', async () => {
    const { pool, poolMock } = makePool();
    const missing = join(tmpDir, 'does-not-exist');
    const migrator = new TenantMigrator(missing, pool);
    await expect(migrator.runMigrationForTenant('acme')).rejects.toThrow(
      /Cannot read migration template directory/,
    );
    // Must not touch the database for an unreadable template dir.
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('fails loudly when the template directory has no .sql files (no false success)', async () => {
    const { pool, poolMock } = makePool();
    // tmpDir exists but is empty
    const migrator = new TenantMigrator(tmpDir, pool);
    await expect(migrator.runMigrationForTenant('acme')).rejects.toThrow(
      /No \.sql migration templates found/,
    );
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('runs a valid migration with quoted identifiers and substitutes __tenant__', async () => {
    writeFileSync(join(tmpDir, '001_init.sql'), 'CREATE TABLE __tenant__.widgets (id int);');
    const { pool, client } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);

    await migrator.runMigrationForTenant('acme');

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "acme"');
    expect(calls).toContain('SET search_path TO "acme", public');
    expect(calls).toContain('CREATE TABLE acme.widgets (id int);');
    expect(calls).toContain('SET search_path TO public');
    // Migration record inserted with parameterized slug
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_migrations'),
      ['acme'],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client even when a SQL statement fails', async () => {
    writeFileSync(join(tmpDir, '001_init.sql'), 'CREATE TABLE x;');
    const { pool, client } = makePool();
    client.query.mockRejectedValue(new Error('syntax error'));
    const migrator = new TenantMigrator(tmpDir, pool);

    await expect(migrator.runMigrationForTenant('acme')).rejects.toThrow('syntax error');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('TenantMigrator.rollbackMigration', () => {
  it('rejects an invalid slug', async () => {
    const { pool } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);
    await expect(migrator.rollbackMigration('Bad-Slug!', 1)).rejects.toThrow('Invalid tenant slug');
  });

  it('drops the schema with a quoted identifier and removes the record', async () => {
    const { pool, client } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);
    await migrator.rollbackMigration('acme', 1);

    expect(client.query).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "acme" CASCADE');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tenant_migrations'),
      ['acme', 1],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('TenantMigrator.runMigrationForAllTenants', () => {
  it('migrates every tenant serially', async () => {
    writeFileSync(join(tmpDir, '001_init.sql'), 'CREATE TABLE __tenant__.t (id int);');
    const { pool, client, poolMock } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);

    await migrator.runMigrationForAllTenants(['acme', 'beta'], false);

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "acme"');
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "beta"');
    // One connection per tenant in serial mode.
    expect(poolMock.connect).toHaveBeenCalledTimes(2);
  });

  it('migrates every tenant in parallel', async () => {
    writeFileSync(join(tmpDir, '001_init.sql'), 'CREATE TABLE __tenant__.t (id int);');
    const { pool, client, poolMock } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);

    await migrator.runMigrationForAllTenants(['acme', 'beta', 'gamma'], true);

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "acme"');
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "beta"');
    expect(calls).toContain('CREATE SCHEMA IF NOT EXISTS "gamma"');
    expect(poolMock.connect).toHaveBeenCalledTimes(3);
  });

  it('propagates an error when any tenant slug is invalid', async () => {
    writeFileSync(join(tmpDir, '001_init.sql'), 'CREATE TABLE x;');
    const { pool } = makePool();
    const migrator = new TenantMigrator(tmpDir, pool);

    await expect(
      migrator.runMigrationForAllTenants(['acme', 'Bad-Slug!'], false),
    ).rejects.toThrow('Invalid tenant slug');
  });
});
