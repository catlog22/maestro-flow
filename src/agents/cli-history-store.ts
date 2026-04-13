// ---------------------------------------------------------------------------
// CLI History Store
// Persistent JSONL storage for CLI execution history with resume support.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import {
  appendFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { paths } from '../config/paths.js';
import { truncateForHistory } from '../utils/cli-format.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal entry shape — mirrors NormalizedEntry without importing it. */
export interface EntryLike {
  type: string;
  [key: string]: unknown;
}

export interface ExecutionMeta {
  execId: string;
  tool: string;
  model?: string;
  mode: string;
  prompt: string;          // first 500 chars of user prompt
  workDir: string;
  startedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  exitCode?: number;
}

export interface ExecutionSnapshot {
  execId: string;
  tool: string;
  mode: string;
  workDir: string;
  prompt: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  outputPreview: string;
  outputChars: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Entry types to include when building a resume prompt. */
const RESUME_INCLUDE_TYPES = new Set([
  'assistant_message',
  'tool_use',
  'file_change',
  'command_exec',
  'error',
]);

/** Warn when resume context exceeds this char count. */
const RESUME_CONTEXT_WARN_CHARS = 32_000;

/** Max chars per tool_use result or command_exec output in resume context. */
const RESUME_ENTRY_MAX_CHARS = 4_096;
const SNAPSHOT_OUTPUT_PREVIEW_CHARS = 240;

// ---------------------------------------------------------------------------
// CliHistoryStore
// ---------------------------------------------------------------------------

export class CliHistoryStore {
  private get dir(): string {
    return paths.cliHistory;
  }

  private jsonlPath(execId: string): string {
    return join(this.dir, `${execId}.jsonl`);
  }

  private metaPath(execId: string): string {
    return join(this.dir, `${execId}.meta.json`);
  }

  /** Expose JSONL file path for a given execution (used by watch). */
  jsonlPathFor(execId: string): string {
    return this.jsonlPath(execId);
  }

  // ---- Write operations ---------------------------------------------------

