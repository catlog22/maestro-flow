/**
 * Workspace Command — Cross-workspace knowledge sharing management.
 *
 * Subcommands:
 *   maestro workspace link   <path> [--name <n>] [--share spec,knowhow,domain] [--write spec]
 *   maestro workspace unlink <name>
 *   maestro workspace list   [--json]
 *   maestro workspace status [--json]
 *   maestro workspace identity <init|show|reseed>
 */

import type { Command } from 'commander';
import { basename, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireFileLocksSync } from '../utils/atomic-write.js';

import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  resolveWorkspaceLinks,
} from '../config/index.js';
import type { WorkspaceCorpus } from '../types/index.js';
import {
  CURRENT_REPOSITORY_ALIAS,
  canonicalizeRepositoryRoot,
  initializeRepositoryIdentity,
  readRepositoryIdentity,
  reseedRepositoryIdentity,
} from '../repository/context.js';

const VALID_SHARE_TYPES: WorkspaceCorpus[] = ['spec', 'knowhow', 'domain', 'codebase', 'session'];

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

function runLink(targetPath: string, opts: { name?: string; share?: string; write?: string }): void {
  const projectPath = canonicalizeRepositoryRoot(process.cwd());
  const resolvedTarget = canonicalizeRepositoryRoot(resolve(projectPath, targetPath));
  const resolvedSelf = projectPath;

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
  const writeTypes = opts.write ? parseShareTypes(opts.write) : [];
  const name = opts.name ?? basename(resolvedTarget);

  if (name === CURRENT_REPOSITORY_ALIAS) {
    console.error('Error: workspace alias "current" is reserved.');
    process.exit(1);
  }
  if (!name || /[^a-zA-Z0-9_-]/.test(name)) {
    console.error(`Error: workspace name must be alphanumeric with hyphens/underscores (got "${name}")`);
    process.exit(1);
  }

  for (const corpus of writeTypes) {
    if (!shareTypes.includes(corpus)) {
      console.error(`Error: write capability "${corpus}" also requires read sharing for that corpus.`);
      process.exit(1);
    }
  }

  const targetIdentity = readRepositoryIdentity(resolvedTarget);
  if (writeTypes.length > 0 && !targetIdentity) {
    console.error('Error: linked writes require a persisted target repository identity.');
    console.error(`Run 'maestro workspace identity init' in ${resolvedTarget} first.`);
    process.exit(1);
  }
  const currentIdentity = readRepositoryIdentity(projectPath);
  if (currentIdentity && targetIdentity?.repo_id === currentIdentity.repo_id) {
    console.error('Error: target has the same stable repository identity as the current repository.');
    console.error('If this is an intentional fork, explicitly reseed one copy first.');
    process.exit(1);
  }

  const config = loadWorkspaceConfig(projectPath);
  if (config.linked.some(l => l.name === name)) {
    console.error(`Error: workspace "${name}" is already linked. Use 'unlink' first to replace.`);
    process.exit(1);
  }

  config.linked.push({
    name,
    path: targetPath,
    share: shareTypes,
    write: writeTypes,
    ...(targetIdentity ? { repo_id: targetIdentity.repo_id } : {}),
  });
  saveWorkspaceConfig(projectPath, config);

  console.log(`Linked workspace "${name}"`);
  console.log(`  Path:  ${targetPath} → ${resolvedTarget}`);
  console.log(`  Read:  ${shareTypes.join(', ')}`);
  console.log(`  Write: ${writeTypes.length > 0 ? writeTypes.join(', ') : '(none)'}`);
  console.log(`  Repo:  ${targetIdentity?.repo_id ?? '(legacy identity not persisted)'}`);
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
// explicit linked write authorization
// ---------------------------------------------------------------------------

function mutateWriteCapabilities(
  name: string,
  typesInput: string,
  operation: 'grant' | 'revoke',
): void {
  const projectPath = canonicalizeRepositoryRoot(process.cwd());
  const configPath = join(projectPath, '.workflow', 'config.json');
  const release = acquireFileLocksSync([configPath]);
  try {
    const config = loadWorkspaceConfig(projectPath);
    const link = config.linked.find(item => item.name === name || item.repo_id === name);
    if (!link) throw new Error(`Linked repository not found: ${name}`);
    const types = parseShareTypes(typesInput);
    if (operation === 'grant') {
      const inspected = resolveWorkspaceLinks(projectPath, { linked: [link] })[0];
      if (!inspected.valid || !inspected.identityPersisted || !inspected.repoId) {
        throw new Error(inspected.error ?? 'Linked writes require a valid persisted target identity');
      }
      for (const corpus of types) {
        if (!link.share.includes(corpus)) {
          throw new Error(`Write capability "${corpus}" also requires read sharing for that corpus`);
        }
      }
      link.repo_id = inspected.repoId;
      link.write = [...new Set([...(link.write ?? []), ...types])];
    } else {
      const revoked = new Set(types);
      link.write = (link.write ?? []).filter(corpus => !revoked.has(corpus));
    }
    saveWorkspaceConfig(projectPath, config);
    console.log(`${operation === 'grant' ? 'Granted' : 'Revoked'} linked write capability for "${link.name}".`);
    console.log(`  Write: ${(link.write ?? []).length > 0 ? (link.write ?? []).join(', ') : '(none)'}`);
  } finally {
    release();
  }
}

function runWriteStatus(name: string | undefined, opts: { json?: boolean }): void {
  const projectPath = canonicalizeRepositoryRoot(process.cwd());
  const resolved = resolveWorkspaceLinks(projectPath, loadWorkspaceConfig(projectPath))
    .filter(link => !name || link.name === name || link.repoId === name)
    .map(link => ({
      name: link.name,
      repo_id: link.repoId,
      valid: link.valid,
      shared: link.share,
      write: link.write ?? [],
      identity_persisted: link.identityPersisted,
      ...(link.error ? { error: link.error } : {}),
    }));
  if (name && resolved.length === 0) throw new Error(`Linked repository not found: ${name}`);
  if (opts.json) {
    console.log(JSON.stringify(resolved, null, 2));
    return;
  }
  if (resolved.length === 0) {
    console.log('No linked workspaces.');
    return;
  }
  for (const entry of resolved) {
    console.log(`${entry.name} (${entry.repo_id ?? 'legacy identity not persisted'})`);
    console.log(`  Shared: ${entry.shared.length > 0 ? entry.shared.join(', ') : '(none)'}`);
    console.log(`  Write:  ${entry.write.length > 0 ? entry.write.join(', ') : '(none)'}`);
    console.log(`  Status: ${entry.valid ? 'valid' : `invalid${entry.error ? ` — ${entry.error}` : ''}`}`);
  }
}

function reportWorkspaceAction(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
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
    console.log(`       Read:  ${lw.share.join(', ')}`);
    console.log(`       Write: ${(lw.write ?? []).length > 0 ? (lw.write ?? []).join(', ') : '(none)'}`);
    console.log(`       Repo:  ${lw.repoId ?? '(legacy identity not persisted)'}`);
    if (lw.error) console.log(`       Error: ${lw.error}`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const projectPath = process.cwd();
  const currentIdentity = readRepositoryIdentity(projectPath);
  const config = loadWorkspaceConfig(projectPath);
  const resolved = resolveWorkspaceLinks(projectPath, config);

  const statuses: Array<Record<string, unknown>> = [];

  for (const lw of resolved) {
    const entry: Record<string, unknown> = {
      name: lw.name,
      path: lw.resolvedPath,
      valid: lw.valid,
      share: lw.share,
      write: lw.write ?? [],
      repo_id: lw.repoId,
      repo_name: lw.repoName,
      identity_persisted: lw.identityPersisted,
      ...(lw.error ? { error: lw.error } : {}),
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

  console.log(`Current repository: ${currentIdentity?.repo_name ?? basename(resolve(projectPath))}`);
  console.log(`  Repo ID: ${currentIdentity?.repo_id ?? '(legacy identity not persisted)'}`);
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

function parseShareTypes(input: string): WorkspaceCorpus[] {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const result: WorkspaceCorpus[] = [];
  for (const p of parts) {
    if (!VALID_SHARE_TYPES.includes(p as WorkspaceCorpus)) {
      console.error(`Error: invalid share type "${p}". Valid: ${VALID_SHARE_TYPES.join(', ')}`);
      process.exit(1);
    }
    if (!result.includes(p as WorkspaceCorpus)) result.push(p as WorkspaceCorpus);
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
        const glossaryYaml = join(workflowRoot, 'domain', 'glossary.yaml');
        const glossaryJson = join(workflowRoot, 'domain', 'glossary.json');
        const glossary = existsSync(glossaryYaml) ? glossaryYaml : existsSync(glossaryJson) ? glossaryJson : null;
        if (!glossary) return 0;
        const content = readFileSync(glossary, 'utf-8');
        const YAML = require('yaml');
        const raw = glossary.endsWith('.yaml')
          ? YAML.parse(content)
          : JSON.parse(content);
        return Array.isArray(raw.terms) ? raw.terms.length : 0;
      }
      case 'codebase': {
        const docIdx = join(workflowRoot, 'codebase', 'doc-index.json');
        return existsSync(docIdx) ? 1 : 0;
      }
      case 'session': {
        const dir = join(workflowRoot, 'sessions');
        if (!existsSync(dir)) return 0;
        return readdirSync(dir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'session.json')))
          .length;
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
// identity
// ---------------------------------------------------------------------------

function runIdentityInit(opts: { name?: string; json?: boolean }): void {
  const manifest = initializeRepositoryIdentity(process.cwd(), { repoName: opts.name });
  if (opts.json) console.log(JSON.stringify(manifest, null, 2));
  else {
    console.log('Repository identity initialized.');
    console.log(`  ID:      ${manifest.repo_id}`);
    console.log(`  Name:    ${manifest.repo_name}`);
    console.log(`  Created: ${manifest.created_at}`);
  }
}

function runIdentityShow(opts: { json?: boolean }): void {
  const identity = readRepositoryIdentity(process.cwd());
  if (!identity) {
    console.error('Error: repository identity is not initialized.');
    console.error("Run 'maestro workspace identity init' first.");
    process.exit(1);
  }
  if (opts.json) console.log(JSON.stringify(identity, null, 2));
  else {
    console.log('Repository identity:');
    console.log(`  ID:      ${identity.repo_id}`);
    console.log(`  Name:    ${identity.repo_name}`);
    console.log(`  Created: ${identity.created_at}`);
  }
}

function runIdentityReseed(opts: { name?: string; force?: boolean; json?: boolean }): void {
  if (!opts.force) {
    console.error('Error: reseeding changes stable repository identity and can invalidate every cached link.');
    console.error('Re-run with --force only for an intentional fork.');
    process.exit(1);
  }
  const result = reseedRepositoryIdentity(process.cwd(), { repoName: opts.name });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Repository identity reseeded (high-impact operation).');
    console.log(`  Previous: ${result.previous?.repo_id ?? '(none)'}`);
    console.log(`  Current:  ${result.current.repo_id}`);
    console.log('  Diagnostic: linked repositories caching the previous ID will now fail closed.');
  }
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
    .option('--share <types>', 'Comma-separated read capabilities: spec,knowhow,domain,codebase,session', 'spec,knowhow,domain')
    .option('--write <types>', 'Comma-separated write capabilities (must also be shared for reads)')
    .action((path: string, opts) => runLink(path, opts));

  ws.command('unlink <name>')
    .description('Remove a linked workspace')
    .action((name: string) => runUnlink(name));

  ws.command('grant <name>')
    .description('Explicitly grant linked write capability per corpus type')
    .requiredOption('--write <types>', 'Comma-separated corpus types to grant')
    .action((name: string, opts: { write: string }) => reportWorkspaceAction(
      () => mutateWriteCapabilities(name, opts.write, 'grant'),
    ));

  ws.command('revoke <name>')
    .description('Immediately revoke linked write capability per corpus type')
    .requiredOption('--write <types>', 'Comma-separated corpus types to revoke')
    .action((name: string, opts: { write: string }) => reportWorkspaceAction(
      () => mutateWriteCapabilities(name, opts.write, 'revoke'),
    ));

  const write = ws.command('write').description('Manage explicit linked write authorization');
  write.command('grant <name> <types>')
    .description('Grant comma-separated corpus write capabilities')
    .action((name: string, types: string) => reportWorkspaceAction(
      () => mutateWriteCapabilities(name, types, 'grant'),
    ));
  write.command('revoke <name> <types>')
    .description('Revoke comma-separated corpus write capabilities')
    .action((name: string, types: string) => reportWorkspaceAction(
      () => mutateWriteCapabilities(name, types, 'revoke'),
    ));
  write.command('status [name]')
    .description('Show effective linked write capabilities')
    .option('--json', 'Output as JSON')
    .action((name: string | undefined, opts: { json?: boolean }) => reportWorkspaceAction(
      () => runWriteStatus(name, opts),
    ));

  ws.command('list')
    .alias('ls')
    .description('List all linked workspaces')
    .option('--json', 'Output as JSON')
    .action((opts) => runList(opts));

  ws.command('status')
    .description('Show detailed status of linked workspaces')
    .option('--json', 'Output as JSON')
    .action(async (opts) => runStatus(opts));

  const identity = ws.command('identity').description('Manage stable repository identity');
  identity.command('init')
    .description('Persist a random stable identity for this repository')
    .option('--name <name>', 'Repository display name')
    .option('--json', 'Output as JSON')
    .action((opts) => runIdentityInit(opts));
  identity.command('show')
    .description('Show the persisted repository identity')
    .option('--json', 'Output as JSON')
    .action((opts) => runIdentityShow(opts));
  identity.command('reseed')
    .description('Explicitly assign a new identity to an intentional fork')
    .option('--name <name>', 'Repository display name')
    .option('--force', 'Acknowledge that cached links will be invalidated')
    .option('--json', 'Output as JSON')
    .action((opts) => runIdentityReseed(opts));
}
