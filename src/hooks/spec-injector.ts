/**
 * Spec Injector — PreToolUse:Agent Hook
 *
 * Automatically injects project specs into subagent context based on
 * agent type → spec category mapping. Uses context-budget to reduce
 * payload when context usage is high.
 *
 * Design: Uses `additionalContext` (advisory) rather than rewriting
 * the prompt — safer and non-destructive.
 */

import { loadSpecs, type SpecCategory } from '../tools/spec-loader.js';
import { evaluateContextBudget } from './context-budget.js';
import { resolveSelf } from '../tools/team-members.js';
import type { SpecInjectionConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecInjectionRule {
  categories: SpecCategory[];
  /** Additional file paths relative to project root */
  extras: string[];
}

export interface SpecInjectionResult {
  inject: boolean;
  content?: string;
  categories?: string[];
  specCount?: number;
  budgetAction?: string;
}

// ---------------------------------------------------------------------------
// Default agent-type → spec-category mapping
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_SPEC_MAP: Record<string, SpecInjectionRule> = {
  // Execution agents → coding specs
  'code-developer':      { categories: ['coding'], extras: [] },
  'tdd-developer':       { categories: ['coding', 'test'], extras: [] },
  'workflow-executor':   { categories: ['coding'], extras: [] },
  'universal-executor':  { categories: ['coding'], extras: [] },
  'test-fix-agent':      { categories: ['coding', 'test'], extras: [] },

  // Planning agents → arch specs
  'cli-lite-planning-agent': { categories: ['arch'], extras: [] },
  'action-planning-agent':   { categories: ['arch'], extras: [] },
  'workflow-planner':        { categories: ['arch'], extras: [] },

  // Review agents → review specs
  'workflow-reviewer':   { categories: ['review'], extras: [] },

  // Debug agents → debug specs
  'debug-explore-agent': { categories: ['debug'], extras: [] },
  'workflow-debugger':   { categories: ['debug'], extras: [] },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether to inject specs for a given agent type.
 *
 * @param agentType   The subagent_type from PreToolUse tool_input
 * @param projectPath Working directory (for spec file resolution)
 * @param sessionId   Session ID (for context budget bridge metrics)
 * @param config      Optional user config overrides
 * @param uid         Optional team member uid for personal spec layer
 */
export function evaluateSpecInjection(
  agentType: string,
  projectPath: string,
  sessionId?: string,
  config?: SpecInjectionConfig,
  uid?: string,
): SpecInjectionResult {
  // Merge user config mapping with defaults
  const mapping = buildMapping(config);
  const rule = mapping[agentType];

  if (!rule) return { inject: false };

  // Resolve uid from team membership if not explicitly provided
  const resolvedUid = uid ?? resolveUidSafe();

  // Load specs for each category
  const sections: string[] = [];
  const allCategories: string[] = [];
  let totalCount = 0;

  for (const category of rule.categories) {
    const result = loadSpecs(projectPath, category as SpecCategory, resolvedUid);
    if (result.content) {
      sections.push(result.content);
      allCategories.push(category);
      totalCount += result.totalLoaded;
    }
  }

  if (sections.length === 0) return { inject: false };

  const rawContent = sections.join('\n\n---\n\n');

  // Apply context budget
  const budget = evaluateContextBudget(rawContent, sessionId);

  if (budget.action === 'skip') {
    return { inject: false, budgetAction: 'skip' };
  }

  return {
    inject: true,
    content: budget.content,
    categories: allCategories,
    specCount: totalCount,
    budgetAction: budget.action,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Best-effort uid resolution — returns null on any failure so spec injection
 * never throws due to team-mode issues.
 */
function resolveUidSafe(): string | undefined {
  try {
    const self = resolveSelf();
    return self?.uid ?? undefined;
  } catch {
    return undefined;
  }
}

function buildMapping(config?: SpecInjectionConfig): Record<string, SpecInjectionRule> {
  if (!config?.mapping) return DEFAULT_AGENT_SPEC_MAP;

  const merged = { ...DEFAULT_AGENT_SPEC_MAP };
  for (const [agent, rule] of Object.entries(config.mapping)) {
    merged[agent] = {
      categories: rule.categories as SpecCategory[],
      extras: rule.extras ?? [],
    };
  }
  return merged;
}
