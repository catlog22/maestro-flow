// ---------------------------------------------------------------------------
// `maestro launcher` — unified Claude Code launcher with workflow switching
//
// Manages two dimensions:
//   1. Workflow profiles — which CLAUDE.md + cli-tools.json to activate
//   2. Settings profiles — which settings.json to launch with
//
// All workflows are global — switching replaces ~/.claude/CLAUDE.md and
// ~/.claude/cli-tools.json. If the current project directory has workflow
// files from a different workflow, the user is prompted to clean them.
//
// Config stored at: ~/.claude-launcher/config.json
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { select, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), '.claude-launcher');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_MD = join(CLAUDE_DIR, 'CLAUDE.md');
const CLI_TOOLS = join(CLAUDE_DIR, 'cli-tools.json');
const SYSTEM_SETTINGS = join(CLAUDE_DIR, 'settings.json');

/** Project-level workflow directories that may conflict when switching */
const PROJECT_WORKFLOW_DIRS = [
  join('.claude', 'commands'),
  join('.claude', 'agents'),
  join('.claude', 'skills'),
  join('.codex', 'skills'),
];

// ---------------------------------------------------------------------------
// Config types & I/O
// ---------------------------------------------------------------------------

interface WorkflowProfile {
  claudeMd: string;
  cliTools: string | null;
  npmPackage?: string;
  installCheck?: string;
}

interface SettingsProfile {
  path: string;
}

interface LauncherConfig {
  workflows: Record<string, WorkflowProfile>;
  settings: Record<string, SettingsProfile>;
  defaults: { workflow?: string; settings?: string };
}

function load(): LauncherConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { workflows: {}, settings: {}, defaults: {} };
  }
  const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  if (!raw.workflows) raw.workflows = {};
  if (!raw.settings) raw.settings = {};
  if (!raw.defaults) raw.defaults = {};
  return raw;
}

function save(config: LauncherConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Install check helpers
// ---------------------------------------------------------------------------

function resolveCheckPath(p: string): string {
  return p.replace(/^~[/\\]/, homedir() + '/');
}

function isBinaryAvailable(bin: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [bin], { stdio: 'pipe', shell: true });
  return result.status === 0;
}

interface NpmPackageInfo {
  name: string;
  version: string | null;
  installed: boolean;
}

function checkNpmPackage(packageName: string): NpmPackageInfo {
  try {
    const output = spawnSync('npm', ['list', '-g', '--depth=0', '--json'], {
      shell: true,
      encoding: 'utf-8',
      timeout: 10000,
    });
    if (output.stdout) {
      const data = JSON.parse(output.stdout);
      const deps = data.dependencies || {};
      for (const [key, info] of Object.entries(deps) as [string, any][]) {
        if (key === packageName || info.name === packageName) {
          return { name: packageName, version: info.version || null, installed: true };
        }
      }
    }
  } catch {
    // fall through
  }
  return { name: packageName, version: null, installed: false };
}

// ---------------------------------------------------------------------------
// Unified manifest reader — reads from both ~/.claude-manifests/ and
// ~/.maestro/manifests/ to detect installations from either installer.
// ---------------------------------------------------------------------------

interface UnifiedManifestEntry {
  path: string;
}

interface UnifiedManifest {
  id: string;
  date: string;
  entries: UnifiedManifestEntry[];
}

function loadAllManifests(): UnifiedManifest[] {
  const results: UnifiedManifest[] = [];
  const manifestDirs = [
    join(homedir(), '.claude-manifests'),
    join(homedir(), '.maestro', 'manifests'),
  ];

  for (const dir of manifestDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const raw = readFileSync(join(dir, f), 'utf-8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);

        // Normalize both manifest schemas into unified format
        const entries: UnifiedManifestEntry[] = [];

        // ccw schema: { files: [{path}], directories: [{path}] }
        if (Array.isArray(data.files)) {
          for (const e of data.files) entries.push({ path: e.path || '' });
        }
        if (Array.isArray(data.directories)) {
          for (const e of data.directories) entries.push({ path: e.path || '' });
        }

        // maestro schema: { entries: [{path, type}] }
        if (Array.isArray(data.entries)) {
          for (const e of data.entries) entries.push({ path: e.path || '' });
        }

        if (entries.length > 0) {
          results.push({
            id: data.manifest_id || data.id || f,
            date: data.installation_date || data.installedAt || '',
            entries,
          });
        }
      } catch { /* skip invalid */ }
    }
  }

  return results;
}

