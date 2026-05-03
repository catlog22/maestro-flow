// ---------------------------------------------------------------------------
// `maestro overlay` — manage command overlays.
//
// Subcommands:
//   list             — show overlays on disk and their applied state
//   apply            — reapply all overlays to known installations (idempotent)
//   add <file>       — copy overlay JSON to ~/.maestro/overlays/ and apply
//   import <file>    — alias of `add`; validates + copies + applies
//   export <name>    — copy an installed overlay to a portable path
//   remove <name>    — strip markers from targets and delete overlay file
//   bundle           — pack overlays + docs into a single portable file
//   import-bundle    — unpack a bundle file into overlays + docs and apply
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../config/paths.js';
import { getAllManifests } from '../core/manifest.js';
import {
  applyOverlays,
  ensureOverlayDir,
  loadOverlayManifest,
  removeOverlayFromTargets,
  deleteOverlayManifest,
  exportOverlayFile,
  importOverlayFile,
  bundleOverlays,
  importBundle,
  type ApplyReport,
  type OverlayBundle,
} from '../core/overlay/applier.js';
import { loadOverlay, OverlayLoadError } from '../core/overlay/loader.js';
import { getProjectRoot } from '../utils/path-validator.js';
import { resolveSelf } from '../tools/team-members.js';

// ---------------------------------------------------------------------------
// Scope discovery
// ---------------------------------------------------------------------------

interface Scope {
  scope: 'global' | 'project';
  targetBase: string;
}

