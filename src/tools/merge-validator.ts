// ---------------------------------------------------------------------------
// Merge Validator — Pre-merge integrity checks for worktree → main merges.
//
// Pure functions — no side effects, no git operations. Takes paths and returns
// validation results. Called by the maestro-merge workflow before Phase 1.
//
// Checks:
//   1. Phase completeness: all owned phases must be "completed"
//   2. State consistency: worktree state.json fields don't conflict with main
//   3. Artifact integrity: every owned phase has a valid index.json
//   4. Dependency check: dependency phases still exist in main
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeValidation {
  phase_completeness: boolean;
  state_consistency: boolean;
  artifact_integrity: boolean;
  dependency_check: boolean;
}

export interface MergeValidationResult {
  valid: boolean;
  checks: MergeValidation;
  errors: string[];
  warnings: string[];
}

interface WorktreeScope {
  worktree: boolean;
  milestone_num: number;
  milestone: string;
  owned_phases: number[];
  main_worktree: string;
  branch: string;
  base_commit: string;
  created_at: string;
}

interface PhaseIndex {
  phase: number;
  title?: string;
  slug?: string;
  status: string;
  depends_on?: number[];
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validate that a worktree is ready to merge back to main.
 *
 * @param worktreePath  Absolute path to the worktree root
 * @param mainPath      Absolute path to the main worktree root
 * @param milestoneNum  Milestone number being merged
 * @param opts          Options (force skips completeness check)
 */
export function validateMergeReadiness(
  worktreePath: string,
  mainPath: string,
  milestoneNum: number,
  opts?: { force?: boolean },
): MergeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Load worktree-scope.json
  const scope = loadWorktreeScope(worktreePath);
  if (!scope) {
    return {
      valid: false,
      checks: { phase_completeness: false, state_consistency: false, artifact_integrity: false, dependency_check: false },
      errors: ['Cannot read .workflow/worktree-scope.json in worktree'],
      warnings: [],
    };
  }

  if (scope.milestone_num !== milestoneNum) {
    errors.push(
      `Milestone mismatch: worktree owns M${scope.milestone_num} but merge requested for M${milestoneNum}`,
    );
  }

  // Check 1: Phase completeness
  const completeness = checkPhaseCompleteness(worktreePath, scope.owned_phases, opts?.force);
  if (!completeness.passed) {
    if (opts?.force) {
      warnings.push(...completeness.messages.map(m => `[force] ${m}`));
    } else {
      errors.push(...completeness.messages);
    }
  }

  // Check 2: State consistency
  const consistency = checkStateConsistency(worktreePath, mainPath);
  if (!consistency.passed) {
    errors.push(...consistency.messages);
  }

  // Check 3: Artifact integrity
  const integrity = checkArtifactIntegrity(worktreePath, scope.owned_phases);
  if (!integrity.passed) {
    errors.push(...integrity.messages);
  }

  // Check 4: Dependency check
  const deps = checkDependencies(worktreePath, mainPath, scope.owned_phases);
  if (!deps.passed) {
    warnings.push(...deps.messages);
  }

  const checks: MergeValidation = {
    phase_completeness: completeness.passed || (opts?.force === true),
    state_consistency: consistency.passed,
    artifact_integrity: integrity.passed,
    dependency_check: deps.passed,
  };