interface WorkflowInstallStatus {
  installed: boolean;
  manifest: UnifiedManifest | null;
  date: string | null;
}

function checkWorkflowManifest(name: string, wf: WorkflowProfile): WorkflowInstallStatus {
  const manifests = loadAllManifests();

  // Strategy 1: match by installCheck path in manifest entries
  if (wf.installCheck) {
    const checkPath = resolveCheckPath(wf.installCheck).toLowerCase().replace(/[\\/]/g, '/');
    for (const m of manifests) {
      for (const e of m.entries) {
        const normalized = (e.path || '').toLowerCase().replace(/[\\/]/g, '/');
        if (normalized.startsWith(checkPath) || checkPath.startsWith(normalized)) {
          return { installed: true, manifest: m, date: m.date || null };
        }
      }
    }
  }

  // Strategy 2: match by workflow name pattern in entries
  const namePatterns = [`.${name}/`, `.${name}\\`];
  for (const m of manifests) {
    if (m.entries.some(e => {
      const lp = (e.path || '').toLowerCase();
      return namePatterns.some(pat => lp.includes(pat));
    })) {
      return { installed: true, manifest: m, date: m.date || null };
    }
  }

  // Strategy 3: fallback to installCheck path existence on disk
  if (wf.installCheck) {
    const checkPath = resolveCheckPath(wf.installCheck);
    if (existsSync(checkPath)) {
      return { installed: true, manifest: null, date: null };
    }
  }

  return { installed: false, manifest: null, date: null };
}

// ---------------------------------------------------------------------------
// Status dashboard
// ---------------------------------------------------------------------------

function printStatusDashboard(config: LauncherConfig, currentWf: string | null): void {
  const wfEntries = Object.entries(config.workflows);

  // Collect unique npm packages
  const packageNames = new Set<string>();
  for (const [, wf] of wfEntries) {
    if (wf.npmPackage) packageNames.add(wf.npmPackage);
  }

  // Check npm packages
  const pkgResults: NpmPackageInfo[] = [];
  packageNames.forEach((pkg) => {
    pkgResults.push(checkNpmPackage(pkg));
  });

  // Build lines
  const lines: string[] = [];

  // NPM packages section
  if (pkgResults.length > 0) {
    lines.push('  NPM Packages:');
    for (const pkg of pkgResults) {
      const icon = pkg.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const ver = pkg.version ? `\x1b[90mv${pkg.version}\x1b[0m` : '\x1b[31mnot installed\x1b[0m';
      lines.push(`    ${icon} ${pkg.name.padEnd(20)} ${ver}`);
    }
    lines.push('');
  }

  // Workflows section — manifest-based detection
  lines.push('  Workflows:');
  for (const [name, wf] of wfEntries) {
    const isActive = currentWf === name;
    const isDefault = config.defaults.workflow === name;
    const installStatus = checkWorkflowManifest(name, wf);

    const icon = installStatus.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';

    const tags: string[] = [];
    if (isActive) tags.push('\x1b[36mactive\x1b[0m');
    if (isDefault) tags.push('\x1b[33m★ default\x1b[0m');
    if (installStatus.installed) {
      const dateStr = installStatus.date
        ? new Date(installStatus.date).toLocaleDateString()
        : '';
      tags.push(`\x1b[32minstalled${dateStr ? ' ' + dateStr : ''}\x1b[0m`);
    } else {
      tags.push('\x1b[31mnot installed\x1b[0m');
    }

    const tagStr = tags.length > 0 ? `  [${tags.join(', ')}]` : '';
    lines.push(`    ${icon} ${name.padEnd(16)}${tagStr}`);
  }

  // Print box
  console.error('');
  console.error('\x1b[36m╭─ Launcher Status ─────────────────────────────────────╮\x1b[0m');
  for (const line of lines) {
    console.error(`\x1b[36m│\x1b[0m${line}`);
  }
  console.error('\x1b[36m╰───────────────────────────────────────────────────────╯\x1b[0m');
  console.error('');
}

// ---------------------------------------------------------------------------
// Auto-install
// ---------------------------------------------------------------------------

