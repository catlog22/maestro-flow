/**
 * Skill Context Hook — UserPromptSubmit
 *
 * When a user invokes a workflow skill (e.g., `/maestro-execute 2`),
 * injects current workflow state, phase artifact tree, and prior
 * phase outcomes into the session context.
 *
 * Uses `additionalContext` (not `updatedInput`) to avoid interfering
 * with skill expansion.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveWorkspace } from './workspace.js';
import { readCoordBridge, buildNextStepHint, type CoordBridgeData } from './coordinator-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillMatch {
  skill: string;
  phaseNum?: number;
  raw: string;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

interface WorkflowState {
  current_milestone?: string;
  current_phase?: number;
  status?: string;
  phases_summary?: { total: number; completed: number; in_progress: number; pending: number };
  accumulated_context?: {
    key_decisions?: string[];
    deferred?: Array<{ id?: string; severity?: string; description?: string; fix_direction?: string } | string>;
  };
  transition_history?: Array<{ type: string; from_phase: number | null; to_phase: number | null; milestone: string; transitioned_at: string }>;
  [key: string]: unknown;
}

interface PhaseIndex {
  phase?: number;
  title?: string;
  slug?: string;
  status?: string;
  verification?: { status?: string; gaps?: Array<{ description?: string; severity?: string }> };
  learnings?: { patterns?: Array<{ content?: string }>; pitfalls?: Array<{ content?: string }> };
  execution?: { tasks_total?: number; tasks_completed?: number };
  [key: string]: unknown;
}

export interface SkillContextInput {
  user_prompt?: string;
  cwd?: string;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Skill invocation patterns
// ---------------------------------------------------------------------------

const SKILL_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\/maestro-execute\s+(\d+)/, skill: 'maestro-execute' },
  { pattern: /\/maestro-plan\s+(\d+)/, skill: 'maestro-plan' },
  { pattern: /\/maestro-verify\s+(\d+)/, skill: 'maestro-verify' },
  { pattern: /\/maestro-analyze\s+(\d+)/, skill: 'maestro-analyze' },
  { pattern: /\/maestro-phase-transition(?:\s+(\d+))?/, skill: 'maestro-phase-transition' },
  { pattern: /\/quality-review\s+(\d+)/, skill: 'quality-review' },
  { pattern: /\/quality-test\s+(\d+)/, skill: 'quality-test' },
  { pattern: /\/maestro(?:\s|$)/, skill: 'maestro' },
  { pattern: /\/maestro-coordinate(?:\s|$)/, skill: 'maestro-coordinate' },
  { pattern: /\/maestro-link-coordinate(?:\s|$)/, skill: 'maestro-link-coordinate' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a user prompt for workflow skill invocation.
 * Returns null if no skill pattern is matched.
 */
export function parseSkillInvocation(prompt: string): SkillMatch | null {
  for (const { pattern, skill } of SKILL_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      const phaseNum = match[1] ? parseInt(match[1], 10) : undefined;
      return { skill, phaseNum, raw: match[0] };
    }
  }
  return null;
}

/**
 * Evaluate skill context and return workflow state + artifact tree.
 * Returns null if no skill invocation detected or no workflow exists.
 */
