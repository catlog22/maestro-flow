// ---------------------------------------------------------------------------
// `maestro update` — check for updates and optionally install the latest version
//
// Strategy:
//   1. Fetch latest version from npm registry
//   2. Compare with current installed version
//   3. Prompt user to install if update is available
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { exec, execSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, rmSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPackageVersion } from '../utils/get-version.js';
import { getAllManifests } from '../core/manifest.js';
import { manifestToProfile } from '../core/install-profile.js';
import { loadMigrations, planMigrations, runPendingMigrations } from '../utils/migration-registry.js';
import { applyNotices, planNotices, printNoticePlan } from '../utils/update-notices.js';

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

/**
 * Detect if the global maestro-flow install is an npm-link symlink.
 * Returns the link target (source directory) or null.
 */
function getLinkedSourceDir(): string | null {
  try {
    const globalPrefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
    const pkgDir = join(globalPrefix, 'node_modules', PACKAGE_NAME);
    if (!existsSync(pkgDir)) return null;
    const stat = lstatSync(pkgDir);
    if (!stat.isSymbolicLink()) return null;
    return readlinkSync(pkgDir);
  } catch {
    return null;
  }
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
// Pre-update: stop view server
// ---------------------------------------------------------------------------

const VIEW_SERVER_PORT = 3001;

async function checkViewServer(): Promise<{ status: string; workspace?: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${VIEW_SERVER_PORT}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return await res.json() as { status: string; workspace?: string };
    return null;
  } catch {
    return null;
  }
}

async function stopViewServer(): Promise<boolean> {
  const health = await checkViewServer();
  if (!health) return false;

  console.error('  Stopping view server to avoid file locks...');

  try {
    await fetch(`http://127.0.0.1:${VIEW_SERVER_PORT}/api/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    await new Promise(r => setTimeout(r, 1000));
  } catch {
    // Connection refused = server already stopped
  }

  if (!(await checkViewServer())) {
    console.error('  View server stopped.');
    return true;
  }

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${VIEW_SERVER_PORT}`);
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[3] === 'LISTENING') {
          const localAddr = parts[1] ?? '';
          if (localAddr.endsWith(`:${VIEW_SERVER_PORT}`)) {
            const pid = parts[4];
            if (pid && /^[1-9]\d*$/.test(pid)) {
              await execAsync(`taskkill /PID ${pid} /T /F`);
              break;
            }
          }
        }
      }
    } else {
      const { stdout } = await execAsync(`lsof -i :${VIEW_SERVER_PORT} -t -sTCP:LISTEN`);
      const pid = stdout.trim().split('\n')[0]?.trim();
      if (pid && /^[1-9]\d*$/.test(pid)) {
        await execAsync(`kill -TERM ${pid}`);
      }
    }
    await new Promise(r => setTimeout(r, 500));
    console.error('  View server stopped.');
  } catch {
    console.error('  Warning: could not stop view server. Run `maestro stop` manually if update fails.');
  }

  return true;
}

// ---------------------------------------------------------------------------
// Post-update: reinstall workflows
// ---------------------------------------------------------------------------

/**
 * After npm install, export each manifest as a profile JSON and hand it
 * to the NEW version of maestro via `install --import --upgrade`.
 *
 * Using a profile file instead of CLI args avoids:
 *   - Windows command-line length limits (~8192 chars)
 *   - Shell escaping issues with paths
 *   - Loss of custom hook selections (only level was passed before)
 *
 * The `--upgrade` flag tells the new binary to merge newly added
 * default-selected components into the existing selection and prune
 * prior-owned files that the current package no longer produces.
 */
async function reinstallWorkflows(version: string): Promise<void> {
  const manifests = getAllManifests();
  if (manifests.length === 0) return;

  console.error('');
  console.error('  Reinstalling workflow components...');

  // Deduplicate by scope + targetPath (latest manifest wins)
  const seen = new Set<string>();
  const deduped: typeof manifests = [];
  for (const m of manifests) {
    const key = `${m.scope}:${m.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  const tmpDir = join(tmpdir(), 'maestro-reinstall');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  for (const m of deduped) {
    if (m.scope === 'project' && !existsSync(m.targetPath)) {
      console.error(`  [-] Skipped ${m.targetPath} (directory not found)`);
      continue;
    }

    const profile = manifestToProfile(m);
    const profilePath = join(tmpDir, `reinstall-${m.id}.json`);
    writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

    const args = ['install', '--import', profilePath, '--upgrade'];
    if (m.scope === 'global') {
      args.push('--global');
    } else {
      args.push('--path', m.targetPath);
    }

    const label = m.scope === 'global' ? 'Global' : m.targetPath;
    try {
      await spawnAsync('maestro', args);
      console.error(`  [+] ${label} reinstalled (v${version})`);
      try { unlinkSync(profilePath); } catch { /* ignore */ }
    } catch (err) {
      console.error(`  [x] ${label} reinstall failed: ${err instanceof Error ? err.message : err}`);
      console.error(`      Profile saved: ${profilePath}`);
    }
  }

  // Clean up empty temp dir
  try {
    if (readdirSync(tmpDir).length === 0) rmSync(tmpDir);
  } catch { /* ignore */ }
}

/**
 * Re-register native plugin if any manifest has plugin.claude or plugin.codex.
 * Calls the NEW binary's `maestro plugin install` so it picks up new skills.
 */
async function reinstallPlugin(): Promise<void> {
  const manifests = getAllManifests();
  const hasPlugin = manifests.some(m => m.plugin?.claude || m.plugin?.codex);
  if (!hasPlugin) return;

  console.error('');
  console.error('  Re-registering native plugin...');

  try {
    const args: string[] = ['plugin', 'install'];
    await spawnAsync('maestro', args);
    console.error('  [+] Plugin re-registered');
  } catch (err) {
    console.error(`  [x] Plugin re-registration failed: ${err instanceof Error ? err.message : err}`);
    console.error('      Run `maestro plugin install` manually.');
  }
}

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exit code ${code}`)));
    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Post-update: apply version-keyed notices (new features, optional installs)
