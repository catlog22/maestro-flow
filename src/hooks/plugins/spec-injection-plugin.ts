// ---------------------------------------------------------------------------
// SpecInjectionPlugin — Injects project specs into coordinator prompts
// ---------------------------------------------------------------------------

import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';
import { loadSpecs, type SpecCategory } from '../../tools/spec-loader.js';
import { resolveSelf } from '../../tools/team-members.js';
import { evaluateKeywordInjection } from '../keyword-spec-injector.js';

/**
 * In-process plugin for `maestro coordinate` — injects relevant specs
 * into the prompt via the `transformPrompt` waterfall hook.
 *
 * This is the coordinator counterpart to the Claude Code `spec-injector`
 * subprocess hook. Both reuse the same spec-loader infrastructure.
 */
export class SpecInjectionPlugin implements MaestroPlugin {
  readonly name = 'specInjection';

  constructor(
    private readonly projectPath: string = process.cwd(),
    private readonly sessionId: string = '',
  ) {}

  apply(registry: WorkflowHookRegistry): void {
    registry.transformPrompt.tap(this.name, (prompt: string) => {
      const parts: string[] = [prompt];

      // Category-based injection
      const category = inferCategory(prompt);
      const uid = resolveUidSafe();
      const catResult = loadSpecs(this.projectPath, category, uid);
      if (catResult.content) {
        parts.push(catResult.content);
      }

      // Keyword-based injection (with session dedup)
      if (this.sessionId) {
        const kwResult = evaluateKeywordInjection(prompt, this.projectPath, this.sessionId);
        if (kwResult.inject && kwResult.content) {
          parts.push(kwResult.content);
        }
      }

      return parts.length > 1 ? parts.join('\n\n---\n\n') : prompt;
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
 * Infer category from prompt keywords.
 * The coordinator doesn't have agent-type metadata, so we use
 * heuristic keyword matching on the assembled prompt.
 *
 * Principle: category = "who consumes" (agent type), not "what it's about".
 * Multi-word phrases don't need \b; single words use \b to avoid sub-matches.
 */
function inferCategory(prompt: string): SpecCategory {
  const lower = prompt.toLowerCase();
  if (/\b(review|audit|compliance|lint)\b|code review|security audit|quality gate/.test(lower)) return 'review';
  if (/\b(test(?:ing)?|coverage|assert|verify|validate|e2e|regression)\b/.test(lower)) return 'test';
  if (/\b(debug|diagnose|bug|trace|crash|hang|leak)\b|root cause/.test(lower)) return 'debug';
  if (/\b(plan|design|architect|decompose|blueprint)\b|migration strategy/.test(lower)) return 'arch';
  return 'coding'; // Default for implementation work
}