  return {
    valid: errors.length === 0,
    checks,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Check 1: Phase Completeness
// ---------------------------------------------------------------------------

interface CheckResult {
  passed: boolean;
  messages: string[];
}

function checkPhaseCompleteness(
  worktreePath: string,
  ownedPhases: number[],
  force?: boolean,
): CheckResult {
  const messages: string[] = [];
  const phasesDir = join(worktreePath, '.workflow', 'phases');

  if (!existsSync(phasesDir)) {
    return { passed: false, messages: ['No .workflow/phases/ directory in worktree'] };
  }

  for (const phaseNum of ownedPhases) {
    const index = findPhaseIndex(phasesDir, phaseNum);
    if (!index) {
      messages.push(`Phase ${phaseNum}: index.json not found`);
      continue;
    }
    if (index.status !== 'completed') {
      messages.push(
        `Phase ${phaseNum} (${index.title ?? index.slug ?? '?'}): status is "${index.status}", expected "completed"`,
      );
    }
  }

  return { passed: messages.length === 0, messages };
}

// ---------------------------------------------------------------------------
// Check 2: State Consistency
// ---------------------------------------------------------------------------

function checkStateConsistency(worktreePath: string, mainPath: string): CheckResult {
  const messages: string[] = [];

  const wtStatePath = join(worktreePath, '.workflow', 'state.json');
  const mainStatePath = join(mainPath, '.workflow', 'state.json');

  const wtState = loadJson(wtStatePath);
  const mainState = loadJson(mainStatePath);

  if (!wtState) {
    messages.push('Cannot read .workflow/state.json in worktree');
    return { passed: false, messages };
  }
  if (!mainState) {
    messages.push('Cannot read .workflow/state.json in main');
    return { passed: false, messages };
  }

  // Check that project-level fields haven't diverged
  if (wtState.project_name && mainState.project_name &&
      wtState.project_name !== mainState.project_name) {
    messages.push(
      `project_name diverged: worktree="${wtState.project_name}" vs main="${mainState.project_name}"`,
    );
  }

  // Check milestones array length consistency
  const wtMilestones = Array.isArray(wtState.milestones) ? wtState.milestones.length : 0;
  const mainMilestones = Array.isArray(mainState.milestones) ? mainState.milestones.length : 0;
  if (wtMilestones !== mainMilestones && wtMilestones > 0 && mainMilestones > 0) {
    messages.push(
      `milestones array length differs: worktree=${wtMilestones} vs main=${mainMilestones}`,
    );
  }

  return { passed: messages.length === 0, messages };
}

// ---------------------------------------------------------------------------
// Check 3: Artifact Integrity
// ---------------------------------------------------------------------------

function checkArtifactIntegrity(worktreePath: string, ownedPhases: number[]): CheckResult {
  const messages: string[] = [];
  const phasesDir = join(worktreePath, '.workflow', 'phases');

  for (const phaseNum of ownedPhases) {
    const index = findPhaseIndex(phasesDir, phaseNum);
    if (!index) {
      messages.push(`Phase ${phaseNum}: missing index.json`);
      continue;
    }

    // Validate required fields
    if (typeof index.phase !== 'number') {
      messages.push(`Phase ${phaseNum}: index.json missing "phase" field`);
    }
    if (typeof index.status !== 'string') {
      messages.push(`Phase ${phaseNum}: index.json missing "status" field`);
    }
  }

  return { passed: messages.length === 0, messages };
}

// ---------------------------------------------------------------------------
// Check 4: Dependency Check
// ---------------------------------------------------------------------------

function checkDependencies(
  worktreePath: string,
  mainPath: string,
  ownedPhases: number[],
): CheckResult {
  const messages: string[] = [];
  const wtPhasesDir = join(worktreePath, '.workflow', 'phases');
  const mainPhasesDir = join(mainPath, '.workflow', 'phases');

  // Collect all dependencies from owned phases
  const allDeps = new Set<number>();
  for (const phaseNum of ownedPhases) {
    const index = findPhaseIndex(wtPhasesDir, phaseNum);
    if (index?.depends_on) {
      for (const dep of index.depends_on) {
        if (!ownedPhases.includes(dep)) {
          allDeps.add(dep);
        }
      }
    }
  }

  // Verify each dependency still exists in main
  for (const dep of allDeps) {
    const mainIndex = findPhaseIndex(mainPhasesDir, dep);
    if (!mainIndex) {
      messages.push(`Dependency phase ${dep} not found in main .workflow/phases/`);
    } else if (mainIndex.status !== 'completed') {
      messages.push(
        `Dependency phase ${dep} in main has status "${mainIndex.status}" (expected "completed")`,
      );
    }
  }

  return { passed: messages.length === 0, messages };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadWorktreeScope(worktreePath: string): WorktreeScope | null {
  const scopePath = join(worktreePath, '.workflow', 'worktree-scope.json');
  return loadJson(scopePath) as WorktreeScope | null;
}

function loadJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Find a phase's index.json by phase number. Phases are stored as
 * `{NN}-{slug}/index.json` where NN is zero-padded.
 */
function findPhaseIndex(phasesDir: string, phaseNum: number): PhaseIndex | null {
  if (!existsSync(phasesDir)) return null;

  const prefix = String(phaseNum).padStart(2, '0') + '-';
  try {
    const entries = readdirSync(phasesDir);
    const match = entries.find(e => e.startsWith(prefix));
    if (!match) return null;

    const indexPath = join(phasesDir, match, 'index.json');
    if (!existsSync(indexPath)) return null;

    return JSON.parse(readFileSync(indexPath, 'utf-8')) as PhaseIndex;
  } catch {
    return null;
  }
}
