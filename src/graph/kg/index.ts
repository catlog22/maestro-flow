// src/graph/kg/index.ts — MaestroGraph 模块导出

export { MaestroGraph } from './engine.js';
export { KgDatabaseConnection, KgQueryBuilder, getKgDatabasePath, sanitizeFtsQuery, makeNodeId, validateNodeId } from './db/index.js';
export type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  ResolutionResult, SyncResult, UnifiedSearchResult, UnifiedGraphStats,
  UnifiedNodeKind, UnifiedEdgeKind, CodeNodeKind, KnowledgeNodeKind,
  CodeEdgeKind, KnowledgeEdgeKind, Language, SourceType, EdgeProvenance,
  NodeIdPrefix, Visibility,
  UNIFIED_NODE_KINDS, CODE_NODE_KINDS, KNOWLEDGE_NODE_KINDS,
  LANGUAGES, SOURCE_TYPES,
} from './db/types.js';

// Extraction
export { extractCode, forEachCodeExtractionResult } from './extraction/code/code-extractor.js';
export { syncKnowledgeGraph } from './extraction/orchestrator.js';
export { extractDomain } from './extraction/knowledge/domain-extractor.js';
export { extractSpec } from './extraction/knowledge/spec-extractor.js';
export { extractWiki } from './extraction/knowledge/wiki-extractor.js';
export { extractCodebase } from './extraction/knowledge/codebase-extractor.js';
export { extractIssues } from './extraction/knowledge/issue-extractor.js';

// Code extraction
export { TreeSitterEngine, isTreeSitterAvailable, getTreeSitterEngine } from './extraction/code/tree-sitter.js';
export { isGeneratedFile, isTestFile, shouldDegradeInSearch } from './extraction/code/generated-detection.js';
export { ensureWasmStability, cleanupWasmStability } from './extraction/code/wasm-stability.js';
export { WASM_RUNTIME_FLAGS, processHasWasmRuntimeFlags, getWasmRuntimeHint } from './extraction/code/wasm-runtime-flags.js';
export { buildScanScope, MAESTRO_IGNORE_FILE } from './extraction/code/scan-scope.js';
export { getExtractor, getSupportedLanguages, detectLanguageFromPath } from './extraction/code/languages/index.js';

// Resolution
export { resolveKnowledgeEdges, expandRelated } from './resolution/index.js';
export { matchReference, tokenize } from './resolution/name-matcher.js';
export { ImportResolver } from './resolution/import-resolver.js';
export { runCallbackSynthesis } from './resolution/callback-synthesizer.js';
export { getRegisteredFrameworks, detectFrameworks } from './resolution/frameworks/index.js';

// Query
export { searchUnified, searchCodeOnly, searchKnowledgeOnly, parseQuery } from './query/search.js';
export { bfs, traceCallChain, getCallers, getCallees, getImpactRadius, findShortestPath } from './query/traversal.js';
export { buildContext, getAgentCategories } from './query/context-builder.js';
export { computeScore, kindBonus, scorePathRelevance, nameMatchBonus } from './query/scoring.js';

// Sync
export { FileLock, runIncrementalSync, computeFileHash, hasFileChanged } from './sync/incremental-sync.js';
export { isWSL2, isOnDrvFs, decideWatchStrategy, areGitHooksInstalled } from './sync/watch-policy.js';

// Surface
export { registerKgCommands } from './surface/cli.js';
export { KG_MCP_TOOLS, handleMcpTool, precheckKg } from './surface/mcp-tools.js';
