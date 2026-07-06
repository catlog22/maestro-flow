// ---------------------------------------------------------------------------
// `maestro uninstall` — remove installed maestro assets using manifests
//
// Interactive Ink TUI by default. Supports --all -y for non-interactive.
// All removal goes through the unified uninstallManifest() function which
// reads the manifest as the source of truth — no marker scanning.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import {
  getAllManifests,
  type Manifest,
} from '../core/manifest.js';
import {
  uninstallManifest,
  scanFallbackTargets,
  performFallbackCleanup,
  type UninstallResult,
} from './install-backend.js';
import { runUninstallFlow } from '../tui/uninstall-ui/index.js';
import { t } from '../i18n/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatManifest(m: Manifest): string {
  const date = m.installedAt.split('T')[0];
  return `[${m.scope}] ${m.targetPath} (${(m.entries ?? []).length} entries, ${date})`;
}

function formatResult(r: UninstallResult): string {
  const parts: string[] = [`${r.filesRemoved} removed`];
  if (r.filesSkipped > 0) parts.push(`${r.filesSkipped} preserved`);
  if (r.claudeHooksRemoved > 0) parts.push(`${r.claudeHooksRemoved} claude hooks`);
  if (r.codexHooksRemoved > 0) parts.push(`${r.codexHooksRemoved} codex hooks`);
  if (r.agyHooksRemoved > 0) parts.push(`${r.agyHooksRemoved} agy hooks`);
  if (r.statuslineRemoved) parts.push('statusline');
  if (r.mcpRemoved.claude) parts.push('claude mcp');
  if (r.mcpRemoved.codex) parts.push('codex mcp');
  if (r.mcpRemoved.extras.length) parts.push(`${r.mcpRemoved.extras.length} extra mcp`);
  return parts.join(', ');
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
        // Fallback: scan for orphaned files when manifests are missing
        const scan = scanFallbackTargets('global', '');
        if (scan.totalFiles === 0 && !scan.hooksFound && !scan.claudeMcpFound && !scan.codexMcpFound) {
          console.error('No installations found.');
          return;
        }

        console.error('No manifests found, but maestro files detected (orphaned install):');
        if (scan.totalFiles > 0) {
          console.error(`  Files: ${scan.totalFiles} across ${scan.directories.length} directories`);
          for (const d of scan.directories.slice(0, 8)) {
            console.error(`    ${d.path} (${d.fileCount} files)`);
          }
          if (scan.directories.length > 8) {
            console.error(`    ... and ${scan.directories.length - 8} more directories`);
          }
        }
        if (scan.hooksFound) console.error('  Hooks: maestro hooks in settings');
        if (scan.statuslineFound) console.error('  Statusline: maestro statusline in settings');
        if (scan.claudeMcpFound) console.error('  MCP: claude maestro-tools registered');
        if (scan.codexMcpFound) console.error('  MCP: codex maestro-tools registered');

        if (!opts.yes) {
          try {
            const ok = await confirm({
              message: 'Remove all detected maestro files and config?',
              default: false,
            });
            if (!ok) { console.error('Cancelled.'); return; }
          } catch (err) {
            if (err instanceof ExitPromptError) { console.error('Cancelled.'); return; }
            throw err;
          }
        }

        const r = performFallbackCleanup('global', '');
        console.error(`\n  ${formatResult(r)}`);
        console.error('\nDone (fallback cleanup).');
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

        let successCount = 0;
        let failCount = 0;
        for (const m of manifests) {
          console.error(`\n${formatManifest(m)}`);
          try {
            const r = uninstallManifest(m);
            console.error(`  ${formatResult(r)}`);
            successCount++;
          } catch (err) {
            failCount++;
            console.error(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        console.error('\nDone.' + (failCount > 0 ? ` (${successCount} succeeded, ${failCount} failed)` : ''));
        return;
      }

      // Interactive: launch Ink TUI
      await runUninstallFlow(manifests);
    });
}