async function ensureWorkflowReady(name: string, wf: WorkflowProfile): Promise<boolean> {
  if (!wf.installCheck && !wf.npmPackage) return true;

  // Check manifest first, then fallback to installCheck path
  const manifestStatus = checkWorkflowManifest(name, wf);
  if (manifestStatus.installed) return true;

  if (wf.installCheck) {
    const checkPath = resolveCheckPath(wf.installCheck);
    if (existsSync(checkPath)) return true;
  } else if (!wf.npmPackage) {
    return true;
  }

  // Resources missing — prompt to install
  console.error('');
  console.error(`  Workflow "${name}" resources not found.`);
  if (wf.installCheck) {
    console.error(`  Missing: ${wf.installCheck}`);
  }
  console.error('');

  const proceed = await confirm({
    message: `Install "${name}" dependencies?`,
    default: true,
  });
  if (!proceed) return false;

  if (wf.npmPackage) {
    const bin = name;
    if (!isBinaryAvailable(bin)) {
      console.error(`  Installing npm package: ${wf.npmPackage}...`);
      const npmResult = spawnSync('npm', ['install', '-g', wf.npmPackage], {
        stdio: 'inherit',
        shell: true,
      });
      if (npmResult.status !== 0) {
        console.error(`  Failed to install ${wf.npmPackage}`);
        return false;
      }
      console.error(`  npm package installed.`);
    }

    console.error(`  Running ${bin} install...`);
    const installResult = spawnSync(bin, ['install', '--force'], {
      stdio: 'inherit',
      shell: true,
    });
    if (installResult.status !== 0) {
      console.error(`  Failed to run ${bin} install`);
      return false;
    }
  }

  // Verify after install
  if (wf.installCheck) {
    const checkPath = resolveCheckPath(wf.installCheck);
    if (!existsSync(checkPath)) {
      console.error(`  Warning: ${wf.installCheck} still not found after install.`);
      return false;
    }
  }

  console.error('  Installation complete.');
  console.error('');
  return true;
}

// ---------------------------------------------------------------------------
// Project conflict detection
// ---------------------------------------------------------------------------

function countDir(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) count++;
      else if (entry.isDirectory()) count += countDir(join(dir, entry.name));
    }
    return count;
  } catch {
    return 0;
  }
}

interface ConflictInfo {
  dir: string;
  fileCount: number;
}

function detectProjectConflicts(cwd: string): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  for (const relDir of PROJECT_WORKFLOW_DIRS) {
    const fullPath = join(cwd, relDir);
    const fileCount = countDir(fullPath);
    if (fileCount > 0) {
      conflicts.push({ dir: relDir, fileCount });
    }
  }
  return conflicts;
}

async function handleProjectConflicts(cwd: string): Promise<void> {
  const conflicts = detectProjectConflicts(cwd);
  if (conflicts.length === 0) return;

  console.error('');
  console.error('  Project workflow files detected:');
  for (const c of conflicts) {
    console.error(`    ${c.dir}  (${c.fileCount} files)`);
  }
  console.error('');

  const shouldClean = await confirm({
    message: 'Delete project workflow files? (they may conflict with the selected workflow)',
    default: false,
  });

  if (!shouldClean) return;

  for (const c of conflicts) {
    const fullPath = join(cwd, c.dir);
    rmSync(fullPath, { recursive: true, force: true });
    console.error(`  Deleted: ${c.dir}`);
  }
  console.error('');
}

// ---------------------------------------------------------------------------
// Workflow operations
// ---------------------------------------------------------------------------

interface AddWorkflowOpts {
  npmPackage?: string;
  installCheck?: string;
}

function addWorkflow(name: string, claudeMdPath: string, cliToolsPath?: string, opts: AddWorkflowOpts = {}): WorkflowProfile {
  const md = resolve(claudeMdPath);
  if (!existsSync(md)) throw new Error(`CLAUDE.md not found: ${md}`);
  const tools = cliToolsPath ? resolve(cliToolsPath) : null;
  if (tools && !existsSync(tools)) throw new Error(`cli-tools.json not found: ${tools}`);

  const config = load();
  const profile: WorkflowProfile = { claudeMd: md, cliTools: tools };
  if (opts.npmPackage) profile.npmPackage = opts.npmPackage;
  if (opts.installCheck) profile.installCheck = opts.installCheck;
  config.workflows[name] = profile;
  if (Object.keys(config.workflows).length === 1) {
    config.defaults.workflow = name;
  }
  save(config);
  return config.workflows[name];
}

