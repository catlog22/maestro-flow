// Graph Coordinator — Prompt Assembler
// 6-phase pipeline: resolve args → build command → inject context →
// inject state → apply template → auto directive.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AssembleRequest,
  CommandNode,
  ProjectSnapshot,
  PromptAssembler,
  WalkerContext,
} from './graph-types.js';

// Built-in default template (used when file template not found)
const DEFAULT_TEMPLATE = `# Coordinate Step {{STEP_N}} — {{GRAPH_NAME}}

## Command
{{COMMAND}}

{{#AUTO_DIRECTIVE}}
**Mode:** {{AUTO_DIRECTIVE}}
{{/AUTO_DIRECTIVE}}

{{#PREVIOUS_CONTEXT}}
## Context from Previous Step
{{PREVIOUS_CONTEXT}}
{{/PREVIOUS_CONTEXT}}

{{#STATE_SNAPSHOT}}
## Current State
{{STATE_SNAPSHOT}}
{{/STATE_SNAPSHOT}}

{{#INTENT}}
## Original Intent
{{INTENT}}
{{/INTENT}}

## Return Format

Output MUST end with this exact block:

\`\`\`
--- COORDINATE RESULT ---
STATUS: <SUCCESS or FAILURE>
PHASE: <number, or "none">
VERIFICATION_STATUS: <passed or failed or pending, if applicable>
REVIEW_VERDICT: <PASS or WARN or BLOCK, if applicable>
UAT_STATUS: <passed or failed or pending, if applicable>
ARTIFACTS: <comma-separated file paths, or "none">
SUMMARY: <one-line what was accomplished>
\`\`\`
`;

export class DefaultPromptAssembler implements PromptAssembler {
  constructor(
    private readonly workflowRoot: string,
    private readonly templateDir: string,
  ) {}

  async assemble(req: AssembleRequest): Promise<string> {
    const { node, context: ctx, graph, auto_mode } = req;
    const resolvedArgs = this.resolveArgs(node.args ?? '', ctx);
    const command = this.buildCommand(node, resolvedArgs, auto_mode);
    const previousContext = this.buildPreviousContext(req);
    const stateSnapshot = this.buildStateSnapshot(ctx.project);
    const autoDirective = auto_mode
      ? 'Auto-confirm all prompts. No interactive questions. Skip clarifications.'
      : '';
    const vars: Record<string, string> = {
      COMMAND: command,
      STEP_N: `${req.command_index}/${req.command_total}`,
      GRAPH_NAME: graph.name,
      GRAPH_ID: graph.id,
      NODE_ID: req.node_id,
      PREVIOUS_CONTEXT: previousContext,
      STATE_SNAPSHOT: stateSnapshot,
      AUTO_DIRECTIVE: autoDirective,
      INTENT: (ctx.inputs['intent'] as string) ?? '',
    };
    const template = await this.loadTemplate();
    return this.renderTemplate(template, vars);
  }

  // -- Phase 1: Resolve Args --

