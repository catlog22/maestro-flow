import { describe, it, expect } from 'vitest';

import {
  detectTaskType,
  resolveArgs,
  resolveAgentType,
  CHAIN_MAP,
  TASK_TO_CHAIN,
  INTENT_PATTERNS,
  AUTO_FLAG_MAP,
  STEP_TIMEOUT_MS,
} from './chain-map.js';

// ---------------------------------------------------------------------------
// detectTaskType
// ---------------------------------------------------------------------------

describe('detectTaskType', () => {
  it('detects state_continue for "continue"', () => {
    expect(detectTaskType('continue')).toBe('state_continue');
    expect(detectTaskType('next')).toBe('state_continue');
    expect(detectTaskType('go')).toBe('state_continue');
  });

  it('detects status for "status"', () => {
    expect(detectTaskType('status')).toBe('status');
    expect(detectTaskType('dashboard')).toBe('status');
  });

  it('detects spec_generate', () => {
    expect(detectTaskType('spec generate the API')).toBe('spec_generate');
    expect(detectTaskType('spec creation')).toBe('spec_generate');
  });

  it('detects brainstorm', () => {
    expect(detectTaskType('brainstorm ideas for auth')).toBe('brainstorm');
    expect(detectTaskType('ideate on new features')).toBe('brainstorm');
  });

  it('detects analyze', () => {
    expect(detectTaskType('analyze the database schema')).toBe('analyze');
    expect(detectTaskType('evaluate feasibility')).toBe('analyze');
    expect(detectTaskType('discuss the approach')).toBe('analyze');
  });

  it('detects ui_design', () => {
    expect(detectTaskType('UI design for dashboard')).toBe('ui_design');
    expect(detectTaskType('design UI components')).toBe('ui_design');
  });

  it('detects init', () => {
    expect(detectTaskType('init the project')).toBe('init');
    expect(detectTaskType('setup project')).toBe('init');
  });

  it('detects plan', () => {
    expect(detectTaskType('plan the sprint')).toBe('plan');
    expect(detectTaskType('break down the feature')).toBe('plan');
  });

  it('detects execute', () => {
    expect(detectTaskType('execute the task now')).toBe('execute');
    expect(detectTaskType('implement the auth module')).toBe('execute');
    expect(detectTaskType('build the feature')).toBe('execute');
    expect(detectTaskType('develop the API')).toBe('execute');
    expect(detectTaskType('code the feature')).toBe('execute');
  });

  it('detects verify', () => {
    expect(detectTaskType('verify the results')).toBe('verify');
    expect(detectTaskType('validate result output')).toBe('verify');
  });

  it('review pattern is shadowed by execute for "code" keyword', () => {
    // The 'execute' pattern matches 'code' before 'review' can match 'code review'
    // This documents the actual first-match-wins behavior
    expect(detectTaskType('review code changes')).toBe('execute');
    expect(detectTaskType('code review the PR')).toBe('execute');
  });

  it('detects test_gen', () => {
    expect(detectTaskType('test gen for auth module')).toBe('test_gen');
    expect(detectTaskType('generate tests for the API')).toBe('test_gen');
    expect(detectTaskType('add tests for utils')).toBe('test_gen');
  });

  it('detects test', () => {
    expect(detectTaskType('test the feature')).toBe('test');
    expect(detectTaskType('run uat')).toBe('test');
  });

  it('detects debug', () => {
    expect(detectTaskType('debug the auth flow')).toBe('debug');
    expect(detectTaskType('diagnose the error')).toBe('debug');
    expect(detectTaskType('troubleshoot the issue')).toBe('debug');
    expect(detectTaskType('fix bug in login')).toBe('debug');
  });

  it('detects integration_test via e2e keyword', () => {
    // "integration test" matches 'test' first due to pattern order
    // Only 'e2e' reaches the integration_test pattern
    expect(detectTaskType('e2e suite')).toBe('integration_test');
    expect(detectTaskType('e2e')).toBe('integration_test');
  });

  it('detects refactor', () => {
    expect(detectTaskType('refactor the auth module')).toBe('refactor');
    expect(detectTaskType('tech debt cleanup')).toBe('refactor');
  });

  it('detects sync', () => {
    expect(detectTaskType('sync doc with project')).toBe('sync');
    expect(detectTaskType('refresh doc for module')).toBe('sync');
  });

  it('detects phase_transition', () => {
    expect(detectTaskType('phase transition to next')).toBe('phase_transition');
    expect(detectTaskType('next phase now')).toBe('phase_transition');
  });

  it('detects issue', () => {
    expect(detectTaskType('create issue for bug')).toBe('issue');
    expect(detectTaskType('discover issues in module')).toBe('issue');
  });

  it('detects quick for fallback and explicit match', () => {
    expect(detectTaskType('quick fix the button')).toBe('quick');
    expect(detectTaskType('small task: rename file')).toBe('quick');
  });

  it('returns quick as fallback for unknown intent', () => {
    expect(detectTaskType('some random text that matches nothing specific')).toBe('quick');
    expect(detectTaskType('')).toBe('quick');
  });

  it('is case-insensitive', () => {
    expect(detectTaskType('CONTINUE')).toBe('state_continue');
    expect(detectTaskType('STATUS')).toBe('status');
    expect(detectTaskType('ANALYZE the code')).toBe('analyze');
  });

  it('detects memory_capture', () => {
    expect(detectTaskType('memory capture the context')).toBe('memory_capture');
    expect(detectTaskType('save memory of the session')).toBe('memory_capture');
  });

  it('detects memory', () => {
    expect(detectTaskType('knowhow management')).toBe('knowhow');
    expect(detectTaskType('manage knowhow for project')).toBe('knowhow');
  });
});

