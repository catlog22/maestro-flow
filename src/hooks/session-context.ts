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
  source_roots?: string[];
  [key: string]: unknown;
}

interface RunModeSession {
  session_id?: string;
  intent?: string;
  status?: string;
  active_run_id?: string | null;
  latest_completed_run_id?: string | null;
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

  // 2. Project summary from project.md
  const projectSection = workspaceRoot ? buildProjectSummarySection(workspaceRoot) : null;
  if (projectSection) sections.push(projectSection);

  // 3. Source tree from state.json.source_roots
  const sourceTreeSection = workspaceRoot ? buildSourceTreeSection(workspaceRoot) : null;
  if (sourceTreeSection) sections.push(sourceTreeSection);

  // 4. Recent canonical Sessions
  const sessionsSection = workspaceRoot ? buildRecentSessionsSection(workspaceRoot) : null;
  if (sessionsSection) sections.push(sessionsSection);

  // 5. Available specs (use workspace root if found)
  const specsSection = workspaceRoot ? buildSpecsSection(workspaceRoot) : null;
  if (specsSection) sections.push(specsSection);

  // 6. Explore availability
  const exploreSection = buildExploreSection();
  if (exploreSection) sections.push(exploreSection);

  // 7. Git context (lightweight)
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

// ---------------------------------------------------------------------------
// P1: Project Summary — parse project.md headings for lightweight overview
// ---------------------------------------------------------------------------

function buildProjectSummarySection(cwd: string): string | null {
  const projectPath = join(cwd, '.workflow', 'project.md');
  if (!existsSync(projectPath)) return null;

  try {
    const content = readFileSync(projectPath, 'utf8');
    const lines = content.split('\n');
    const parts: string[] = ['## Project'];

    // Extract project name from H1
    const h1 = lines.find(l => /^# /.test(l));
    if (h1) parts.push(h1.replace(/^# /, '').replace(/^Project:\s*/, '').trim());

    // Core Value — first non-empty line after ## Core Value
    const coreValue = extractFirstLine(lines, 'Core Value');
    if (coreValue) parts.push(`Core: ${truncate(coreValue, 80)}`);

    // Requirements — count Active/Validated/Out of Scope
    const reqStats = countRequirements(lines);
    if (reqStats) parts.push(`Reqs: ${reqStats}`);

    // Tech Stack — extract key:value pairs
    const stack = extractTechStack(lines);
    if (stack) parts.push(`Stack: ${stack}`);

    // Key Decisions — count table rows
    const decisionCount = countTableRows(lines, 'Key Decisions');
    if (decisionCount > 0) parts.push(`Decisions: ${decisionCount}`);

    return parts.length > 2 ? parts.join(' | ') : null;
  } catch {
    return null;
  }
}

function extractFirstLine(lines: string[], heading: string): string | null {
  const idx = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length && i < idx + 5; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('<!--')) continue;
    if (/^\{\{.*\}\}$/.test(line)) return null;
    return line;
  }
  return null;
}

function countRequirements(lines: string[]): string | null {
  let validated = 0, active = 0, outOfScope = 0;
  let section: 'none' | 'validated' | 'active' | 'oos' = 'none';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '### Validated') { section = 'validated'; continue; }
    if (trimmed === '### Active') { section = 'active'; continue; }
    if (trimmed === '### Out of Scope') { section = 'oos'; continue; }
    if (/^##[^#]/.test(trimmed)) { section = 'none'; continue; }

    if (section === 'validated' && /^- \[x\]/.test(trimmed)) validated++;
    if (section === 'active' && /^- \[ \]/.test(trimmed)) active++;
    if (section === 'oos' && /^- /.test(trimmed)) outOfScope++;
  }

  const total = validated + active + outOfScope;
  if (total === 0) return null;
  return `${validated}V/${active}A/${outOfScope}O`;
}

function extractTechStack(lines: string[]): string | null {
  const idx = lines.findIndex(l => l.trim() === '## Tech Stack');
  if (idx === -1) return null;

  const values: string[] = [];
  for (let i = idx + 1; i < lines.length && values.length < 6; i++) {
    const line = lines[i].trim();
    if (/^##[^#]/.test(line)) break;
    const match = line.match(/(?:^-\s*)?\*\*([^*]+)\*\*:\s*(.+)$/);
    if (match) {
      const val = match[2].trim();
      if (!/^\{\{/.test(val)) values.push(val);
    }
  }

  return values.length > 0 ? values.join(', ') : null;
}

function countTableRows(lines: string[], heading: string): number {
  const idx = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (idx === -1) return 0;

  let count = 0;
  let inTable = false;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##[^#]/.test(line)) break;
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) { inTable = true; continue; } // header
      if (/^[\s|:-]+$/.test(line)) continue; // separator
      if (/\{\{/.test(line)) continue; // template placeholder
      count++;
    }
  }
  return count;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// P2: Source Tree — read source_roots from state.json, list 2 levels
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.workflow', '.hg',
  'coverage', '.next', '.nuxt', '.output', '__pycache__', '.venv',
  'vendor', 'target',
]);

function buildSourceTreeSection(cwd: string): string | null {
  const statePath = join(cwd, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const roots: string[] = state.source_roots;
    if (!Array.isArray(roots) || roots.length === 0) return null;

    const parts: string[] = ['## Source Tree'];
    let totalEntries = 0;
    const MAX_ENTRIES = 40;

    for (const root of roots.slice(0, 3)) {
      const rootPath = join(cwd, root);
      if (!existsSync(rootPath)) continue;

      try {
        const entries = readdirSync(rootPath, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name));
        const files = entries.filter(e => e.isFile());

        if (dirs.length === 0 && files.length === 0) continue;

        const subNames: string[] = [];
        for (const d of dirs) {
          if (totalEntries >= MAX_ENTRIES) break;
          // Level 2: count children only
          try {
            const subEntries = readdirSync(join(rootPath, d.name), { withFileTypes: true });
            const subDirs = subEntries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name)).length;
            const subFiles = subEntries.filter(e => e.isFile()).length;
            subNames.push(subDirs > 0 ? `${d.name}/(${subDirs}d${subFiles > 0 ? `+${subFiles}f` : ''})` : `${d.name}/`);
          } catch {
            subNames.push(`${d.name}/`);
          }
          totalEntries++;
        }

        const line = `${root}/ (${dirs.length}d+${files.length}f): ${subNames.join(', ')}`;
        parts.push(line);
      } catch {
        continue;
      }
    }

