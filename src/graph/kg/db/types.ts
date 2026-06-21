// src/graph/kg/db/types.ts — MaestroGraph 统一类型系统
// 参考: guide/plan-maestrograph.md Gap 修补 2 + D8.4 Node ID 命名空间

// ---------------------------------------------------------------------------
// NodeKind — 完整复用 CodeGraph 22 种 + 新增 7 种知识类型
// ---------------------------------------------------------------------------

export const CODE_NODE_KINDS = [
  'file',           // CodeGraph 原有
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',       // Swift 协议, callback-synthesizer 依赖
  'function',
  'method',
  'property',
  'field',
  'variable',
  'constant',
  'enum',
  'enum_member',
  'type_alias',
  'namespace',
  'parameter',
  'import',
  'export',
  'route',
  'component',
] as const;

export const KNOWLEDGE_NODE_KINDS = [
  'domain_term',      // Domain glossary term
  'spec_entry',       // Spec constraint/rule
  'knowhow_entry',    // Wiki knowhow document
  'codebase_section', // Codebase doc section
  'issue',            // Issue tracker entry
  'decision',         // Architecture decision record
  'requirement',      // Requirement from context-package
] as const;

export const UNIFIED_NODE_KINDS = [...CODE_NODE_KINDS, ...KNOWLEDGE_NODE_KINDS] as const;
export type BuiltinNodeKind = (typeof UNIFIED_NODE_KINDS)[number];
export type UnifiedNodeKind = BuiltinNodeKind | (string & {});
export type CodeNodeKind = (typeof CODE_NODE_KINDS)[number];
export type KnowledgeNodeKind = (typeof KNOWLEDGE_NODE_KINDS)[number];

// ---------------------------------------------------------------------------
// EdgeKind — 完整复用 CodeGraph 12 种 + 新增 9 种知识关系
// ---------------------------------------------------------------------------

export type CodeEdgeKind =
  | 'contains' | 'calls' | 'imports' | 'exports'
  | 'extends' | 'implements' | 'references'
  | 'type_of' | 'returns' | 'instantiates'
  | 'overrides' | 'decorates';

export type KnowledgeEdgeKind =
  | 'defines'          // domain_term → code
  | 'constrains'       // spec_entry → code
  | 'documents'        // knowhow → code
  | 'relates_to'       // domain_term → domain_term
  | 'implements_rule'  // code → spec_entry
  | 'resolves'         // code → issue
  | 'derived_from'     // spec_entry → decision / spec_entry → domain
  | 'supersedes'       // decision → decision
  | 'aliases';         // domain_term → domain_term (同义词)

export type UnifiedEdgeKind = CodeEdgeKind | KnowledgeEdgeKind;

// ---------------------------------------------------------------------------
// Language — 完整复用 CodeGraph 28+ 种
// ---------------------------------------------------------------------------

export const LANGUAGES = [
  'typescript', 'javascript', 'tsx', 'jsx',
  'python', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'php', 'ruby',
  'swift', 'kotlin', 'dart',
  'svelte', 'vue', 'liquid',
  'pascal', 'scala', 'lua', 'luau', 'objc',
  'yaml', 'twig', 'xml', 'properties',
  'unknown',
] as const;