/** Known install scopes from install manifests. Fallback to homedir global. */
function discoverScopes(): Scope[] {
  const manifests = getAllManifests();
  const scopes: Scope[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    const targetBase = m.scope === 'global' ? homedir() : m.targetPath;
    const key = `${m.scope}:${targetBase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ scope: m.scope, targetBase });
  }
  // Fallback: if no manifests but global commands/skills dir exists, treat as global.
  if (scopes.length === 0) {
    const globalCmds = join(homedir(), '.claude', 'commands');
    const globalSkills = join(homedir(), '.codex', 'skills');
    if (existsSync(globalCmds) || existsSync(globalSkills)) {
      scopes.push({ scope: 'global', targetBase: homedir() });
    }
  }
  return scopes;
}

function overlayDir(): string {
  return join(paths.home, 'overlays');
}

// ---------------------------------------------------------------------------
// Subcommand: list (ink-based TUI)
// ---------------------------------------------------------------------------

async function runList(interactive: boolean): Promise<void> {
  const { runOverlayListUI } = await import('../tui/overlay-ui/index.js');
  await runOverlayListUI(interactive);
}

// ---------------------------------------------------------------------------
// Subcommand: apply
// ---------------------------------------------------------------------------

function runApply(): void {
  const dir = overlayDir();
  ensureOverlayDir(dir);

  const scopes = discoverScopes();
  if (scopes.length === 0) {
    console.error('No install scopes found. Run `maestro install` first.');
    return;
  }

  const reports: ApplyReport[] = [];
  for (const s of scopes) {
    console.error(`[${s.scope}] ${s.targetBase}`);
    const report = applyOverlays({
      scope: s.scope,
      targetBase: s.targetBase,
      overlayDir: dir,
    });
    reports.push(report);
    console.error(
      `  loaded=${report.overlaysLoaded} applied=${report.overlaysApplied} ` +
        `changed=${report.filesChanged} unchanged=${report.filesUnchanged}`,
    );
    if (report.skipped.length > 0) {
      for (const s of report.skipped) {
        console.error(`    skipped: ${s.overlay} → ${s.target} (${s.reason})`);
      }
    }
  }
  console.error('');
  console.error('Done.');
}

// ---------------------------------------------------------------------------
// Subcommand: add
// ---------------------------------------------------------------------------

function runAdd(file: string): void {
  const dir = overlayDir();
  try {
    const result = importOverlayFile(file, dir);
    console.error('');
    console.error('=== OVERLAY IMPORTED ===');
    console.error(`  Name:   ${result.overlayName}`);
    console.error(`  Source: ${result.source}`);
    console.error(`  Dest:   ${result.dest}`);
    if (result.overwritten) console.error('  Status: overwritten');
    console.error('');
  } catch (err) {
    if (err instanceof OverlayLoadError) {
      console.error(`Invalid overlay: ${err.filePath}`);
      for (const msg of err.errors) console.error(`  - ${msg}`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
  runApply();
}

// ---------------------------------------------------------------------------
// Subcommand: export
// ---------------------------------------------------------------------------

function runExport(name: string, opts: { out?: string }): void {
  const dir = overlayDir();
  const outPath = opts.out ?? resolve(process.cwd(), `${name}.json`);
  try {
    const result = exportOverlayFile(dir, name, outPath);
    console.error('');
    console.error('=== OVERLAY EXPORTED ===');
    console.error(`  Name:   ${result.overlayName}`);
    console.error(`  Source: ${result.source}`);
    console.error(`  Dest:   ${result.dest}`);
    console.error('');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: remove
// ---------------------------------------------------------------------------

function runRemove(name: string): void {
  const dir = overlayDir();

  // Strip markers from all scopes
  const scopes = discoverScopes();
  let filesChanged = 0;
  for (const s of scopes) {
    const res = removeOverlayFromTargets(name, s.scope, s.targetBase);
    filesChanged += res.filesChanged;
  }
  console.error(`Stripped markers from ${filesChanged} file(s).`);

  // Delete overlay file(s) matching the name
  if (existsSync(dir)) {
    let deleted = 0;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const fp = join(dir, entry);
      try {
        const overlay = loadOverlay(fp);
        if (overlay.meta.name === name) {
          unlinkSync(fp);
          deleted++;
        }
      } catch {
        // Skip unparseable files
      }
    }
    if (deleted > 0) console.error(`Deleted ${deleted} overlay file(s).`);
  }

  // Prune manifests that no longer have any applied overlays
  for (const s of scopes) {
    const m = loadOverlayManifest(s.scope, s.targetBase);
    if (m && m.appliedOverlays.length === 0) {
      deleteOverlayManifest(s.scope, s.targetBase);
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommand: bundle
// ---------------------------------------------------------------------------

function runBundle(opts: { out?: string; names?: string[] }): void {
  const dir = overlayDir();
  const outPath = opts.out ?? resolve(process.cwd(), 'overlays-bundle.json');
  try {
    const result = bundleOverlays(dir, outPath, opts.names);
    console.error('');
    console.error('=== BUNDLE CREATED ===');
    console.error(`  Path:     ${result.dest}`);
    console.error(`  Overlays: ${result.overlayCount}`);
    console.error(`  Docs:     ${result.docCount}`);
    console.error('');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: import-bundle
// ---------------------------------------------------------------------------

function runImportBundle(file: string): void {
  const dir = overlayDir();
  try {
    const result = importBundle(file, dir);
    console.error('');
    console.error('=== BUNDLE IMPORTED ===');
    console.error(`  Source: ${result.source}`);
    console.error(`  Docs:   ${result.docsWritten} file(s) restored`);
    console.error('');
    for (const item of result.items) {
      const tag = item.overwritten ? '(overwritten)' : '(new)';
      console.error(`  + ${item.name} ${tag}`);
    }
    console.error('');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  runApply();
}

// ---------------------------------------------------------------------------
// Subcommand: push (team sync — bundle to collab/overlays/)
// ---------------------------------------------------------------------------

function runOverlayPush(opts: { names?: string[] }): void {
  const self = resolveSelf();
  if (!self) {
    console.error("Team mode not enabled. Run 'maestro team join' first.");
    process.exit(1);
    return;
  }

  const dir = overlayDir();
  ensureOverlayDir(dir);

  // Bundle overlays into a temporary location first, then enrich with metadata
  const collabOverlaysDir = join(getProjectRoot(), '.workflow', 'collab', 'overlays');
  if (!existsSync(collabOverlaysDir)) mkdirSync(collabOverlaysDir, { recursive: true });

  const destPath = join(collabOverlaysDir, `${self.uid}-bundle.json`);

  try {
    const result = bundleOverlays(dir, destPath, opts.names);

    // Read back the bundle and enrich with team metadata
    const bundle: OverlayBundle = JSON.parse(readFileSync(destPath, 'utf-8'));
    bundle.sourceMember = self.uid;
    bundle.ts = new Date().toISOString();
    writeFileSync(destPath, JSON.stringify(bundle, null, 2), 'utf-8');

    console.error('');
    console.error('=== OVERLAY PUSHED ===');
    console.error(`  Member:   ${self.uid}`);
    console.error(`  Path:     ${result.dest}`);
    console.error(`  Overlays: ${result.overlayCount}`);
    console.error(`  Docs:     ${result.docCount}`);
    console.error('');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerOverlayCommand(program: Command): void {
  const overlay = program
    .command('overlay')
    .description('Manage command overlays — non-invasive patches for .claude/commands and .codex/skills');

  overlay
    .command('list')
    .description('Show overlays with cumulative section map and interactive management')
    .option('--no-interactive', 'Disable interactive mode (non-TTY safe)')
    .action((opts: { interactive?: boolean }) => runList(opts.interactive !== false));

  overlay
    .command('apply')
    .description('Reapply all overlays to known installations (idempotent)')
    .action(() => runApply());

  overlay
    .command('add <file>')
    .description('Install an overlay JSON file and apply it')
    .action((file: string) => runAdd(file));

  overlay
    .command('import <file>')
    .description('Import an overlay JSON file (alias of `add`)')
    .action((file: string) => runAdd(file));

  overlay
    .command('export <name>')
    .description('Export an installed overlay to a portable JSON path')
    .option('-o, --out <path>', 'Output file or directory (default: ./<name>.json)')
    .action((name: string, opts: { out?: string }) => runExport(name, opts));

  overlay
    .command('remove <name>')
    .description('Strip an overlay from targets and delete its file')
    .action((name: string) => runRemove(name));

  overlay
    .command('bundle')
    .description('Pack overlays (+ referenced docs) into a single portable JSON file')
    .option('-o, --out <path>', 'Output file (default: ./overlays-bundle.json)')
    .option('-n, --names <names...>', 'Only bundle specific overlays by name')
    .action((opts: { out?: string; names?: string[] }) => runBundle(opts));

  overlay
    .command('import-bundle <file>')
    .description('Import a bundle file, unpacking overlays and docs, then apply')
    .action((file: string) => runImportBundle(file));

  overlay
    .command('push')
    .description('Bundle overlays to .workflow/collab/overlays/ for team sharing')
    .option('-n, --names <names...>', 'Only push specific overlays by name')
    .action((opts: { names?: string[] }) => runOverlayPush(opts));
}
