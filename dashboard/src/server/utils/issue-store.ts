// ---------------------------------------------------------------------------
// Unified JSONL I/O + shared write lock for issue storage
// ---------------------------------------------------------------------------
// Single source of truth for reading/writing issues.jsonl.
// Both routes/issues.ts and execution-scheduler.ts import from here,
// ensuring all writes go through the same lock.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Issue } from '../../shared/issue-types.js';

// ---------------------------------------------------------------------------
// Write lock — single shared lock across the entire process
// ---------------------------------------------------------------------------

let writeLock: Promise<void> = Promise.resolve();

export function withIssueWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve!: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

/** Generate a unique issue ID: ISS-{timestamp_base36}-{random_4char} */
export function generateIssueId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `ISS-${ts}-${rand}`;
}

/**
 * Resolve the issues.jsonl path for a workflow root.
 * Primary: <root>/issues/issues.jsonl
 * Fallback: <root>/issues.jsonl (older sandbox layout)
 */
export async function resolveIssuesJsonlPath(workflowRoot: string): Promise<string> {
  const primary = join(workflowRoot, 'issues', 'issues.jsonl');
  try {
    await access(primary);
    return primary;
  } catch {
    const fallback = join(workflowRoot, 'issues.jsonl');
    try {
      await access(fallback);
      return fallback;
    } catch {
      return primary; // default to primary for writes
    }
  }
}

/** Read all issues from a JSONL file. Returns [] if file does not exist. */
export async function readIssuesJsonl(filePath: string): Promise<Issue[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }
  const issues: Issue[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      issues.push(JSON.parse(trimmed) as Issue);
    } catch {
      // Skip malformed lines
    }
  }
  return issues;
}

/** Write all issues to a JSONL file (one JSON object per line). */
export async function writeIssuesJsonl(filePath: string, issues: Issue[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const content = issues.map((i) => JSON.stringify(i)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
}

/** Append a single issue to the JSONL file. */
export async function appendIssueJsonl(filePath: string, issue: Issue): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    // File does not exist yet
  }
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(filePath, existing + sep + JSON.stringify(issue) + '\n', 'utf-8');
}
