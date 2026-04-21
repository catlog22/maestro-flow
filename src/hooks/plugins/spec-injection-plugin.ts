// ---------------------------------------------------------------------------
// SpecInjectionPlugin — Injects project specs into coordinator prompts
// ---------------------------------------------------------------------------

import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';
import { loadSpecs, type SpecCategory } from '../../tools/spec-loader.js';
import { resolveSelf } from '../../tools/team-members.js';

/**
 * In-process plugin for `maestro coordinate` — injects relevant specs
 * into the prompt via the `transformPrompt` waterfall hook.
 *
 * This is the coordinator counterpart to the Claude Code `spec-injector`
 * subprocess hook. Both reuse the same spec-loader infrastructure.
 */
export class SpecInjectionPlugin implements MaestroPlugin {
  readonly name = 'specInjection';

  constructor(private readonly projectPath: string = process.cwd()) {}

  apply(registry: WorkflowHookRegistry): void {
    registry.transformPrompt.tap(this.name, (prompt: string) => {
      // Infer category from prompt content heuristics
      const category = inferCategory(prompt);

      // Best-effort uid resolution for personal spec layer
      const uid = resolveUidSafe();
      const result = loadSpecs(this.projectPath, category, uid);

      if (!result.content) return prompt;

      return `${prompt}\n\n---\n\n${result.content}`;
    });
  }
}

/**
 * Best-effort uid resolution — returns undefined on any failure so spec
 * injection never throws due to team-mode issues.
 */
function resolveUidSafe(): string | undefined {
  try {
    const self = resolveSelf();
    return self?.uid ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Infer spec category from prompt keywords.
 * The coordinator doesn't have agent-type metadata, so we use
 * heuristic keyword matching on the assembled prompt.
 */
function inferCategory(prompt: string): SpecCategory {
  const lower = prompt.toLowerCase();
  if (/\b(review|audit|check quality)\b/.test(lower)) return 'review';
  if (/\b(test|spec|coverage|assert)\b/.test(lower)) return 'test';
  if (/\b(debug|diagnose|fix|error|bug)\b/.test(lower)) return 'debug';
  if (/\b(plan|design|architect|decompose|explore|discover|search|analyze)\b/.test(lower)) return 'arch';
  return 'coding'; // Default for implementation work
}
