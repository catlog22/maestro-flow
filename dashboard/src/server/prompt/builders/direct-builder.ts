// ---------------------------------------------------------------------------
// DirectPromptBuilder — assembles natural language prompt from issue fields
// ---------------------------------------------------------------------------
// Extracted from ExecutionScheduler.buildPrompt() 'direct' mode branch.
// ---------------------------------------------------------------------------

import type { PromptBuilder, PromptContext, PromptResult } from '../prompt-builder.js';

export class DirectPromptBuilder implements PromptBuilder {
  readonly name = 'direct';

  async build(context: PromptContext): Promise<PromptResult> {
    const { issue } = context;

    const lines: string[] = [
      `You are a software engineer working on the following ${issue.type} issue.`,
      '',
      `## ${issue.title}`,
      '',
      issue.description,
      '',
      `**Priority**: ${issue.priority} | **Type**: ${issue.type} | **Status**: ${issue.status}`,
    ];

    // Inject analysis context if available (from /issue:analyze)
    if (issue.analysis) {
      lines.push(
        '',
        '## Analysis',
        `**Root Cause**: ${issue.analysis.root_cause}`,
        `**Impact**: ${issue.analysis.impact}`,
        `**Approach**: ${issue.analysis.suggested_approach}`,
      );
      if (issue.analysis.related_files.length > 0) {
        lines.push(`**Key Files**: ${issue.analysis.related_files.join(', ')}`);
      }
    }

    // Inject solution steps if available (from /issue:plan)
    if (issue.solution) {
      lines.push('', '## Solution Plan');

      if (issue.solution.context) {
        lines.push('', '### Context', '', issue.solution.context);
      }

      if (issue.solution.steps.length > 0) {
        lines.push('', '### Steps');
        for (let i = 0; i < issue.solution.steps.length; i++) {
          const step = issue.solution.steps[i];
          lines.push(`${i + 1}. ${step.description}`);
          if (step.target) lines.push(`   - Target: \`${step.target}\``);
          if (step.verification) lines.push(`   - Verify: ${step.verification}`);
        }
      }

      lines.push(
        '',
        '## Instructions',
        '1. Execute each step in order.',
        '2. After each step, verify its criteria before proceeding.',
        '3. If a step fails verification, fix it before moving on.',
        '4. When all steps are complete, provide a summary of changes.',
      );
    } else {
      lines.push(
        '',
        '## Instructions',
        '1. Analyze the issue and identify the files to modify.',
        '2. Implement the fix/feature following existing code patterns.',
        '3. Verify your changes work correctly.',
        '4. Provide a summary of the changes made.',
      );
    }

    return { userPrompt: lines.join('\n'), mode: 'direct' };
  }
}