export function evaluateSkillContext(data: SkillContextInput): HookOutput | null {
  const prompt = data.user_prompt ?? '';
  if (!prompt) return null;

  const skill = parseSkillInvocation(prompt);
  if (!skill) return null;

  const cwd = resolveWorkspace(data);
  if (!cwd) return null;
  const statePath = join(cwd, '.workflow', 'state.json');
  if (!existsSync(statePath)) return null;

  let state: WorkflowState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }

  const sections: string[] = [];

  // Section 0: Coordinator session context (for /maestro, /maestro-coordinate, /maestro-link-coordinate)
  const COORDINATOR_SKILLS = ['maestro', 'maestro-coordinate', 'maestro-link-coordinate'];
  if (COORDINATOR_SKILLS.includes(skill.skill) && data.session_id) {
    const coordBridge = readCoordBridge(data.session_id);
    if (coordBridge) {
      const hint = buildNextStepHint(coordBridge);
      if (hint) sections.push(hint);
    }
  }

  // Section 1: Workflow state summary
  const stateSection = buildStateSection(state, skill);
  if (stateSection) sections.push(stateSection);

  // Section 2: Phase artifact tree
  const phaseNum = skill.phaseNum ?? state.current_phase;
  if (phaseNum) {
    const treeSection = buildArtifactTree(cwd, phaseNum);
    if (treeSection) sections.push(treeSection);
  }

  // Section 3: Prior phase outcomes
  const outcomesSection = buildOutcomesSection(cwd, state, phaseNum);
  if (outcomesSection) sections.push(outcomesSection);

  if (sections.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: sections.join('\n\n'),
    },
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildStateSection(state: WorkflowState, skill: SkillMatch): string | null {
  const parts: string[] = [`## Workflow Context for ${skill.skill}`];

  if (state.current_milestone) parts.push(`Milestone: ${state.current_milestone}`);
  if (state.current_phase !== undefined) {
    const summary = state.phases_summary;
    const progress = summary ? `${summary.completed}/${summary.total} completed` : '';
    parts.push(`Phase: ${state.current_phase} ${progress ? `(${progress})` : ''}`);
  }
  if (state.status) parts.push(`Status: ${state.status}`);

  const decisions = state.accumulated_context?.key_decisions;
  if (decisions && decisions.length > 0) {
    parts.push(`Key decisions: ${decisions.length}`);
  }

  const deferred = state.accumulated_context?.deferred;
  if (deferred && deferred.length > 0) {
    parts.push(`Deferred items: ${deferred.length}`);
  }

  const history = state.transition_history;
  if (history && history.length > 0) {
    const last = history[history.length - 1];
    parts.push(`Last transition: ${last.type} ${last.milestone} (${last.transitioned_at})`);
  }

  return parts.length > 1 ? parts.join(' | ') : null;
}

function buildArtifactTree(cwd: string, phaseNum: number): string | null {
  const phasesDir = join(cwd, '.workflow', 'phases');
  if (!existsSync(phasesDir)) return null;

  // Find phase directory by number prefix
  let phaseDir: string | null = null;
  let phaseDirName = '';
  try {
    const dirs = readdirSync(phasesDir);
    const prefix = String(phaseNum).padStart(2, '0');
    for (const d of dirs) {
      if (d.startsWith(`${prefix}-`)) {
        phaseDir = join(phasesDir, d);
        phaseDirName = d;
        break;
      }
    }
  } catch {
    return null;
  }

  if (!phaseDir || !existsSync(phaseDir)) return null;

  const lines: string[] = [`## Phase ${phaseNum} Artifacts (.workflow/phases/${phaseDirName}/)`];

  // List top-level files
  try {
    const entries = readdirSync(phaseDir);
    const files = entries.filter(e => !e.startsWith('.') && e !== '.task' && e !== '.summaries' && e !== '.process');
    if (files.length > 0) {
      lines.push(files.join(' | '));
    }

    // List .task/ directory with status annotations
    const taskDir = join(phaseDir, '.task');
    if (existsSync(taskDir)) {
      const taskSection = buildTaskListing(taskDir);
      if (taskSection) lines.push(taskSection);
    }

    // List .summaries/ if it exists
    const summariesDir = join(phaseDir, '.summaries');
    if (existsSync(summariesDir)) {
      const summaryFiles = readdirSync(summariesDir).filter(f => f.endsWith('.md'));
      if (summaryFiles.length > 0) {
        lines.push(`.summaries/ (${summaryFiles.length} files)`);
      }
    }
  } catch {
    return null;
  }

  return lines.join('\n');
}

