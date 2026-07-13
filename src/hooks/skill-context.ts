/**
 * Skill Context Hook — UserPromptSubmit
 *
 * When a user invokes a workflow skill (e.g., `/maestro-execute 2`),
 * injects the current canonical Session and sealed Run artifacts.
 *
 * Uses `additionalContext` (not `updatedInput`) to avoid interfering
 * with skill expansion.
 *
 * Formal artifacts are read only from each canonical Session `artifacts.json`.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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
  version?: string;
  current_milestone?: string;
  current_phase?: number;                // v1 compat — v2 derives from artifacts
  current_task_id?: string | null;
  status?: string;
  phases_summary?: { total: number; completed: number; in_progress: number; pending: number }; // v1 compat
  milestones?: Array<{ id?: string; name: string; phases?: number[]; status?: string }>;
  accumulated_context?: {
    key_decisions?: string[];
    deferred?: Array<{ id?: string; severity?: string; description?: string; fix_direction?: string } | string>;
  };
  transition_history?: Array<{ type: string; from_phase: number | null; to_phase: number | null; milestone: string; transitioned_at: string; trigger?: string; force?: boolean; snapshot?: { phases_completed: number; phases_total: number; deferred_count: number; verification_status: string; learnings_count: number } }>;
  artifacts?: ArtifactEntry[];
  active_session_id?: string | null;
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

interface ArtifactEntry {
  id: string;
  type: string;
  milestone?: string | null;
  phase?: number | null;
  scope?: string;
  path?: string;
  status: string;
  depends_on?: string | string[] | null;
  harvested?: boolean;
  error_context?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

export interface SkillContextInput {
  user_prompt?: string;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
}

// ---------------------------------------------------------------------------
// Skill invocation patterns
// ---------------------------------------------------------------------------

const SKILL_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\/maestro-execute\s+(\d+)/, skill: 'maestro-execute' },
  { pattern: /\/maestro-plan\s+(\d+)/, skill: 'maestro-plan' },
  { pattern: /\/maestro-analyze\s+(\d+)/, skill: 'maestro-analyze' },
  { pattern: /\/maestro-milestone-audit(?:\s+(\d+))?/, skill: 'maestro-milestone-audit' },
  { pattern: /\/quality-review\s+(\d+)/, skill: 'quality-review' },
  { pattern: /\/quality-test\s+(\d+)/, skill: 'quality-test' },
  { pattern: /\/maestro(?:\s|$)/, skill: 'maestro' },
  { pattern: /\/maestro-ralph(?:\s|$)/, skill: 'maestro-ralph' },
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
 * Parse any /command-name invocation from user prompt (generalized).
 * Used for skill config parameter injection — works with all commands,
 * not just workflow-specific ones.
 */