// ---------------------------------------------------------------------------
// resolveArgs
// ---------------------------------------------------------------------------

describe('resolveArgs', () => {
  it('replaces {phase} with provided phase', () => {
    expect(resolveArgs('{phase}', 'some intent', 'alpha')).toBe('alpha');
  });

  it('replaces {description} with intent text', () => {
    expect(resolveArgs('"{description}"', 'fix the login bug', 'p1')).toBe('"fix the login bug"');
  });

  it('replaces {scratch_dir} with empty string', () => {
    expect(resolveArgs('--dir {scratch_dir}', 'intent', 'p1')).toBe('--dir ');
  });

  it('replaces multiple placeholders in one template', () => {
    const result = resolveArgs('{phase} "{description}" --dir {scratch_dir}', 'build auth', 'beta');
    expect(result).toBe('beta "build auth" --dir ');
  });

  it('handles null phase gracefully', () => {
    expect(resolveArgs('{phase}', 'intent', null)).toBe('');
  });

  it('returns template unchanged when no placeholders present', () => {
    expect(resolveArgs('-y --auto', 'intent', 'p1')).toBe('-y --auto');
  });

  it('handles empty template', () => {
    expect(resolveArgs('', 'intent', 'p1')).toBe('');
  });

  it('replaces multiple occurrences of same placeholder', () => {
    expect(resolveArgs('{phase}/{phase}', 'intent', 'v2')).toBe('v2/v2');
  });
});

// ---------------------------------------------------------------------------
// resolveAgentType
// ---------------------------------------------------------------------------

describe('resolveAgentType', () => {
  it('maps claude to claude-code', () => {
    expect(resolveAgentType('claude')).toBe('claude-code');
  });

  it('maps claude-code to claude-code', () => {
    expect(resolveAgentType('claude-code')).toBe('claude-code');
  });

  it('maps codex to codex', () => {
    expect(resolveAgentType('codex')).toBe('codex');
  });

  it('maps gemini to gemini', () => {
    expect(resolveAgentType('gemini')).toBe('gemini');
  });

  it('maps qwen to qwen', () => {
    expect(resolveAgentType('qwen')).toBe('qwen');
  });

  it('maps opencode to opencode', () => {
    expect(resolveAgentType('opencode')).toBe('opencode');
  });

  it('returns claude-code for null', () => {
    expect(resolveAgentType(null)).toBe('claude-code');
  });

  it('returns claude-code for unknown tool', () => {
    expect(resolveAgentType('unknown-tool')).toBe('claude-code');
  });
});

// ---------------------------------------------------------------------------
// Static exports sanity checks
// ---------------------------------------------------------------------------

describe('CHAIN_MAP', () => {
  it('contains expected single-step chains', () => {
    expect(CHAIN_MAP['status']).toHaveLength(1);
    expect(CHAIN_MAP['init']).toHaveLength(1);
    expect(CHAIN_MAP['execute']).toHaveLength(1);
    expect(CHAIN_MAP['quick']).toHaveLength(1);
  });

  it('contains expected multi-step chains', () => {
    expect(CHAIN_MAP['full-lifecycle']!.length).toBeGreaterThan(1);
    expect(CHAIN_MAP['spec-driven']!.length).toBeGreaterThan(1);
    expect(CHAIN_MAP['execute-verify']).toHaveLength(2);
  });

  it('each chain entry has cmd field', () => {
    for (const [name, steps] of Object.entries(CHAIN_MAP)) {
      for (const step of steps) {
        expect(step.cmd, `chain "${name}" has step without cmd`).toBeTruthy();
      }
    }
  });
});

describe('TASK_TO_CHAIN', () => {
  it('maps spec_generate to spec-driven', () => {
    expect(TASK_TO_CHAIN['spec_generate']).toBe('spec-driven');
  });

  it('maps brainstorm to brainstorm-driven', () => {
    expect(TASK_TO_CHAIN['brainstorm']).toBe('brainstorm-driven');
  });
});

describe('AUTO_FLAG_MAP', () => {
  it('has auto flags for known commands', () => {
    expect(AUTO_FLAG_MAP['maestro-analyze']).toBe('-y');
    expect(AUTO_FLAG_MAP['maestro-plan']).toBe('--auto');
    expect(AUTO_FLAG_MAP['quality-test']).toBe('--auto-fix');
  });
});

describe('STEP_TIMEOUT_MS', () => {
  it('is 10 minutes', () => {
    expect(STEP_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });
});

describe('INTENT_PATTERNS', () => {
  it('is non-empty array', () => {
    expect(INTENT_PATTERNS.length).toBeGreaterThan(0);
  });

  it('each entry has string type and RegExp pattern', () => {
    for (const [type, pattern] of INTENT_PATTERNS) {
      expect(typeof type).toBe('string');
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});
