// ---------------------------------------------------------------------------
// Commander Agent prompts — system prompt, assessment builder, output schema
// ---------------------------------------------------------------------------

import type { OutputFormat } from '@anthropic-ai/claude-agent-sdk';

import type { ProjectState, PhaseCard } from '../../shared/types.js';
import type { Issue } from '../../shared/issue-types.js';
import type { Decision } from '../../shared/commander-types.js';

// ---------------------------------------------------------------------------
// System prompt — defines Commander's role and behavior
// ---------------------------------------------------------------------------

export const COMMANDER_SYSTEM_PROMPT = `You are the Commander Agent for the Maestro workflow orchestration system.

## Role
You are a strategic decision-maker that assesses project state and recommends actions. You NEVER execute changes directly — you only assess and recommend. Worker agents execute your recommendations.

## Your Data Sources
Read these files to understand current state:
- .workflow/state.json — project status, current milestone, phase progress
- .workflow/issues/issues.jsonl — issue queue (one JSON per line)
- .workflow/phases/<slug>/index.json — phase details, tasks, execution state

## Output Format
ALWAYS return a single JSON object (no markdown, no explanation):

{
  "priority_actions": [
    {
      "type": "execute_issue" | "create_issue" | "advance_phase" | "flag_blocker",
      "target": "ISS-xxx" | "phase-slug",
      "reason": "concise rationale",
      "risk": "low" | "medium" | "high",
      "executor": "claude-code" | "gemini" | "codex"
    }
  ],
  "observations": ["what you noticed about project state"],
  "risks": ["potential problems or blockers"]
}

## Decision Rules
1. Prefer issues that already have a .solution planned (solution.steps exists)
2. Urgent/high priority issues take precedence
3. If current phase has incomplete tasks, focus on those before advancing
4. Flag blockers immediately — don't try to resolve them yourself
5. If nothing actionable, return empty priority_actions (it's OK to do nothing)
6. Never recommend more actions than the worker capacity allows
7. Assign executor based on task complexity:
   - Simple file edits, docs -> gemini (fast, cost-effective)
   - Code implementation, debugging -> claude-code (thorough)
   - Code review, analysis -> codex (strong reasoning)

## Risk Assessment Guidelines
- LOW: Read-only operations, documentation, simple config changes
- MEDIUM: Code modifications with existing tests, refactoring
- HIGH: API changes, database migrations, security-sensitive changes, no test coverage
`;

// ---------------------------------------------------------------------------
// Assessment context — input to buildAssessmentPrompt
// ---------------------------------------------------------------------------

export interface AssessmentContext {
  project: ProjectState;
  openIssues: Issue[];
  runningWorkers: number;
  maxWorkers: number;
  recentDecisions: Decision[];
  currentPhase?: PhaseCard;
  workDir: string;
}

// ---------------------------------------------------------------------------
// Assessment prompt builder
// ---------------------------------------------------------------------------

export function buildAssessmentPrompt(context: AssessmentContext): string {
  const phaseStatus = context.currentPhase?.status ?? 'unknown';

  const issueList = context.openIssues.length > 0
    ? context.openIssues.map((i) =>
        `- [${i.id}] ${i.priority.toUpperCase()} ${i.type}: ${i.title}${i.solution ? ' (has solution)' : ''}`,
      ).join('\n')
    : '(none)';

  const decisionList = context.recentDecisions.length > 0
    ? context.recentDecisions.map((d) =>
        `- [${d.timestamp}] ${d.trigger}: ${d.actions.length} actions dispatched`,
      ).join('\n')
    : '(none)';

  const blockerList = context.project.accumulated_context.blockers.length > 0
    ? context.project.accumulated_context.blockers.map((b) => `- ${b}`).join('\n')
    : '(none)';

  return `## Current Project State
Project: ${context.project.project_name}
Status: ${context.project.status}
Milestone: ${context.project.current_milestone}
Phase: ${context.project.current_phase} (${phaseStatus})

## Worker Capacity
Running: ${context.runningWorkers}/${context.maxWorkers}
Available slots: ${context.maxWorkers - context.runningWorkers}

## Open Issues (${context.openIssues.length})
${issueList}

## Recent Decisions (last 5)
${decisionList}

## Blockers
${blockerList}

## Task
Assess the current state and recommend priority actions. Consider:
1. Are there open issues that should be executed now?
2. Is the current phase progressing well or stalled?
3. Are there risks or blockers that need attention?
4. Should any phase transitions be triggered?

Return your assessment as JSON.`;
}

// ---------------------------------------------------------------------------
// Structured output schema — Agent SDK outputFormat
// ---------------------------------------------------------------------------

export const COMMANDER_OUTPUT_SCHEMA: OutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      priority_actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['execute_issue', 'create_issue', 'advance_phase', 'flag_blocker'],
            },
            target: { type: 'string', description: 'ISS-xxx or phase-slug' },
            reason: { type: 'string' },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            executor: { type: 'string', enum: ['claude-code', 'gemini', 'codex'] },
          },
          required: ['type', 'target', 'reason', 'risk', 'executor'],
        },
      },
      observations: {
        type: 'array',
        items: { type: 'string' },
      },
      risks: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['priority_actions', 'observations', 'risks'],
  },
};
