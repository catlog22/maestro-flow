// Pre-merge validation for canonical Session/Run worktrees.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  milestone_num: number;
  owned_phases: number[];
  phase_dependencies?: Record<string, number[]>;
}

interface CanonicalRun {
  run_id: string;
  sequence: number;
  command: string;
  status: string;
  sessionDir: string;
}

interface CanonicalArtifact {
  id: string;
  kind?: string;
  status?: string;
  producer_run_id?: string;
  relative_path?: string;
  sessionDir: string;
}

interface CanonicalWorkflow {
  runs: CanonicalRun[];
  artifacts: CanonicalArtifact[];
}

interface CheckResult { passed: boolean; messages: string[] }

export function validateMergeReadiness(
  worktreePath: string,
  mainPath: string,
  milestoneNum: number,
  opts?: { force?: boolean },
): MergeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scope = loadJson(join(worktreePath, '.workflow', 'worktree-scope.json')) as WorktreeScope | null;
  if (!scope) {
    return {
      valid: false,
      checks: { phase_completeness: false, state_consistency: false, artifact_integrity: false, dependency_check: false },
      errors: ['Cannot read .workflow/worktree-scope.json in worktree'],
      warnings: [],
    };
  }
  if (scope.milestone_num !== milestoneNum) {
    errors.push(`Milestone mismatch: worktree owns M${scope.milestone_num} but merge requested for M${milestoneNum}`);
  }

  const worktree = loadCanonicalWorkflow(worktreePath);
  const main = loadCanonicalWorkflow(mainPath);
  const completeness = checkCompleteness(worktree, scope.owned_phases);
  if (!completeness.passed) {
    if (opts?.force) warnings.push(...completeness.messages.map(message => `[force] ${message}`));
    else errors.push(...completeness.messages);
  }
  const consistency = checkStateConsistency(worktreePath, mainPath);
  if (!consistency.passed) errors.push(...consistency.messages);
  const integrity = checkArtifactIntegrity(worktree, scope.owned_phases);
  if (!integrity.passed) errors.push(...integrity.messages);
  const dependencies = checkDependencies(main, scope);
  if (!dependencies.passed) warnings.push(...dependencies.messages);

  const checks = {
    phase_completeness: completeness.passed || opts?.force === true,
    state_consistency: consistency.passed,
    artifact_integrity: integrity.passed,
    dependency_check: dependencies.passed,
  };
  return { valid: errors.length === 0, checks, errors, warnings };
}

function checkCompleteness(workflow: CanonicalWorkflow, phases: number[]): CheckResult {
  const messages: string[] = [];
  for (const phase of phases) {
    const run = workflow.runs.find(candidate => candidate.sequence === phase && /execute$/i.test(candidate.command));
    if (!run) messages.push(`Phase ${phase}: no execute Run found`);
    else if (run.status !== 'sealed') messages.push(`Phase ${phase}: ${run.run_id} status is "${run.status}", expected "sealed"`);
  }
  return { passed: messages.length === 0, messages };
}

function checkArtifactIntegrity(workflow: CanonicalWorkflow, phases: number[]): CheckResult {
  const messages: string[] = [];
  for (const phase of phases) {
    const runs = workflow.runs.filter(run => run.sequence === phase);
    const runIds = new Set(runs.map(run => run.run_id));
    const artifacts = workflow.artifacts.filter(artifact => artifact.producer_run_id && runIds.has(artifact.producer_run_id));
    if (artifacts.length === 0) {
      messages.push(`Phase ${phase}: no artifacts in Session registry`);
      continue;
    }
    for (const artifact of artifacts) {
      if (artifact.status !== 'sealed') messages.push(`Phase ${phase}: artifact ${artifact.id} status is not "sealed"`);
      if (!artifact.relative_path || !existsSync(join(artifact.sessionDir, artifact.relative_path))) {
        messages.push(`Phase ${phase}: artifact ${artifact.id} path "${artifact.relative_path ?? ''}" does not exist`);
      }
    }
  }
  return { passed: messages.length === 0, messages };
}

function checkDependencies(main: CanonicalWorkflow, scope: WorktreeScope): CheckResult {
  const messages: string[] = [];
  const dependencies = new Set<number>();
  for (const phase of scope.owned_phases) {
    for (const dependency of scope.phase_dependencies?.[String(phase)] ?? []) {
      if (!scope.owned_phases.includes(dependency)) dependencies.add(dependency);
    }
  }
  for (const dependency of dependencies) {
    const run = main.runs.find(candidate => candidate.sequence === dependency && /execute$/i.test(candidate.command) && candidate.status === 'sealed');
    if (!run) messages.push(`Dependency phase ${dependency} has no sealed execute Run in main`);
  }
  return { passed: messages.length === 0, messages };
}

function checkStateConsistency(worktreePath: string, mainPath: string): CheckResult {
  const worktree = loadJson(join(worktreePath, '.workflow', 'state.json'));
  const main = loadJson(join(mainPath, '.workflow', 'state.json'));
  if (!worktree) return { passed: false, messages: ['Cannot read .workflow/state.json in worktree'] };
  if (!main) return { passed: false, messages: ['Cannot read .workflow/state.json in main'] };
  if (worktree.project_name && main.project_name && worktree.project_name !== main.project_name) {
    return { passed: false, messages: [`project_name diverged: worktree="${worktree.project_name}" vs main="${main.project_name}"`] };
  }
  return { passed: true, messages: [] };
}

function loadCanonicalWorkflow(root: string): CanonicalWorkflow {
  const sessionsDir = join(root, '.workflow', 'sessions');
  const workflow: CanonicalWorkflow = { runs: [], artifacts: [] };
  if (!existsSync(sessionsDir)) return workflow;
  for (const sessionName of safeReadDir(sessionsDir)) {
    const sessionDir = join(sessionsDir, sessionName);
    const runsDir = join(sessionDir, 'runs');
    for (const runName of safeReadDir(runsDir)) {
      const run = loadJson(join(runsDir, runName, 'run.json'));
      if (run && typeof run.run_id === 'string' && typeof run.sequence === 'number') {
        workflow.runs.push({
          run_id: run.run_id,
          sequence: run.sequence,
          command: typeof run.command === 'string' ? run.command : '',
          status: typeof run.status === 'string' ? run.status : '',
          sessionDir,
        });
      }
    }
    const registry = loadJson(join(sessionDir, 'artifacts.json'));
    if (registry?.artifacts && typeof registry.artifacts === 'object') {
      for (const [id, raw] of Object.entries(registry.artifacts as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object') continue;
        const artifact = raw as Record<string, unknown>;
        workflow.artifacts.push({
          id,
          kind: typeof artifact.kind === 'string' ? artifact.kind : undefined,
          status: typeof artifact.status === 'string' ? artifact.status : undefined,
          producer_run_id: typeof artifact.producer_run_id === 'string' ? artifact.producer_run_id : undefined,
          relative_path: typeof artifact.relative_path === 'string' ? artifact.relative_path : undefined,
          sessionDir,
        });
      }
    }
  }
  return workflow;
}

function safeReadDir(path: string): string[] {
  try { return existsSync(path) ? readdirSync(path) : []; } catch { return []; }
}

function loadJson(filePath: string): Record<string, unknown> | null {
  try { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
