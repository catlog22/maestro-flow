import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as coreSchema from './schema/core/index.js';
import { TenantMigrator } from './tenant-migrator.js';

export class TenantConnectionManager {
  private pool: Pool;

  constructor(
    databaseUrl: string,
    poolOptions?: { max?: number; idleTimeoutMillis?: number },
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: poolOptions?.max ?? 20,
      idleTimeoutMillis: poolOptions?.idleTimeoutMillis ?? 30000,
    });
  }

  async getTenantDb(tenantSlug: string): Promise<{
    db: NodePgDatabase<typeof coreSchema>;
    client: PoolClient;
  }> {
    if (!/^[a-z0-9_]+$/.test(tenantSlug)) {
      throw new Error(`Invalid tenant slug: ${tenantSlug}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query(`SET search_path TO "${tenantSlug}", public`);
    } catch (err) {
      // Release the client back to the pool before rethrowing; otherwise a
      // failed SET (broken connection, insufficient privilege) leaks a pool
      // slot and repeated failures can exhaust the pool (default max=20).
      client.release();
      throw err;
    }
    const db = drizzle(client, { schema: coreSchema });
    return { db, client };
  }

  async releaseTenantConnection(client: PoolClient): Promise<void> {
    try {
      await client.query('SET search_path TO public');
    } finally {
      client.release();
    }
  }

  async createNewTenant(slug: string, migrator: TenantMigrator): Promise<boolean> {
    if (!/^[a-z0-9_]+$/.test(slug)) {
      throw new Error(`Invalid tenant slug: ${slug}`);
    }

    // Run migrations for the new tenant
    await migrator.runMigrationForTenant(slug);

    // Verify schema was created
    const result = await this.pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [slug],
    );
    return result.rows.length > 0;
  }

  async removeTenant(slug: string): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(slug)) {
      throw new Error(`Invalid tenant slug: ${slug}`);
    }
    await this.pool.query(`DROP SCHEMA IF EXISTS "${slug}" CASCADE`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }
}