export function parseAnySkillInvocation(prompt: string): string | null {
  const match = prompt.match(/\/([a-z][\w-]*)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Skill config parameter injection
// ---------------------------------------------------------------------------

interface SkillConfigData {
  version: string;
  skills: Record<string, { params: Record<string, string | boolean | number>; updated?: string }>;
}

/**
 * Load skill-config.json with workspace override (inline to keep hooks self-contained).
 */
function loadSkillConfigInline(workDir: string | null): SkillConfigData | null {
  const globalPath = join(homedir(), '.maestro', 'skill-config.json');

  let global: SkillConfigData | null = null;
  try {
    if (existsSync(globalPath)) {
      global = JSON.parse(readFileSync(globalPath, 'utf8'));
    }
  } catch { /* */ }

  let workspace: SkillConfigData | null = null;
  if (workDir) {
    const wsPath = join(workDir, '.maestro', 'skill-config.json');
    try {
      if (existsSync(wsPath)) {
        workspace = JSON.parse(readFileSync(wsPath, 'utf8'));
      }
    } catch { /* */ }
  }

  if (!global && !workspace) return null;
  if (!workspace) return global;
  if (!global) return workspace;

  // Merge: workspace params override global params per-skill
  const merged: SkillConfigData = {
    version: workspace.version ?? global.version,
    skills: { ...global.skills },
  };
  for (const [skill, defaults] of Object.entries(workspace.skills)) {
    const existing = merged.skills[skill];
    merged.skills[skill] = existing
      ? { params: { ...existing.params, ...defaults.params }, updated: defaults.updated ?? existing.updated }
      : defaults;
  }
  return merged;
}

/**
 * Build additionalContext section for skill config parameter injection.
 * Only includes params the user hasn't explicitly specified in their prompt.
 */
function buildParamInjectionSection(
  skillName: string,
  userPrompt: string,
  workDir: string | null,
): string | null {
  const config = loadSkillConfigInline(workDir);
  if (!config) return null;

  const defaults = config.skills[skillName];
  if (!defaults || Object.keys(defaults.params).length === 0) return null;

  const lines: string[] = [];
  for (const [param, value] of Object.entries(defaults.params)) {
    // Check if user already specified this param in the prompt
    if (userPrompt.includes(param)) {
      continue; // User explicitly set — skip injection
    }
    lines.push(`${param}: ${value}`);
  }

  if (lines.length === 0) return null;

  return [
    `## Skill Config Defaults (${skillName})`,
    'The following parameter defaults are configured. Apply these unless the user explicitly specified otherwise:',
    ...lines,
  ].join('\n');
}

/**
 * Evaluate skill context and return workflow state + artifact tree + param defaults.
 * Returns null if no skill invocation detected.
 *
 * Two independent concern layers:
 * 1. Workflow context (state, artifacts, outcomes) — requires workflow state.json
 * 2. Skill config param injection — works for ANY /command, no workflow required
 */
export function evaluateSkillContext(data: SkillContextInput): HookOutput | null {
  const prompt = data.user_prompt ?? '';
  if (!prompt) return null;

  const sections: string[] = [];
  const cwd = resolveWorkspace(data);

  // --- Layer 1: Canonical Session/Run context ---
  const skill = parseSkillInvocation(prompt);
  if (skill && cwd) {
    const statePath = join(cwd, '.workflow', 'state.json');
    if (existsSync(statePath)) {
      try {
        const state: WorkflowState = JSON.parse(readFileSync(statePath, 'utf8'));

        // Section 0: Coordinator session context
        const COORDINATOR_SKILLS = ['maestro', 'maestro-ralph', 'maestro-link-coordinate'];
        if (COORDINATOR_SKILLS.includes(skill.skill) && data.session_id) {
          const coordBridge = readCoordBridge(data.session_id);
          if (coordBridge) {
            const hint = buildNextStepHint(coordBridge);
            if (hint) sections.push(hint);
          }
        }

        const sessionSection = buildCanonicalSessionSection(cwd, state, skill);
        if (sessionSection) sections.push(sessionSection);
      } catch {
        // state.json unreadable — skip workflow context
      }
    }
  }

  // --- Layer 2: Skill config parameter injection (works for all commands) ---
  const anySkill = skill?.skill ?? parseAnySkillInvocation(prompt);
  if (anySkill) {
    const paramSection = buildParamInjectionSection(anySkill, prompt, cwd ?? data.cwd ?? null);
    if (paramSection) sections.push(paramSection);
  }

  if (sections.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: data.hook_event_name || 'UserPromptSubmit',
      additionalContext: sections.join('\n\n'),
    },
  };
}
function buildCanonicalSessionSection(cwd: string, state: WorkflowState, skill: SkillMatch): string | null {
  const sessionId = state.active_session_id;
  if (!sessionId) return null;
  const sessionDir = join(cwd, '.workflow', 'sessions', sessionId);
  try {
    const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8')) as {
      intent?: string; status?: string; active_run_id?: string | null; latest_completed_run_id?: string | null;
    };
    const registry = JSON.parse(readFileSync(join(sessionDir, 'artifacts.json'), 'utf8')) as {
      artifacts?: Record<string, { kind?: string; role?: string; status?: string; relative_path?: string }>;
      aliases?: Record<string, string>;
    };
    const lines = [
      `## Session Context for ${skill.skill}`,
      `Session: ${sessionId} | ${session.status ?? 'unknown'} | ${session.intent ?? ''}`,
      `Run: ${session.active_run_id ?? session.latest_completed_run_id ?? '-'}`,
    ];
    const aliases = Object.entries(registry.aliases ?? {});
    if (aliases.length > 0) {
      lines.push('Artifacts:');
      for (const [alias, id] of aliases.slice(0, 12)) {
        const artifact = registry.artifacts?.[id];
        if (!artifact) continue;
        lines.push(`- ${alias} → ${id} | ${artifact.kind ?? 'artifact'} | ${artifact.status ?? 'unknown'} | ${artifact.relative_path ?? ''}`);
      }
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}
