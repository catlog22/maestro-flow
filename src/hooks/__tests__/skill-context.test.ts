import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillInvocation, evaluateSkillContext } from '../skill-context.js';

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `maestro-test-skill-${Date.now()}`);

function setupWorkflow(opts: {
  phase?: number;
  tasks?: Array<{ id: string; status: string }>;
  deferred?: Array<{ id: string; severity: string; description: string }>;
  priorPhase?: { verification_gaps?: string[]; learnings?: string[] };
} = {}): void {
  const workflowDir = join(TEST_DIR, '.workflow');
  mkdirSync(workflowDir, { recursive: true });

  // state.json
  writeFileSync(join(workflowDir, 'state.json'), JSON.stringify({
    version: '1.0',
    project_name: 'TestProject',
    current_milestone: 'MVP',
    current_phase: opts.phase ?? 2,
    status: 'phase_2_pending',
    phases_summary: { total: 4, completed: 1, in_progress: 0, pending: 3 },
    accumulated_context: {
      key_decisions: ['Decision A', 'Decision B'],
      deferred: opts.deferred ?? [
        { id: 'GAP-001', severity: 'high', description: 'Missing auth flow', fix_direction: 'Add OAuth' },
        { id: 'GAP-002', severity: 'medium', description: 'No tests', fix_direction: 'Add unit tests' },
      ],
    },
    transition_history: [
      { type: 'phase', from_phase: 1, to_phase: 2, milestone: 'MVP', transitioned_at: '2026-04-10T00:00:00Z' },
    ],
  }));

  // Phase directory with tasks
  const phaseNum = opts.phase ?? 2;
  const prefix = String(phaseNum).padStart(2, '0');
  const phaseDir = join(workflowDir, 'phases', `${prefix}-test-phase`);
  const taskDir = join(phaseDir, '.task');
  const summariesDir = join(phaseDir, '.summaries');
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(summariesDir, { recursive: true });

  // Phase index
  writeFileSync(join(phaseDir, 'index.json'), JSON.stringify({
    phase: phaseNum,
    title: 'Test Phase',
    status: 'executing',
  }));
  writeFileSync(join(phaseDir, 'plan.json'), '{}');

  // Tasks
  const tasks = opts.tasks ?? [
    { id: 'TASK-001', status: 'completed' },
    { id: 'TASK-002', status: 'completed' },
    { id: 'TASK-003', status: 'in_progress' },
    { id: 'TASK-004', status: 'pending' },
  ];
  for (const t of tasks) {
    writeFileSync(join(taskDir, `${t.id}.json`), JSON.stringify({ task_id: t.id, status: t.status }));
  }

  // Summary file
  writeFileSync(join(summariesDir, 'TASK-001-summary.md'), '# Summary');

  // Prior phase (for learnings/gaps)
  if (opts.priorPhase && phaseNum > 1) {
    const priorPrefix = String(phaseNum - 1).padStart(2, '0');
    const priorDir = join(workflowDir, 'phases', `${priorPrefix}-prior-phase`);
    mkdirSync(priorDir, { recursive: true });
    writeFileSync(join(priorDir, 'index.json'), JSON.stringify({
      phase: phaseNum - 1,
      title: 'Prior Phase',
      status: 'completed',
      verification: {
        status: 'gaps_found',
        gaps: (opts.priorPhase.verification_gaps ?? []).map(d => ({ description: d, severity: 'medium' })),
      },
      learnings: {
        patterns: (opts.priorPhase.learnings ?? []).map(c => ({ content: c })),
        pitfalls: [],
      },
    }));
  }
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// parseSkillInvocation
// ---------------------------------------------------------------------------

describe('parseSkillInvocation', () => {
  it('matches /maestro-execute with phase number', () => {
    const result = parseSkillInvocation('/maestro-execute 2');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-execute');
    assert.strictEqual(result.phaseNum, 2);
  });

  it('matches /maestro-plan with phase number', () => {
    const result = parseSkillInvocation('/maestro-plan 1');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-plan');
    assert.strictEqual(result.phaseNum, 1);
  });

  it('matches /maestro-verify with phase number', () => {
    const result = parseSkillInvocation('/maestro-verify 3');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-verify');
    assert.strictEqual(result.phaseNum, 3);
  });

  it('matches /maestro-phase-transition without number', () => {
    const result = parseSkillInvocation('/maestro-phase-transition');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-phase-transition');
    assert.strictEqual(result.phaseNum, undefined);
  });

  it('matches /maestro-phase-transition with number', () => {
    const result = parseSkillInvocation('/maestro-phase-transition 2');
    assert.ok(result);
    assert.strictEqual(result.skill, 'maestro-phase-transition');
    assert.strictEqual(result.phaseNum, 2);
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
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.strictEqual(result, null);
  });

  it('returns workflow state section', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Workflow Context'));
    assert.ok(ctx.includes('MVP'));
    assert.ok(ctx.includes('Phase: 2'));
  });

  it('returns artifact tree with task statuses', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Phase 2 Artifacts'));
    assert.ok(ctx.includes('.task/'));
    assert.ok(ctx.includes('TASK-001 ✓'));
    assert.ok(ctx.includes('TASK-003 →'));
    assert.ok(ctx.includes('TASK-004 …'));
  });

  it('returns deferred items section', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Deferred Items'));
    assert.ok(ctx.includes('Missing auth flow'));
  });

  it('returns prior phase learnings and gaps', () => {
    setupWorkflow({
      priorPhase: {
        verification_gaps: ['OAuth not implemented', 'Missing rate limiting'],
        learnings: ['Schema isolation works well'],
      },
    });
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Verification Gaps'));
    assert.ok(ctx.includes('OAuth not implemented'));
    assert.ok(ctx.includes('Prior Phase Learnings'));
    assert.ok(ctx.includes('Schema isolation works well'));
  });

  it('uses correct hookEventName', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    assert.strictEqual(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  });

  it('returns summaries count', () => {
    setupWorkflow();
    const result = evaluateSkillContext({ user_prompt: '/maestro-execute 2', cwd: TEST_DIR });
    assert.ok(result);
    const ctx = result.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('.summaries/'));
  });
});
