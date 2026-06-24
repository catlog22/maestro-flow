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
import { wrapMaestroContext, type ContextSection } from './context-format.js';
import { loadGlossary, type DomainTerm } from '../tools/domain-loader.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Content → compact lines helper
// ---------------------------------------------------------------------------

/**
 * Convert a loaded markdown block into compact section lines.
 *
 * The loaders (loadSpecs/loadExtraDocs/loadWikiByCategory) return pre-formatted
 * markdown. To fit the unified <maestro-context> shape we flatten that markdown
 * into non-empty lines, dropping separator rules and blank lines while keeping
 * headings (as `# ...`) so structure survives. Each line becomes a bullet via
 * wrapMaestroContext.
 *
 * FUTURE WORK: emit truly structured one-line entries (e.g.
 * `coding · auth,token · <oneline>`) by having the loaders expose parsed
 * spec-entry data instead of concatenated markdown. Done here as format-only.
 */
function markdownToLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^-{3,}\s*$/.test(l));
}

/**
 * Per-injector budget reporting for the wrapper attribute.
 *
 * FUTURE WORK: this is local char accounting only — cross-injector budget
 * pooling (shared token accounting across spec/keyword/kg hooks in one turn)
 * is intentionally not implemented yet to avoid behavioral risk.
 */
