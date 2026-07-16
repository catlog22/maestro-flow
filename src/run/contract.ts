import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';

import { paths } from '../config/paths.js';

const consumeSchema = z.object({
  kind: z.string().min(1),
  alias: z.string().min(1).optional(),
  required: z.boolean().default(false),
  require_status: z.literal('sealed').optional(),
}).passthrough();

const produceSchema = z.object({
  kind: z.string().min(1),
  primary: z.boolean().default(false),
  path: z.string().min(1).optional(),
  alias: z.string().min(1).optional(),
}).passthrough();

const gateDefinitionSchema = z.union([
  z.string().min(1),
  z.object({
    key: z.string().min(1),
    title: z.string().optional(),
    required: z.boolean().default(true),
    blocking: z.boolean().default(true),
    applicable_modes: z.array(z.enum(['quick', 'standard', 'full'])).default([]),
    check: z.record(z.string(), z.unknown()),
  }).passthrough(),
]);

const commandContractSchema = z.object({
  consumes: z.array(consumeSchema).default([]),
  produces: z.array(produceSchema).default([]),
  gates: z.object({
    entry: z.array(gateDefinitionSchema).default([]),
    exit: z.array(gateDefinitionSchema).default([]),
  }).default({ entry: [], exit: [] }),
}).passthrough();

export type CommandContract = z.infer<typeof commandContractSchema>;
export type ContractGateDefinition = z.infer<typeof gateDefinitionSchema>;

const SESSION_MODES = ['run', 'brief', 'none', 'bootstrap'] as const;
export type SessionMode = typeof SESSION_MODES[number];

export interface ResolvedCommandSource {
  path: string;
  relativePath: string;
  raw: string;
  contentHash: string;
  contract: CommandContract;
  sessionMode: SessionMode;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function extractContract(raw: string): unknown {
  const tagged = raw.match(/<contract>\s*([\s\S]*?)\s*<\/contract>/i);
  if (tagged) {
    const parsed = YAML.parse(tagged[1]);
    if (parsed && typeof parsed === 'object' && 'contract' in parsed) {
      return (parsed as Record<string, unknown>).contract;
    }
    return parsed;
  }

  for (const match of raw.matchAll(/```(?:ya?ml)?\s*\n([\s\S]*?)```/gi)) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && 'contract' in parsed) {
        return (parsed as Record<string, unknown>).contract;
      }
    } catch { /* try next fenced block */ }
  }

  const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    try {
      const parsed = YAML.parse(frontmatter[1]);
      if (parsed && typeof parsed === 'object' && 'contract' in parsed) {
        return (parsed as Record<string, unknown>).contract;
      }
    } catch { /* no usable frontmatter contract */ }
  }
  return {};
}

export function resolveCommandSource(projectRoot: string, commandName: string): ResolvedCommandSource {
  const normalized = commandName.replace(/^\//, '').replace(/\.md$/i, '');
  const names = Array.from(new Set([
    normalized,
    normalized.startsWith('maestro-') ? normalized.slice('maestro-'.length) : `maestro-${normalized}`,
  ]));
  const project = paths.project(projectRoot);
  const prepareCandidates = names.flatMap(name => [
    join(project.prepare, `${name}.md`),
    join(paths.prepare, `${name}.md`),
    join(projectRoot, 'prepare', `${name}.md`),
  ]);
  const projectClaudeCandidates = names.flatMap(name => [
    join(projectRoot, '.claude', 'commands', `${name}.md`),
    join(projectRoot, '.claude', 'skills', name, 'SKILL.md'),
  ]);
  const claudeHome = process.env.MAESTRO_CLAUDE_HOME ?? join(homedir(), '.claude');
  const globalClaudeCandidates = names.flatMap(name => [
    join(claudeHome, 'commands', `${name}.md`),
    join(claudeHome, 'skills', name, 'SKILL.md'),
  ]);
  const projectCandidates = [
    ...prepareCandidates,
    ...projectClaudeCandidates,
  ];
  const path = projectCandidates.find(candidate => existsSync(candidate))
    ?? resolveStepContent(projectRoot, normalized).prepare?.path
    ?? globalClaudeCandidates.find(candidate => existsSync(candidate));
  if (!path) {
    const empty = '';
    return {
      path: '',
      relativePath: '',
      raw: empty,
      contentHash: sha256(empty),
      contract: commandContractSchema.parse({}),
      sessionMode: 'run',
    };
  }
  const raw = readFileSync(path, 'utf8');
  const fm = extractFrontmatter(raw);
  const rawMode = fm?.['session-mode'];
  const sessionMode: SessionMode = typeof rawMode === 'string' && (SESSION_MODES as readonly string[]).includes(rawMode)
    ? rawMode as SessionMode
    : 'run';
  return {
    path,
    relativePath: relative(projectRoot, path).replaceAll('\\', '/'),
    raw,
    contentHash: sha256(raw),
    contract: commandContractSchema.parse(extractContract(raw)),
    sessionMode,
  };
}

export interface ResolvedStepContent {
  prepare: { path: string; raw: string } | null;
  workflow: { path: string; raw: string } | null;
  runMode: { path: string; raw: string } | null;
  refs: Array<{ path: string; when: string }>;
}

const refEntrySchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    when: z.string().default(''),
  }).passthrough(),
]);

