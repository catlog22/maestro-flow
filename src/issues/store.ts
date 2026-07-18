import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { FileLock } from '../graph/kg/sync/file-lock.js';

const issueSchema = z.object({
  id: z.string().regex(/^ISS-[A-Za-z0-9-]+$/),
  title: z.string().min(1),
  status: z.string().min(1),
}).passthrough();

export type IssueRecord = z.infer<typeof issueSchema>;

export interface IssuePaths {
  root: string;
  active: string;
  history: string;
  lock: string;
  backups: string;
}

export function resolveIssuePaths(workflowRoot = resolve('.workflow')): IssuePaths {
  const root = join(resolve(workflowRoot), 'issues');
  return {
    root,
    active: join(root, 'issues.jsonl'),
    history: join(root, 'issue-history.jsonl'),
    lock: join(root, '.issues.lock'),
    backups: join(root, '.backups'),
  };
}

export function readIssueFile(path: string): IssueRecord[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const records: IssueRecord[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid issue JSON at ${path}:${index + 1}: ${(error as Error).message}`);
    }
    const result = issueSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid issue record at ${path}:${index + 1}: ${result.error.message}`);
    }
    records.push(result.data);
  }
  return records;
}

function backup(path: string, backups: string): void {
  if (!existsSync(path)) return;
  mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(path, join(backups, `${basename(path)}.${stamp}.bak`));
}

function writeIssueFile(path: string, records: IssueRecord[], backups: string): void {
  const validated = records.map(record => issueSchema.parse(record));
  mkdirSync(dirname(path), { recursive: true });
  backup(path, backups);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const content = validated.length > 0
    ? `${validated.map(record => JSON.stringify(record)).join('\n')}\n`
    : '';
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
}

function dateStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function nextIssueId(active: IssueRecord[], history: IssueRecord[], now: Date): string {
  const prefix = `ISS-${dateStamp(now)}-`;
  const max = [...active, ...history].reduce((value, issue) => {
    if (!issue.id.startsWith(prefix)) return value;
    const sequence = Number(issue.id.slice(prefix.length));
    return Number.isInteger(sequence) ? Math.max(value, sequence) : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function appendHistory(issue: IssueRecord, from: string | null, to: string, note: string, now: string): IssueRecord {
  const history = Array.isArray(issue.issue_history) ? issue.issue_history : [];
  return {
    ...issue,
    issue_history: [...history, { timestamp: now, from_status: from, to_status: to, actor: 'maestro-cli', note }],
    updated_at: now,
  };
}

export async function createIssue(
  workflowRoot: string,
  input: { title: string; severity: string; source: string; priority: number; description?: string; tags?: string[] },
): Promise<IssueRecord> {
  const paths = resolveIssuePaths(workflowRoot);
  return new FileLock(paths.lock).withLock(async () => {
    const active = readIssueFile(paths.active);
    const history = readIssueFile(paths.history);
    const now = new Date();
    const iso = now.toISOString();
    const issue = issueSchema.parse({
      id: nextIssueId(active, history, now),
      title: input.title,
      status: 'open',
      priority: input.priority,
      severity: input.severity,
      source: input.source,
      description: input.description ?? '',
      fix_direction: '',
      context: { location: '', suggested_fix: '', notes: '' },
      tags: input.tags ?? [],
      affected_components: [],
      feedback: [],
      issue_history: [{ timestamp: iso, from_status: null, to_status: 'open', actor: 'maestro-cli', note: 'Issue created' }],
      created_at: iso,
      updated_at: iso,
      resolved_at: null,
      resolution: null,
    });
    writeIssueFile(paths.active, [...active, issue], paths.backups);
    return issue;
  });
}

export function listIssues(workflowRoot: string, includeHistory = false): IssueRecord[] {
  const paths = resolveIssuePaths(workflowRoot);
  return [...readIssueFile(paths.active), ...(includeHistory ? readIssueFile(paths.history) : [])];
}

export function getIssue(workflowRoot: string, id: string): IssueRecord | null {
  return listIssues(workflowRoot, true).find(issue => issue.id === id) ?? null;
}

export async function updateIssue(
  workflowRoot: string,
  id: string,
  updates: Record<string, unknown>,
  note?: string,
): Promise<IssueRecord> {
  const paths = resolveIssuePaths(workflowRoot);
  return new FileLock(paths.lock).withLock(async () => {
    const active = readIssueFile(paths.active);
    const index = active.findIndex(issue => issue.id === id);
    if (index < 0) throw new Error(`Active issue not found: ${id}`);
    const current = active[index];
    const iso = new Date().toISOString();
    let next = issueSchema.parse({ ...current, ...updates, updated_at: iso });
    if (updates.status && updates.status !== current.status) {
      next = appendHistory(next, current.status, String(updates.status), note ?? 'Issue updated', iso);
    } else if (note) {
      const feedback = Array.isArray(next.feedback) ? next.feedback : [];
      next = issueSchema.parse({ ...next, feedback: [...feedback, { timestamp: iso, type: 'clarification', content: note }] });
    }
    active[index] = next;
    writeIssueFile(paths.active, active, paths.backups);
    return next;
  });
}

export async function closeIssue(
  workflowRoot: string,
  id: string,
  status: 'completed' | 'failed' | 'deferred',
  resolutionText: string,
): Promise<IssueRecord> {
  const paths = resolveIssuePaths(workflowRoot);
  return new FileLock(paths.lock).withLock(async () => {
    const active = readIssueFile(paths.active);
    const index = active.findIndex(issue => issue.id === id);
    if (index < 0) throw new Error(`Active issue not found: ${id}`);
    const history = readIssueFile(paths.history);
    const current = active[index];
    const iso = new Date().toISOString();
    const closed = issueSchema.parse({
      ...appendHistory(current, current.status, status, resolutionText, iso),
      status,
      resolved_at: iso,
      resolution: resolutionText,
    });
    active.splice(index, 1);
    writeIssueFile(paths.active, active, paths.backups);
    writeIssueFile(paths.history, [...history, closed], paths.backups);
    return closed;
  });
}

export async function linkIssue(workflowRoot: string, id: string, taskId: string): Promise<IssueRecord> {
  const issue = getIssue(workflowRoot, id);
  if (!issue || ['completed', 'failed', 'deferred'].includes(issue.status)) {
    throw new Error(`Active issue not found: ${id}`);
  }
  const affected = Array.isArray(issue.affected_components) ? issue.affected_components.map(String) : [];
  return updateIssue(workflowRoot, id, {
    gap_ref: issue.gap_ref ?? taskId,
    affected_components: [...new Set([...affected, taskId])],
  }, `Linked task ${taskId}`);
}

export function issueStoreMtime(workflowRoot: string): number {
  const path = resolveIssuePaths(workflowRoot).active;
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}