export type Language = (typeof LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Source Type — 知识节点来源分类
// ---------------------------------------------------------------------------

export const SOURCE_TYPES = [
  'codegraph', 'domain', 'spec', 'knowhow', 'codebase', 'issue',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// Edge provenance — 细粒度来源追踪
// ---------------------------------------------------------------------------

export type EdgeProvenance =
  | 'tree-sitter'         // 代码: tree-sitter AST 直接提取
  | 'heuristic'           // 代码: 名称匹配启发式
  | 'callback-synth'      // 代码: 回调合成器 (14 阶段)
  | 'framework'           // 代码: 框架解析器 (24 种)
  | 'domain'              // 知识: domain glossary
  | 'spec'                // 知识: spec entry
  | 'knowhow'             // 知识: wiki/knowhow
  | 'harvest'             // 知识: harvest 提取
  | 'knowledge-resolver'  // 知识: 跨源自动边解析
  | 'manual';             // 手动添加

// ---------------------------------------------------------------------------
// Node ID 命名空间规范 (D8.4)
// 强制命名空间前缀，避免不同来源的 ID 冲突
// ---------------------------------------------------------------------------

export type NodeIdPrefix = 'code' | 'domain' | 'spec' | 'knowhow' | 'codebase' | 'issue';

export function makeNodeId(prefix: NodeIdPrefix, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

export function validateNodeId(id: string): boolean {
  const VALID_PREFIXES = new Set<NodeIdPrefix>(['code', 'domain', 'spec', 'knowhow', 'codebase', 'issue']);
  const colonIdx = id.indexOf(':');
  return colonIdx > 0 && VALID_PREFIXES.has(id.slice(0, colonIdx) as NodeIdPrefix);
}

export function getNodePrefix(id: string): NodeIdPrefix | null {
  const colonIdx = id.indexOf(':');
  if (colonIdx <= 0) return null;
  const prefix = id.slice(0, colonIdx);
  const VALID_PREFIXES: Set<string> = new Set(['code', 'domain', 'spec', 'knowhow', 'codebase', 'issue']);
  return VALID_PREFIXES.has(prefix) ? prefix as NodeIdPrefix : null;
}

// ---------------------------------------------------------------------------
// Visibility — CodeGraph 原有
// ---------------------------------------------------------------------------

export type Visibility = 'public' | 'private' | 'protected' | 'internal';

// ---------------------------------------------------------------------------
// UnifiedNode — 统一节点类型 (DB ↔ TS 映射)
// ---------------------------------------------------------------------------

export interface UnifiedNode {
  id: string;
  kind: UnifiedNodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: Language;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;

  // CodeGraph 代码字段
  docstring: string;
  signature: string;
  visibility: Visibility | '';
  isExported: boolean;
  isAsync: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  decorators: string[];
  typeParameters: string[];

  // 知识扩展字段
  sourceType: SourceType;
  definition: string;
  aliases: string[];
  keywords: string[];
  category: string;
  roles: string[];
  priority: string;
  status: string;
  body: string;
  metadata: Record<string, unknown>;

  updatedAt: number;
}

// ---------------------------------------------------------------------------
// UnifiedEdge — 统一边类型 (DB ↔ TS 映射)
// ---------------------------------------------------------------------------

export interface UnifiedEdge {
  id?: number;
  source: string;
  target: string;
  kind: UnifiedEdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: EdgeProvenance;
}

// ---------------------------------------------------------------------------
// FileRecord — 文件追踪
// ---------------------------------------------------------------------------

export interface FileRecord {
  path: string;
  contentHash: string;
  language: Language;
  size: number;
  modifiedAt: number;
  indexedAt: number;
  nodeCount: number;
  errors: string[];
  sourceType: SourceType;
}

// ---------------------------------------------------------------------------
// ExtractionResult — 提取器输出标准
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  nodes: UnifiedNode[];
  edges: UnifiedEdge[];
  fileRecord: FileRecord;
}

// ---------------------------------------------------------------------------
// ResolutionResult — 引用解析输出
// ---------------------------------------------------------------------------

export interface ResolutionResult {
  edgesCreated: number;
  edges: UnifiedEdge[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// SyncResult — 同步结果
// ---------------------------------------------------------------------------

export interface SyncResult {
  source: string;
  nodesAdded: number;
  nodesUpdated: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// UnifiedSearchResult — 统一搜索结果
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  node: UnifiedNode;
  score: number;
  matchReason:
    | { kind: 'direct'; field: 'name' | 'definition' | 'aliases' | 'keywords' }
    | { kind: 'edge'; fromNodeId: string; fromNodeName: string; edgeKind: string }
    | { kind: 'hop'; path: Array<{ nodeName: string; edgeKind: string }> };
}

// ---------------------------------------------------------------------------
// GraphStats — 统计
// ---------------------------------------------------------------------------

export interface UnifiedGraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  dbSizeBytes: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  nodesBySourceType: Record<string, number>;
  detectedFrameworks: string[];
  schemaVersion: number;
  stalenessRatio: number;
}