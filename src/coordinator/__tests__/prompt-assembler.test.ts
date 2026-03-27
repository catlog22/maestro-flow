import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DefaultPromptAssembler } from '../prompt-assembler.js';
import type {
  AssembleRequest,
  CommandNode,
  ProjectSnapshot,
  WalkerContext,
} from '../graph-types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<ProjectSnapshot>): ProjectSnapshot {
  return {
    initialized: true,
    current_phase: 1,
    phase_status: 'in_progress',
    artifacts: {},
    execution: { tasks_completed: 0, tasks_total: 0 },
    verification_status: 'pending',
    review_verdict: null,
    uat_status: 'pending',
    phases_total: 3,
    phases_completed: 0,
    accumulated_context: null,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<WalkerContext>): WalkerContext {
  return {
    inputs: {},
    project: makeProject(),
    result: null,
    analysis: null,
    visits: {},
    var: {},
    ...overrides,
  };
}

function makeNode(overrides?: Partial<CommandNode>): CommandNode {
  return { type: 'command', cmd: 'maestro-plan', args: '', next: 'done', ...overrides };
}

function makeRequest(overrides?: Partial<AssembleRequest>): AssembleRequest {
  return {
    node: makeNode(),
    node_id: 'test-node',
    context: makeCtx(),
    graph: { id: 'test-graph', name: 'Test Graph' },
    command_index: 1,
    command_total: 3,
    auto_mode: false,
    ...overrides,
  };
}

// Non-existent template dir forces built-in default
const assembler = new DefaultPromptAssembler('/tmp/workflow', '/tmp/nonexistent-templates');

// ---------------------------------------------------------------------------
// Phase 1: Resolve Args
// ---------------------------------------------------------------------------

