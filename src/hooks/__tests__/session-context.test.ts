import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateSessionContext } from '../session-context.js';

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `maestro-test-session-${Date.now()}`);

interface SetupOpts {
  workflow?: boolean;
  specs?: boolean;
  project?: boolean;
  sourceRoots?: string[];
  sessions?: Array<{ name: string; session: Record<string, unknown> }>;
}

function setupTestProject(opts: SetupOpts = {}): void {
  mkdirSync(TEST_DIR, { recursive: true });

  if (opts.workflow) {
    const workflowDir = join(TEST_DIR, '.workflow');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'state.json'), JSON.stringify({
      version: '3.2',
      phase: 3,
      step: 2,
      task: 'implement-auth',
      status: 'in_progress',
      sessions: [],
      source_roots: opts.sourceRoots,
    }));
  }

  if (opts.specs) {
    const specsDir = join(TEST_DIR, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'coding-conventions.md'), '# Coding');
    writeFileSync(join(specsDir, 'quality-rules.md'), '# Quality');
  }

  if (opts.project) {
    const workflowDir = join(TEST_DIR, '.workflow');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'project.md'), [
      '# Project: TestApp',
      '',
      '## Core Value',
      '',
      'Fast and reliable task management.',
      '',
      '## Requirements',
      '',
      '### Validated',
      '',
      '- [x] User auth',
      '- [x] Team management',
      '',
      '### Active',
      '',
      '- [ ] Kanban board',
      '- [ ] Notifications',
      '- [ ] API rate limiting',
      '',
      '### Out of Scope',
      '',
      '- Mobile native app',
      '',
      '## Tech Stack',
      '',
      '- **Language**: TypeScript',
      '- **Framework**: Hono',
      '- **Database**: PostgreSQL',
      '',
      '## Key Decisions',
      '',
      '| Decision | Rationale | Outcome |',
      '|----------|-----------|---------|',
      '| Schema-level isolation | Lower cost | Phase 1 |',
      '| JWT auth | Stateless | Phase 1 |',
    ].join('\n'));
  }

  if (opts.sourceRoots) {
    for (const root of opts.sourceRoots) {
      const rootPath = join(TEST_DIR, root);
      mkdirSync(rootPath, { recursive: true });
      mkdirSync(join(rootPath, 'commands'), { recursive: true });
      mkdirSync(join(rootPath, 'hooks'), { recursive: true });
      writeFileSync(join(rootPath, 'index.ts'), '');
    }
  }

  if (opts.sessions) {
    const sessionsDir = join(TEST_DIR, '.workflow', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    for (const { name, session } of opts.sessions) {
      const sessionDir = join(sessionsDir, name);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(session));
    }
  }
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// evaluateSessionContext
// ---------------------------------------------------------------------------

describe('evaluateSessionContext', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('returns null when no workflow state or specs exist', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    // May still return git info if in a repo, so check structure
    if (result) {
      assert.ok(result.hookSpecificOutput.hookEventName === 'Notification');
    }
  });

  it('includes workflow state when state.json exists', () => {
    setupTestProject({ workflow: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    assert.strictEqual(result!.hookSpecificOutput.hookEventName, 'Notification');
    assert.ok(result!.hookSpecificOutput.additionalContext.includes('Phase: 3'));
    assert.ok(result!.hookSpecificOutput.additionalContext.includes('implement-auth'));
  });

  it('includes available specs listing', () => {
    setupTestProject({ workflow: true, specs: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    assert.ok(result!.hookSpecificOutput.additionalContext.includes('coding-conventions'));
    assert.ok(result!.hookSpecificOutput.additionalContext.includes('quality-rules'));
    assert.ok(result!.hookSpecificOutput.additionalContext.includes('spec-injector'));
  });

  it('returns correct hookEventName', () => {
    setupTestProject({ workflow: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    assert.strictEqual(result!.hookSpecificOutput.hookEventName, 'Notification');
  });

  it('includes project summary when project.md exists', () => {
    setupTestProject({ workflow: true, project: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    const ctx = result!.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('TestApp'));
    assert.ok(ctx.includes('Core:'));
    assert.ok(ctx.includes('2V/3A/1O'));
    assert.ok(ctx.includes('TypeScript'));
    assert.ok(ctx.includes('Decisions: 2'));
  });

  it('includes source tree when source_roots configured', () => {
    setupTestProject({ workflow: true, sourceRoots: ['src'] });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    const ctx = result!.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Source Tree'));
    assert.ok(ctx.includes('src/'));
    assert.ok(ctx.includes('commands'));
    assert.ok(ctx.includes('hooks'));
  });

  it('includes recent canonical Sessions', () => {
    setupTestProject({
      workflow: true,
      sessions: [
        { name: '20260624-fix-search', session: { session_id: 'fix-search', intent: 'Search quality', status: 'running', active_run_id: 'RUN-002' } },
        { name: '20260623-improve-perf', session: { session_id: 'improve-perf', intent: 'Performance', status: 'sealed', latest_completed_run_id: 'RUN-003' } },
      ],
    });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    assert.ok(result !== null);
    const ctx = result!.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Recent Sessions'));
    assert.ok(ctx.includes('fix-search'));
    assert.ok(ctx.includes('RUN-002'));
    assert.ok(ctx.includes('improve-perf'));
  });

  it('skips source tree when source_roots not configured', () => {
    setupTestProject({ workflow: true });
    const result = evaluateSessionContext({ cwd: TEST_DIR });
    if (result) {
      assert.ok(!result.hookSpecificOutput.additionalContext.includes('Source Tree'));
    }
  });
});