const workflowAssociationSchema = z.object({
  name: z.string().min(1),
  prepare: z.string().min(1),
  commands: z.array(z.string().min(1)).min(1),
}).passthrough();

type WorkflowAssociation = z.infer<typeof workflowAssociationSchema>;

function extractFrontmatter(raw: string): Record<string, unknown> | null {
  const frontmatter = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return null;
  try {
    const parsed = YAML.parse(frontmatter[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extractWorkflowAssociation(raw: string): WorkflowAssociation | null {
  const parsed = extractFrontmatter(raw);
  if (!parsed) return null;
  const result = workflowAssociationSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function resolveInDirs(dirs: string[], fileName: string): { path: string; raw: string } | null {
  for (const dir of dirs) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) {
      return { path: candidate, raw: readFileSync(candidate, 'utf8') };
    }
  }
  return null;
}

function extractRefs(raw: string): Array<{ path: string; when: string }> {
  const parsed = extractFrontmatter(raw);
  if (!parsed || !('refs' in parsed)) return [];
  const rawRefs = parsed.refs;
  if (!Array.isArray(rawRefs)) return [];
  const refs: Array<{ path: string; when: string }> = [];
  for (const entry of rawRefs) {
    const result = refEntrySchema.safeParse(entry);
    if (!result.success) continue;
    refs.push(
      typeof result.data === 'string'
        ? { path: result.data, when: '' }
        : { path: result.data.path, when: result.data.when },
    );
  }
  return refs;
}

function resolveAssociatedWorkflow(
  dirs: string[],
  commandName: string,
): { path: string; raw: string; association: WorkflowAssociation } | null {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const matches = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !/\.(?:codex|agy|pi)\.md$/.test(entry.name))
      .map(entry => {
        const path = join(dir, entry.name);
        const raw = readFileSync(path, 'utf8');
        return { path, raw, association: extractWorkflowAssociation(raw) };
      })
      .filter((item): item is { path: string; raw: string; association: WorkflowAssociation } =>
        item.association?.commands.includes(commandName) === true);
    if (matches.length > 1) {
      throw new Error(`Workflow command association is ambiguous for ${commandName}: ${matches.map(item => item.path).join(', ')}`);
    }
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function resolveStepContent(
  projectRoot: string,
  stepName: string,
  platformSuffix?: string,
): ResolvedStepContent {
  const normalized = stepName.replace(/^\//, '').replace(/\.md$/i, '');
  const project = paths.project(projectRoot);
  const prepareDirs = [project.prepare, paths.prepare, join(projectRoot, 'prepare')];
  const workflowDirs = [
    join(project.workflow, 'workflows'),
    paths.workflows,
    join(projectRoot, 'workflows'),
  ];

  const directWorkflow = resolveInDirs(workflowDirs, `${normalized}.md`);
  const associatedWorkflow = directWorkflow
    ? { ...directWorkflow, association: extractWorkflowAssociation(directWorkflow.raw) }
    : resolveAssociatedWorkflow(workflowDirs, normalized);
  const workflowBase = associatedWorkflow
    ? basename(associatedWorkflow.path, '.md')
    : normalized;
  const prepareBase = associatedWorkflow?.association?.prepare ?? workflowBase;

  // Platform override: e.g. execute.codex.md takes priority over execute.md.
  // Resolve the override from the canonical workflow/prepare names, not from a
  // command alias such as maestro-execute.
  const prepareOverride = platformSuffix ? `${prepareBase}${platformSuffix}` : null;
  const workflowOverride = platformSuffix ? `${workflowBase}${platformSuffix}` : null;
  const prepare = (prepareOverride && resolveInDirs(prepareDirs, prepareOverride))
    || resolveInDirs(prepareDirs, `${prepareBase}.md`);
  const workflow = (workflowOverride && resolveInDirs(workflowDirs, workflowOverride))
    || associatedWorkflow;

  const runModeOverride = platformSuffix
    ? resolveInDirs(workflowDirs, `run-mode${platformSuffix}`)
    : null;
  const runMode = runModeOverride || resolveInDirs(workflowDirs, 'run-mode.md');
  const refs = prepare ? extractRefs(prepare.raw) : [];

  return { prepare, workflow, runMode, refs };
}
