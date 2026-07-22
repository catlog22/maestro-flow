import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Pool } from 'pg';

export class TenantMigrator {
  constructor(
    private templateDir: string,
    private pool: Pool,
  ) {}

  async runMigrationForTenant(tenantSlug: string): Promise<void> {
    // Validate slug to prevent SQL injection
    if (!/^[a-z0-9_]+$/.test(tenantSlug)) {
      throw new Error(`Invalid tenant slug: ${tenantSlug}`);
    }

    // Read and validate template SQL files BEFORE touching the database, so a
    // missing/empty template directory fails loudly instead of creating an
    // empty schema that is then recorded as "migrated" (false success).
    const files = await this.getSqlFiles();
    if (files.length === 0) {
      throw new Error(
        `No .sql migration templates found in "${this.templateDir}"; refusing to record an empty migration as applied`,
      );
    }

    const client = await this.pool.connect();
    try {
      // Create schema if not exists
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${tenantSlug}"`);

      // Execute template SQL files
      for (const file of files.sort()) {
        const sqlPath = join(this.templateDir, file);
        const sqlContent = await readFile(sqlPath, 'utf-8');
        const migratedSql = sqlContent.replace(/__tenant__/g, tenantSlug);

        await client.query(`SET search_path TO "${tenantSlug}", public`);
        await client.query(migratedSql);
      }

      // Reset search_path
      await client.query('SET search_path TO public');

      // Record migration in public schema
      await client.query(
        `INSERT INTO tenant_migrations (tenant_slug, version, applied_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (tenant_slug, version) DO NOTHING`,
        [tenantSlug],
      );
    } finally {
      client.release();
    }
  }

  async runMigrationForAllTenants(slugs: string[], parallel = false): Promise<void> {
    if (parallel) {
      await Promise.all(slugs.map((slug) => this.runMigrationForTenant(slug)));
    } else {
      for (const slug of slugs) {
        await this.runMigrationForTenant(slug);
      }
    }
  }

  async rollbackMigration(tenantSlug: string, version: number): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(tenantSlug)) {
      throw new Error(`Invalid tenant slug: ${tenantSlug}`);
    }

    const client = await this.pool.connect();
    try {
      // Drop the schema (cascade to remove all objects)
      await client.query(`DROP SCHEMA IF EXISTS "${tenantSlug}" CASCADE`);

      // Remove migration record
      await client.query(
        `DELETE FROM tenant_migrations WHERE tenant_slug = $1 AND version = $2`,
        [tenantSlug, version],
      );
    } finally {
      client.release();
    }
  }

  private async getSqlFiles(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.templateDir);
    } catch (err) {
      // A missing/unreadable template directory must fail loudly. Silently
      // returning [] here previously let runMigrationForTenant create an empty
      // schema and record it as successfully migrated.
      throw new Error(
        `Cannot read migration template directory "${this.templateDir}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return entries.filter((f) => f.endsWith('.sql'));
  }
}
