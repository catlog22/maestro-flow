export * from './types.js';
export { loadGraph } from './loader.js';
export {
  mergeGraphs,
  linkTests,
  normalizeNodeId,
  normalizeComplexity,
  normalizeDirection,
  isTestPath,
  productionCandidates,
  recoverImportsFromScan,
} from './merger.js';
export { searchNodes, findPath, diffChanges, countBy, truncate } from './query.js';
export { FsAnalyzer } from './analyzers/fs-analyzer.js';

// Enhanced modules (codegraph-derived)
export { DatabaseConnection, QueryBuilder, getDatabasePath } from './db/index.js';
export { GraphTraverser } from './traversal.js';
export { GraphQueryManager } from './graph-queries.js';
export { parseQuery, extractSearchTerms, scorePathRelevance, nameMatchBonus, kindBonus } from './search/index.js';
export { IncrementalSync, FileWatcher } from './sync/index.js';
export { GraphFacade, detectBackend as detectGraphBackend } from './facade.js';
export { migrateJsonToSqlite, exportSqliteToJson } from './migration.js';
export { loadGraphSqlite, detectBackend } from './loader.js';