    return parts.length > 1 ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// P3: Recent Sessions — scan sessions/*/session.json by mtime
// ---------------------------------------------------------------------------

const SESSION_CACHE_TTL_MS = 60_000;

function getSessionCachePath(cwd: string): string {
  const hash = createHash('md5').update(cwd + '-sessions').digest('hex').slice(0, 12);
  return join(tmpdir(), `maestro-sessions-${hash}.json`);
}

function buildRecentSessionsSection(cwd: string): string | null {
  const sessionsDir = join(cwd, '.workflow', 'sessions');
  if (!existsSync(sessionsDir)) return null;

  // Check cache
  const cachePath = getSessionCachePath(cwd);
  try {
    if (existsSync(cachePath)) {
      const cacheStat = statSync(cachePath);
      if (Date.now() - cacheStat.mtimeMs < SESSION_CACHE_TTL_MS) {
        const cached = readFileSync(cachePath, 'utf8');
        if (cached) return cached || null;
      }
    }
  } catch { /* cache miss */ }

  try {
    const dirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory());

    // Find directories containing session.json, collect with mtime
    const candidates: Array<{ dir: string; mtime: number }> = [];
    for (const d of dirs) {
      const sessionPath = join(sessionsDir, d.name, 'session.json');
      if (existsSync(sessionPath)) {
        try {
          const st = statSync(sessionPath);
          candidates.push({ dir: d.name, mtime: st.mtimeMs });
        } catch { /* skip */ }
      }
    }

    if (candidates.length === 0) return null;

    // Sort by mtime desc, take 5
    candidates.sort((a, b) => b.mtime - a.mtime);
    const top5 = candidates.slice(0, 5);

    const lines: string[] = ['## Recent Sessions'];
    for (const { dir } of top5) {
      try {
        const session: RunModeSession = JSON.parse(
          readFileSync(join(sessionsDir, dir, 'session.json'), 'utf8'),
        );
        const id = session.session_id ?? dir;
        const state = session.status ?? '';
        const run = session.active_run_id ?? session.latest_completed_run_id ?? '-';
        lines.push(`- ${id} | ${state} | run=${run} | ${truncate(session.intent ?? '', 60)}`);
      } catch {
        lines.push(`- ${dir}`);
      }
    }

    const result = lines.join('\n');

    // Write cache
    try { writeFileSync(cachePath, result); } catch { /* non-critical */ }

    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Existing section builders
// ---------------------------------------------------------------------------

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
  const apiJsonPath = join(homedir(), '.maestro', 'api.json');
  const legacyPath = join(homedir(), '.maestro', 'api-explore.json');
  const configPath = existsSync(apiJsonPath) ? apiJsonPath : legacyPath;
  if (!existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
      baseUrl?: string; apiKey?: string; model?: string;
      endpoints?: Record<string, { baseUrl?: string; apiKey?: string; model?: string; maxTurns?: number }>;
      maxTurns?: number; concurrency?: number;
    };

    const endpoints: string[] = [];

    if (raw.baseUrl && raw.apiKey && raw.model) {
      endpoints.push(`default(${raw.model})`);
    }

    if (raw.endpoints) {
      for (const [name, ep] of Object.entries(raw.endpoints)) {
        if (ep.baseUrl && ep.apiKey && ep.model) {
          const turns = ep.maxTurns ? `,${ep.maxTurns}t` : '';
          endpoints.push(`${name}(${ep.model}${turns})`);
        }
      }
    }

    if (endpoints.length === 0) return null;

    const parts = [`## Explore`, `Endpoints: ${endpoints.join(', ')}`];
    if (raw.concurrency) parts.push(`Concurrency: ${raw.concurrency}`);
    if (raw.maxTurns) parts.push(`MaxTurns: ${raw.maxTurns}`);
    return parts.join(' | ');
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
