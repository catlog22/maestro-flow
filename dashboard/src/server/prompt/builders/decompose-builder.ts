// ---------------------------------------------------------------------------
// DecomposePromptBuilder — builds prompt for LLM-driven issue decomposition
// ---------------------------------------------------------------------------
// Extracted from wave-executor.ts buildDecomposePrompt().
// ---------------------------------------------------------------------------

import type { PromptBuilder, PromptContext, PromptResult } from '../prompt-builder.js';

export class DecomposePromptBuilder implements PromptBuilder {
  readonly name = 'decompose';

  async build(context: PromptContext): Promise<PromptResult> {
    const { issue } = context;

    const lines = [
      `Decompose the following issue into independent, atomic subtasks suitable for parallel execution.`,
      `Each subtask should be small enough for a single focused agent to complete.`,
      '',
      `## Issue`,
      `**ID**: ${issue.id}`,
      `**Title**: ${issue.title}`,
      `**Type**: ${issue.type}`,
      `**Priority**: ${issue.priority}`,
      '',
      `**Description**:`,
      issue.description,
    ];

    if (issue.solution) {
      lines.push('', `## Existing Solution Plan`);
      if (issue.solution.context) {
        lines.push('', issue.solution.context);
      }
      if (issue.solution.steps.length > 0) {
        lines.push('');
        for (let i = 0; i < issue.solution.steps.length; i++) {
          const step = issue.solution.steps[i];
          lines.push(`${i + 1}. ${step.description}`);
          if (step.target) lines.push(`   Target: ${step.target}`);
          if (step.verification) lines.push(`   Verify: ${step.verification}`);
        }
      }
    }

    lines.push(
      '',
      '## Rules',
      '- Decompose into 2-6 subtasks. Prefer fewer, substantial tasks over many tiny ones.',
      '- Each task must be self-contained: a single agent can complete it without knowledge of other tasks.',
      '- Group related file changes into one task (e.g., all changes for one feature = one task).',
      '- Use `deps` to specify tasks that must complete first (by task id). Only use when Task B truly needs Task A\'s output.',
      '- Use `contextFrom` to specify completed tasks whose output provides useful context.',
      '- Tasks with no dependencies will run in parallel (same wave).',
      '',
      '## Output Format',
      'Respond with ONLY a valid JSON object. No markdown fences, no explanation:',
      '',
      '```',
      '{',
      '  "tasks": [',
      '    {',
      '      "id": "T1",',
      '      "title": "Short descriptive title",',
      '      "description": "Detailed description of what to implement and how to verify",',
      '      "deps": [],',
      '      "contextFrom": []',
      '    }',
      '  ]',
      '}',
      '```',
    );

    return { userPrompt: lines.join('\n'), mode: 'decompose' };
  }
}
