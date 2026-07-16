import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillInvocation, evaluateSkillContext } from '../skill-context.js';

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `maestro-test-skill-${Date.now()}`);

function setupWorkflow(): void {
  const workflowDir = join(TEST_DIR, '.workflow');
  mkdirSync(workflowDir, { recursive: true });
  const sessionId = '20260713-auth-refactor';
  const sessionDir = join(workflowDir, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(workflowDir, 'state.json'), JSON.stringify({
    version: '2.0',
    active_session_id: sessionId,
    sessions: [{ session_id: sessionId, intent: 'Auth Refactor', status: 'running' }],
  }));
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
    session_id: sessionId,
    intent: 'Auth Refactor',
    status: 'running',
    active_run_id: '20260713-002-execute',
    latest_completed_run_id: '20260713-001-plan',
  }));
  writeFileSync(join(sessionDir, 'artifacts.json'), JSON.stringify({
    artifacts: {
      'ART-001-001': { kind: 'plan', role: 'primary', status: 'sealed', relative_path: 'runs/20260713-001-plan/outputs/plan.json' },
      'ART-002-001': { kind: 'execution', role: 'primary', status: 'sealed', relative_path: 'runs/20260713-002-execute/outputs/change-manifest.json' },
    },
    aliases: { 'current-plan': 'ART-001-001', 'latest-execution': 'ART-002-001' },
  }));
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// parseSkillInvocation
// ---------------------------------------------------------------------------

describe('parseSkillInvocation', () => {
  it('matches /maestro with intent text', () => {
    const result = parseSkillInvocation('/maestro implement auth');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro');
  });

  it('matches /maestro-ralph without falling through to /maestro', () => {
    const result = parseSkillInvocation('/maestro-ralph fix login bug');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-ralph');
  });

  it('matches /maestro-session-seal', () => {
    const result = parseSkillInvocation('/maestro-session-seal');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-session-seal');
  });

  it('matches /maestro-next', () => {
    const result = parseSkillInvocation('/maestro-next');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-next');
  });

  it('returns null for non-skill prompts', () => {
    assert.strictEqual(parseSkillInvocation('fix the login bug'), null);
    assert.strictEqual(parseSkillInvocation('implement OAuth flow'), null);
    assert.strictEqual(parseSkillInvocation(''), null);
  });

  it('returns null for non-workflow skills', () => {
    assert.strictEqual(parseSkillInvocation('/help'), null);
    assert.strictEqual(parseSkillInvocation('/compact'), null);
  });
});

// ---------------------------------------------------------------------------
// evaluateSkillContext
// ---------------------------------------------------------------------------

describe('evaluateSkillContext', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('returns null for non-skill prompts', () => {
    const result = evaluateSkillContext({ user_prompt: 'fix a bug', cwd: TEST_DIR });
    assert.strictEqual(result, null);
  });

  it('returns null when no workflow exists', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const result = evaluateSkillContext({ user_prompt: '/maestro-ralph continue', cwd: TEST_DIR });
    assert.strictEqual(result, null);
  });

  it('returns canonical Session context', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-ralph continue', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Session Context'));
    assert.ok(ctx.includes('20260713-auth-refactor'));
    assert.ok(ctx.includes('20260713-002-execute'));
  });

  it('returns sealed artifact aliases', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-ralph continue', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('current-plan → ART-001-001'));
    assert.ok(ctx.includes('latest-execution → ART-002-001'));
    assert.ok(ctx.includes('runs/20260713-001-plan/outputs/plan.json'));
  });

  it('uses correct hookEventName', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-ralph continue', cwd: TEST_DIR });
    assert.ok(result);
    assert.strictEqual(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  });

});
