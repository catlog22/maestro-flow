/**
 * Session Context Hook — Notification (SessionStart)
 *
 * Injects lightweight workflow state + available specs overview
 * at session initialization. Does NOT inject full spec content —
 * that's handled per-agent by spec-injector.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolveWorkspace } from './workspace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionContextInput {
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

interface WorkflowState {
  phase?: number;
  step?: number;
  task?: string;
  status?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate session context and return an overview for the agent.
 * Returns null if there's nothing useful to inject.
 */
export function evaluateSessionContext(data: SessionContextInput): HookOutput | null {
  const cwd = data.cwd || process.cwd();
  const workspaceRoot = resolveWorkspace(data);
  const sections: string[] = [];

  // 1. Workflow state (use workspace root if found)
  const workflowSection = workspaceRoot ? buildWorkflowSection(workspaceRoot) : null;
  if (workflowSection) sections.push(workflowSection);

  // 2. Available specs (use workspace root if found)
  const specsSection = workspaceRoot ? buildSpecsSection(workspaceRoot) : null;
  if (specsSection) sections.push(specsSection);

  // 3. Explore availability
  const exploreSection = buildExploreSection();
  if (exploreSection) sections.push(exploreSection);

  // 4. Git context (lightweight)
  const gitSection = buildGitSection(cwd);
  if (gitSection) sections.push(gitSection);

  if (sections.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: data.hook_event_name || 'Notification',
      additionalContext: sections.join('\n\n'),
    },
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildWorkflowSection(cwd: string): string | null {
  const statePath = join(cwd, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  try {
    const state: WorkflowState = JSON.parse(readFileSync(statePath, 'utf8'));
    const parts: string[] = ['## Maestro Workflow State'];

    if (state.phase !== undefined) {
      const step = state.step !== undefined ? `.${state.step}` : '';
      parts.push(`Phase: ${state.phase}${step}`);
    }
    if (state.task) parts.push(`Task: ${state.task}`);
    if (state.status) parts.push(`Status: ${state.status}`);

    return parts.length > 1 ? parts.join(' | ') : null;
  } catch {
    return null;
  }
}

function buildSpecsSection(cwd: string): string | null {
  const specsDir = join(cwd, '.workflow', 'specs');
  if (!existsSync(specsDir)) return null;

  try {
    const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) return null;

    const items = files.map(f => `- ${f.replace('.md', '')}`);
    return `## Available Specs\n${items.join('\n')}\n(Auto-injected per agent type via spec-injector hook)`;
  } catch {
    return null;
  }
}

function buildExploreSection(): string | null {
  const configPath = join(homedir(), '.maestro', 'api-explore.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
      baseUrl?: string; apiKey?: string; model?: string;
      endpoints?: Record<string, { baseUrl?: string; apiKey?: string; model?: string }>;
    };

    const endpoints: string[] = [];

    if (raw.baseUrl && raw.apiKey && raw.model) {
      endpoints.push(`default(${raw.model})`);
    }

    if (raw.endpoints) {
      for (const [name, ep] of Object.entries(raw.endpoints)) {
        if (ep.baseUrl && ep.apiKey && ep.model) {
          endpoints.push(`${name}(${ep.model})`);
        }
      }
    }

    if (endpoints.length === 0) return null;

    // Load explore-usage.md if available for full injection
    const usagePath = join(homedir(), '.maestro', 'workflows', 'explore-usage.md');
    if (existsSync(usagePath)) {
      try {
        const usage = readFileSync(usagePath, 'utf8').trim();
        return `## Explore [${endpoints.join(', ')}]\n\n${usage}`;
      } catch {
        // Fall through to compact format
      }
    }

    return `## Explore\nEndpoints: ${endpoints.join(', ')}\n` +
      `Prefer \`maestro explore\` for codebase search (read-only, parallel, structured).\n` +
      `Prompt: \`maestro explore "FIND: <target> SCOPE: src/ EXCLUDE: tests EXPECTED: file:line list"\`\n` +
      `Multi-prompt: \`maestro explore "p1" "p2" "p3" --json\`\n` +
      `Serial within same endpoint, parallel across endpoints.`;
  } catch {
    return null;
  }
}

const GIT_CACHE_TTL_MS = 30_000;

interface GitCache {
  branch: string;
  lastCommit: string;
  timestamp: number;
}

function getGitCachePath(cwd: string): string {
  const hash = createHash('md5').update(cwd).digest('hex').slice(0, 12);
  return join(tmpdir(), `maestro-git-${hash}.json`);
}

function readGitCache(cachePath: string): GitCache | null {
  try {
    if (!existsSync(cachePath)) return null;
    const stat = statSync(cachePath);
    if (Date.now() - stat.mtimeMs > GIT_CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildGitSection(cwd: string): string | null {
  const cachePath = getGitCachePath(cwd);
  const cached = readGitCache(cachePath);
  if (cached) {
    const parts = [`## Git`, `Branch: ${cached.branch}`];
    if (cached.lastCommit) parts.push(`Last: ${cached.lastCommit}`);
    return parts.join(' | ');
  }

  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    let lastCommit = '';
    try {
      lastCommit = execFileSync('git', ['log', '-1', '--oneline'], {
        cwd,
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // No commits yet
    }

    // Write cache
    try {
      writeFileSync(cachePath, JSON.stringify({ branch, lastCommit, timestamp: Date.now() }));
    } catch {
      // Cache write failure is non-critical
    }

    const parts = [`## Git`, `Branch: ${branch}`];
    if (lastCommit) parts.push(`Last: ${lastCommit}`);
    return parts.join(' | ');
  } catch {
    return null;
  }
}
