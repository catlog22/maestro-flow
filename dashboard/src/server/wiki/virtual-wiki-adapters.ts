import { readFile } from 'node:fs/promises';

import type { WikiEntry, WikiStatus } from './wiki-types.js';

/**
 * Virtual wiki adapters: read-only reflections of JSONL rows as WikiEntries.
 * Never mutate the source files. Return null on schema violation (logged once
 * per process) so a malformed row cannot break the whole scan.
 */

const warnOnce = new Set<string>();
function warn(key: string, message: string): void {
  if (warnOnce.has(key)) return;
  warnOnce.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[wiki-indexer] ${message}`);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toIso(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function mapIssueStatus(raw: unknown): WikiStatus {
  switch (raw) {
    case 'resolved':
    case 'closed':
      return 'completed';
    case 'deferred':
      return 'archived';
    case 'in_progress':
      return 'active';
    default:
      return 'draft';
  }
}

export function adaptIssueRow(
  row: unknown,
  sourcePath: string,
  line: number,
): WikiEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = asString(r.id);
  if (!id) {
    warn(`issue-no-id:${sourcePath}`, `issue row at ${sourcePath}:${line} missing id`);
    return null;
  }
  const title = asString(r.title) || `Issue ${id}`;
  const description = asString(r.description);
  const issueType = asString(r.type);
  const priority = asString(r.priority);

  const tags: string[] = [];
  if (issueType) tags.push(issueType);
  if (priority) tags.push(priority);

  return {
    id: `issue-${id}`,
    type: 'issue',
    title,
    summary: description.slice(0, 240),
    tags,
    status: mapIssueStatus(r.status),
    created: toIso(r.created_at),
    updated: toIso(r.updated_at),
    related: [],
    source: { kind: 'virtual', path: sourcePath, line },
    body: '',
    raw: row,
    ext: {
      issueType,
      priority,
      rawStatus: r.status,
      execution: r.execution,
    },
    category: issueType || null,
    createdBy: null,
    sourceRef: id,
    parent: null,
  };
}

export function adaptLessonRow(
  row: unknown,
  sourcePath: string,
  line: number,
): WikiEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  // patterns.jsonl shape: { command, frequency, successRate, avgDuration, lastUsed, contexts[] }
  const command = asString(r.command);
  if (!command) {
    warn(`lesson-no-command:${sourcePath}`, `lesson row at ${sourcePath}:${line} missing command`);
    return null;
  }

  const frequency = typeof r.frequency === 'number' ? r.frequency : 0;
  const successRate = typeof r.successRate === 'number' ? r.successRate : 0;
  const avgDuration = typeof r.avgDuration === 'number' ? r.avgDuration : 0;
  const contexts = Array.isArray(r.contexts) ? r.contexts.map(String) : [];

  const successPct = Math.round(successRate * 100);
  const durationSec = Math.round(avgDuration / 1000);

  const title = `Pattern: ${command}`;
  const summary =
    `Used ${frequency}× • ${successPct}% success • ~${durationSec}s avg` +
    (contexts.length ? ` • ${contexts.length} context(s)` : '');

  const slug = command.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const lastUsed = toIso(r.lastUsed);

  return {
    id: `lesson-${slug || `row${line}`}`,
    type: 'lesson',
    title,
    summary,
    tags: ['pattern', command],
    status: 'active',
    created: lastUsed,
    updated: lastUsed,
    related: [],
    source: { kind: 'virtual', path: sourcePath, line },
    body: '',
    raw: row,
    ext: {
      command,
      frequency,
      successRate,
      avgDuration,
      contexts,
    },
    category: 'learning',
    createdBy: null,
    sourceRef: null,
    parent: null,
  };
}

export async function loadVirtualEntries(
  absPath: string,
  kind: 'issue' | 'lesson',
  relPath: string,
): Promise<WikiEntry[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf-8');
  } catch {
    return [];
  }
  const out: WikiEntry[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warn(`bad-json:${absPath}:${i + 1}`, `invalid JSON at ${absPath}:${i + 1}`);
      continue;
    }
    const entry =
      kind === 'issue'
        ? adaptIssueRow(parsed, relPath, i + 1)
        : adaptLessonRow(parsed, relPath, i + 1);
    if (entry) out.push(entry);
  }
  return out;
}
