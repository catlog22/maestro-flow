// ---------------------------------------------------------------------------
// `maestro collab` — human-team collaboration CLI (team-lite, Waves 2 + 3A)
//
// Subcommands:
//   maestro collab join      [--role admin|member]
//   maestro collab whoami
//   maestro collab report    --action <name> [--phase <n>] [--task-id <id>] [--target <s>]
//   maestro collab status    [--window <minutes>]
//   maestro collab sync      [--dry-run]
//   maestro collab preflight --phase <n> [--force] [--json]
//   maestro collab task    create --title <t> [--description] [--priority] [--tags]
//   maestro collab task    list   [--status <s>] [--assignee <uid>]
//   maestro collab task    show   <task-id>
//   maestro collab task    status <task-id> <status>
//   maestro collab task    assign <task-id> <uid>
//   maestro collab task    check  <task-id> --action <a> [--comment <text>]
//
// Namespace: writes only to `.workflow/collab/**`. Never touches
// `.workflow/.team/` (that belongs to the agent pipeline, see team-msg.ts).
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  joinTeam,
  resolveSelf,
  requireRole,
  requireTeamMode,
  getMemberByUid,
  type MemberRecord,
  addProjectRole,
  removeProjectRole,
  listProjectRoles,
} from '../tools/team-members.js';
import {
  reportActivity,
  readRecentActivity,
  rotateIfNeeded,
  type ActivityEvent,
} from '../tools/team-activity.js';
import {
  runPreflight,
  type PreflightResult,
} from '../hooks/preflight-core.js';
import {
  importBundle,
  type OverlayBundle,
} from '../core/overlay/applier.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTaskStatus,
  assignTask,
  addCheckEntry,
  type TaskStatus,
  type TaskPriority,
  type CheckAction,
} from '../tools/team-tasks.js';
import { paths } from '../config/paths.js';
import { getProjectRoot } from '../utils/path-validator.js';
import { CATEGORY_MAP, TEAM_SPECS_DIR } from '../tools/spec-loader.js';
import { getNamespaceBoundaries } from '../tools/namespace-guard.js';

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------

