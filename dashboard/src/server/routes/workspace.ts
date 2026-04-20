import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';

import { Hono } from 'hono';
import { toForwardSlash } from '../../shared/utils.js';

/**
 * Workspace routes.
 *
 * GET /api/workspace?tree=true      - full project directory tree
 * GET /api/workspace/file?path=xxx  - serve a single file (text content)
 */

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt', '.output',
  '.turbo', '.cache', '.parcel-cache', '__pycache__', '.venv',
  'coverage', '.nyc_output',
]);

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export function createWorkspaceRoutes(workflowRoot: string | (() => string)): Hono {
  const app = new Hono();
  const getProjectRoot = () => {
    const root = typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;
    return resolve(root, '..');
  };

  // Directory tree
  app.get('/api/workspace', async (c) => {
    const tree = c.req.query('tree');
    if (tree === 'true') {
      const projectRoot = getProjectRoot();
      const treeData = await buildTree(projectRoot, projectRoot, 0);
      return c.json(treeData);
    }
    return c.json({ error: 'Use ?tree=true' }, 400);
  });

  // File content
  app.get('/api/workspace/file', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'Missing path query' }, 400);

    const projectRoot = getProjectRoot();
    const requested = resolve(projectRoot, filePath);

    // Path traversal prevention
    if (!requested.startsWith(projectRoot + sep) && requested !== projectRoot) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      const content = await readFile(requested, 'utf-8');
      return c.text(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch {
      return c.json({ error: 'File not found' }, 404);
    }
  });

  // File content search via git grep
  app.get('/api/workspace/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

    if (q.length < 2) {
      return c.json({ results: [], total: 0 });
    }

    const projectRoot = getProjectRoot();

    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          'git', ['grep', '-n', '--no-color', '-I', q],
          { cwd: projectRoot, timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
          (err, stdout) => {
            // git grep exits with code 1 when no matches — treat as empty
            if (err && (err as NodeJS.ErrnoException).code !== '1' && !stdout) {
              // If exit code is 1 with no output, that means no matches
              if ((err as { code?: number }).code === 1) {
                resolve('');
                return;
              }
              reject(err);
              return;
            }
            resolve(stdout ?? '');
          },
        );
      });

      const lines = stdout.split('\n').filter(Boolean);
      const total = lines.length;
      const results = lines.slice(0, limit).map((line) => {
        // Format: file:lineNumber:matchedLine
        const firstColon = line.indexOf(':');
        const secondColon = line.indexOf(':', firstColon + 1);
        const file = toForwardSlash(line.slice(0, firstColon));
        const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
        const text = line.slice(secondColon + 1);
        return { file, line: lineNum, text };
      });

      return c.json({ results, total });
    } catch {
      return c.json({ results: [], total: 0 });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tree builder — max depth 6 to avoid excessive recursion
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;

async function buildTree(dir: string, root: string, depth: number): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH) return [];
  const nodes: TreeNode[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return nodes;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = resolve(dir, entry.name);
    const relPath = toForwardSlash(relative(root, fullPath));

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const children = await buildTree(fullPath, root, depth + 1);
      nodes.push({ name: entry.name, path: relPath, type: 'directory', children });
    } else {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  return nodes;
}
