import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMergeReadiness } from '../merge-validator.js';

let worktree: string;
let main: string;

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'merge-wt-'));
  main = mkdtempSync(join(tmpdir(), 'merge-main-'));
});
afterEach(() => {
  if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
  if (existsSync(main)) rmSync(main, { recursive: true, force: true });
});

function setupRoot(root: string, runs: Array<{ sequence: number; status?: string; command?: string; artifact?: boolean }> = []): void {
  const workflowDir = join(root, '.workflow');
  const sessionDir = join(workflowDir, 'sessions', 'session-1');
  mkdirSync(join(sessionDir, 'runs'), { recursive: true });
  writeFileSync(join(workflowDir, 'state.json'), JSON.stringify({ project_name: 'test-project', active_session_id: 'session-1' }));
  const artifacts: Record<string, unknown> = {};
  for (const item of runs) {
    const runId = `20260713-${String(item.sequence).padStart(3, '0')}-execute`;
    const runDir = join(sessionDir, 'runs', runId);
    mkdirSync(join(runDir, 'outputs'), { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({
      run_id: runId,
      sequence: item.sequence,
      command: item.command ?? 'maestro-execute',
      status: item.status ?? 'sealed',
    }));
    if (item.artifact !== false) {
      const relativePath = `runs/${runId}/outputs/execution.json`;
      writeFileSync(join(sessionDir, relativePath), '{}');
      artifacts[`ART-${item.sequence}`] = {
        kind: 'execution', status: 'sealed', producer_run_id: runId, relative_path: relativePath,
      };
    }
  }
  writeFileSync(join(sessionDir, 'artifacts.json'), JSON.stringify({ artifacts, aliases: {} }));
}

function setupScope(phases = [3, 4], dependencies?: Record<string, number[]>): void {
  const workflowDir = join(worktree, '.workflow');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(join(workflowDir, 'worktree-scope.json'), JSON.stringify({
    milestone_num: 2,
    owned_phases: phases,
    phase_dependencies: dependencies,
  }));
}

describe('merge-validator canonical Session/Run', () => {
  it('fails when worktree scope is missing', () => {
    setupRoot(worktree);
    setupRoot(main);
    expect(validateMergeReadiness(worktree, main, 2).errors[0]).toContain('worktree-scope.json');
  });

  it('passes sealed execute Runs with sealed artifacts', () => {
    setupScope();
    setupRoot(worktree, [{ sequence: 3 }, { sequence: 4 }]);
    setupRoot(main);
    const result = validateMergeReadiness(worktree, main, 2);
    expect(result.valid).toBe(true);
    expect(result.checks.phase_completeness).toBe(true);
    expect(result.checks.artifact_integrity).toBe(true);
  });

  it('rejects a non-sealed execute Run', () => {
    setupScope();
    setupRoot(worktree, [{ sequence: 3 }, { sequence: 4, status: 'running' }]);
    setupRoot(main);
    const result = validateMergeReadiness(worktree, main, 2);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('expected "sealed"'))).toBe(true);
  });

  it('force only downgrades Run completeness', () => {
    setupScope();
    setupRoot(worktree, [{ sequence: 3 }, { sequence: 4, status: 'running' }]);
    setupRoot(main);
    const result = validateMergeReadiness(worktree, main, 2, { force: true });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(warning => warning.startsWith('[force]'))).toBe(true);
  });

  it('rejects missing canonical artifacts', () => {
    setupScope([3]);
    setupRoot(worktree, [{ sequence: 3, artifact: false }]);
    setupRoot(main);
    const result = validateMergeReadiness(worktree, main, 2);
    expect(result.checks.artifact_integrity).toBe(false);
    expect(result.errors.some(error => error.includes('Session registry'))).toBe(true);
  });

  it('checks external dependencies against sealed execute Runs in main', () => {
    setupScope([3, 4], { '3': [1, 2], '4': [3] });
    setupRoot(worktree, [{ sequence: 3 }, { sequence: 4 }]);
    setupRoot(main, [{ sequence: 1 }]);
    const result = validateMergeReadiness(worktree, main, 2);
    expect(result.warnings.some(warning => warning.includes('Dependency phase 2'))).toBe(true);
  });

  it('detects project identity divergence', () => {
    setupScope([3]);
    setupRoot(worktree, [{ sequence: 3 }]);
    setupRoot(main);
    writeFileSync(join(main, '.workflow', 'state.json'), JSON.stringify({ project_name: 'other-project' }));
    expect(validateMergeReadiness(worktree, main, 2).checks.state_consistency).toBe(false);
  });
});
