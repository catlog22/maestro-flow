// ---------------------------------------------------------------------------
// CSV Wave routes — read .workflow/.csv-wave/ directory data
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CsvWaveSession, CsvWaveTask, CsvWaveResult } from '../../shared/csv-wave-types.js';

export function createCsvWaveRoutes(workflowRoot: string | (() => string)): Hono {
  const app = new Hono();
  const getRoot = () => typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;

  // GET /api/csv-waves - list all CSV wave sessions
  app.get('/api/csv-waves', async (c) => {
    try {
      const csvDir = join(getRoot(), '.csv-wave');
      const entries = await safeReaddir(csvDir);
      const sessions: CsvWaveSession[] = [];

      for (const dirName of entries) {
        const session = await readSession(csvDir, dirName);
        if (session) sessions.push(session);
      }

      return c.json(sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/csv-waves/:sessionId - get a single CSV wave session
  app.get('/api/csv-waves/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const csvDir = join(getRoot(), '.csv-wave');
      const session = await readSession(csvDir, sessionId);
      if (!session) {
        return c.json({ error: `Session not found: ${sessionId}` }, 404);
      }
      return c.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/csv-waves/:sessionId/wave/:n - get wave tasks + results
  app.get('/api/csv-waves/:sessionId/wave/:n', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const waveNum = c.req.param('n');
      const csvDir = join(getRoot(), '.csv-wave');
      const sessionDir = join(csvDir, sessionId);

      const tasksCsv = await safeReadFile(join(sessionDir, `wave-${waveNum}.csv`));
      const resultsCsv = await safeReadFile(join(sessionDir, `wave-${waveNum}-results.csv`));

      return c.json({
        session_id: sessionId,
        wave: Number(waveNum),
        tasks: tasksCsv ? parseCsvTasks(tasksCsv) : [],
        results: resultsCsv ? parseCsvResults(resultsCsv) : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// CSV Parsing
// ---------------------------------------------------------------------------

/**
 * Minimal RFC 4180 CSV parser — handles quoted fields with embedded commas/newlines.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;

  while (i <= len) {
    if (i === len) {
      fields.push('');
      break;
    }

    if (line[i] === '"') {
      // Quoted field — find closing quote (handle escaped "")
      i++;
      let field = '';
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      if (i < len && line[i] === ',') i++; // skip comma separator
    } else {
      // Unquoted field — find next comma
      const commaIdx = line.indexOf(',', i);
      if (commaIdx === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, commaIdx));
      i = commaIdx + 1;
    }
  }

  return fields;
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function parseCsv(content: string): ParsedCsv {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { headers, rows };
}

function rowToObj(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] ?? '';
  }
  return obj;
}

function parseCsvTasks(content: string): CsvWaveTask[] {
  const { headers, rows } = parseCsv(content);
  return rows.map(row => {
    const obj = rowToObj(headers, row);
    return {
      id: obj.id ?? '',
      title: obj.title ?? '',
      description: obj.description ?? '',
      test: obj.test ?? '',
      acceptance_criteria: obj.acceptance_criteria ?? '',
      scope: obj.scope ?? '',
      hints: obj.hints ?? '',
      execution_directives: obj.execution_directives ?? '',
      deps: obj.deps ?? '',
      context_from: obj.context_from ?? '',
      wave: Number(obj.wave) || 0,
      prev_context: obj.prev_context ?? '',
    };
  });
}

function parseCsvResults(content: string): CsvWaveResult[] {
  const { headers, rows } = parseCsv(content);
  return rows.map(row => {
    const obj = rowToObj(headers, row);
    // Try to parse result_json for richer data
    let filesModified: string[] = [];
    try {
      const rj = JSON.parse(obj.result_json || '{}');
      filesModified = Array.isArray(rj.files_modified) ? rj.files_modified : [];
    } catch { /* ignore */ }

    return {
      id: obj.id ?? '',
      title: obj.title ?? '',
      status: (obj.status as CsvWaveResult['status']) ?? 'pending',
      findings: obj.findings ?? '',
      files_modified: filesModified,
      tests_passed: obj.tests_passed === 'true',
      acceptance_met: obj.acceptance_met ?? '',
      error: obj.error ?? '',
      wave: Number(obj.wave) || 0,
      reported_at: obj.reported_at ?? '',
      completed_at: obj.completed_at ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function readSession(csvDir: string, dirName: string): Promise<CsvWaveSession | null> {
  const sessionDir = join(csvDir, dirName);
  const files = await safeReaddirFiles(sessionDir);

  // Parse directory name: {prefix}-{name}-{date}
  const parts = dirName.split('-');
  const prefix = parts[0] ?? '';
  const date = parts[parts.length - 1] ?? '';

  // Detect wave numbers
  const waveMatches = files
    .map(f => f.match(/^wave-(\d+)\.csv$/))
    .filter(Boolean)
    .map(m => Number(m![1]));

  // Parse tasks.csv if present
  let tasks: CsvWaveTask[] = [];
  const tasksContent = await safeReadFile(join(sessionDir, 'tasks.csv'));
  if (tasksContent) {
    tasks = parseCsvTasks(tasksContent);
  }

  // Parse results.csv if present
  let results: CsvWaveResult[] = [];
  const resultsContent = await safeReadFile(join(sessionDir, 'results.csv'));
  if (resultsContent) {
    results = parseCsvResults(resultsContent);
  }

  return {
    id: dirName,
    prefix,
    date,
    waves: waveMatches.sort((a, b) => a - b),
    hasTasks: files.includes('tasks.csv'),
    hasResults: files.includes('results.csv'),
    tasks,
    results,
  };
}

async function safeReaddirFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch {
    return [];
  }
}
