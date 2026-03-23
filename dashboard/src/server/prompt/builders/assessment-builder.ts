// ---------------------------------------------------------------------------
// AssessmentPromptBuilder — builds prompt for Commander's LLM assessment
// ---------------------------------------------------------------------------
// Extracted from commander-prompts.ts buildAssessmentPrompt().
// The original function takes AssessmentContext directly, so this builder
// expects the AssessmentContext fields in PromptContext.extra.
// ---------------------------------------------------------------------------

import type { PromptBuilder, PromptContext, PromptResult } from '../prompt-builder.js';
import type { AssessmentContext } from '../../commander/commander-prompts.js';

export class AssessmentPromptBuilder implements PromptBuilder {
  readonly name = 'assessment';

  async build(context: PromptContext): Promise<PromptResult> {
    const assessmentCtx = context.extra?.assessmentContext as AssessmentContext | undefined;
    if (!assessmentCtx) {
      throw new Error('AssessmentPromptBuilder requires extra.assessmentContext');
    }

    const phaseStatus = assessmentCtx.currentPhase?.status ?? 'unknown';

    const issueList = assessmentCtx.openIssues.length > 0
      ? assessmentCtx.openIssues.map((i) => {
          const state = i.solution ? '[READY]' : i.analysis ? '[ANALYZED]' : '[NEW]';
          return `- [${i.id}] ${state} ${i.priority.toUpperCase()} ${i.type}: ${i.title}${i.solution ? ' (has solution)' : ''}`;
        }).join('\n')
      : '(none)';

    const decisionList = assessmentCtx.recentDecisions.length > 0
      ? assessmentCtx.recentDecisions.map((d) =>
          `- [${d.timestamp}] ${d.trigger}: ${d.actions.length} actions dispatched`,
        ).join('\n')
      : '(none)';

    const blockerList = assessmentCtx.project.accumulated_context.blockers.length > 0
      ? assessmentCtx.project.accumulated_context.blockers.map((b) => `- ${b}`).join('\n')
      : '(none)';

    const userPrompt = `## Current Project State
Project: ${assessmentCtx.project.project_name}
Status: ${assessmentCtx.project.status}
Milestone: ${assessmentCtx.project.current_milestone}
Phase: ${assessmentCtx.project.current_phase} (${phaseStatus})

## Worker Capacity
Running: ${assessmentCtx.runningWorkers}/${assessmentCtx.maxWorkers}
Available slots: ${assessmentCtx.maxWorkers - assessmentCtx.runningWorkers}

## Open Issues (${assessmentCtx.openIssues.length})
${issueList}

## Recent Decisions (last 5)
${decisionList}

## Blockers
${blockerList}

## Task
Assess the current state and recommend priority actions.

Consider:
1. Which open issues should be executed now? Prioritize issues with solutions ([READY]) over unplanned ones.
2. Is the current phase progressing well or stalled? Look at worker utilization and recent decisions.
3. Are there risks or blockers that need immediate attention?
4. Should any phase transitions be triggered based on completion state?

Respond with ONLY a valid JSON object:
{
  "assessment": "brief overall assessment",
  "health": "healthy | degraded | stalled",
  "actions": [
    {
      "type": "dispatch | pause | escalate | transition",
      "issueId": "issue id if applicable",
      "reason": "why this action"
    }
  ],
  "risks": ["risk descriptions if any"]
}`;

    return { userPrompt, mode: 'assessment' };
  }
}