function computeBudgetInfo(sections: ContextSection[]): { used: number; max: number } {
  const used = sections.reduce(
    (sum, s) => sum + s.lines.reduce((acc, l) => acc + l.length, 0),
    0,
  );
  return { used, max: used };
}

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
  'workflow-executor':   ['coding', 'learning', 'ui'],
  'universal-executor':  ['coding', 'ui'],
  'test-fix-agent':      ['coding', 'test'],
  'impeccable-agent':    ['coding', 'ui'],
  'ui-design-agent':     ['coding', 'ui'],

  // Exploration agents → coding + arch specs
  'Explore':             ['coding', 'arch'],
  'general-purpose':     ['coding', 'learning'],
  'claude-code-guide':   ['coding'],
  'cli-explore-agent':   ['coding', 'arch'],

  // Planning agents → arch specs
  'cli-lite-planning-agent': ['arch', 'coding'],
  'action-planning-agent':   ['arch'],
  'workflow-planner':        ['arch'],
  'workflow-collab-planner': ['arch'],
  'workflow-roadmapper':     ['arch'],
  'role-design-author':      ['arch', 'coding'],
  'team-supervisor':         ['arch'],
  'team-worker':             ['coding', 'learning'],
  'Plan':                    ['arch', 'coding'],

  // Review agents → review specs
  'workflow-reviewer':         ['review', 'coding'],
  'workflow-review':           ['review', 'coding'],
  'workflow-verifier':         ['review', 'test'],
  'workflow-plan-checker':     ['review', 'arch'],
  'workflow-integration-checker': ['review', 'test'],
  'workflow-nyquist-auditor':  ['review'],
  'cross-role-reviewer':       ['review'],

  // Debug agents → debug specs
  'debug-explore-agent': ['debug'],
  'workflow-debugger':   ['debug'],

  // Context / research agents
  'context-search-agent':         ['coding', 'arch'],
  'workflow-research-agent':      ['coding'],
  'workflow-codebase-mapper':     ['arch'],
  'workflow-analyzer':            ['coding', 'arch'],
  'workflow-external-researcher': ['coding', 'arch'],
  'workflow-phase-researcher':    ['coding', 'arch'],
  'workflow-project-researcher':  ['coding', 'arch'],
  'workflow-research-synthesizer': ['coding', 'arch'],

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

  // Resolve linked workspace specs for cross-workspace injection
  const wsConfig = loadWorkspaceConfig(projectPath);
  const resolvedLinks = resolveWorkspaceLinks(projectPath, wsConfig);
  const linkedSpecs = resolvedLinks
    .filter(lw => lw.valid && lw.share.includes('spec'))
    .map(lw => ({ name: lw.name, specsDir: join(lw.workflowRoot, 'specs') }));

  const ctxSections: ContextSection[] = [];
  const allCategories: string[] = [];
  let totalCount = 0;

  for (const category of categories) {
    // Build loader options with keyword filters and extra spec files
    const loaderOpts: LoadSpecsOptions = {};
    if (kwFilters.include?.length) loaderOpts.includeKeywords = kwFilters.include;
    if (kwFilters.exclude?.length) loaderOpts.excludeKeywords = kwFilters.exclude;
    if (linkedSpecs.length > 0) loaderOpts.linkedWorkspaces = linkedSpecs;

    const catDocConfig = config?.categoryDocs?.[category];
    if (catDocConfig?.specFiles?.length) loaderOpts.extraSpecFiles = catDocConfig.specFiles;

    // Load specs by category (primary doc + keyword cross-match + tool discovery)
    const specResult = loadSpecs(projectPath, category as SpecCategory, resolvedUid, undefined, undefined, loaderOpts);
    if (specResult.content) {
      ctxSections.push({ label: `specs[${category}]`, lines: markdownToLines(specResult.content) });
      allCategories.push(category);
      totalCount += specResult.totalLoaded;
    }

    // Load category-level extra documents
    if (catDocConfig?.docs?.length) {
      const docsResult = loadExtraDocs(projectPath, catDocConfig.docs);
      if (docsResult.content) {
        ctxSections.push({ label: `docs[${category}]`, lines: markdownToLines(docsResult.content) });
        totalCount += docsResult.count;
      }
    }

    // Wiki category knowledge injection
    const wikiResult = loadWikiByCategory(projectPath, category);
    if (wikiResult) {
      ctxSections.push({ label: `wiki[${category}]`, lines: markdownToLines(wikiResult.content) });
      totalCount += wikiResult.entryCount;
    }
  }

  // Agent-specific extra documents
  const agentExtras = config?.mapping?.[agentType]?.extras;
  if (agentExtras?.length) {
    const extrasResult = loadExtraDocs(projectPath, agentExtras);
    if (extrasResult.content) {
      ctxSections.push({ label: 'extras', lines: markdownToLines(extrasResult.content) });
      totalCount += extrasResult.count;
    }
  }

  // Domain compact summary (always-inject for all agents)
  try {
    const domainSection = buildDomainCompactForAgent(projectPath);
    if (domainSection) {
      ctxSections.push(domainSection);
    }
  } catch { /* domain injection is best-effort */ }

  // Always-inject (session start): documents, keyword-matched entries, and categories
  if (config?.always) {
    const always = config.always;

    // Always-inject documents
    if (always.docs?.length) {
      const alwaysResult = loadExtraDocs(projectPath, always.docs);
      if (alwaysResult.content) {
        ctxSections.push({ label: 'always-docs', lines: markdownToLines(alwaysResult.content) });
        totalCount += alwaysResult.count;
      }
    }

    // Always-inject keyword-matched entries (load from all specs, filter by keywords)
    if (always.keywords?.length) {
      const kwOpts: LoadSpecsOptions = { includeKeywords: always.keywords };
      const kwResult = loadSpecs(projectPath, undefined, resolvedUid, undefined, undefined, kwOpts);
      if (kwResult.content) {
        ctxSections.push({ label: `always-keyword[${always.keywords.join(',')}]`, lines: markdownToLines(kwResult.content) });
        totalCount += kwResult.totalLoaded;
      }
    }

    // Always-inject full categories
    if (always.categories?.length) {
      for (const cat of always.categories) {
        if (allCategories.includes(cat)) continue; // Already loaded above
        const catResult = loadSpecs(projectPath, cat as SpecCategory, resolvedUid);
        if (catResult.content) {
          ctxSections.push({ label: `always-specs[${cat}]`, lines: markdownToLines(catResult.content) });
          totalCount += catResult.totalLoaded;
        }
      }
    }
  }

  if (ctxSections.length === 0) {
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

  // Apply maxContentLength as a per-section line budget guard before wrapping:
  // flatten, then let context-budget decide tier. We wrap first so the budget
  // operates on the final shape the agent will see.
  let rawContent = wrapMaestroContext(ctxSections, computeBudgetInfo(ctxSections));

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

  // Credibility: increment consumption for injected spec category nodes (best-effort, async)
  (async () => {
    let mg: import('../graph/kg/engine.js').MaestroGraph | null = null;
    try {
      const { MaestroGraph } = await import('../graph/kg/engine.js');
      if (MaestroGraph.isInitialized(projectPath)) {
        mg = await MaestroGraph.open(resolve(projectPath));
        if (mg) {
          const { CredibilityStore } = await import('../graph/kg/credibility.js');
          const store = new CredibilityStore(mg.rawDb);
          const nodes = mg.rawDb.prepare(
            `SELECT id FROM nodes WHERE source_type = 'spec' AND category IN (${allCategories.map(() => '?').join(',')})`,
          ).all(...allCategories) as Array<{ id: string }>;
          if (nodes.length > 0) {
            store.incrementSearchHits(nodes.map(n => n.id));
          }
        }
      }
    } catch { /* best-effort */ } finally {
      mg?.close();
    }
  })().catch(() => {});

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

// ---------------------------------------------------------------------------
// Domain compact summary for Agent injection
// ---------------------------------------------------------------------------

const DOMAIN_COMPACT_MAX_CHARS = 800;

function buildDomainCompactForAgent(projectPath: string): ContextSection | null {
  const { exists, activeTerms, isEmpty } = loadGlossary(projectPath);
  if (!exists || isEmpty) return null;

  const coreTerms = activeTerms.filter(t => (t.tier ?? 'core') === 'core');
  if (coreTerms.length === 0) return null;

  let summary = '';
  for (const t of coreTerms) {
    const entry = `${t.canonical}=${t.definition}`;
    if (summary.length + entry.length + 3 > DOMAIN_COMPACT_MAX_CHARS) break;
    summary += (summary ? ' | ' : '') + entry;
  }
  if (!summary) return null;

  return { label: 'domain-compact', lines: [summary] };
}
