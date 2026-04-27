// ---------------------------------------------------------------------------
// `maestro update` — check for updates and optionally install the latest version
//
// Strategy:
//   1. Fetch latest version from npm registry
//   2. Compare with current installed version
//   3. Prompt user to install if update is available
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getPackageVersion } from '../utils/get-version.js';
import { getAllManifests } from '../core/manifest.js';
import { loadMigrations, planMigrations, runPendingMigrations } from '../utils/migration-registry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_NAME = 'maestro-flow';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const FETCH_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the latest published version from the npm registry.
 */
async function fetchLatestVersion(): Promise<{ version: string } | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return { version: (data.version as string) ?? '0.0.0' };
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Post-update: reinstall workflows
// ---------------------------------------------------------------------------

/**
 * After npm install, exec the NEW version of maestro to reinstall
 * previously installed workflow components. This ensures new-version
 * code and assets are used (current process still runs old code).
 */
async function reinstallWorkflows(version: string): Promise<void> {
  const manifests = getAllManifests();
  if (manifests.length === 0) return;

  console.error('');
  console.error('  Reinstalling workflow components...');

  // Deduplicate by scope + targetPath (latest manifest wins)
  const seen = new Set<string>();
  const deduped: { scope: string; targetPath: string; hookLevel: string; selectedComponentIds?: string[] }[] = [];
  for (const m of manifests) {
    const key = `${m.scope}:${m.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ scope: m.scope, targetPath: m.targetPath, hookLevel: m.hookLevel ?? 'none', selectedComponentIds: m.selectedComponentIds });
  }

  for (const { scope, targetPath, hookLevel, selectedComponentIds } of deduped) {
    const hooksArg = hookLevel !== 'none' ? ` --hooks ${hookLevel}` : '';
    const componentsArg = selectedComponentIds?.length ? ` --components ${selectedComponentIds.join(',')}` : '';
    if (scope === 'global') {
      try {
        await execAsync(`maestro install --force --global${hooksArg}${componentsArg}`);
        console.error(`  [+] Global components reinstalled (v${version})`);
      } catch (err) {
        console.error(`  [x] Global reinstall failed: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      if (!existsSync(targetPath)) {
        console.error(`  [-] Skipped ${targetPath} (directory not found)`);
        continue;
      }
      try {
        await execAsync(`maestro install --force --path "${targetPath}"${hooksArg}${componentsArg}`);
        console.error(`  [+] Project reinstalled: ${targetPath}`);
      } catch (err) {
        console.error(`  [x] Project reinstall failed (${targetPath}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-update: run migrations
// ---------------------------------------------------------------------------

/**
 * Apply migrations for a specific project path (non-interactive).
 * Used by `--migrate <path>` which runs on the NEW binary after npm update.
 */
async function applyMigrations(projectPath: string): Promise<void> {
  try {
    await loadMigrations();
  } catch {
    return;
  }

  const plan = planMigrations(projectPath);
  if (!plan) return;

  console.error(`  Migrations: v${plan.currentVersion} → v${plan.targetVersion}`);
  for (const step of plan.steps) {
    console.error(`    - ${step.name} (v${step.from} → v${step.to})`);
  }

  const { results } = runPendingMigrations(projectPath);
  for (const { step, result } of results) {
    const icon = result.success ? '+' : 'x';
    console.error(`  [${icon}] ${step.name}: ${result.summary}`);
    if (result.changes?.length) {
      for (const change of result.changes) {
        console.error(`      - ${change}`);
      }
    }
  }

  const failed = results.some(r => !r.result.success);
  if (failed) {
    console.error('  Migration completed with errors. Check backups in .workflow/');
  }
}

/**
 * Shell out to the NEW maestro binary to run migrations for all managed projects.
 * This ensures new-version migration code is used (current process runs old code).
 */
async function runMigrationsForAllProjects(): Promise<void> {
  const manifests = getAllManifests();
  const projectPaths = new Set<string>();

  for (const m of manifests) {
    if (m.scope === 'project' && existsSync(m.targetPath)) {
      projectPaths.add(m.targetPath);
    }
  }

  if (projectPaths.size === 0) return;

  console.error('');
  console.error('  Running workflow migrations...');

  for (const p of projectPaths) {
    try {
      const { stderr } = await execAsync(`maestro update --migrate "${p}"`);
      if (stderr.trim()) console.error(stderr.trim());
    } catch (err) {
      console.error(`  [x] Migration failed for ${p}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for updates and install the latest version')
    .option('--check', 'Only check for updates, do not install')
    .option('--migrate <path>', 'Run pending migrations for a project path')
    .action(async (opts: { check?: boolean; migrate?: string }) => {
      // Internal: --migrate runs migrations for a specific path via new binary
      if (opts.migrate) {
        await applyMigrations(opts.migrate);
        return;
      }

      console.error('');
      console.error('  Maestro Update');
      console.error('');

      const current = getPackageVersion();
      console.error(`  Current version:  ${current}`);

      // Fetch latest from npm
      console.error('  Checking npm registry...');
      const latest = await fetchLatestVersion();

      if (!latest) {
        console.error('  Could not reach the npm registry. Check your network connection.');
        console.error('');
        return;
      }

      console.error(`  Latest version:   ${latest.version}`);

      const cmp = compareSemver(latest.version, current);

      if (cmp <= 0) {
        console.error('');
        console.error('  You are on the latest version.');
        console.error('');
        return;
      }

      console.error('');
      console.error(`  Update available: ${current} → ${latest.version}`);

      if (opts.check) {
        console.error('');
        console.error(`  Run \`maestro update\` to install.`);
        console.error('');
        return;
      }

      // Prompt for confirmation
      const { confirm } = await import('@inquirer/prompts');
      const shouldInstall = await confirm({
        message: `Install ${PACKAGE_NAME}@${latest.version}?`,
        default: true,
      });

      if (!shouldInstall) {
        console.error('  Update cancelled.');
        console.error('');
        return;
      }

      console.error('');
      console.error(`  Installing ${PACKAGE_NAME}@${latest.version}...`);
      console.error('');

      try {
        const { stdout, stderr } = await execAsync(`npm install -g ${PACKAGE_NAME}@${latest.version}`);
        if (stdout.trim()) console.error(stdout.trim());
        if (stderr.trim()) console.error(stderr.trim());
        console.error('');
        console.error('  Update complete!');
      } catch (err) {
        console.error('  Installation failed.');
        if (err instanceof Error) {
          console.error(`  ${err.message}`);
        }
        console.error('');
        console.error(`  You can try manually: npm install -g ${PACKAGE_NAME}@${latest.version}`);
        console.error('');
        return;
      }

      // --- Post-update: reinstall workflow components ---
      await reinstallWorkflows(latest.version);

      // --- Post-update: run pending migrations via new binary ---
      await runMigrationsForAllProjects();

      console.error('');
    });
}
