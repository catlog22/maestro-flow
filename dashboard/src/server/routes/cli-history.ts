// ---------------------------------------------------------------------------
// CLI History REST API routes
// Lightweight filesystem reader for ~/.maestro/cli-history/ — avoids
// cross-rootDir import of CliHistoryStore from src/.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { CLI_HISTORY_DIR_NAME } from '../../shared/constants.js';
import { DelegateBrokerClient } from '../../../../src/async/index.js';

interface ExecutionMeta {
  execId: string;
  tool: string;
  model?: string;
  mode: string;
  prompt: string;
  workDir: string;
  startedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  exitCode?: number;
  asyncDelegate?: boolean;
  delegateStatus?: string | null;
  cancelRequestedAt?: string | null;
}

function getCliHistoryDir(): string {
  const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
  return join(maestroHome, CLI_HISTORY_DIR_NAME);
}

/**
 * CLI history routes.
 *
 * GET /api/cli-history            - list recent executions (?limit=20)
 * GET /api/cli-history/:id/entries - load JSONL entries for an execution
 * GET /api/cli-history/:id/messages - load queued follow-up messages for an async delegate
 */
export function createCliHistoryRoutes(): Hono {
  const app = new Hono();
  const broker = new DelegateBrokerClient();

  // GET /api/cli-history
  app.get('/api/cli-history', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100) : 20;
    const dir = getCliHistoryDir();

    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.meta.json'))
        .map(f => ({
          name: f,
          mtime: statSync(join(dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const results: ExecutionMeta[] = [];
      for (const f of files) {
        try {
          const raw = readFileSync(join(dir, f.name), 'utf-8');
          const meta = JSON.parse(raw) as ExecutionMeta;
          const job = broker.getJob(meta.execId);
          const cancelRequestedAt = job?.metadata && typeof job.metadata.cancelRequestedAt === 'string'
            ? job.metadata.cancelRequestedAt
            : null;
          results.push({
            ...meta,
            asyncDelegate: Boolean(job),
            delegateStatus: cancelRequestedAt && (job?.status === 'queued' || job?.status === 'running')
              ? 'cancelling'
              : job?.status ?? null,
            cancelRequestedAt,
          });
        } catch {
          // skip corrupt meta files
        }
      }
      return c.json(results);
    } catch {
      // Directory doesn't exist or unreadable — return empty
      return c.json([]);
    }
  });

  // GET /api/cli-history/:id/entries
  app.get('/api/cli-history/:id/entries', (c) => {
    const id = c.req.param('id');

    // Whitelist validation: execId format is {prefix}-{HHmmss}-{hex4} or user-provided alphanumeric
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      return c.json({ error: 'Invalid execution ID' }, 400);
    }

    const dir = getCliHistoryDir();
    const jsonlPath = join(dir, `${id}.jsonl`);

    try {
      const raw = readFileSync(jsonlPath, 'utf-8');
      const entries: unknown[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as Record<string, unknown>;
          // Filter out protocol echo artifacts from old Gemini JSONL
          if (
            entry.type === 'assistant_message'
            && typeof entry.content === 'string'
            && (entry.content as string).trimStart().startsWith('# Analysis Mode Protocol')
          ) {
            continue;
          }
          entries.push(entry);
        } catch {
          // skip malformed lines
        }
      }
      return c.json(entries);
    } catch {
      return c.json({ error: 'Execution not found' }, 404);
    }
  });

  // GET /api/cli-history/:id/messages
  app.get('/api/cli-history/:id/messages', (c) => {
    const id = c.req.param('id');

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      return c.json({ error: 'Invalid execution ID' }, 400);
    }

    return c.json(broker.listMessages(id));
  });

  return app;
}
