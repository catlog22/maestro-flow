import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';

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

export interface ResolvedCommandSource {
  path: string;
  relativePath: string;
  raw: string;
  contentHash: string;
  contract: CommandContract;
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
  const candidates = names.flatMap(name => [
    join(projectRoot, '.claude', 'commands', `${name}.md`),
    join(projectRoot, '.claude', 'skills', name, 'SKILL.md'),
  ]);
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) {
    const empty = '';
    return {
      path: '',
      relativePath: '',
      raw: empty,
      contentHash: sha256(empty),
      contract: commandContractSchema.parse({}),
    };
  }
  const raw = readFileSync(path, 'utf8');
  return {
    path,
    relativePath: relative(projectRoot, path).replaceAll('\\', '/'),
    raw,
    contentHash: sha256(raw),
    contract: commandContractSchema.parse(extractContract(raw)),
  };
}
