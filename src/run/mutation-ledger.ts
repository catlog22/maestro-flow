import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { SessionStore } from './store.js';

export interface MutationEntry {
  timestamp: string;
  actor: string;
  target: string;
  content_hash: string | null;
  mutation_type: 'write' | 'append' | 'delete' | 'patch';
  run_id: string | null;
}

const mutationEntrySchema = z.object({
  timestamp: z.string(),
  actor: z.string().min(1),
  target: z.string(),
  content_hash: z.string().nullable(),
  mutation_type: z.enum(['write', 'append', 'delete', 'patch']),
  run_id: z.string().nullable(),
}).strict();

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
  const record: MutationEntry = { timestamp: localISO(), ...entry };
  mutationEntrySchema.parse(record);
  new SessionStore(projectRoot).appendLine(path, JSON.stringify(record));
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
    .map((line, index) => {
      try {
        return mutationEntrySchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid mutation ledger entry at line ${index + 1}: ${(error as Error).message}`);
      }
    });
}
