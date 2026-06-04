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

import { loadSpecs, loadExtraDocs, type SpecCategory, type LoadSpecsOptions } from '../tools/spec-loader.js';
import { evaluateContextBudget } from './context-budget.js';
import { resolveSelf } from '../tools/team-members.js';
import { evaluateKeywordInjection } from './keyword-spec-injector.js';
import { loadWikiByCategory } from './wiki-role-loader.js';
import type { SpecInjectionConfig } from '../types/index.js';
import { logInjectionEvent } from './spec-analytics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecInjectionResult {
  inject: boolean;
  content?: string;
  categories?: string[];
  specCount?: number;
  budgetAction?: string;
}

// ---------------------------------------------------------------------------
// Agent-type → spec categories mapping (single source of truth)
// ---------------------------------------------------------------------------

const AGENT_CATEGORY_MAP: Record<string, SpecCategory[]> = {
  // Execution agents → coding specs
  'code-developer':      ['coding', 'learning', 'ui'],
  'tdd-developer':       ['coding', 'test'],
  'workflow-executor':   ['coding'],
  'universal-executor':  ['coding', 'ui'],
  'test-fix-agent':      ['coding', 'test'],

  // Exploration agents → coding + arch specs
  'Explore':             ['coding', 'arch'],
  'general-purpose':     ['coding', 'learning'],
  'claude-code-guide':   ['coding'],

  // Planning agents → arch specs
  'cli-lite-planning-agent': ['arch', 'coding'],
  'action-planning-agent':   ['arch'],
  'workflow-planner':        ['arch'],
  'workflow-collab-planner': ['arch'],
  'Plan':                    ['arch', 'coding'],

  // Review agents → review specs
  'workflow-reviewer':   ['review'],
  'workflow-review':     ['review', 'coding'],

  // Debug agents → debug specs
  'debug-explore-agent': ['debug'],
  'workflow-debugger':   ['debug'],

  // Context / research agents
  'context-search-agent':      ['coding', 'arch'],
  'workflow-research-agent':   ['coding'],
  'workflow-codebase-mapper':  ['arch'],
  'workflow-analyzer':         ['coding', 'arch'],

  // General — used by Codex SessionStart (no agent type available)
  'general':             ['coding', 'learning'],
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
  const categories = resolveCategories(agentType, config);
  if (!categories || categories.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'spec-injector',
      agentType,
      categories: [],
      specCount: 0,
      contentLength: 0,
      inject: false,
      reason: 'no-categories',
    }, config?.analytics);
    return { inject: false };
  }

  const resolvedUid = uid ?? resolveUidSafe();
  const kwFilters = resolveKeywordFilters(agentType, config);

  const sections: string[] = [];
  const allCategories: string[] = [];
  let totalCount = 0;

  for (const category of categories) {
    // Build loader options with keyword filters and extra spec files
    const loaderOpts: LoadSpecsOptions = {};
    if (config?.globalSpecsDir) loaderOpts.globalDir = config.globalSpecsDir;
    if (kwFilters.include?.length) loaderOpts.includeKeywords = kwFilters.include;
    if (kwFilters.exclude?.length) loaderOpts.excludeKeywords = kwFilters.exclude;

    const catDocConfig = config?.categoryDocs?.[category];
    if (catDocConfig?.specFiles?.length) loaderOpts.extraSpecFiles = catDocConfig.specFiles;

    // Load specs by category (primary doc + keyword cross-match + tool discovery)
    const specResult = loadSpecs(projectPath, category as SpecCategory, resolvedUid, undefined, undefined, loaderOpts);
    if (specResult.content) {
      sections.push(specResult.content);
      allCategories.push(category);
      totalCount += specResult.totalLoaded;
    }

    // Load category-level extra documents
    if (catDocConfig?.docs?.length) {
      const docsResult = loadExtraDocs(projectPath, catDocConfig.docs);
      if (docsResult.content) {
        sections.push(docsResult.content);
        totalCount += docsResult.count;
      }
    }

    // Wiki category knowledge injection
    const wikiResult = loadWikiByCategory(projectPath, category);
    if (wikiResult) {
      sections.push(wikiResult.content);
      totalCount += wikiResult.entryCount;
    }
  }

  // Agent-specific extra documents
  const agentExtras = config?.mapping?.[agentType]?.extras;
  if (agentExtras?.length) {
    const extrasResult = loadExtraDocs(projectPath, agentExtras);
    if (extrasResult.content) {
      sections.push(extrasResult.content);
      totalCount += extrasResult.count;
    }
  }

  // Always-inject (session start): documents, keyword-matched entries, and categories
  if (config?.always) {
    const always = config.always;

    // Always-inject documents
    if (always.docs?.length) {
      const alwaysResult = loadExtraDocs(projectPath, always.docs);
      if (alwaysResult.content) {
        sections.push(alwaysResult.content);
        totalCount += alwaysResult.count;
      }
    }

    // Always-inject keyword-matched entries (load from all specs, filter by keywords)
    if (always.keywords?.length) {
      const kwOpts: LoadSpecsOptions = { includeKeywords: always.keywords };
      if (config?.globalSpecsDir) kwOpts.globalDir = config.globalSpecsDir;
      const kwResult = loadSpecs(projectPath, undefined, resolvedUid, undefined, undefined, kwOpts);
      if (kwResult.content) {
        sections.push(kwResult.content);
        totalCount += kwResult.totalLoaded;
      }
    }

    // Always-inject full categories
    if (always.categories?.length) {
      const catOpts: LoadSpecsOptions = {};
      if (config?.globalSpecsDir) catOpts.globalDir = config.globalSpecsDir;
      for (const cat of always.categories) {
        if (allCategories.includes(cat)) continue; // Already loaded above
        const catResult = loadSpecs(projectPath, cat as SpecCategory, resolvedUid, undefined, undefined, catOpts);
        if (catResult.content) {
          sections.push(catResult.content);
          totalCount += catResult.totalLoaded;
        }
      }
    }
  }

  if (sections.length === 0) {
    logInjectionEvent(projectPath, {
      source: 'spec-injector',
      agentType,
      categories: allCategories,
      specCount: totalCount,
      contentLength: 0,
      inject: false,
      reason: 'no-content',
    }, config?.analytics);
    return { inject: false };
  }

  let rawContent = sections.join('\n\n---\n\n');

  // Apply maxContentLength before context budget
  if (config?.maxContentLength && rawContent.length > config.maxContentLength) {
    rawContent = rawContent.slice(0, config.maxContentLength);
  }

  const budget = evaluateContextBudget(rawContent, sessionId);

  if (budget.action === 'skip') {
    logInjectionEvent(projectPath, {
      source: 'spec-injector',
      agentType,
      categories: allCategories,
      specCount: totalCount,
      budgetAction: 'skip',
      contentLength: rawContent.length,
      inject: false,
      reason: 'budget-skip',
    }, config?.analytics);
    return { inject: false, budgetAction: 'skip' };
  }

  logInjectionEvent(projectPath, {
    source: 'spec-injector',
    agentType,
    categories: allCategories,
    specCount: totalCount,
    budgetAction: budget.action,
    contentLength: budget.content?.length ?? 0,
    inject: true,
  }, config?.analytics);

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

/**
 * Resolve categories for an agent type. Config overrides take precedence.
 */
function resolveCategories(agentType: string, config?: SpecInjectionConfig): string[] | null {
  // Config override
  if (config?.mapping?.[agentType]) {
    return config.mapping[agentType].categories;
  }
  return AGENT_CATEGORY_MAP[agentType] ?? null;
}

/**
 * Merge keyword filters from agent-level and global-level config.
 * Agent-level include replaces global include; excludes are merged.
 */
function resolveKeywordFilters(agentType: string, config?: SpecInjectionConfig): { include?: string[]; exclude?: string[] } {
  if (!config) return {};

  const agentMapping = config.mapping?.[agentType];
  const globalFilters = config.keywordFilters;

  const include = agentMapping?.includeKeywords ?? globalFilters?.include;

  const agentExclude = agentMapping?.excludeKeywords ?? [];
  const globalExclude = globalFilters?.exclude ?? [];
  const mergedExclude = [...agentExclude, ...globalExclude];

  return {
    include: include?.length ? include : undefined,
    exclude: mergedExclude.length > 0 ? mergedExclude : undefined,
  };
}
