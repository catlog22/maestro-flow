// ---------------------------------------------------------------------------
// SpecInjectionPlugin — Injects project specs into coordinator prompts
// ---------------------------------------------------------------------------

import type { MaestroPlugin, SpecInjectionConfig } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';
import { loadSpecs, loadExtraDocs, type SpecCategory, type LoadSpecsOptions } from '../../tools/spec-loader.js';
import { loadSpecInjectionConfig } from '../../config/index.js';
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
      const config = loadSpecInjectionConfig(this.projectPath);

      // Category-based injection with keyword filters
      const category = inferCategory(prompt);
      const uid = resolveUidSafe();

      const loaderOpts: LoadSpecsOptions = {};
      if (config.keywordFilters?.include?.length) loaderOpts.includeKeywords = config.keywordFilters.include;
      if (config.keywordFilters?.exclude?.length) loaderOpts.excludeKeywords = config.keywordFilters.exclude;

      const catDocConfig = config.categoryDocs?.[category];
      if (catDocConfig?.specFiles?.length) loaderOpts.extraSpecFiles = catDocConfig.specFiles;

      const catResult = loadSpecs(this.projectPath, category, uid, undefined, undefined, loaderOpts);
      if (catResult.content) {
        parts.push(catResult.content);
      }

      // Load category-level extra documents
      if (catDocConfig?.docs?.length) {
        const docsResult = loadExtraDocs(this.projectPath, catDocConfig.docs);
        if (docsResult.content) parts.push(docsResult.content);
      }

      // Always-inject (session start): docs, keyword-matched entries, categories
      if (config.always) {
        if (config.always.docs?.length) {
          const alwaysResult = loadExtraDocs(this.projectPath, config.always.docs);
          if (alwaysResult.content) parts.push(alwaysResult.content);
        }
        if (config.always.keywords?.length) {
          const kwOpts: LoadSpecsOptions = { includeKeywords: config.always.keywords };
          const kwResult = loadSpecs(this.projectPath, undefined, uid, undefined, undefined, kwOpts);
          if (kwResult.content) parts.push(kwResult.content);
        }
        if (config.always.categories?.length) {
          for (const cat of config.always.categories) {
            if (cat === category) continue;
            const catRes = loadSpecs(this.projectPath, cat as import('../../tools/spec-loader.js').SpecCategory, uid);
            if (catRes.content) parts.push(catRes.content);
          }
        }
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
  if (/\b(ui|ux|frontend|component|style|css|scss|tailwind|design system|layout|animation|responsive|landing|dashboard|impeccable)\b/.test(lower)) return 'ui';
  return 'coding'; // Default for implementation work
}
