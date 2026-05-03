// ---------------------------------------------------------------------------
// `maestro uninstall` — remove installed maestro assets using manifests
//
// Interactive Ink TUI by default. Supports --all -y for non-interactive.
// Cleans up files, MCP config, and hooks.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import {
  getAllManifests,
  cleanManifestFiles,
  deleteManifest,
  type Manifest,
} from '../core/manifest.js';
import { deleteOverlayManifest } from '../core/overlay/applier.js';
import { removeMcpServer } from './install-backend.js';
import {
  removeMaestroHooks,
  loadClaudeSettings,
  getClaudeSettingsPath,
} from './hooks.js';
import { runUninstallFlow } from '../tui/uninstall-ui/index.js';
import { t } from '../i18n/index.js';

// ---------------------------------------------------------------------------
// Helpers (used by --all -y non-interactive path)
// ---------------------------------------------------------------------------

function formatManifest(m: Manifest): string {
  const date = m.installedAt.split('T')[0];
  return `[${m.scope}] ${m.targetPath} (${(m.entries ?? []).length} entries, ${date})`;
}

function uninstallManifest(manifest: Manifest): { removed: number; skipped: number; mcp: boolean; hooks: boolean } {
  const { removed, skipped } = cleanManifestFiles(manifest);

  const targetBase = manifest.scope === 'global' ? homedir() : manifest.targetPath;
  deleteOverlayManifest(manifest.scope, targetBase);

  const mcp = removeMcpServer(manifest.scope, manifest.targetPath);

  let hooks = false;
  const settingsPath = manifest.scope === 'global'
    ? getClaudeSettingsPath()
    : join(manifest.targetPath, '.claude', 'settings.json');

  if (existsSync(settingsPath)) {
    const settings = loadClaudeSettings(settingsPath);
    const hadHooks = !!settings.hooks;
    if (settings.statusLine?.command?.includes('maestro')) delete settings.statusLine;
    removeMaestroHooks(settings);
    if (hadHooks && !settings.hooks) hooks = true;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  deleteManifest(manifest);
  return { removed, skipped, mcp, hooks };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove installed maestro assets (interactive)')
    .option('--all', 'Uninstall all recorded installations')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (opts: { all?: boolean; yes?: boolean }) => {
      const manifests = getAllManifests();

      if (manifests.length === 0) {
        console.error('No installations found.');
        return;
      }

      // --all -y: non-interactive batch uninstall
      if (opts.all) {
        console.error(`Found ${manifests.length} installation(s):`);
        for (const m of manifests) console.error(`  ${formatManifest(m)}`);

        if (!opts.yes) {
          try {
            const ok = await confirm({
              message: t.uninstall.promptConfirm.replace('{count}', String(manifests.length)),
              default: false,
            });
            if (!ok) { console.error('Cancelled.'); return; }
          } catch (err) {
            if (err instanceof ExitPromptError) { console.error('Cancelled.'); return; }
            throw err;
          }
        }

        for (const m of manifests) {
          console.error(`\n${formatManifest(m)}`);
          const r = uninstallManifest(m);
          const parts = [`${r.removed} removed`];
          if (r.skipped > 0) parts.push(`${r.skipped} preserved`);
          if (r.mcp) parts.push('MCP cleaned');
          if (r.hooks) parts.push('hooks cleaned');
          console.error(`  ${parts.join(', ')}`);
        }
        console.error('\nDone.');
        return;
      }

      // Interactive: launch Ink TUI
      await runUninstallFlow(manifests);
    });
}
