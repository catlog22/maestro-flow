import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateMergeReadiness } from '../merge-validator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let wtDir: string;
let mainDir: string;

function setup(): void {
  wtDir = mkdtempSync(join(tmpdir(), 'merge-wt-'));
  mainDir = mkdtempSync(join(tmpdir(), 'merge-main-'));
}

function teardown(): void {
  if (wtDir && existsSync(wtDir)) rmSync(wtDir, { recursive: true, force: true });
  if (mainDir && existsSync(mainDir)) rmSync(mainDir, { recursive: true, force: true });
}

function setupWorktree(opts: {
  milestoneNum?: number;
  ownedPhases?: number[];
  phaseStatuses?: Record<number, string>;
}): void {
  const wfDir = join(wtDir, '.workflow');
  mkdirSync(wfDir, { recursive: true });

  // worktree-scope.json
  writeFileSync(join(wfDir, 'worktree-scope.json'), JSON.stringify({
    worktree: true,
    milestone_num: opts.milestoneNum ?? 2,
    milestone: 'Production',
    owned_phases: opts.ownedPhases ?? [3, 4],
    main_worktree: mainDir,
    branch: 'milestone/production',
    base_commit: 'abc1234',
    created_at: '2026-04-10T00:00:00Z',
  }), 'utf-8');

  // state.json
  writeFileSync(join(wfDir, 'state.json'), JSON.stringify({
    project_name: 'test-project',
    current_phase: 3,
    milestones: [{ name: 'MVP' }, { name: 'Production' }],
  }), 'utf-8');

  // Phase directories
  const phasesDir = join(wfDir, 'phases');
  const statuses = opts.phaseStatuses ?? { 3: 'completed', 4: 'completed' };
  for (const [num, status] of Object.entries(statuses)) {
    const phaseDir = join(phasesDir, `${String(num).padStart(2, '0')}-phase-${num}`);
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(join(phaseDir, 'index.json'), JSON.stringify({
      phase: Number(num),
      title: `Phase ${num}`,
      slug: `phase-${num}`,
      status,
      depends_on: Number(num) > 1 ? [Number(num) - 1] : [],
    }), 'utf-8');
  }
}

function setupMain(opts?: {
  phaseStatuses?: Record<number, string>;
}): void {
  const wfDir = join(mainDir, '.workflow');
  mkdirSync(wfDir, { recursive: true });

  // state.json
  writeFileSync(join(wfDir, 'state.json'), JSON.stringify({
    project_name: 'test-project',
    current_phase: 2,
    milestones: [{ name: 'MVP' }, { name: 'Production' }],
  }), 'utf-8');

  // Dependency phases (completed in main)
  const phasesDir = join(wfDir, 'phases');
  const statuses = opts?.phaseStatuses ?? { 1: 'completed', 2: 'completed' };
  for (const [num, status] of Object.entries(statuses)) {
    const phaseDir = join(phasesDir, `${String(num).padStart(2, '0')}-phase-${num}`);
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(join(phaseDir, 'index.json'), JSON.stringify({
      phase: Number(num),
      title: `Phase ${num}`,
      slug: `phase-${num}`,
      status,
    }), 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('merge-validator', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('fails when worktree-scope.json is missing', () => {
    mkdirSync(join(wtDir, '.workflow'), { recursive: true });
    const result = validateMergeReadiness(wtDir, mainDir, 2);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('worktree-scope.json');
  });

  it('fails on milestone mismatch', () => {
    setupWorktree({ milestoneNum: 2 });
    setupMain();
    const result = validateMergeReadiness(wtDir, mainDir, 3); // asking for M3 but worktree owns M2
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Milestone mismatch'))).toBe(true);
  });

  it('passes when all phases completed and state consistent', () => {
    setupWorktree({ phaseStatuses: { 3: 'completed', 4: 'completed' } });
    setupMain();
    const result = validateMergeReadiness(wtDir, mainDir, 2);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checks.phase_completeness).toBe(true);
    expect(result.checks.state_consistency).toBe(true);
    expect(result.checks.artifact_integrity).toBe(true);
  });

  it('fails when phases not completed', () => {
    setupWorktree({ phaseStatuses: { 3: 'completed', 4: 'in_progress' } });
    setupMain();
    const result = validateMergeReadiness(wtDir, mainDir, 2);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Phase 4') && e.includes('in_progress'))).toBe(true);
    expect(result.checks.phase_completeness).toBe(false);
  });

  it('force mode downgrades completeness errors to warnings', () => {
    setupWorktree({ phaseStatuses: { 3: 'completed', 4: 'in_progress' } });
    setupMain();
    const result = validateMergeReadiness(wtDir, mainDir, 2, { force: true });
    expect(result.valid).toBe(true); // force → valid
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('[force]') && w.includes('Phase 4'))).toBe(true);
    expect(result.checks.phase_completeness).toBe(true); // forced pass
  });

  it('detects state consistency issues (project_name divergence)', () => {
    setupWorktree({ phaseStatuses: { 3: 'completed', 4: 'completed' } });
    setupMain();
    // Modify main state to have different project name
    const mainStatePath = join(mainDir, '.workflow', 'state.json');
    writeFileSync(mainStatePath, JSON.stringify({
      project_name: 'different-project',
      current_phase: 2,
      milestones: [{ name: 'MVP' }, { name: 'Production' }],
    }), 'utf-8');

    const result = validateMergeReadiness(wtDir, mainDir, 2);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('project_name diverged'))).toBe(true);
    expect(result.checks.state_consistency).toBe(false);
  });

  it('detects missing dependency phases in main', () => {
    setupWorktree({
      ownedPhases: [3, 4],
      phaseStatuses: { 3: 'completed', 4: 'completed' },
    });
    // Main has NO phases at all
    const wfDir = join(mainDir, '.workflow');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'state.json'), JSON.stringify({
      project_name: 'test-project',
      milestones: [{ name: 'MVP' }, { name: 'Production' }],
    }), 'utf-8');

    const result = validateMergeReadiness(wtDir, mainDir, 2);
    // Dependency check fails but as warning
    expect(result.warnings.some(w => w.includes('Dependency phase'))).toBe(true);
  });

  it('artifact integrity fails when index.json has missing fields', () => {
    setupWorktree({ phaseStatuses: { 3: 'completed', 4: 'completed' } });
    setupMain();

    // Corrupt phase 4 index.json — remove required fields
    const phase4Dir = join(wtDir, '.workflow', 'phases', '04-phase-4');
    writeFileSync(join(phase4Dir, 'index.json'), JSON.stringify({
      title: 'Phase 4',
      // missing 'phase' and 'status' fields
    }), 'utf-8');

    const result = validateMergeReadiness(wtDir, mainDir, 2);
    expect(result.checks.artifact_integrity).toBe(false);
    expect(result.errors.some(e => e.includes('Phase 4') && e.includes('missing'))).toBe(true);
  });
});