function runJoin(opts: { role?: string }): void {
  const existing = resolveSelf();

  let role: 'admin' | 'member' | undefined;
  if (opts.role === 'admin' || opts.role === 'member') {
    role = opts.role;
  } else if (opts.role !== undefined) {
    console.error(`Error: --role must be "admin" or "member" (got "${opts.role}")`);
    process.exit(1);
  }

  let record: MemberRecord;
  try {
    record = joinTeam(role ? { role } : undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  const verb = existing ? 'Already joined' : 'Joined';
  console.log(
    `${verb} as ${record.uid} <${record.email}> on ${record.host} (${record.role})`,
  );
}

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------

function runWhoami(): void {
  const self = resolveSelf();
  if (!self) {
    console.error("Team mode not enabled. Run 'maestro team join' first.");
    process.exit(1);
    return;
  }
  console.log(`uid:    ${self.uid}`);
  console.log(`name:   ${self.name}`);
  console.log(`email:  ${self.email}`);
  console.log(`host:   ${self.host}`);
  console.log(`role:   ${self.role}`);
  console.log(`joined: ${self.joinedAt}`);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function runReport(opts: {
  action: string;
  phase?: string;
  taskId?: string;
  target?: string;
}): void {
  // Hooks call this; missing team is not an error — exit 0 silently.
  const self = resolveSelf();
  if (!self) return;

  let phase_id: number | undefined;
  if (opts.phase !== undefined) {
    const n = Number.parseInt(opts.phase, 10);
    if (!Number.isNaN(n)) phase_id = n;
  }

  reportActivity({
    user: self.uid,
    host: self.host,
    action: opts.action,
    phase_id,
    task_id: opts.taskId,
    target: opts.target,
  });
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function runStatus(opts: { window?: string }): void {
  const self = resolveSelf();
  if (!self) {
    console.error('Team mode not enabled.');
    process.exit(1);
    return;
  }

  let window = 30;
  if (opts.window !== undefined) {
    const n = Number.parseInt(opts.window, 10);
    if (Number.isFinite(n) && n > 0) window = n;
  }

  const events = readRecentActivity(window);
  if (events.length === 0) {
    console.log(`No team activity in last ${window} min.`);
    return;
  }

  // Group by user@host, pick latest event per group.
  const latest = new Map<string, ActivityEvent>();
  for (const e of events) {
    const key = `${e.user}@${e.host}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(e.ts) > Date.parse(prev.ts)) {
      latest.set(key, e);
    }
  }

  // Sort by ts descending — most recent first.
  const rows = Array.from(latest.entries()).sort(
    (a, b) => Date.parse(b[1].ts) - Date.parse(a[1].ts),
  );

  console.log(`Active in last ${window} min:`);
  const now = Date.now();
  for (const [key, evt] of rows) {
    const user = pad(key, 20);
    const action = pad(evt.action, 18);
    const loc = pad(formatLocation(evt), 18);
    const rel = formatRelative(now - Date.parse(evt.ts));
    console.log(`  ${user}  ${action}  ${loc}  ${rel}`);
  }
}

function formatLocation(e: ActivityEvent): string {
  if (e.phase_id !== undefined && e.task_id) return `P${e.phase_id}/${e.task_id}`;
  if (e.phase_id !== undefined) return `P${e.phase_id}`;
  if (e.task_id) return e.task_id;
  if (e.target) return e.target;
  return '-';
}

function formatRelative(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

// ---------------------------------------------------------------------------
// overlay sync — import team bundles from .workflow/collab/overlays/
// ---------------------------------------------------------------------------

/** Manifest tracking last-imported bundle timestamps per member. */
interface OverlaySyncManifest {
  /** Map of member uid to last imported ISO timestamp. */
  imported: Record<string, string>;
}

/**
 * Scan `.workflow/collab/overlays/` for bundle files from other team members,
 * import bundles that are newer than previously imported, and update manifest.
 *
 * Returns counts of imported and skipped bundles.
 */
export function syncOverlays(
  projectRoot: string,
  selfUid: string,
): { imported: number; skipped: number } {
  const collabOverlaysDir = join(projectRoot, '.workflow', 'collab', 'overlays');
  if (!existsSync(collabOverlaysDir)) {
    return { imported: 0, skipped: 0 };
  }

  // Load sync manifest
  const manifestPath = join(collabOverlaysDir, 'manifest.json');
  let manifest: OverlaySyncManifest = { imported: {} };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as OverlaySyncManifest;
    } catch {
      // Corrupted manifest — start fresh
      manifest = { imported: {} };
    }
  }

  const overlayDir = join(paths.home, 'overlays');
  let imported = 0;
  let skipped = 0;

  // Scan for bundle files
  let entries: string[];
  try {
    entries = readdirSync(collabOverlaysDir);
  } catch {
    return { imported: 0, skipped: 0 };
  }

  for (const entry of entries) {
    if (!entry.endsWith('-bundle.json')) continue;

    const bundlePath = join(collabOverlaysDir, entry);
    let bundle: OverlayBundle;
    try {
      bundle = JSON.parse(readFileSync(bundlePath, 'utf-8')) as OverlayBundle;
    } catch {
      skipped++;
      continue;
    }

    // Skip own bundles
    if (bundle.sourceMember === selfUid) {
      skipped++;
      continue;
    }

    // Skip bundles without team metadata
    if (!bundle.sourceMember || !bundle.ts) {
      skipped++;
      continue;
    }

    // Check if we already imported this version
    const lastImported = manifest.imported[bundle.sourceMember];
    if (lastImported && lastImported >= bundle.ts) {
      skipped++;
      continue;
    }

    // Import the bundle
    try {
      importBundle(bundlePath, overlayDir);
      manifest.imported[bundle.sourceMember] = bundle.ts;
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Warning: failed to import bundle from ${bundle.sourceMember}: ${msg}`);
      skipped++;
    }
  }

  // Save updated manifest
  if (imported > 0) {
    if (!existsSync(collabOverlaysDir)) mkdirSync(collabOverlaysDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// sync -- fast-path detection
// ---------------------------------------------------------------------------

/**
 * Attempt SHA-based fast-path detection. Runs git fetch origin, then
 * compares local HEAD with upstream tracking ref to decide if the full
 * stash/pull/push cycle can be shortened.
 *
 * Returns:
 *   'skip'      -- local and remote are identical; nothing to do.
 *   'push-only' -- remote is ancestor of local; only push needed.
 *   'pull-only' -- local is ancestor of remote; skip push step.
 *   null        -- cannot determine; fall through to full sync.
 *
 * Any error falls through to full sync (returns null) so this never
 * introduces new failure modes.
 */
function tryFastPath(
  dry: boolean,
  say: (s: string) => void,
  self: MemberRecord,
  dirty: boolean,
): 'skip' | 'push-only' | 'pull-only' | null {
  try {
    say('Fetching from origin...');
    if (!dry) {
      execSync('git fetch origin', { stdio: 'inherit' });
    }

    // Read local and upstream SHAs.
    const localSha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    let remoteSha: string;
    try {
      remoteSha = execSync('git rev-parse @{u}', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // No upstream tracking ref configured -- cannot fast-path.
      say('No upstream tracking ref; falling through to full sync.');
      return null;
    }

    // SKIP: identical SHAs.
    if (localSha === remoteSha) {
      if (dirty) {
        say('Already up to date (working tree has uncommitted changes, nothing to sync).');
      } else {
        say('Already up to date.');
      }
      reportActivity({
        user: self.uid,
        host: self.host,
        action: 'sync-skip',
      });
      return 'skip';
    }

    if (dry) {
      // In dry-run we cannot reliably run merge-base checks after a
      // skipped fetch, but we can still show the SHA mismatch.
      say(`Local HEAD ${localSha.slice(0, 8)} differs from upstream ${remoteSha.slice(0, 8)}.`);
      // Fall through so the full dry-run plan is printed.
      return null;
    }

    // PULL-ONLY: local is ancestor of remote (remote has new commits, local doesn't).
    try {
      execSync('git merge-base --is-ancestor HEAD @{u}', {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      // Local is ancestor of remote -- only need to pull.
      say('Local is behind upstream; skipping push.');
      reportActivity({
        user: self.uid,
        host: self.host,
        action: 'sync-pull-only',
      });
      return 'pull-only';
    } catch {
      // Not an ancestor -- check the other direction.
    }

    // PUSH-ONLY: remote is ancestor of local (local has new commits, remote doesn't).
    try {
      execSync('git merge-base --is-ancestor @{u} HEAD', {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      // Remote is ancestor of local -- only need to push.
      say('Upstream is behind local; skipping pull.');
      reportActivity({
        user: self.uid,
        host: self.host,
        action: 'sync-push-only',
      });
      return 'push-only';
    } catch {
      // Diverged -- need full sync.
    }

    // Diverged history -- full sync needed.
    say('Local and upstream have diverged; running full sync.');
    return null;
  } catch (err) {
    // Any unexpected error: log and fall through to full sync.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Warning: fast-path detection failed (${msg}); running full sync.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

/**
 * `maestro team sync` — wrap git stash/pull --rebase/pop/push and trigger
 * activity.jsonl rotation. Uses `stdio: 'inherit'` so users see git output.
 *
 * Exit codes:
 *   0 — success
 *   1 — team mode not enabled
 *   2 — rebase failed (aborted + stash restored)
 *   3 — push rejected twice in a row
 *   4 — stash pop conflict (left in conflict state for user to resolve)
 *   5 — detached HEAD
 */
function runSync(opts: { dryRun?: boolean; withOverlays?: boolean }): void {
  let self: MemberRecord;
  try {
    self = requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  // Detached HEAD check.
  try {
    execSync('git symbolic-ref --quiet HEAD', { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    console.error(
      'Error: detached HEAD. Checkout a branch before running `maestro team sync`.',
    );
    process.exit(5);
    return;
  }

  const dry = opts.dryRun === true;

  const say = (s: string): void => {
    console.log(dry ? `[dry-run] ${s}` : s);
  };

  // Dirty check: capture porcelain output (NOT inherited, we need the string).
  let dirty = false;
  try {
    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dirty = porcelain.trim().length > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: failed to read git status: ${msg}`);
    process.exit(2);
    return;
  }

  // Fast path: fetch + SHA comparison to skip unnecessary steps.
  const fastPath = tryFastPath(dry, say, self, dirty);
  if (fastPath === 'skip') {
    return;
  }
  if (fastPath === 'push-only') {
    // Skip stash/pull, jump straight to push.
    say('Pushing...');
    if (!dry) {
      const tryPush = (): boolean => {
        try {
          execSync('git push', { stdio: 'inherit' });
          return true;
        } catch {
          return false;
        }
      };

      if (!tryPush()) {
        console.error('Push rejected. Falling through to full sync...');
        // Fall through below to full sync cycle.
      } else {
        // Rotation check.
        const archivePath = rotateIfNeeded(10 * 1024 * 1024);
        if (archivePath) {
          console.log(`Rotated activity.jsonl -> ${archivePath}`);
        }
        console.log('Sync complete (push-only fast path).');
        return;
      }
    } else {
      say('Would check activity.jsonl rotation (10 MB threshold).');
      console.log('[dry-run] Sync plan complete (push-only fast path).');
      return;
    }
  }
  if (fastPath === 'pull-only') {
    // No local-only commits; skip push after pull.
    // Still need stash/pull/pop, but can skip push.
    // Fall through to full sync but mark that push can be skipped.
  }

  // Track whether push should be skipped (pull-only fast path).
  const skipPush = fastPath === 'pull-only';

  let stashed = false;

  // Step 1: stash if dirty.
  if (dirty) {
    say('Stashing local changes (maestro-team-sync-auto)...');
    if (!dry) {
      try {
        execSync('git stash push -m "maestro-team-sync-auto"', { stdio: 'inherit' });
        stashed = true;
      } catch {
        console.error('Error: git stash failed.');
        process.exit(2);
        return;
      }
    }
  }

  // Step 2: pull --rebase.
  say('Pulling from origin/HEAD (rebase)...');
  if (!dry) {
    try {
      execSync('git pull --rebase origin HEAD', { stdio: 'inherit' });
    } catch {
      console.error('Error: rebase failed. Aborting rebase and restoring stash.');
      try {
        execSync('git rebase --abort', { stdio: 'inherit' });
      } catch {
        // Best-effort; rebase --abort may fail if no rebase in progress.
      }
      if (stashed) {
        try {
          execSync('git stash pop', { stdio: 'inherit' });
        } catch {
          console.error('Warning: failed to restore stash. Run `git stash pop` manually.');
        }
      }
      process.exit(2);
      return;
    }
  }

  // Step 3: push (with one retry on non-fast-forward).
  // Skipped when pull-only fast path detected (local has no unique commits).
  if (skipPush) {
    say('Push skipped (pull-only fast path -- no local-only commits).');
  } else {
    say('Pushing...');
    if (!dry) {
      const tryPush = (): boolean => {
        try {
          execSync('git push', { stdio: 'inherit' });
          return true;
        } catch {
          return false;
        }
      };

      if (!tryPush()) {
        console.error('Push rejected. Retrying pull --rebase + push once...');
        try {
          execSync('git pull --rebase origin HEAD', { stdio: 'inherit' });
        } catch {
          console.error('Error: retry rebase failed.');
          if (stashed) {
            try {
              execSync('git stash pop', { stdio: 'inherit' });
            } catch {
              // Best-effort.
            }
          }
          process.exit(3);
          return;
        }
        if (!tryPush()) {
          console.error('Error: push still rejected after retry.');
          if (stashed) {
            try {
              execSync('git stash pop', { stdio: 'inherit' });
            } catch {
              // Best-effort.
            }
          }
          process.exit(3);
          return;
        }
      }
    }
  }

  // Step 4: stash pop.
  // TODO: wire commit tag if sync ever authors its own commit
  //       (design doc 耦合 4 — downscoped: sync produces no user commits).
  if (stashed) {
    say('Restoring stashed changes...');
    if (!dry) {
      try {
        execSync('git stash pop', { stdio: 'inherit' });
      } catch {
        console.error(
          'Error: stash pop produced conflicts. Resolve them manually ' +
            '(see `git status`), then commit. Your changes are in the stash.',
        );
        process.exit(4);
        return;
      }
    }
  }

  // Step 5: rotation check.
  if (!dry) {
    const archivePath = rotateIfNeeded(10 * 1024 * 1024);
    if (archivePath) {
      console.log(`Rotated activity.jsonl -> ${archivePath}`);
    }
  } else {
    say('Would check activity.jsonl rotation (10 MB threshold).');
  }

  // Step 6: post-sync overlay import (when --with-overlays is set).
  if (opts.withOverlays) {
    say('Importing team overlay bundles...');
    if (!dry) {
      const result = syncOverlays(getProjectRoot(), self.uid);
      if (result.imported > 0) {
        console.log(`Imported ${result.imported} overlay bundle(s) from teammates.`);
      }
      if (result.skipped > 0) {
        console.log(`Skipped ${result.skipped} overlay bundle(s) (own/unchanged/invalid).`);
      }
      if (result.imported === 0 && result.skipped === 0) {
        console.log('No team overlay bundles found.');
      }
    } else {
      say('Would scan .workflow/collab/overlays/ for team bundles.');
    }
  }

  const suffix = skipPush ? ' (pull-only fast path)' : '';
  console.log(dry ? `[dry-run] Sync plan complete${suffix}.` : `Sync complete${suffix}.`);
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

// runPreflight and PreflightResult are imported from '../hooks/preflight-core.js'
// and re-exported for backward compatibility.
export { runPreflight, type PreflightResult } from '../hooks/preflight-core.js';

function runPreflightCli(opts: {
  phase?: string;
  force?: boolean;
  json?: boolean;
}): void {
  // Team mode off is a silent no-op. Resolve self BEFORE checking phase arg
  // so that CI/hooks invoking preflight on machines without team config
  // never fail on missing flags.
  if (!resolveSelf()) {
    process.exit(0);
    return;
  }

  if (opts.phase === undefined) {
    console.error('Error: --phase <n> is required.');
    process.exit(2);
    return;
  }
  const phase = Number.parseInt(opts.phase, 10);
  if (!Number.isFinite(phase) || Number.isNaN(phase)) {
    console.error(`Error: --phase must be an integer (got "${opts.phase}").`);
    process.exit(2);
    return;
  }

  const result = runPreflight(phase, { force: opts.force });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result.conflicts) + '\n');
  } else {
    for (const line of result.warnings) {
      console.error(line);
    }
    if (result.warnings.length > 0 && !opts.force) {
      console.error('Proceed anyway? Use --force or confirm with user.');
    }
  }

  process.exit(result.exitCode);
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export function registerCollabCommand(program: Command): void {
  const collab = program
    .command('collab')
    .alias('team')
    .description('Human-team collaboration — join, report, and view activity');

  collab
    .command('join')
    .description('Register the current git identity as a team member (idempotent)')
    .option('--role <role>', 'Force role: admin or member')
    .action((opts: { role?: string }) => runJoin(opts));

  collab
    .command('whoami')
    .description('Show the current team member record')
    .action(() => runWhoami());

  collab
    .command('report')
    .description('Append an activity event (usually called from hooks)')
    .requiredOption('--action <name>', 'Command or tool name')
    .option('--phase <n>', 'Associated phase id')
    .option('--task-id <id>', 'Associated task id')
    .option('--target <s>', 'Operation target (file, spec, issue id)')
    .action((opts: { action: string; phase?: string; taskId?: string; target?: string }) =>
      runReport(opts),
    );

  collab
    .command('status')
    .description('Show recent team activity')
    .option('--window <minutes>', 'Look-back window in minutes', '30')
    .action((opts: { window?: string }) => runStatus(opts));

  collab
    .command('sync')
    .description('Sync with remote: git stash/pull --rebase/pop/push + log rotation')
    .option('--dry-run', 'Print the plan without executing any git command')
    .option('--with-overlays', 'Import team overlay bundles after sync')
    .action((opts: { dryRun?: boolean; withOverlays?: boolean }) => runSync(opts));

  collab
    .command('preflight')
    .description('Warn if teammates are active on the same phase')
    .option('--phase <n>', 'Phase id to check')
    .option('--force', 'Print warnings but exit 0')
    .option('--json', 'Output conflicts as JSON')
    .action((opts: { phase?: string; force?: boolean; json?: boolean }) =>
      runPreflightCli(opts),
    );

  collab
    .command('guard')
    .description('Show namespace boundaries for the current team member')
    .action(() => runGuard());

  // spec subcommand group
  const spec = collab
    .command('spec')
    .description('Manage personal spec overrides');

  spec
    .command('list')
    .description('List personal spec files')
    .action(() => runSpecList());

  spec
    .command('edit')
    .description('Create or edit a personal spec file')
    .argument('<filename>', 'Spec filename (e.g. coding-conventions or coding-conventions.md)')
    .action((filename: string) => runSpecEdit(filename));

  // role subcommand group
  const role = collab
    .command('role')
    .description('Manage project roles for team members');

  role
    .command('add')
    .description('Add one or more project roles to a team member')
    .argument('<uid>', 'Member uid')
    .argument('<roles...>', 'Project role(s) to add')
    .action((uid: string, roles: string[]) => runRoleAdd(uid, roles));

  role
    .command('remove')
    .description('Remove one or more project roles from a team member')
    .argument('<uid>', 'Member uid')
    .argument('<roles...>', 'Project role(s) to remove')
    .action((uid: string, roles: string[]) => runRoleRemove(uid, roles));

  role
    .command('list')
    .description('List project roles for one or all team members')
    .option('--uid <uid>', 'Filter to a specific member')
    .action((opts: { uid?: string }) => runRoleList(opts.uid));

  // task subcommand group
  const task = collab
    .command('task')
    .description('Manage collaboration tasks');

  task
    .command('create')
    .description('Create a new task')
    .requiredOption('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--priority <priority>', 'Priority: low, medium, high, critical')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((opts: { title: string; description?: string; priority?: string; tags?: string }) =>
      runTaskCreate(opts),
    );

  task
    .command('list')
    .description('List tasks with optional filters')
    .option('--status <status>', 'Filter by status')
    .option('--assignee <uid>', 'Filter by assignee uid')
    .action((opts: { status?: string; assignee?: string }) => runTaskList(opts));

  task
    .command('show')
    .description('Show full details for a task')
    .argument('<task-id>', 'Task id (e.g. TASK-001)')
    .action((taskId: string) => runTaskShow(taskId));

  task
    .command('status')
    .description('Update task status')
    .argument('<task-id>', 'Task id (e.g. TASK-001)')
    .argument('<status>', 'New status: open|assigned|in_progress|pending_review|done|closed')
    .action((taskId: string, status: string) => runTaskStatus(taskId, status));

  task
    .command('assign')
    .description('Assign a task to a team member')
    .argument('<task-id>', 'Task id (e.g. TASK-001)')
    .argument('<uid>', 'Member uid to assign')
    .action((taskId: string, uid: string) => runTaskAssign(taskId, uid));

  task
    .command('check')
    .description('Add a check entry to a task')
    .argument('<task-id>', 'Task id (e.g. TASK-001)')
    .requiredOption('--action <action>', 'Action: confirmed|rejected|commented')
    .option('--comment <text>', 'Comment text')
    .action((taskId: string, opts: { action: string; comment?: string }) =>
      runTaskCheck(taskId, opts),
    );
}

// ---------------------------------------------------------------------------
// guard
// ---------------------------------------------------------------------------

function runGuard(): void {
  const self = resolveSelf();
  if (!self) {
    console.error("Team mode not enabled. Run 'maestro collab join' first.");
    process.exit(1);
    return;
  }

  const root = getProjectRoot();
  const boundaries = getNamespaceBoundaries(self.uid, root);

  console.log(`Namespace boundaries for ${self.uid}:`);
  console.log('');
  console.log('Writable paths (own namespace):');
  for (const b of boundaries.filter(
    (p) => !p.includes('activity.jsonl') && !p.endsWith('manifest.json'),
  )) {
    console.log(`  ${b}`);
  }
  console.log('');
  console.log('Shared writable paths:');
  for (const b of boundaries.filter(
    (p) => p.includes('activity.jsonl') || p.endsWith('manifest.json'),
  )) {
    console.log(`  ${b}`);
  }
  console.log('');
  console.log('Mode: advisory (warnings only, non-blocking)');
}

// ---------------------------------------------------------------------------
// spec list / spec edit
// ---------------------------------------------------------------------------

function runSpecList(): void {
  const self = resolveSelf();
  if (!self) {
    console.error("Team mode not enabled. Run 'maestro collab join' first.");
    process.exit(1);
    return;
  }

  const root = getProjectRoot();
  const personalDir = join(root, TEAM_SPECS_DIR, self.uid);

  if (!existsSync(personalDir)) {
    console.log(`No personal specs found for ${self.uid}.`);
    console.log(`Directory: ${personalDir}`);
    console.log(`Run 'maestro collab spec edit <filename>' to create one.`);
    return;
  }

  let files: string[];
  try {
    files = readdirSync(personalDir).filter(f => f.endsWith('.md'));
  } catch {
    console.error(`Error: could not read ${personalDir}`);
    process.exit(1);
    return;
  }

  if (files.length === 0) {
    console.log(`No personal spec files in ${personalDir}`);
    return;
  }

  console.log(`Personal specs for ${self.uid} (${files.length} files):`);
  console.log('');
  for (const file of files.sort()) {
    const cats = CATEGORY_MAP[file];
    const catLabel = cats ? cats.join(', ') : 'general';
    console.log(`  ${file}  (${catLabel})`);
  }
}

function runSpecEdit(filename: string): void {
  const self = resolveSelf();
  if (!self) {
    console.error("Team mode not enabled. Run 'maestro collab join' first.");
    process.exit(1);
    return;
  }

  // Ensure .md extension
  const specFile = filename.endsWith('.md') ? filename : `${filename}.md`;

  const root = getProjectRoot();
  const personalDir = join(root, TEAM_SPECS_DIR, self.uid);
  const filePath = join(personalDir, specFile);

  // Create directory if needed
  if (!existsSync(personalDir)) {
    mkdirSync(personalDir, { recursive: true });
  }

  // Create file with template if it does not exist
  if (!existsSync(filePath)) {
    const cats = CATEGORY_MAP[specFile];
    const catComment = cats ? cats.join(', ') : 'general';
    writeFileSync(filePath, `# ${specFile.replace('.md', '')}\n\n<!-- categories: ${catComment} -->\n\n`, 'utf-8');
    console.log(`Created: ${filePath}`);
  } else {
    console.log(`Exists: ${filePath}`);
  }

  // Try to open with $EDITOR
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    try {
      execSync(`${editor} "${filePath}"`, { stdio: 'inherit' });
    } catch {
      console.log(`Open with your editor: ${filePath}`);
    }
  } else {
    console.log(`No $EDITOR set. Edit manually: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// role add / role remove / role list
// ---------------------------------------------------------------------------

function runRoleAdd(uid: string, roles: string[]): void {
  requireTeamMode();

  if (!getMemberByUid(uid)) {
    console.error(`Error: member "${uid}" not found.`);
    process.exit(1);
    return;
  }

  let current: MemberRecord | null = null;
  for (const role of roles) {
    current = addProjectRole(uid, role);
  }

  console.log(`Updated roles for ${uid}: ${(current?.projectRoles ?? []).join(', ') || '(none)'}`);
}

function runRoleRemove(uid: string, roles: string[]): void {
  requireTeamMode();

  if (!getMemberByUid(uid)) {
    console.error(`Error: member "${uid}" not found.`);
    process.exit(1);
    return;
  }

  let current: MemberRecord | null = null;
  for (const role of roles) {
    current = removeProjectRole(uid, role);
  }

  console.log(`Updated roles for ${uid}: ${(current?.projectRoles ?? []).join(', ') || '(none)'}`);
}

function runRoleList(uid?: string): void {
  requireTeamMode();

  const result = listProjectRoles(uid);

  if (Array.isArray(result)) {
    // Single-member result
    if (result.length === 0) {
      console.log(uid ? `No project roles for ${uid}.` : 'No project roles found.');
    } else {
      console.log(`Project roles for ${uid}:`);
      for (const r of result) {
        console.log(`  ${r}`);
      }
    }
  } else {
    // Map of all members
    let hasAny = false;
    for (const [memberUid, roles] of result) {
      if (roles.length > 0) {
        hasAny = true;
        const roleStr = roles.join(', ');
        console.log(`${pad(memberUid, 20)}  ${roleStr}`);
      }
    }
    if (!hasAny) {
      console.log('No project roles assigned to any member.');
    }
  }
}

// ---------------------------------------------------------------------------
// task create / task list / task show / task status / task assign / task check
// ---------------------------------------------------------------------------

const VALID_TASK_STATUSES: TaskStatus[] = [
  'open', 'assigned', 'in_progress', 'pending_review', 'done', 'closed',
];

const VALID_PRIORITIES: TaskPriority[] = [
  'low', 'medium', 'high', 'critical',
];

const VALID_CHECK_ACTIONS: CheckAction[] = [
  'confirmed', 'rejected', 'commented',
];

function runTaskCreate(opts: {
  title: string;
  description?: string;
  priority?: string;
  tags?: string;
}): void {
  let self: MemberRecord;
  try {
    self = requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  let priority: TaskPriority | undefined;
  if (opts.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(opts.priority as TaskPriority)) {
      console.error(
        `Error: --priority must be one of ${VALID_PRIORITIES.join(', ')} (got "${opts.priority}")`,
      );
      process.exit(1);
      return;
    }
    priority = opts.priority as TaskPriority;
  }

  const tags = opts.tags
    ? opts.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
    : undefined;

  try {
    const task = createTask({
      title: opts.title,
      description: opts.description,
      priority,
      reporter: self.uid,
      tags,
    });
    console.log(`Created ${task.id}:`);
    console.log(`  title:    ${task.title}`);
    console.log(`  status:   ${task.status}`);
    console.log(`  priority: ${task.priority}`);
    if (task.tags && task.tags.length > 0) {
      console.log(`  tags:     ${task.tags.join(', ')}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function runTaskList(opts: { status?: string; assignee?: string }): void {
  let self: MemberRecord;
  try {
    self = requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  if (opts.status !== undefined && !VALID_TASK_STATUSES.includes(opts.status as TaskStatus)) {
    console.error(
      `Error: --status must be one of ${VALID_TASK_STATUSES.join(', ')} (got "${opts.status}")`,
    );
    process.exit(1);
    return;
  }

  try {
    const tasks = listTasks({
      status: opts.status as TaskStatus | undefined,
      assignee: opts.assignee,
    });

    if (tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }

    // Table header
    const idW = 10;
    const titleW = 30;
    const statusW = 15;
    const priorityW = 10;
    const assigneeW = 15;

    console.log(
      `${pad('ID', idW)}  ${pad('TITLE', titleW)}  ${pad('STATUS', statusW)}  ${pad('PRIORITY', priorityW)}  ${pad('ASSIGNEE', assigneeW)}`,
    );
    console.log('-'.repeat(idW + titleW + statusW + priorityW + assigneeW + 8));

    for (const t of tasks) {
      console.log(
        `${pad(t.id, idW)}  ${pad(truncate(t.title, titleW), titleW)}  ${pad(t.status, statusW)}  ${pad(t.priority, priorityW)}  ${pad(t.assignee ?? '-', assigneeW)}`,
      );
    }

    console.log(`\n${tasks.length} task(s) listed.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function runTaskShow(taskId: string): void {
  try {
    requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  try {
    const task = getTask(taskId);
    if (!task) {
      console.error(`Error: task "${taskId}" not found.`);
      process.exit(1);
      return;
    }

    console.log(`ID:          ${task.id}`);
    console.log(`Title:       ${task.title}`);
    console.log(`Status:      ${task.status}`);
    console.log(`Priority:    ${task.priority}`);
    console.log(`Reporter:    ${task.reporter}`);
    if (task.assignee) console.log(`Assignee:    ${task.assignee}`);
    if (task.description) console.log(`Description: ${task.description}`);
    if (task.tags && task.tags.length > 0) {
      console.log(`Tags:        ${task.tags.join(', ')}`);
    }
    if (task.external_refs && task.external_refs.length > 0) {
      console.log(`References:`);
      for (const ref of task.external_refs) {
        console.log(`  ${ref.type}: ${ref.id}${ref.url ? ` (${ref.url})` : ''}`);
      }
    }
    console.log(`Created:     ${task.created_at}`);
    console.log(`Updated:     ${task.updated_at} by ${task.updated_by}`);

    if (task.check_log.length > 0) {
      console.log(`\nCheck log (${task.check_log.length} entries):`);
      for (const entry of task.check_log) {
        const comment = entry.comment ? ` -- ${entry.comment}` : '';
        console.log(`  ${entry.ts}  ${entry.uid}  ${entry.action}${comment}`);
      }
    } else {
      console.log('\nCheck log: (empty)');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function runTaskStatus(taskId: string, status: string): void {
  let self: MemberRecord;
  try {
    self = requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  if (!VALID_TASK_STATUSES.includes(status as TaskStatus)) {
    console.error(
      `Error: status must be one of ${VALID_TASK_STATUSES.join(', ')} (got "${status}")`,
    );
    process.exit(1);
    return;
  }

  try {
    const task = updateTaskStatus(taskId, status as TaskStatus, self.uid);
    console.log(`${task.id} status -> ${task.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function runTaskAssign(taskId: string, uid: string): void {
  try {
    requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  try {
    const task = assignTask(taskId, uid);
    console.log(`${task.id} assigned to ${task.assignee} (status: ${task.status})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function runTaskCheck(taskId: string, opts: { action: string; comment?: string }): void {
  let self: MemberRecord;
  try {
    self = requireTeamMode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
    return;
  }

  if (!VALID_CHECK_ACTIONS.includes(opts.action as CheckAction)) {
    console.error(
      `Error: --action must be one of ${VALID_CHECK_ACTIONS.join(', ')} (got "${opts.action}")`,
    );
    process.exit(1);
    return;
  }

  try {
    const task = addCheckEntry(taskId, {
      uid: self.uid,
      action: opts.action as CheckAction,
      comment: opts.comment,
    });
    console.log(`${task.id} check entry added: ${opts.action}${opts.comment ? ` -- ${opts.comment}` : ''}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

/** Truncate a string to maxLen, appending '...' if truncated. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}
