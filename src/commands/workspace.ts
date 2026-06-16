/**
 * Workspace Command — Cross-workspace knowledge sharing management.
 *
 * Subcommands:
 *   maestro workspace link   <path> [--name <n>] [--share spec,knowhow,domain]
 *   maestro workspace unlink <name>
 *   maestro workspace list   [--json]
 *   maestro workspace status [--json]
 */

import type { Command } from 'commander';
import { basename, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  resolveWorkspaceLinks,
} from '../config/index.js';
import type { WorkspaceShareType } from '../types/index.js';

const VALID_SHARE_TYPES: WorkspaceShareType[] = ['spec', 'knowhow', 'domain', 'codebase'];

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

function runLink(targetPath: string, opts: { name?: string; share?: string }): void {
  const projectPath = process.cwd();
  const resolvedTarget = resolve(projectPath, targetPath);
  const resolvedSelf = resolve(projectPath);

  if (resolvedTarget === resolvedSelf) {
    console.error('Error: cannot link a workspace to itself.');
    process.exit(1);
  }

  const targetWorkflow = join(resolvedTarget, '.workflow');
  if (!existsSync(targetWorkflow)) {
    console.error(`Error: no .workflow/ directory found at ${resolvedTarget}`);
    console.error('The target path must be a Maestro-managed project.');
    process.exit(1);
  }

  const shareTypes = parseShareTypes(opts.share ?? 'spec,knowhow,domain');
  const name = opts.name ?? basename(resolvedTarget);

  if (!name || /[^a-zA-Z0-9_-]/.test(name)) {
    console.error(`Error: workspace name must be alphanumeric with hyphens/underscores (got "${name}")`);
    process.exit(1);
  }

  const config = loadWorkspaceConfig(projectPath);
  if (config.linked.some(l => l.name === name)) {
    console.error(`Error: workspace "${name}" is already linked. Use 'unlink' first to replace.`);
    process.exit(1);
  }

  config.linked.push({ name, path: targetPath, share: shareTypes });
  saveWorkspaceConfig(projectPath, config);

  console.log(`Linked workspace "${name}"`);
  console.log(`  Path:  ${targetPath} → ${resolvedTarget}`);
  console.log(`  Share: ${shareTypes.join(', ')}`);
}

// ---------------------------------------------------------------------------
// unlink
// ---------------------------------------------------------------------------

function runUnlink(name: string): void {
  const projectPath = process.cwd();
  const config = loadWorkspaceConfig(projectPath);

  const idx = config.linked.findIndex(l => l.name === name);
  if (idx === -1) {
    console.error(`Error: workspace "${name}" not found.`);
    const names = config.linked.map(l => l.name);
    if (names.length > 0) {
      console.error(`Available: ${names.join(', ')}`);
    }
    process.exit(1);
  }

  config.linked.splice(idx, 1);
  saveWorkspaceConfig(projectPath, config);
  console.log(`Unlinked workspace "${name}".`);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function runList(opts: { json?: boolean }): void {
  const projectPath = process.cwd();
  const config = loadWorkspaceConfig(projectPath);
  const resolved = resolveWorkspaceLinks(projectPath, config);

  if (opts.json) {
    console.log(JSON.stringify(resolved, null, 2));
    return;
  }

  if (resolved.length === 0) {
    console.log('No linked workspaces.');
    return;
  }

  console.log(`Linked workspaces (${resolved.length}):\n`);
  for (const lw of resolved) {
    const status = lw.valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗ missing\x1b[0m';
    console.log(`  ${status}  ${lw.name}`);
    console.log(`       Path:  ${lw.path} → ${lw.resolvedPath}`);
    console.log(`       Share: ${lw.share.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const projectPath = process.cwd();
  const config = loadWorkspaceConfig(projectPath);
  const resolved = resolveWorkspaceLinks(projectPath, config);

  const statuses: Array<Record<string, unknown>> = [];

  for (const lw of resolved) {
    const entry: Record<string, unknown> = {
      name: lw.name,
      path: lw.resolvedPath,
      valid: lw.valid,
      share: lw.share,
    };

    if (lw.valid) {
      const counts: Record<string, number> = {};
      for (const st of lw.share) {
        counts[st] = countEntries(lw.workflowRoot, st);
      }
      entry.counts = counts;
    }

    statuses.push(entry);
  }

  if (opts.json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }

  if (statuses.length === 0) {
    console.log('No linked workspaces.');
    return;
  }

  console.log(`Workspace status (${statuses.length}):\n`);
  for (const s of statuses) {
    const status = s.valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗ missing\x1b[0m';
    console.log(`  ${status}  ${s.name}  (${s.path})`);
    if (s.valid && s.counts) {
      const counts = s.counts as Record<string, number>;
      const parts = Object.entries(counts).map(([k, v]) => `${k}: ${v}`);
      console.log(`       Entries: ${parts.join(', ')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseShareTypes(input: string): WorkspaceShareType[] {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const result: WorkspaceShareType[] = [];
  for (const p of parts) {
    if (!VALID_SHARE_TYPES.includes(p as WorkspaceShareType)) {
      console.error(`Error: invalid share type "${p}". Valid: ${VALID_SHARE_TYPES.join(', ')}`);
      process.exit(1);
    }
    result.push(p as WorkspaceShareType);
  }
  if (result.length === 0) {
    console.error('Error: at least one share type is required.');
    process.exit(1);
  }
  return result;
}

function countEntries(workflowRoot: string, shareType: string): number {
  try {
    switch (shareType) {
      case 'spec': {
        const dir = join(workflowRoot, 'specs');
        if (!existsSync(dir)) return 0;
        return readdirSync(dir).filter(f => f.endsWith('.md')).length;
      }
      case 'knowhow': {
        const dir = join(workflowRoot, 'knowhow');
        if (!existsSync(dir)) return 0;
        return countMdRecursive(dir);
      }
      case 'domain': {
        const glossary = join(workflowRoot, 'domain', 'glossary.json');
        if (!existsSync(glossary)) return 0;
        const raw = JSON.parse(readFileSync(glossary, 'utf-8'));
        return Array.isArray(raw.terms) ? raw.terms.length : 0;
      }
      case 'codebase': {
        const docIdx = join(workflowRoot, 'codebase', 'doc-index.json');
        return existsSync(docIdx) ? 1 : 0;
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

function countMdRecursive(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countMdRecursive(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      }
    }
  } catch {
    // best-effort
  }
  return count;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWorkspaceCommand(program: Command): void {
  const ws = program
    .command('workspace')
    .alias('ws')
    .description('Cross-workspace knowledge sharing — link, unlink, list, status');

  ws.command('link <path>')
    .description('Link another Maestro workspace for knowledge sharing')
    .option('--name <name>', 'Workspace name (defaults to directory basename)')
    .option('--share <types>', 'Comma-separated share types: spec,knowhow,domain,codebase', 'spec,knowhow,domain')
    .action((path: string, opts) => runLink(path, opts));

  ws.command('unlink <name>')
    .description('Remove a linked workspace')
    .action((name: string) => runUnlink(name));

  ws.command('list')
    .alias('ls')
    .description('List all linked workspaces')
    .option('--json', 'Output as JSON')
    .action((opts) => runList(opts));

  ws.command('status')
    .description('Show detailed status of linked workspaces')
    .option('--json', 'Output as JSON')
    .action(async (opts) => runStatus(opts));
}
