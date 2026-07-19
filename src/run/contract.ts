import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';

import { paths } from '../config/paths.js';
import {
  contractSnapshotSchema,
  type ContractSnapshot,
} from './protocol-schemas.js';
import { sha256Digest, stableJsonUtf8 } from './transition-receipts.js';

const consumeV1Schema = z.object({
  kind: z.string().min(1),
  alias: z.string().min(1).optional(),
  required: z.boolean().default(false),
  require_status: z.literal('sealed').optional(),
}).passthrough();

const produceV1Schema = z.object({
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

const commandContractV1Schema = z.object({
  consumes: z.array(consumeV1Schema).default([]),
  produces: z.array(produceV1Schema).default([]),
  gates: z.object({
    entry: z.array(gateDefinitionSchema).default([]),
    exit: z.array(gateDefinitionSchema).default([]),
  }).default({ entry: [], exit: [] }),
}).passthrough();

export type ContractGateDefinition = z.infer<typeof gateDefinitionSchema>;

const consumeV20Schema = z.object({
  kind: z.string().min(1),
  alias: z.string().min(1).optional(),
  required: z.boolean(),
  require_status: z.literal('sealed').optional(),
  schema: z.string().min(1).optional(),
}).strict();

const consumeV21Schema = consumeV20Schema.extend({
  role: z.enum(['primary', 'attachment', 'evidence', 'checkpoint']).optional(),
}).strict();

const commandArgumentSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['boolean', 'enum', 'string', 'number']),
  required: z.boolean(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  question: z.string().min(1).optional(),
}).strict();

const produceV2Schema = z.object({
  kind: z.string().min(1),
  path: z.string().min(1),
  alias: z.string().min(1).optional(),
  role: z.enum(['primary', 'attachment', 'evidence', 'checkpoint']),
  required: z.boolean(),
  schema: z.string().min(1),
}).strict();

const gateDefinitionV2Schema = z.union([
  z.string().min(1),
  z.object({
    key: z.string().min(1),
    title: z.string().optional(),
    required: z.boolean(),
    blocking: z.boolean(),
    applicable_modes: z.array(z.enum(['quick', 'standard', 'full'])),
    check: z.record(z.string(), z.unknown()),
  }).strict(),
]);

function refineStrictContract(
  contract: { consumes: Array<{ alias?: string }>; produces: Array<{ alias?: string; path: string; role: string; required: boolean }> },
  context: z.RefinementCtx,
): void {
  const aliases = new Set<string>();
  for (const item of [...contract.consumes, ...contract.produces]) {
    if (!item.alias) continue;
    if (aliases.has(item.alias)) context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate contract alias: ${item.alias}` });
    aliases.add(item.alias);
  }
  const paths = new Set<string>();
  for (const output of contract.produces) {
    const normalized = output.path.replaceAll('\\', '/');
    if (!normalized.startsWith('outputs/') || normalized.split('/').includes('..') || normalized.startsWith('/')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `output path must remain under outputs/: ${output.path}` });
    }
    if (paths.has(normalized)) context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate output path: ${output.path}` });
    paths.add(normalized);
  }
  if (contract.produces.filter(item => item.role === 'primary' && item.required).length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'multiple required primary outputs are ambiguous' });
  }
}

const commandContractV20Schema = z.object({
  contract_version: z.literal(2),
  consumes: z.array(consumeV20Schema).default([]),
  produces: z.array(produceV2Schema).default([]),
  gates: z.object({
    entry: z.array(gateDefinitionV2Schema).default([]),
    exit: z.array(gateDefinitionV2Schema).default([]),
  }).strict().default({ entry: [], exit: [] }),
}).strict().superRefine(refineStrictContract);

const commandContractV21Schema = z.object({
  contract_version: z.literal(2.1),
  arguments: z.array(commandArgumentSchema).default([]),
  consumes: z.array(consumeV21Schema).default([]),
  produces: z.array(produceV2Schema).default([]),
  gates: z.object({
    entry: z.array(gateDefinitionV2Schema).default([]),
    exit: z.array(gateDefinitionV2Schema).default([]),
  }).strict().default({ entry: [], exit: [] }),
}).strict().superRefine(refineStrictContract);

export interface CommandContractConsume {
  kind: string;
  alias?: string;
  required: boolean;
  require_status?: 'sealed';
  schema?: string;
  role?: 'primary' | 'attachment' | 'evidence' | 'checkpoint';
}

export interface CommandArgumentContract {
  name: string;
  type: 'boolean' | 'enum' | 'string' | 'number';
  required: boolean;
  default?: string | number | boolean;
  question?: string;
}

export interface CommandContractProduce {
  kind: string;
  primary: boolean;
  path?: string;
  alias?: string;
  role?: 'primary' | 'attachment' | 'evidence' | 'checkpoint';
  required?: boolean;
  schema?: string;
}