function applyWorkflow(name: string): void {
  const config = load();
  const wf = config.workflows[name];
  if (!wf) throw new Error(`Workflow not found: ${name}`);
  if (!existsSync(wf.claudeMd)) throw new Error(`Source CLAUDE.md missing: ${wf.claudeMd}`);

  if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true });

  copyFileSync(wf.claudeMd, CLAUDE_MD);

  if (wf.cliTools && existsSync(wf.cliTools)) {
    copyFileSync(wf.cliTools, CLI_TOOLS);
  } else if (existsSync(CLI_TOOLS)) {
    unlinkSync(CLI_TOOLS);
  }
}

function detectCurrentWorkflow(): string | null {
  if (!existsSync(CLAUDE_MD)) return null;
  const current = readFileSync(CLAUDE_MD, 'utf-8').trim();
  const config = load();
  for (const [name, wf] of Object.entries(config.workflows)) {
    if (!existsSync(wf.claudeMd)) continue;
    if (readFileSync(wf.claudeMd, 'utf-8').trim() === current) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings operations
// ---------------------------------------------------------------------------

function isClaudeSettings(filePath: string): boolean {
  try {
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (typeof content !== 'object' || content === null || Array.isArray(content)) return false;
    const knownKeys = ['permissions', 'env', 'allowedTools', 'model', 'apiKey', 'customApiKey', 'settings', 'mcpServers'];
    return Object.keys(content).some((k) => knownKeys.includes(k));
  } catch {
    return false;
  }
}

function scanSettingsDir(dir: string): { added: string[]; skipped: string[] } {
  const resolved = resolve(dir);
  if (!existsSync(resolved)) throw new Error(`Directory not found: ${resolved}`);
  const files = readdirSync(resolved).filter((f) => f.endsWith('.json'));
  const added: string[] = [];
  const skipped: string[] = [];
  const config = load();

  for (const file of files) {
    const filePath = join(resolved, file);
    if (!isClaudeSettings(filePath)) { skipped.push(file); continue; }
    const name = file.replace(/^settings-/, '').replace(/\.json$/, '');
    if (config.settings[name]) { skipped.push(file); continue; }
    config.settings[name] = { path: filePath };
    added.push(name);
  }
  save(config);
  return { added, skipped };
}

function migrateFromStartClaude(): number {
  const oldConfig = join(homedir(), '.start-claude', 'profiles.json');
  if (!existsSync(oldConfig)) return 0;
  const old = JSON.parse(readFileSync(oldConfig, 'utf-8'));
  const config = load();
  let count = 0;
  for (const [name, profile] of Object.entries(old.profiles || {}) as [string, any][]) {
    if (!config.settings[name] && existsSync(profile.path)) {
      config.settings[name] = { path: profile.path };
      count++;
    }
  }
  save(config);
  return count;
}

// ---------------------------------------------------------------------------
// Interactive launcher
// ---------------------------------------------------------------------------

async function interactiveLaunch(extraArgs: string[]): Promise<void> {
  const config = load();
  const currentWf = detectCurrentWorkflow();

  const wfEntries = Object.entries(config.workflows);
  if (wfEntries.length === 0) {
    console.error('No workflows registered. Use: maestro launcher add-workflow <name> --claude-md <path>');
    process.exit(1);
  }

  // Show status dashboard
  printStatusDashboard(config, currentWf);

  const wfChoices = wfEntries.map(([name, wf]) => {
    const tags: string[] = [];
    if (currentWf === name) tags.push('active');
    if (config.defaults.workflow === name) tags.push('★');
    if (wf.npmPackage) tags.push(wf.npmPackage);
    const suffix = tags.length > 0 ? `  (${tags.join(', ')})` : '';
    return { name: `${name}${suffix}`, value: name };
  });

  const chosenWf = await select({
    message: 'Global Workflow (→ ~/.claude/):',
    choices: wfChoices,
    default: config.defaults.workflow || (currentWf ?? undefined),
  });

  const settingsEntries = Object.entries(config.settings);
  const hasSystem = existsSync(SYSTEM_SETTINGS);

  const settingsChoices: { name: string; value: string }[] = [];
  if (hasSystem) {
    settingsChoices.push({ name: `system (default)  →  ${SYSTEM_SETTINGS}`, value: '__system__' });
  }
  for (const [name, s] of settingsEntries) {
    settingsChoices.push({
      name: `${name}${config.defaults.settings === name ? ' ★' : ''}  →  ${s.path}`,
      value: name,
    });
  }

  if (settingsChoices.length === 0) {
    console.error('No settings profiles found. Using system default.');
    await ensureAndLaunch(chosenWf, undefined, extraArgs);
    return;
  }

  const chosenSettings = await select({
    message: 'Settings:',
    choices: settingsChoices,
    default: config.defaults.settings ?? '__system__',
  });

  const settingsPath = chosenSettings === '__system__'
    ? undefined
    : config.settings[chosenSettings]?.path;

  await ensureAndLaunch(chosenWf, settingsPath, extraArgs);
}

async function ensureAndLaunch(workflowName: string, settingsPath: string | undefined, extraArgs: string[]): Promise<void> {
  const config = load();
  const wf = config.workflows[workflowName];

  // Check npm/install dependencies
  if (wf && (wf.npmPackage || wf.installCheck)) {
    const ready = await ensureWorkflowReady(workflowName, wf);
    if (!ready) {
      console.error('Launch cancelled.');
      process.exit(0);
    }
  }

  // Check project-level conflicts
  await handleProjectConflicts(process.cwd());

  launchClaude(workflowName, settingsPath, extraArgs);
}

function launchClaude(workflowName: string, settingsPath: string | undefined, extraArgs: string[]): void {
  applyWorkflow(workflowName);
  console.error(`Workflow: ${workflowName}`);

  const args: string[] = ['--dangerously-skip-permissions'];
  if (settingsPath) {
    args.push('--settings', settingsPath);
    console.error(`Settings: ${settingsPath}`);
  }
  args.push(...extraArgs);

  console.error(`Launching claude...`);
  console.error('');

  const result = spawnSync('claude', args, { stdio: 'inherit', shell: true });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Error: `claude` command not found. Make sure Claude CLI is installed.');
      process.exit(1);
    }
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerLauncherCommand(program: Command): void {
  const launcher = program
    .command('launcher')
    .description('Unified Claude Code launcher with workflow + settings switching')
    .option('-w, --workflow <name>', 'Workflow profile to activate')
    .option('-s, --settings <name>', 'Settings profile to use')
    .allowUnknownOption()
    .action(async (opts: { workflow?: string; settings?: string }, cmd) => {
      const extraArgs = cmd.args;

      if (opts.workflow) {
        const config = load();
        const settingsPath = opts.settings
          ? (opts.settings === 'system' ? undefined : config.settings[opts.settings]?.path)
          : undefined;
        await ensureAndLaunch(opts.workflow, settingsPath, extraArgs);
        return;
      }

      try {
        await interactiveLaunch(extraArgs);
      } catch (err) {
        if (err instanceof ExitPromptError) {
          console.error('\nCancelled.');
          process.exit(0);
        }
        throw err;
      }
    });

  // --- Subcommands ---

  launcher
    .command('add-workflow <name>')
    .description('Register a workflow profile')
    .requiredOption('--claude-md <path>', 'Path to CLAUDE.md for this workflow')
    .option('--cli-tools <path>', 'Path to cli-tools.json for this workflow')
    .option('--npm-package <pkg>', 'npm package to install (e.g., maestro-flow)')
    .option('--install-check <path>', 'Path to verify resources are installed (e.g., ~/.maestro/workflows)')
    .action((name: string, opts: { claudeMd: string; cliTools?: string; npmPackage?: string; installCheck?: string }) => {
      try {
        const wf = addWorkflow(name, opts.claudeMd, opts.cliTools, {
          npmPackage: opts.npmPackage,
          installCheck: opts.installCheck,
        });
        console.log(`Added workflow "${name}"`);
        console.log(`  CLAUDE.md:       ${wf.claudeMd}`);
        if (wf.cliTools) console.log(`  cli-tools:       ${wf.cliTools}`);
        if (wf.npmPackage) console.log(`  npm-package:     ${wf.npmPackage}`);
        if (wf.installCheck) console.log(`  install-check:   ${wf.installCheck}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('remove-workflow <name>')
    .description('Remove a workflow profile')
    .action((name: string) => {
      try {
        const config = load();
        if (!config.workflows[name]) throw new Error(`Workflow not found: ${name}`);
        delete config.workflows[name];
        if (config.defaults.workflow === name) delete config.defaults.workflow;
        save(config);
        console.log(`Removed workflow "${name}"`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('add-settings <name> <path>')
    .description('Register a settings profile')
    .action((name: string, settingsPath: string) => {
      try {
        const resolved = resolve(settingsPath);
        if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
        const config = load();
        config.settings[name] = { path: resolved };
        if (Object.keys(config.settings).length === 1) config.defaults.settings = name;
        save(config);
        console.log(`Added settings "${name}" → ${resolved}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('remove-settings <name>')
    .description('Remove a settings profile')
    .action((name: string) => {
      try {
        const config = load();
        if (!config.settings[name]) throw new Error(`Settings not found: ${name}`);
        delete config.settings[name];
        if (config.defaults.settings === name) delete config.defaults.settings;
        save(config);
        console.log(`Removed settings "${name}"`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('scan <dir>')
    .description('Scan directory for Claude settings JSON files and register them')
    .action((dir: string) => {
      try {
        const { added } = scanSettingsDir(dir);
        if (added.length > 0) {
          console.log(`Registered ${added.length} settings:`);
          added.forEach((n) => console.log(`  + ${n}`));
        } else {
          console.log('No new Claude settings files found.');
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('default <type> <name>')
    .description('Set default (type: workflow or settings)')
    .action((type: string, name: string) => {
      if (type !== 'workflow' && type !== 'settings') {
        console.error('Type must be "workflow" or "settings"');
        process.exit(1);
      }
      try {
        const config = load();
        if (type === 'workflow' && !config.workflows[name]) throw new Error(`Workflow not found: ${name}`);
        if (type === 'settings' && name !== 'system' && !config.settings[name]) throw new Error(`Settings not found: ${name}`);
        config.defaults[type] = name;
        save(config);
        console.log(`Default ${type} set to "${name}"`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('set <name> <key> <value>')
    .description('Set workflow property (npm-package, install-check)')
    .action((name: string, key: string, value: string) => {
      const validKeys: Record<string, keyof WorkflowProfile> = {
        'npm-package': 'npmPackage',
        'install-check': 'installCheck',
      };
      const field = validKeys[key];
      if (!field) {
        console.error(`Unknown key: ${key}. Valid keys: ${Object.keys(validKeys).join(', ')}`);
        process.exit(1);
      }
      try {
        const config = load();
        if (!config.workflows[name]) throw new Error(`Workflow not found: ${name}`);
        (config.workflows[name] as any)[field] = value;
        save(config);
        console.log(`Workflow "${name}": ${key} = "${value}"`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  launcher
    .command('list')
    .description('List all registered profiles')
    .action(() => {
      const config = load();
      const currentWf = detectCurrentWorkflow();

      console.log('');
      console.log('Workflows:');
      const wfEntries = Object.entries(config.workflows);
      if (wfEntries.length === 0) {
        console.log('  (none)');
      } else {
        for (const [name, wf] of wfEntries) {
          const active = currentWf === name ? ' [active]' : '';
          const def = config.defaults.workflow === name ? ' ★' : '';
          const installStatus = checkWorkflowManifest(name, wf);
          const dateLabel = installStatus.date
            ? ` (${new Date(installStatus.date).toLocaleDateString()})`
            : '';
          const statusLabel = installStatus.installed
            ? `installed${dateLabel}`
            : 'not installed';
          console.log(`  ${name}${def}${active}  [${statusLabel}]`);
          console.log(`    CLAUDE.md:  ${wf.claudeMd}`);
          if (wf.cliTools) console.log(`    cli-tools:  ${wf.cliTools}`);
          if (wf.npmPackage) console.log(`    npm:        ${wf.npmPackage}`);
          if (installStatus.manifest) {
            console.log(`    manifest:   ${installStatus.manifest.id}`);
          }
        }
      }

      console.log('');
      console.log('Settings:');
      if (existsSync(SYSTEM_SETTINGS)) {
        console.log(`  system (default)  →  ${SYSTEM_SETTINGS}`);
      }
      const sEntries = Object.entries(config.settings);
      if (sEntries.length === 0 && !existsSync(SYSTEM_SETTINGS)) {
        console.log('  (none)');
      } else {
        for (const [name, s] of sEntries) {
          const def = config.defaults.settings === name ? ' ★' : '';
          console.log(`  ${name}${def}  →  ${s.path}`);
        }
      }
      console.log('');
    });

  launcher
    .command('migrate')
    .description('Import profiles from start-claude (~/.start-claude/profiles.json)')
    .action(() => {
      const count = migrateFromStartClaude();
      if (count > 0) {
        console.log(`Migrated ${count} settings profiles from start-claude`);
      } else {
        console.log('No new profiles to migrate (already imported or start-claude config not found)');
      }
    });

  launcher
    .command('status')
    .description('Show current active workflow and settings')
    .action(() => {
      const config = load();
      const currentWf = detectCurrentWorkflow();
      printStatusDashboard(config, currentWf);
    });
}
