import { execFile as execFileCb } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Hono } from 'hono';

const execFile = promisify(execFileCb);

/**
 * Git routes.
 *
 * GET /api/git/status  - branch, staged, unstaged, untracked
 * GET /api/git/log     - recent commits
 */

interface FileStatus {
  path: string;
  status: string;
}

export function createGitRoutes(workflowRoot: string | (() => string)): Hono {
  const app = new Hono();
  const getProjectRoot = () => {
    const root = typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;
    return resolve(root, '..');
  };

  app.get('/api/git/status', async (c) => {
    const projectRoot = getProjectRoot();
    try {
      const { stdout } = await execFile('git', ['status', '--porcelain=v1', '-b'], {
        cwd: projectRoot,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });

      const lines = stdout.split('\n').filter((l) => l.length > 0);
      let branch = 'unknown';
      const staged: FileStatus[] = [];
      const unstaged: FileStatus[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        // First line: ## branch...tracking
        if (line.startsWith('## ')) {
          const branchPart = line.slice(3);
          // Strip tracking info: "main...origin/main" → "main"
          const dotIdx = branchPart.indexOf('...');
          branch = dotIdx >= 0 ? branchPart.slice(0, dotIdx) : branchPart;
          continue;
        }

        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const filePath = line.slice(3);

        // Untracked
        if (indexStatus === '?' && worktreeStatus === '?') {
          untracked.push(filePath);
          continue;
        }

        // Staged: index has M/A/D/R and worktree is space or ?
        if (
          (indexStatus === 'M' || indexStatus === 'A' || indexStatus === 'D' || indexStatus === 'R') &&
          (worktreeStatus === ' ' || worktreeStatus === '?')
        ) {
          staged.push({ path: filePath, status: indexStatus });
        }

        // Unstaged worktree changes
        if (worktreeStatus === 'M' || worktreeStatus === 'D') {
          unstaged.push({ path: filePath, status: worktreeStatus });
        }
      }

      return c.json({ branch, staged, unstaged, untracked });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/git/log', async (c) => {
    const projectRoot = getProjectRoot();
    const limit = Number(c.req.query('limit')) || 10;
    try {
      const { stdout } = await execFile(
        'git',
        ['log', `--format=%H|%h|%s|%an|%aI`, `-n`, String(limit)],
        { cwd: projectRoot, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true },
      );

      const commits = stdout
        .split('\n')
        .filter((l) => l.length > 0)
        .map((line) => {
          const [hash, shortHash, message, author, date] = line.split('|', 5);
          return { hash, shortHash, message, author, date };
        });

      return c.json({ commits });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return app;
}