export interface CommandContract {
  contract_version?: 1 | 2 | 2.1;
  schema_version?: 'command-contract/1.0' | 'command-contract/2.0' | 'command-contract/2.1';
  consumes: CommandContractConsume[];
  arguments: CommandArgumentContract[];
  produces: CommandContractProduce[];
  gates: { entry: ContractGateDefinition[]; exit: ContractGateDefinition[] };
  compatibility_warnings?: string[];
}

function semanticWarnings(raw: z.infer<typeof commandContractV1Schema>): string[] {
  const warnings: string[] = [];
  raw.consumes.forEach((item, index) => {
    for (const key of ['schema', 'optional', 'role']) {
      if (key in item) warnings.push(`v1 consumes[${index}].${key} is metadata-only; set contract_version: 2 to enforce it`);
    }
  });
  raw.produces.forEach((item, index) => {
    for (const key of ['schema', 'required', 'optional', 'role']) {
      if (key in item) warnings.push(`v1 produces[${index}].${key} is metadata-only; set contract_version: 2 to enforce it`);
    }
  });
  return warnings;
}

export function parseCommandContract(raw: unknown): CommandContract {
  if (raw && typeof raw === 'object' && 'contract_version' in raw) {
    const version = (raw as { contract_version?: unknown }).contract_version;
    if (version !== 2 && version !== 2.1) throw new Error(`Unsupported command contract_version: ${String(version)}`);
    const parsed = version === 2 ? commandContractV20Schema.parse(raw) : commandContractV21Schema.parse(raw);
    return {
      contract_version: version,
      schema_version: version === 2 ? 'command-contract/2.0' : 'command-contract/2.1',
      arguments: 'arguments' in parsed ? parsed.arguments : [],
      consumes: parsed.consumes,
      produces: parsed.produces.map(item => ({
        ...item,
        primary: item.role === 'primary',
      })),
      gates: parsed.gates,
      compatibility_warnings: [],
    };
  }
  const parsed = commandContractV1Schema.parse(raw ?? {});
  const warnings = semanticWarnings(parsed);
  return {
    contract_version: 1,
    schema_version: 'command-contract/1.0',
    arguments: [],
    consumes: parsed.consumes.map(item => ({
      kind: item.kind,
      ...(item.alias ? { alias: item.alias } : {}),
      required: item.required,
      ...(item.require_status ? { require_status: item.require_status } : {}),
      ...(typeof item.schema === 'string' ? { schema: item.schema } : {}),
    })),
    produces: parsed.produces.map(item => ({
      kind: item.kind,
      primary: item.primary,
      ...(item.path ? { path: item.path } : {}),
      ...(item.alias ? { alias: item.alias } : {}),
      role: item.primary ? 'primary' : 'attachment',
      required: false,
      ...(typeof item.schema === 'string' ? { schema: item.schema } : {}),
    })),
    gates: parsed.gates,
    compatibility_warnings: warnings,
  };
}

export function normalizedCommandContract(contract: CommandContract): Record<string, unknown> {
  if ((contract.contract_version ?? 1) === 2 || contract.contract_version === 2.1) {
    const v21 = contract.contract_version === 2.1;
    return {
      contract_version: contract.contract_version,
      ...(v21 ? { arguments: contract.arguments.map(item => ({ ...item })) } : {}),
      consumes: contract.consumes.map(item => ({
        kind: item.kind,
        ...(item.alias ? { alias: item.alias } : {}),
        required: item.required,
        ...(item.require_status ? { require_status: item.require_status } : {}),
        ...(item.schema ? { schema: item.schema } : {}),
        ...(v21 && item.role ? { role: item.role } : {}),
      })),
      produces: contract.produces.map(item => ({
        kind: item.kind,
        path: item.path,
        ...(item.alias ? { alias: item.alias } : {}),
        role: item.role,
        required: item.required,
        schema: item.schema,
      })),
      gates: contract.gates,
    };
  }
  return {
    contract_version: 1,
    consumes: contract.consumes.map(item => ({
      kind: item.kind,
      ...(item.alias ? { alias: item.alias } : {}),
      required: item.required,
      ...(item.require_status ? { require_status: item.require_status } : {}),
    })),
    produces: contract.produces.map(item => ({
      kind: item.kind,
      primary: item.primary,
      ...(item.path ? { path: item.path } : {}),
      ...(item.alias ? { alias: item.alias } : {}),
    })),
    gates: contract.gates,
  };
}

export function createContractSnapshot(contract: CommandContract, capturedAt = new Date().toISOString()): ContractSnapshot {
  const normalized = normalizedCommandContract(contract);
  return contractSnapshotSchema.parse({
    schema_version: 'contract-snapshot/1.0',
    contract_version: contract.contract_version === 2.1
      ? 'command-contract/2.1'
      : contract.contract_version === 2
        ? 'command-contract/2.0'
        : 'command-contract/1.0',
    normalized,
    snapshot_hash: sha256Digest(stableJsonUtf8(normalized)),
    parser_version: 'maestro-command-contract/2',
    captured_at: capturedAt,
    warnings: contract.compatibility_warnings ?? [],
  });
}