  /** Append a single entry as one JSONL line. */
  appendEntry(execId: string, entry: EntryLike): void {
    paths.ensure(this.dir);
    appendFileSync(this.jsonlPath(execId), JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** Save (or overwrite) execution metadata. */
  saveMeta(execId: string, meta: ExecutionMeta): void {
    paths.ensure(this.dir);
    writeFileSync(this.metaPath(execId), JSON.stringify(meta, null, 2), 'utf-8');
  }

  // ---- Read operations ----------------------------------------------------

  /** Load execution metadata, or null if not found. */
  loadMeta(execId: string): ExecutionMeta | null {
    try {
      const raw = readFileSync(this.metaPath(execId), 'utf-8');
      return JSON.parse(raw) as ExecutionMeta;
    } catch {
      return null;
    }
  }

  /**
   * Load JSONL entries filtered for resume context.
   * Excludes status_change, token_usage, thinking, approval_*, user_message,
   * and partial assistant_message entries.
   */
  loadForResume(execId: string): EntryLike[] {
    let raw: string;
    try {
      raw = readFileSync(this.jsonlPath(execId), 'utf-8');
    } catch {
      return [];
    }

    const entries: EntryLike[] = [];
    // Accumulate partial (delta) assistant messages into a single entry
    const pendingDeltas: string[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as EntryLike;
        if (!RESUME_INCLUDE_TYPES.has(entry.type)) continue;
        if (entry.type === 'assistant_message') {
          if (entry.partial === true) {
            // Collect delta text
            pendingDeltas.push(String(entry.content ?? ''));
          } else {
            // Flush accumulated deltas before a complete message
            if (pendingDeltas.length > 0) {
              entries.push({ type: 'assistant_message', content: pendingDeltas.join('') });
              pendingDeltas.length = 0;
            }
            entries.push(entry);
          }
          continue;
        }
        // For tool_use, only include completed
        if (entry.type === 'tool_use' && entry.status !== 'completed') continue;
        entries.push(entry);
      } catch {
        // skip malformed lines
      }
    }
    // Flush trailing deltas
    if (pendingDeltas.length > 0) {
      entries.push({ type: 'assistant_message', content: pendingDeltas.join('') });
    }
    return entries;
  }

  /**
   * Build a resume prompt by loading previous session context and wrapping
   * it with the new prompt.
   *
   * Supports single or comma-separated execIds for merge scenarios.
   */
  buildResumePrompt(execIds: string | string[], newPrompt: string): string {
    const ids = Array.isArray(execIds) ? execIds : execIds.split(',').map(s => s.trim());
    const sections: string[] = [];

    for (const id of ids) {
      const meta = this.loadMeta(id);
      const entries = this.loadForResume(id);
      if (entries.length === 0 && !meta) continue;

      const header = meta
        ? `Tool: ${meta.tool} | Mode: ${meta.mode}`
        : `Session: ${id}`;
      const formatted = entries.map(e => formatEntry(e)).join('\n');
      sections.push(`${header}\n\n${formatted}`);
    }

    if (sections.length === 0) {
      return newPrompt;
    }

    const result = [
      '=== PREVIOUS CONVERSATION ===',
      sections.join('\n\n---\n\n'),
      '',
      '=== NEW REQUEST ===',
      newPrompt,
    ].join('\n');

    if (result.length > RESUME_CONTEXT_WARN_CHARS) {
      console.error(
        `Warning: resume context is ${Math.round(result.length / 1024)}KB — may exceed model context limit.`,
      );
    }

    return result;
  }

  // ---- Query operations ---------------------------------------------------

  /** List recent execution metadata, sorted by modification time descending. */
  listRecent(limit = 20): ExecutionMeta[] {
    try {
      const files = readdirSync(this.dir)
        .filter(f => f.endsWith('.meta.json'))
        .map(f => ({
          name: f,
          mtime: statSync(join(this.dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const results: ExecutionMeta[] = [];
      for (const f of files) {
        try {
          const raw = readFileSync(join(this.dir, f.name), 'utf-8');
          results.push(JSON.parse(raw) as ExecutionMeta);
        } catch {
          // skip corrupt meta files
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  /** Get final output text from an execution's JSONL. */
  getOutput(execId: string): string {
    let raw: string;
    try {
      raw = readFileSync(this.jsonlPath(execId), 'utf-8');
    } catch {
      return '';
    }

    const parts: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as EntryLike;
        if (entry.type === 'assistant_message') {
          parts.push(String(entry.content ?? ''));
        }
      } catch {
        // skip
      }
    }
    return parts.join('');
  }

  /** Build a compact snapshot for async broker updates from persisted history. */
  buildSnapshot(execId: string): ExecutionSnapshot | null {
    const meta = this.loadMeta(execId);
    if (!meta) {
      return null;
    }

    const output = this.getOutput(execId);
    const normalizedOutput = output.replace(/\s+/g, ' ').trim();
    const status = meta.cancelledAt
      ? 'cancelled'
      : meta.exitCode === undefined && !meta.completedAt
        ? 'running'
        : meta.exitCode === 0
          ? 'completed'
          : 'failed';

    return {
      execId: meta.execId,
      tool: meta.tool,
      mode: meta.mode,
      workDir: meta.workDir,
      prompt: meta.prompt,
      startedAt: meta.startedAt,
      completedAt: meta.completedAt ?? null,
      exitCode: meta.exitCode ?? null,
      status,
      outputPreview: truncateForHistory(normalizedOutput, SNAPSHOT_OUTPUT_PREVIEW_CHARS),
      outputChars: output.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Entry formatting for resume prompt
// ---------------------------------------------------------------------------

function formatEntry(entry: EntryLike): string {
  switch (entry.type) {
    case 'assistant_message':
      return String(entry.content ?? '');
    case 'tool_use':
      return `[Tool ${String(entry.name ?? 'unknown')}: ${truncateForHistory(String(entry.result ?? ''), RESUME_ENTRY_MAX_CHARS)}]`;
    case 'file_change':
      return `[File ${String(entry.action ?? 'change')}: ${String(entry.path ?? '')}]`;
    case 'command_exec': {
      const output = entry.output ? `\n${truncateForHistory(String(entry.output), RESUME_ENTRY_MAX_CHARS)}` : '';
      return `[Exec: ${String(entry.command ?? '')}]${output}`;
    }
    case 'error':
      return `[Error: ${String(entry.message ?? '')}]`;
    default:
      return `[${entry.type}]`;
  }
}
