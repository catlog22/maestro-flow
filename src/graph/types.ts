export interface GraphNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  summary: string;
  tags: string[];
  complexity?: string;
}

// ---------------------------------------------------------------------------
// Enhanced types (codegraph-derived)
// ---------------------------------------------------------------------------

export const NODE_KINDS = [
  'file', 'module', 'class', 'struct', 'interface', 'trait', 'protocol',
  'function', 'method', 'property', 'field', 'variable', 'constant',
  'enum', 'enum_member', 'type_alias', 'namespace', 'parameter',
  'import', 'export', 'route', 'component',
] as const;
export type NodeKind = typeof NODE_KINDS[number];

export const EDGE_KINDS = [
  'contains', 'calls', 'imports', 'exports', 'extends', 'implements',
  'references', 'type_of', 'returns', 'instantiates', 'overrides', 'decorates',
] as const;
export type EdgeKind = typeof EDGE_KINDS[number];

export const LANGUAGES = [
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin',
  'dart', 'svelte', 'vue', 'lua', 'luau', 'objc', 'scala', 'pascal',
  'yaml', 'xml', 'properties', 'unknown',
] as const;
export type Language = typeof LANGUAGES[number];

export type Visibility = 'public' | 'private' | 'protected' | 'internal';

export interface EnhancedNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: Language;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  docstring: string;
  signature: string;
  visibility: Visibility | '';
  isExported: boolean;
  isAsync: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  decorators: string[];
  typeParameters: string[];
  updatedAt: string;
}

export interface EnhancedEdge {
  id?: number;
  source: string;
  target: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: string;
}

export interface FileRecord {
  path: string;
  contentHash: string;
  language: Language;
  size: number;
  modifiedAt: string;
  indexedAt: string;
  nodeCount: number;
  errors: string[];
}

export interface UnresolvedReference {
  id?: number;
  fromNodeId: string;
  referenceName: string;
  referenceKind: string;
  line: number;
  column: number;
  candidates: string[];
  filePath: string;
  language: Language;
}

export interface Subgraph {
  nodes: Map<string, EnhancedNode>;
  edges: EnhancedEdge[];
  roots: string[];
}

export interface TraversalOptions {
  maxDepth?: number;
  edgeKinds?: EdgeKind[];
  nodeKinds?: NodeKind[];
  direction?: 'outgoing' | 'incoming' | 'both';
  limit?: number;
  includeStart?: boolean;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  unresolvedRefCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  nodesByLanguage: Record<string, number>;
  dbSizeBytes: number;
}

export interface NodeContext {
  focal: EnhancedNode;
  ancestors: EnhancedNode[];
  children: EnhancedNode[];
  incomingRefs: Array<{ node: EnhancedNode; edge: EnhancedEdge }>;
  outgoingRefs: Array<{ node: EnhancedNode; edge: EnhancedEdge }>;
  types: EnhancedNode[];
  imports: EnhancedNode[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction?: string;
  description?: string;
  weight?: number;
  recoveredFromImportMap?: boolean;
}

export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash?: string;
}

export interface KnowledgeGraph {
  version: string;
  valid?: boolean;
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

export interface AnalyzerOptions {
  include?: string[];
  exclude?: string[];
  batchSize?: number;
}

export interface CodeAnalyzer {
  readonly name: string;
  analyze(projectRoot: string, options?: AnalyzerOptions): Promise<KnowledgeGraph>;
}

export interface BatchData {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  [key: string]: unknown;
}

export interface MergeReport {
  input: { nodes: number; edges: number };
  fixed: { total: number; patterns: Map<string, number> };
  testedBy: { added: number; dropped: number; tagged: number; swapped: number };
  unfixable: string[];
  output: { nodes: number; edges: number };
}

export interface MergeResult {
  assembled: { nodes: GraphNode[]; edges: GraphEdge[] };
  report: string[];
}

export interface PathResult {
  from: string;
  to: string;
  found: boolean;
  length: number;
  steps: Array<{
    node: string;
    type?: string;
    name?: string;
    edgeToNext?: string;
  }>;
}

export interface DiffResult {
  changedFiles: string[];
  direct: GraphNode[];
  impacted: GraphNode[];
}

export interface SearchOptions {
  limit?: number;
  type?: string;
}