export function hashCommandContract(contract: CommandContract): string {
  return createHash('sha256').update(stableJsonUtf8(normalizedCommandContract(contract)), 'utf8').digest('hex');
}

const SESSION_MODES = ['run', 'brief', 'none', 'bootstrap'] as const;
export type SessionMode = typeof SESSION_MODES[number];

export interface ResolvedCommandSource {
  path: string;
  relativePath: string;
  raw: string;
  contentHash: string;
  contract: CommandContract;
  contractSnapshot: ContractSnapshot;
  contractWarnings: string[];
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
    const contract = parseCommandContract({});
    return {
      path: '',
      relativePath: '',
      raw: empty,
      contentHash: sha256(empty),
      contract,
      contractSnapshot: createContractSnapshot(contract),
      contractWarnings: contract.compatibility_warnings ?? [],
      sessionMode: 'run',
    };
  }
  const raw = readFileSync(path, 'utf8');
  const fm = extractFrontmatter(raw);
  const rawMode = fm?.['session-mode'];
  const sessionMode: SessionMode = typeof rawMode === 'string' && (SESSION_MODES as readonly string[]).includes(rawMode)
    ? rawMode as SessionMode
    : 'run';
  const contract = parseCommandContract(extractContract(raw));
  return {
    path,
    relativePath: relative(projectRoot, path).replaceAll('\\', '/'),
    raw,
    contentHash: sha256(raw),
    contract,
    contractSnapshot: createContractSnapshot(contract),
    contractWarnings: contract.compatibility_warnings ?? [],
    sessionMode,
  };
}

export interface ResolvedStepContent {
  prepare: { path: string; raw: string } | null;
  workflow: { path: string; raw: string } | null;
  runMode: { path: string; raw: string } | null;
  refs: Array<{ path: string; when: string }>;
  /** Workflow-declared finish norms (frontmatter `finish:`), appended to the `run check` finish checklist. */
  finish: string[];
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

function extractFinish(raw: string): string[] {
  const parsed = extractFrontmatter(raw);
  if (!parsed || !Array.isArray(parsed.finish)) return [];
  return parsed.finish.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

const PLATFORM_SUFFIX_RE = /\.(?:codex|agy|pi)\.md$/;

/** The step registry: the exact dir lists `resolveStepContent` resolves against. */
function stepRegistryDirs(projectRoot: string): { prepareDirs: string[]; workflowDirs: string[] } {
  const project = paths.project(projectRoot);
  return {
    prepareDirs: [project.prepare, paths.prepare, join(projectRoot, 'prepare')],
    workflowDirs: [
      join(project.workflow, 'workflows'),
      paths.workflows,
      join(projectRoot, 'workflows'),
    ],
  };
}

function resolveAssociatedWorkflow(
  dirs: string[],
  commandName: string,
): { path: string; raw: string; association: WorkflowAssociation } | null {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const matches = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !PLATFORM_SUFFIX_RE.test(entry.name))
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
  const { prepareDirs, workflowDirs } = stepRegistryDirs(projectRoot);

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
  const finish = workflow ? extractFinish(workflow.raw) : [];

  return { prepare, workflow, runMode, refs, finish };
}

export interface StepRegistryEntry {
  name: string;
  scope: 'global' | 'project';
  source: 'prepare' | 'workflow' | 'association';
  path: string;
}

/**
 * Enumerate every step name `resolveStepContent` can resolve: prepare/workflow
 * basenames plus workflow frontmatter command aliases. This is the build-time
 * mirror of the run-time step registry — `ralph skills --steps` exposes it so
 * chain-build prevalidation validates against the same name space `run next`
 * loads from.
 */
export function listResolvableSteps(projectRoot: string): StepRegistryEntry[] {
  const { prepareDirs, workflowDirs } = stepRegistryDirs(projectRoot);
  const globalDirs = new Set([paths.prepare, paths.workflows]);
  const seen = new Map<string, StepRegistryEntry>();
  const add = (entry: StepRegistryEntry) => {
    if (!seen.has(entry.name)) seen.set(entry.name, entry);
  };
  const scanDir = (dir: string, source: 'prepare' | 'workflow') => {
    if (!existsSync(dir)) return;
    const scope = globalDirs.has(dir) ? 'global' as const : 'project' as const;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith('.md') || PLATFORM_SUFFIX_RE.test(item.name)) continue;
      const path = join(dir, item.name);
      add({ name: basename(item.name, '.md'), scope, source, path });
      if (source === 'workflow') {
        const association = extractWorkflowAssociation(readFileSync(path, 'utf8'));
        for (const alias of association?.commands ?? []) {
          add({ name: alias, scope, source: 'association', path });
        }
      }
    }
  };
  for (const dir of prepareDirs) scanDir(dir, 'prepare');
  for (const dir of workflowDirs) scanDir(dir, 'workflow');
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
