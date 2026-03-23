// ---------------------------------------------------------------------------
// TemplatePromptBuilder — applies mustache-style variable substitution
// ---------------------------------------------------------------------------
// Extracted from ExecutionScheduler.applyTemplate().
// ---------------------------------------------------------------------------

import type { PromptBuilder, PromptContext, PromptResult } from '../prompt-builder.js';

export class TemplatePromptBuilder implements PromptBuilder {
  readonly name = 'template';

  async build(context: PromptContext): Promise<PromptResult> {
    const { issue, customTemplate } = context;

    if (!customTemplate) {
      throw new Error('TemplatePromptBuilder requires customTemplate in context');
    }

    const userPrompt = customTemplate
      .replace(/\{\{\s*issue\.id\s*\}\}/g, issue.id)
      .replace(/\{\{\s*issue\.title\s*\}\}/g, issue.title)
      .replace(/\{\{\s*issue\.description\s*\}\}/g, issue.description)
      .replace(/\{\{\s*issue\.type\s*\}\}/g, issue.type)
      .replace(/\{\{\s*issue\.priority\s*\}\}/g, issue.priority)
      .replace(/\{\{\s*issue\.status\s*\}\}/g, issue.status)
      .replace(/\{\{\s*issue\.root_cause\s*\}\}/g, issue.analysis?.root_cause ?? '')
      .replace(/\{\{\s*issue\.suggested_approach\s*\}\}/g, issue.analysis?.suggested_approach ?? '')
      .replace(/\{\{\s*issue\.solution_context\s*\}\}/g, issue.solution?.context ?? '');

    return { userPrompt, mode: 'template' };
  }
}
