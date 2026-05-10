// ---------------------------------------------------------------------------
// SpecInjectionPlugin — Injects project specs into coordinator prompts
// ---------------------------------------------------------------------------

import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';
import { loadSpecs } from '../../tools/spec-loader.js';
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

      // Role-based injection
      const role = inferRole(prompt);
      const uid = resolveUidSafe();
      const roleResult = loadSpecs(this.projectPath, undefined, uid, undefined, undefined, { role });
      if (roleResult.content) {
        parts.push(roleResult.content);
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
 * Infer role from prompt keywords.
 * The coordinator doesn't have agent-type metadata, so we use
 * heuristic keyword matching on the assembled prompt.
 */
function inferRole(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/\b(review|audit|check quality)\b/.test(lower)) return 'review';
  if (/\b(test|spec|coverage|assert)\b/.test(lower)) return 'test';
  if (/\b(debug|diagnose|error|bug)\b/.test(lower)) return 'analyze';
  if (/\b(plan|design|architect|decompose|explore|discover|search|analyze)\b/.test(lower)) return 'plan';
  return 'implement'; // Default for implementation work
}