function buildTaskListing(taskDir: string): string | null {
  try {
    const taskFiles = readdirSync(taskDir)
      .filter(f => f.startsWith('TASK-') && f.endsWith('.json'))
      .slice(0, 20); // Cap at 20

    if (taskFiles.length === 0) return null;

    let completed = 0;
    let pending = 0;
    let inProgress = 0;
    const taskStatuses: string[] = [];

    for (const f of taskFiles) {
      const taskId = f.replace('.json', '');
      try {
        // Read only enough to get status
        const content = readFileSync(join(taskDir, f), 'utf8');
        const task = JSON.parse(content);
        const status = task.status ?? 'pending';

        if (status === 'completed') { completed++; taskStatuses.push(`${taskId} ✓`); }
        else if (status === 'in_progress') { inProgress++; taskStatuses.push(`${taskId} →`); }
        else { pending++; taskStatuses.push(`${taskId} …`); }
      } catch {
        pending++;
        taskStatuses.push(`${taskId} ?`);
      }
    }

    const summary = `.task/ (${taskFiles.length} tasks: ${completed} completed${inProgress ? `, ${inProgress} in_progress` : ''}${pending ? `, ${pending} pending` : ''})`;
    return `${summary}\n  ${taskStatuses.join(' | ')}`;
  } catch {
    return null;
  }
}

function buildOutcomesSection(cwd: string, state: WorkflowState, targetPhase?: number): string | null {
  const parts: string[] = [];

  // Deferred items (high severity, top 5)
  const deferred = state.accumulated_context?.deferred;
  if (deferred && deferred.length > 0) {
    const highItems = deferred
      .filter(d => typeof d === 'object' && (d.severity === 'high' || d.severity === 'critical'))
      .slice(0, 5);

    if (highItems.length > 0) {
      const lines = highItems.map(d => {
        if (typeof d === 'object') {
          return `- [${d.severity}] ${d.description}${d.fix_direction ? ` → ${d.fix_direction}` : ''}`;
        }
        return `- ${d}`;
      });
      parts.push(`## Deferred Items (${deferred.length} total, showing high/critical)\n${lines.join('\n')}`);
    }
  }

  // Prior completed phase learnings + verification gaps
  if (targetPhase && targetPhase > 1) {
    const priorIndex = loadPhaseIndex(cwd, targetPhase - 1);
    if (priorIndex) {
      // Verification gaps
      const gaps = priorIndex.verification?.gaps;
      if (gaps && gaps.length > 0) {
        const gapLines = gaps.slice(0, 3).map(g => `- ${g.description ?? 'Unknown gap'}`);
        parts.push(`## Verification Gaps (Phase ${targetPhase - 1})\n${gapLines.join('\n')}`);
      }

      // Learnings
      const learnings = priorIndex.learnings;
      if (learnings) {
        const items: string[] = [];
        if (learnings.patterns) {
          items.push(...learnings.patterns.slice(0, 3).map(p => `- [pattern] ${p.content ?? p}`));
        }
        if (learnings.pitfalls) {
          items.push(...learnings.pitfalls.slice(0, 2).map(p => `- [pitfall] ${p.content ?? p}`));
        }
        if (items.length > 0) {
          parts.push(`## Prior Phase Learnings (Phase ${targetPhase - 1})\n${items.join('\n')}`);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPhaseIndex(cwd: string, phaseNum: number): PhaseIndex | null {
  const phasesDir = join(cwd, '.workflow', 'phases');
  if (!existsSync(phasesDir)) return null;

  try {
    const dirs = readdirSync(phasesDir);
    const prefix = String(phaseNum).padStart(2, '0');
    for (const d of dirs) {
      if (d.startsWith(`${prefix}-`)) {
        const indexPath = join(phasesDir, d, 'index.json');
        if (existsSync(indexPath)) {
          return JSON.parse(readFileSync(indexPath, 'utf8'));
        }
      }
    }
  } catch {
    // Silently fail
  }
  return null;
}