// ---------------------------------------------------------------------------

/**
 * Shell out to the NEW binary to apply notices for the upgrade range
 * (oldVersion, newVersion]. The new binary's registry has the notice entries
 * for this release; the running parent process can't see them.
 */
async function runNoticesViaNewBinary(oldVersion: string, opts: { nonInteractive?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const flags: string[] = ['--notices', '--from', oldVersion];
  if (opts.nonInteractive) flags.push('--non-interactive');
  if (opts.dryRun) flags.push('--dry-run');
  // Stream stdio so the user sees prompts and answers them live.
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve) => {
    const child = spawn('maestro', ['update', ...flags], { stdio: 'inherit', shell: true });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
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
    .option('--notices', 'Apply pending version-keyed notices (new tools/skills/features)')
    .option('--from <version>', 'Lower bound for --notices (default: 0.0.0)')
    .option('--to <version>', 'Upper bound for --notices (default: current binary version)')
    .option('--dry-run', 'With --notices: list actions without executing them')
    .option('--non-interactive', 'With --notices: skip prompts, use defaults')
    .action(async (opts: {
      check?: boolean;
      migrate?: string;
      notices?: boolean;
      from?: string;
      to?: string;
      dryRun?: boolean;
      nonInteractive?: boolean;
    }) => {
      // Internal: --migrate runs migrations for a specific path via new binary
      if (opts.migrate) {
        await applyMigrations(opts.migrate);
        return;
      }

      // Standalone: apply notices for a version range — no npm install
      if (opts.notices) {
        const from = opts.from ?? '0.0.0';
        const to = opts.to ?? getPackageVersion();
        const plan = planNotices(from, to);
        if (plan.length === 0) {
          console.error('  No pending update notices.');
          return;
        }
        if (opts.dryRun) {
          printNoticePlan(plan);
          return;
        }
        console.error('');
        console.error(`  Applying notices for v${from} → v${to}`);
        await applyNotices(plan, from, to, {
          dryRun: opts.dryRun,
          nonInteractive: opts.nonInteractive,
        });
        console.error('');
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

      const linkedDir = getLinkedSourceDir();
      const viewServerWasRunning = await stopViewServer();

      console.error('');

      if (linkedDir) {
        console.error(`  Linked install detected → ${linkedDir}`);
        console.error(`  Updating via git pull + rebuild...`);
        console.error('');

        try {
          const { stdout: pullOut, stderr: pullErr } = await execAsync(`git -C "${linkedDir}" pull --ff-only`);
          if (pullOut.trim()) console.error(pullOut.trim());
          if (pullErr.trim()) console.error(pullErr.trim());
        } catch (err) {
          console.error('  git pull failed.');
          if (err instanceof Error) console.error(`  ${err.message}`);
          console.error('');
          console.error(`  You can try manually: cd ${linkedDir} && git pull && npm run build`);
          if (viewServerWasRunning) {
            console.error('  Warning: view server was stopped — restart it manually if needed.');
          }
          console.error('');
          return;
        }

        try {
          console.error('');
          console.error('  Rebuilding...');
          const { stdout: buildOut, stderr: buildErr } = await execAsync(`npm run build --prefix "${linkedDir}"`);
          if (buildOut.trim()) console.error(buildOut.trim());
          if (buildErr.trim()) console.error(buildErr.trim());
          console.error('');
          console.error('  Update complete!');
        } catch (err) {
          console.error('  Build failed.');
          if (err instanceof Error) console.error(`  ${err.message}`);
          console.error('');
          console.error(`  You can try manually: cd ${linkedDir} && npm run build`);
          if (viewServerWasRunning) {
            console.error('  Warning: view server was stopped — restart it manually if needed.');
          }
          console.error('');
          return;
        }
      } else {
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
          if (err instanceof Error) console.error(`  ${err.message}`);
          console.error('');
          console.error(`  You can try manually: npm install -g ${PACKAGE_NAME}@${latest.version}`);
          if (viewServerWasRunning) {
            console.error('  Warning: view server was stopped — restart it manually if needed.');
          }
          console.error('');
          return;
        }
      }

      // --- Post-update: reinstall workflow components ---
      await reinstallWorkflows(latest.version);

      // --- Post-update: re-register native plugin if previously installed ---
      await reinstallPlugin();

      // --- Post-update: apply version-keyed notices via new binary ---
      // (runs the new binary so its notice registry is the source of truth)
      await runNoticesViaNewBinary(current);

      // --- Post-update: run pending migrations via new binary ---
      await runMigrationsForAllProjects();

      if (viewServerWasRunning) {
        console.error('');
        console.error('  Note: view server was stopped for the update — restart it manually if needed.');
      }

      console.error('');
    });
}
