import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';

import { Hono } from 'hono';
import { toForwardSlash } from '../../shared/utils.js';

/**
 * Artifact routes.
 *
 * GET /api/artifacts?tree=true  - directory tree of .workflow/
 * GET /api/artifacts/*path      - serve a single file from .workflow/
 *
 * Security: path traversal prevention + file type allowlist.
 */

const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.ndjson']);

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
};

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export function createArtifactRoutes(workflowRoot: string): Hono {
  const app = new Hono();
  const resolvedRoot = resolve(workflowRoot);

  // GET /api/artifacts?tree=true — directory tree
  // GET /api/artifacts/*path    — serve file
  app.get('/api/artifacts/*', async (c) => {
    const tree = c.req.query('tree');

    // Extract file path from the URL (Hono wildcard param may be empty in v4)
    const prefix = '/api/artifacts/';
    const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
    const rawPath = urlPath.startsWith(prefix) ? urlPath.slice(prefix.length) : (c.req.param('*') ?? '');

    if (tree === 'true' && !rawPath) {
      const treeData = await buildTree(resolvedRoot, resolvedRoot);
      return c.json(treeData);
    }

    if (!rawPath) {
      return c.json({ error: 'No artifact path specified' }, 400);
    }

    // Resolve and validate the requested path
    const requested = resolve(resolvedRoot, rawPath);

    // Path traversal prevention: resolved path must start with workflow root
    if (!requested.startsWith(resolvedRoot + sep) && requested !== resolvedRoot) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Check file extension allowlist
    const ext = extname(requested).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 415);
    }

    // Read and serve the file
    try {
      const content = await readFile(requested, 'utf-8');
      const contentType = CONTENT_TYPES[ext] ?? 'text/plain; charset=utf-8';
      return c.text(content, 200, { 'Content-Type': contentType });
    } catch {
      return c.json({ error: 'File not found' }, 404);
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

async function buildTree(dir: string, root: string): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return nodes;
  }

  // Sort entries: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    const relPath = toForwardSlash(relative(root, fullPath));

    if (entry.isDirectory()) {
      // Skip hidden dirs that are not relevant (e.g. node_modules)
      if (entry.name === 'node_modules') continue;

      const children = await buildTree(fullPath, root);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children,
      });
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: 'file',
        });
      }
    }
  }

  return nodes;
}