  resolveArgs(args: string, ctx: WalkerContext): string {
    return args.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = this.resolveKey(key.trim(), ctx);
      return value !== undefined ? String(value) : `{${key}}`;
    });
  }

  private resolveKey(key: string, ctx: WalkerContext): unknown {
    // {var.xxx} or {var.xxx.yyy} — dig into ctx.var
    if (key.startsWith('var.')) {
      return dig(ctx.var, key.slice(4).split('.'));
    }
    // {word} — try ctx.inputs first, then ctx.var
    if (!key.includes('.')) {
      if (key in ctx.inputs) return ctx.inputs[key];
      if (key in ctx.var) return ctx.var[key];
      return undefined;
    }
    // {word.path} — try inputs[word] then var[word]
    const [first, ...rest] = key.split('.');
    if (first in ctx.inputs) {
      const root = ctx.inputs[first];
      return rest.length > 0 ? dig(root, rest) : root;
    }
    if (first in ctx.var) {
      const root = ctx.var[first];
      return rest.length > 0 ? dig(root, rest) : root;
    }
    return undefined;
  }

  // -- Phase 2: Build Command Block --

  buildCommand(node: CommandNode, resolvedArgs: string, autoMode: boolean): string {
    const parts = [`/${node.cmd}`];
    if (resolvedArgs) parts.push(resolvedArgs);
    if (autoMode && node.auto_flag) parts.push(node.auto_flag);
    return parts.join(' ').trim();
  }

  // -- Phase 3: Inject Previous Context --

  buildPreviousContext(req: AssembleRequest): string {
    const sections: string[] = [];
    const ctx = req.context;

    // 3a: Previous command
    if (req.previous_command) {
      const pc = req.previous_command;
      let section = `### Previous Step: ${pc.cmd} (${pc.outcome})`;
      if (pc.summary) section += `\n${pc.summary}`;
      sections.push(section);
    }

    // 3b: Previous result
    if (ctx.result) {
      const lines = ['### Previous Result'];
      const r = ctx.result;
      if (r['status']) lines.push(`- **Status:** ${r['status']}`);
      if (r['phase']) lines.push(`- **Phase:** ${r['phase']}`);
      if (r['artifacts']) lines.push(`- **Artifacts:** ${r['artifacts']}`);
      if (r['summary']) lines.push(`- **Summary:** ${r['summary']}`);
      sections.push(lines.join('\n'));
    }

    // 3c: Analysis hints
    if (ctx.analysis) {
      const a = ctx.analysis;
      const hints = a['next_step_hints'] as Record<string, unknown> | undefined;
      const lines = ['### Analysis Hints'];

      if (hints) {
        if (hints['prompt_additions']) {
          lines.push(String(hints['prompt_additions']));
        }
        if (Array.isArray(hints['cautions']) && hints['cautions'].length > 0) {
          lines.push(`**Cautions:** ${(hints['cautions'] as string[]).join('; ')}`);
        }
        if (hints['context_to_carry']) {
          lines.push(String(hints['context_to_carry']));
        }
      }

      const score = a['quality_score'];
      if (score !== undefined && score !== null) {
        lines.push(`Previous step quality: ${score}/100`);
      }

      if (lines.length > 1) sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  // -- Phase 4: Inject State Snapshot --

  buildStateSnapshot(project: ProjectSnapshot): string {
    if (!project.initialized) return 'Project not initialized.';

    const lines: string[] = [];
    lines.push(`Phase ${project.current_phase} | Status: ${project.phase_status}`);
    lines.push(`Progress: ${project.phases_completed}/${project.phases_total} phases`);

    if (project.execution.tasks_total > 0) {
      lines.push(`Tasks: ${project.execution.tasks_completed}/${project.execution.tasks_total}`);
    }
    if (project.verification_status !== 'pending') {
      lines.push(`Verification: ${project.verification_status}`);
    }
    if (project.review_verdict !== null) {
      lines.push(`Review: ${project.review_verdict}`);
    }
    if (project.uat_status !== 'pending') {
      lines.push(`UAT: ${project.uat_status}`);
    }

    const artifactList = Object.entries(project.artifacts)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (artifactList.length > 0) {
      lines.push(`Artifacts: ${artifactList.join(', ')}`);
    }

    return lines.join('\n');
  }

  // -- Phase 5: Apply Template --

  private async loadTemplate(): Promise<string> {
    const templatePath = join(this.templateDir, 'coordinate-step-v2.md');
    try {
      return await readFile(templatePath, 'utf-8');
    } catch {
      return DEFAULT_TEMPLATE;
    }
  }

  renderTemplate(template: string, vars: Record<string, string>): string {
    // Conditional blocks: {{#FIELD}}...content...{{/FIELD}}
    let result = template.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, field: string, content: string) => {
        return vars[field] ? content : '';
      },
    );

    // Simple variable replacement: {{VAR}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return vars[key] ?? '';
    });

    // Clean up excess blank lines (more than 2 consecutive)
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim() + '\n';
  }
}

function dig(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
