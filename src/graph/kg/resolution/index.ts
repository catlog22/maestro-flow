// src/graph/kg/resolution/index.ts — 统一 resolver 入口

export { resolveKnowledgeEdges, expandRelated } from './knowledge-resolver.js';
export type { KnowledgeResolutionResult, RelatedNode } from './knowledge-resolver.js';
export { resolveCodeStructuralReferences } from './code-reference-resolver.js';
export type { CodeStructuralResolutionResult } from './code-reference-resolver.js';

export { matchReference, tokenize } from './name-matcher.js';
export type { MatchResult, MatchStrategy } from './name-matcher.js';

export { ImportResolver, extractTsconfigMappings, resolveTsconfigAlias, extractGoModule, resolveGoCrossPackageReference, resolveCppIncludePath, buildReExportMap, resolveViaReExport } from './import-resolver.js';
export type { ImportMapping, ResolvedImport, ReExportMap } from './import-resolver.js';

export { runCallbackSynthesis } from './callback-synthesizer.js';
export type { SynthesisResult, CallbackQueryAdapter } from './callback-synthesizer.js';

export { getRegisteredFrameworks, detectFrameworks, getFrameworkResolver } from './frameworks/index.js';
export type { FrameworkResolver } from './frameworks/index.js';