describe('Phase 1: resolveArgs', () => {
  it('replaces {phase} from ctx.inputs', () => {
    const ctx = makeCtx({ inputs: { phase: '2' } });
    const result = assembler.resolveArgs('{phase}', ctx);
    assert.strictEqual(result, '2');
  });

  it('replaces {var.scratch_dir} from ctx.var', () => {
    const ctx = makeCtx({ var: { scratch_dir: '/tmp/scratch' } });
    const result = assembler.resolveArgs('{var.scratch_dir}', ctx);
    assert.strictEqual(result, '/tmp/scratch');
  });

  it('replaces {description} from ctx.inputs', () => {
    const ctx = makeCtx({ inputs: { description: 'Add login feature' } });
    const result = assembler.resolveArgs('--desc "{description}"', ctx);
    assert.strictEqual(result, '--desc "Add login feature"');
  });

  it('falls back to ctx.var when not in inputs', () => {
    const ctx = makeCtx({ var: { mode: 'fast' } });
    const result = assembler.resolveArgs('--mode {mode}', ctx);
    assert.strictEqual(result, '--mode fast');
  });

  it('resolves nested var path {var.config.timeout}', () => {
    const ctx = makeCtx({ var: { config: { timeout: 5000 } } });
    const result = assembler.resolveArgs('--timeout {var.config.timeout}', ctx);
    assert.strictEqual(result, '--timeout 5000');
  });

  it('keeps unresolved placeholders as-is', () => {
    const ctx = makeCtx();
    const result = assembler.resolveArgs('{unknown_key}', ctx);
    assert.strictEqual(result, '{unknown_key}');
  });

  it('handles multiple placeholders', () => {
    const ctx = makeCtx({ inputs: { phase: '1', description: 'test' } });
    const result = assembler.resolveArgs('{phase} {description}', ctx);
    assert.strictEqual(result, '1 test');
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Build Command
// ---------------------------------------------------------------------------

describe('Phase 2: buildCommand', () => {
  it('formats /cmd args', () => {
    const node = makeNode({ cmd: 'maestro-execute', args: '--phase 2' });
    const result = assembler.buildCommand(node, '--phase 2', false);
    assert.strictEqual(result, '/maestro-execute --phase 2');
  });

  it('appends auto_flag when auto_mode is true', () => {
    const node = makeNode({ cmd: 'maestro-plan', auto_flag: '-y' });
    const result = assembler.buildCommand(node, '', true);
    assert.strictEqual(result, '/maestro-plan -y');
  });

  it('omits auto_flag when auto_mode is false', () => {
    const node = makeNode({ cmd: 'maestro-plan', auto_flag: '-y' });
    const result = assembler.buildCommand(node, '', false);
    assert.strictEqual(result, '/maestro-plan');
  });

  it('trims whitespace for empty args', () => {
    const node = makeNode({ cmd: 'maestro-verify' });
    const result = assembler.buildCommand(node, '', false);
    assert.strictEqual(result, '/maestro-verify');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Previous Context
// ---------------------------------------------------------------------------

describe('Phase 3: buildPreviousContext', () => {
  it('includes previous command with outcome and summary', () => {
    const req = makeRequest({
      previous_command: {
        node_id: 'step_plan',
        cmd: 'maestro-plan',
        outcome: 'success',
        summary: 'Created 5 tasks',
      },
    });
    const result = assembler.buildPreviousContext(req);
    assert.ok(result.includes('### Previous Step: maestro-plan (success)'));
    assert.ok(result.includes('Created 5 tasks'));
  });

  it('includes previous result fields', () => {
    const req = makeRequest({
      context: makeCtx({
        result: {
          status: 'SUCCESS',
          phase: '2',
          artifacts: 'plan.json, state.json',
          summary: 'Planning complete',
        },
      }),
    });
    const result = assembler.buildPreviousContext(req);
    assert.ok(result.includes('### Previous Result'));
    assert.ok(result.includes('**Status:** SUCCESS'));
    assert.ok(result.includes('**Phase:** 2'));
    assert.ok(result.includes('**Artifacts:** plan.json, state.json'));
    assert.ok(result.includes('**Summary:** Planning complete'));
  });

  it('includes analysis hints with cautions', () => {
    const req = makeRequest({
      context: makeCtx({
        analysis: {
          quality_score: 85,
          next_step_hints: {
            prompt_additions: 'Focus on error handling',
            cautions: ['Skip flaky tests', 'Check memory'],
            context_to_carry: 'Auth module refactored',
          },
        },
      }),
    });
    const result = assembler.buildPreviousContext(req);
    assert.ok(result.includes('### Analysis Hints'));
    assert.ok(result.includes('Focus on error handling'));
    assert.ok(result.includes('**Cautions:** Skip flaky tests; Check memory'));
    assert.ok(result.includes('Auth module refactored'));
    assert.ok(result.includes('Previous step quality: 85/100'));
  });

  it('returns empty string when no previous context', () => {
    const req = makeRequest();
    const result = assembler.buildPreviousContext(req);
    assert.strictEqual(result, '');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: State Snapshot
// ---------------------------------------------------------------------------

describe('Phase 4: buildStateSnapshot', () => {
  it('shows phase, status, progress', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      current_phase: 2,
      phase_status: 'executing',
      phases_completed: 1,
      phases_total: 4,
    }));
    assert.ok(result.includes('Phase 2 | Status: executing'));
    assert.ok(result.includes('Progress: 1/4 phases'));
  });

  it('shows tasks when total > 0', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      execution: { tasks_completed: 3, tasks_total: 5 },
    }));
    assert.ok(result.includes('Tasks: 3/5'));
  });

  it('shows verification when not pending', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      verification_status: 'passed',
    }));
    assert.ok(result.includes('Verification: passed'));
  });

  it('shows review verdict when not null', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      review_verdict: 'WARN',
    }));
    assert.ok(result.includes('Review: WARN'));
  });

  it('shows UAT when not pending', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      uat_status: 'failed',
    }));
    assert.ok(result.includes('UAT: failed'));
  });

  it('shows truthy artifacts', () => {
    const result = assembler.buildStateSnapshot(makeProject({
      artifacts: { 'plan.json': true, 'state.json': true, 'context.md': false },
    }));
    assert.ok(result.includes('Artifacts: plan.json, state.json'));
    assert.ok(!result.includes('context.md'));
  });

  it('returns not-initialized message', () => {
    const result = assembler.buildStateSnapshot(makeProject({ initialized: false }));
    assert.strictEqual(result, 'Project not initialized.');
  });

  it('omits tasks line when total is 0', () => {
    const result = assembler.buildStateSnapshot(makeProject());
    assert.ok(!result.includes('Tasks:'));
  });

  it('omits verification/review/uat when at defaults', () => {
    const result = assembler.buildStateSnapshot(makeProject());
    assert.ok(!result.includes('Verification:'));
    assert.ok(!result.includes('Review:'));
    assert.ok(!result.includes('UAT:'));
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Template rendering
// ---------------------------------------------------------------------------

describe('Phase 5: renderTemplate', () => {
  it('replaces simple variables', () => {
    const result = assembler.renderTemplate('Hello {{NAME}}', { NAME: 'World' });
    assert.ok(result.includes('Hello World'));
  });

  it('includes conditional block when field is non-empty', () => {
    const result = assembler.renderTemplate(
      '{{#HINT}}Hint: {{HINT}}{{/HINT}}',
      { HINT: 'check tests' },
    );
    assert.ok(result.includes('Hint: check tests'));
  });

  it('removes conditional block when field is empty', () => {
    const result = assembler.renderTemplate(
      'Before{{#HINT}}\nHint: {{HINT}}{{/HINT}}\nAfter',
      { HINT: '' },
    );
    assert.ok(!result.includes('Hint:'));
    assert.ok(result.includes('Before'));
    assert.ok(result.includes('After'));
  });

  it('handles missing variable as empty string', () => {
    const result = assembler.renderTemplate('Value: {{MISSING}}', {});
    assert.ok(result.includes('Value:'));
  });
});

// ---------------------------------------------------------------------------
// Phase 6: Auto Directive
// ---------------------------------------------------------------------------

describe('Phase 6: auto directive', () => {
  it('includes auto directive when auto_mode is true', async () => {
    const req = makeRequest({ auto_mode: true });
    const result = await assembler.assemble(req);
    assert.ok(result.includes('Auto-confirm all prompts'));
  });

  it('omits auto directive when auto_mode is false', async () => {
    const req = makeRequest({ auto_mode: false });
    const result = await assembler.assemble(req);
    assert.ok(!result.includes('Auto-confirm'));
  });
});

// ---------------------------------------------------------------------------
// Full assemble: end-to-end
// ---------------------------------------------------------------------------

describe('Full assemble (end-to-end)', () => {
  it('produces complete prompt with all phases', async () => {
    const req = makeRequest({
      node: makeNode({
        cmd: 'maestro-execute',
        args: '--phase {phase}',
        auto_flag: '-y',
      }),
      context: makeCtx({
        inputs: { phase: '2', intent: 'Build auth module' },
        project: makeProject({
          current_phase: 2,
          phase_status: 'executing',
          phases_completed: 1,
          phases_total: 3,
          execution: { tasks_completed: 2, tasks_total: 5 },
          artifacts: { 'plan.json': true },
        }),
        result: { status: 'SUCCESS', summary: 'Plan created' },
        analysis: {
          quality_score: 90,
          next_step_hints: {
            prompt_additions: 'Focus on security',
            cautions: ['Watch memory usage'],
          },
        },
      }),
      graph: { id: 'full-lifecycle', name: 'Full Lifecycle' },
      command_index: 2,
      command_total: 5,
      auto_mode: true,
      previous_command: {
        node_id: 'step_plan',
        cmd: 'maestro-plan',
        outcome: 'success',
        summary: 'Created plan with 5 tasks',
      },
    });

    const result = await assembler.assemble(req);

    // Phase 1: Args resolved
    assert.ok(result.includes('/maestro-execute --phase 2'));

    // Phase 2: Command with auto flag
    assert.ok(result.includes('-y'));

    // Phase 3: Previous context
    assert.ok(result.includes('Previous Step: maestro-plan (success)'));
    assert.ok(result.includes('Created plan with 5 tasks'));
    assert.ok(result.includes('Previous Result'));
    assert.ok(result.includes('Plan created'));
    assert.ok(result.includes('Analysis Hints'));
    assert.ok(result.includes('Focus on security'));
    assert.ok(result.includes('**Cautions:** Watch memory usage'));
    assert.ok(result.includes('Previous step quality: 90/100'));

    // Phase 4: State snapshot
    assert.ok(result.includes('Phase 2 | Status: executing'));
    assert.ok(result.includes('Progress: 1/3 phases'));
    assert.ok(result.includes('Tasks: 2/5'));
    assert.ok(result.includes('Artifacts: plan.json'));

    // Phase 5: Template structure
    assert.ok(result.includes('Coordinate Step 2/5'));
    assert.ok(result.includes('Full Lifecycle'));
    assert.ok(result.includes('COORDINATE RESULT'));

    // Phase 6: Auto directive
    assert.ok(result.includes('Auto-confirm all prompts'));

    // Intent
    assert.ok(result.includes('Build auth module'));
  });

  it('produces minimal prompt with no context', async () => {
    const req = makeRequest({
      node: makeNode({ cmd: 'maestro-init' }),
      context: makeCtx({
        project: makeProject({ initialized: false }),
      }),
    });

    const result = await assembler.assemble(req);

    assert.ok(result.includes('/maestro-init'));
    assert.ok(result.includes('Project not initialized.'));
    assert.ok(!result.includes('Previous Step'));
    assert.ok(!result.includes('Analysis Hints'));
    assert.ok(!result.includes('Auto-confirm'));
  });
});
