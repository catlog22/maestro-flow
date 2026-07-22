import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantConnectionManager } from '../connection-pool.js';

// ---------------------------------------------------------------------------
// Mocks — avoid a real PostgreSQL connection. The manager constructs a `pg`
// Pool internally, so we mock the Pool class and capture its surface.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  poolQuery: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  // Regular function (not arrow) so it can be used with `new`; returning an
  // object from a constructor replaces the default `this`.
  Pool: vi.fn(function (this: unknown) {
    return {
      connect: mocks.connect,
      query: mocks.poolQuery,
      end: mocks.end,
    };
  }),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn((client: unknown) => ({ __client: client })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TenantConnectionManager.getTenantDb', () => {
  it('rejects an invalid tenant slug without touching the pool', async () => {
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await expect(mgr.getTenantDb('Bad-Slug!')).rejects.toThrow('Invalid tenant slug');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('returns db + client on success and quotes the identifier', async () => {
    const client = { query: mocks.clientQuery, release: mocks.release };
    mocks.connect.mockResolvedValue(client);
    mocks.clientQuery.mockResolvedValue({ rows: [] });

    const mgr = new TenantConnectionManager('postgres://localhost/x');
    const { db, client: returned } = await mgr.getTenantDb('acme');

    expect(returned).toBe(client);
    expect(db).toBeDefined();
    expect(mocks.clientQuery).toHaveBeenCalledWith('SET search_path TO "acme", public');
    // Success path must NOT release — caller owns the client until releaseTenantConnection.
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('releases the client back to the pool when SET search_path fails (leak fix)', async () => {
    const client = { query: mocks.clientQuery, release: mocks.release };
    mocks.connect.mockResolvedValue(client);
    mocks.clientQuery.mockRejectedValue(new Error('connection lost'));

    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await expect(mgr.getTenantDb('acme')).rejects.toThrow('connection lost');

    // The leaked-slot regression: client must be released exactly once on failure.
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('TenantConnectionManager.removeTenant', () => {
  it('rejects an invalid slug', async () => {
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await expect(mgr.removeTenant('Bad-Slug!')).rejects.toThrow('Invalid tenant slug');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('drops the schema using a quoted identifier', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await mgr.removeTenant('acme');
    expect(mocks.poolQuery).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "acme" CASCADE');
  });
});

describe('TenantConnectionManager.releaseTenantConnection', () => {
  it('resets search_path and always releases', async () => {
    const client = { query: mocks.clientQuery, release: mocks.release };
    mocks.clientQuery.mockResolvedValue({ rows: [] });

    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await mgr.releaseTenantConnection(client as never);

    expect(mocks.clientQuery).toHaveBeenCalledWith('SET search_path TO public');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('releases even when the reset query fails', async () => {
    const client = { query: mocks.clientQuery, release: mocks.release };
    mocks.clientQuery.mockRejectedValue(new Error('boom'));

    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await expect(mgr.releaseTenantConnection(client as never)).rejects.toThrow('boom');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('TenantConnectionManager.createNewTenant', () => {
  function mockMigrator() {
    return { runMigrationForTenant: vi.fn().mockResolvedValue(undefined) };
  }

  it('rejects an invalid slug without running migrations', async () => {
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    const migrator = mockMigrator();
    await expect(mgr.createNewTenant('Bad-Slug!', migrator as never)).rejects.toThrow(
      'Invalid tenant slug',
    );
    expect(migrator.runMigrationForTenant).not.toHaveBeenCalled();
  });

  it('runs the migrator then verifies the schema exists (returns true)', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ schema_name: 'acme' }] });
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    const migrator = mockMigrator();

    const ok = await mgr.createNewTenant('acme', migrator as never);

    expect(migrator.runMigrationForTenant).toHaveBeenCalledWith('acme');
    // Verification uses a parameterized query (no identifier interpolation).
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM information_schema.schemata'),
      ['acme'],
    );
    expect(ok).toBe(true);
  });

  it('returns false when the schema was not created', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    const migrator = mockMigrator();

    const ok = await mgr.createNewTenant('acme', migrator as never);
    expect(ok).toBe(false);
  });
});

describe('TenantConnectionManager lifecycle', () => {
  it('close() ends the pool', async () => {
    mocks.end.mockResolvedValue(undefined);
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    await mgr.close();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('getPool() exposes the underlying pool', () => {
    const mgr = new TenantConnectionManager('postgres://localhost/x');
    expect(mgr.getPool()).toBeDefined();
  });
});
