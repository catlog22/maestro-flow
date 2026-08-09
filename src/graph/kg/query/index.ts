// src/graph/kg/query/index.ts — 查询层导出

export { searchUnified, searchCodeOnly, searchKnowledgeOnly, parseQuery } from './search.js';
export type { SearchOptions, UnifiedSearchOutput, ParsedQuery } from './search.js';

export {
  bfs,
  traceCallChain,
  getCallers,
  getCallees,
  getImpactRadius,
  getTypeHierarchy,
  findShortestPath,
  findShortestPathResult,
  normalizeTraversalDepth,
} from './traversal.js';
export type {
  HierarchyDirection,
  ImpactDirection,
  ImpactResult,
  PathSearchResult,
  PathStep,
  TraversalResult,
  TraversalOptions,
  TypeHierarchyResult,
} from './traversal.js';

export { buildContext, getAgentCategories } from './context-builder.js';
export type { ContextSection, ContextBudget, BuiltContext } from './context-builder.js';

export { computeScore, kindBonus, scorePathRelevance, nameMatchBonus, extractSearchTerms, getStemVariants, removeStopWords } from './scoring.js';
