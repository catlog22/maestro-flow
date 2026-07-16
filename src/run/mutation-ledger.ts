import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';

export interface MutationEntry {
  timestamp: string;
  actor: string;
  target: string;
  content_hash: string | null;
  mutation_type: 'write' | 'append' | 'delete' | 'patch';
  run_id: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function localISO(): string {
  return new Date().toISOString();
}

export function ledgerPath(projectRoot: string): string {
  return join(projectRoot, '.workflow', 'mutations.jsonl');
}

export function appendMutation(
  projectRoot: string,
  entry: Omit<MutationEntry, 'timestamp'>,
): void {
  const path = ledgerPath(projectRoot);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: MutationEntry = { timestamp: localISO(), ...entry };
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
}

export function logMutation(
  projectRoot: string,
  actor: string,
  targetPath: string,
  opts: {
    contentHash?: string;
    mutationType?: MutationEntry['mutation_type'];
    runId?: string;
  } = {},
): void {
  appendMutation(projectRoot, {
    actor,
    target: relative(projectRoot, targetPath).replaceAll('\\', '/'),
    content_hash: opts.contentHash ?? null,
    mutation_type: opts.mutationType ?? 'write',
    run_id: opts.runId ?? null,
  });
}

export function readLedger(projectRoot: string): MutationEntry[] {
  const path = ledgerPath(projectRoot);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as MutationEntry);
}
