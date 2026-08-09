// src/graph/kg/extraction/code/tree-sitter-types.ts
// LanguageExtractor 接口 + tree-sitter 类型辅助
// 参考: codegraph/src/extraction/tree-sitter-types.ts

import type { UnifiedNode, UnifiedEdge, Language } from '../../db/types.js';
import type { ImportReference, StructuralReference } from '../../resolution/structural-reference.js';

// ---------------------------------------------------------------------------
// 提取出的符号信息 (tree-sitter 节点 → 符号)
// ---------------------------------------------------------------------------

export interface ExtractedSymbol {
  kind: string;             // UnifiedNodeKind (代码类型)
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
  visibility: string;
  isExported: boolean;
  isAsync: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  decorators: string[];
  typeParameters: string[];
  /** Extractor-owned exact identity facts used by later strict resolution. */
  metadata?: Record<string, unknown>;
}

/**
 * Public extractor reference contract consumed by the generic code resolver.
 * Keep this shape backward compatible for plugins and non-structural relations
 * such as imports and calls.
 */
export interface ExtractedReference {
  fromSymbolName: string;
  fromSymbolId: string;
  referenceName: string;
  referenceKind: string;
  line: number;
  col: number;
  filePath: string;
  language: Language;
}

export function makeImportReference(
  originFilePath: string,
  rawTarget: string,
  line: number,
  column: number,
  importKind: string = 'module',
): ImportReference {
  return { kind: 'import', originFilePath, importKind, rawTarget, line, column };
}

export interface LanguageExtractionResult {
  symbols: ExtractedSymbol[];
  references: ExtractedReference[];
  /** Exact import facts used internally to retain import kind and raw identity. */
  importReferences?: ImportReference[];
  /** Replayable exact structural facts resolved independently of generic refs. */
  structuralReferences?: StructuralReference[];
  edges: Array<{ source: string; target: string; kind: string; line?: number; col?: number }>;
  /** Non-fatal parser coverage diagnostics retained on the FileRecord. */
  diagnostics?: string[];
}

// ---------------------------------------------------------------------------
// LanguageExtractor 接口 — 每种语言一个提取器
// ---------------------------------------------------------------------------

export interface LanguageExtractor {
  /** 该提取器支持的语言 */
  language: Language;

  /** 对应的 tree-sitter grammar 名 (或 wasm 文件名) */
  grammarName: string;

  /** tree-sitter 节点类型 → 符号 kind 映射 */
  nodeTypeMap: Record<string, string>;

  /**
   * 从 tree-sitter AST 提取符号 + 引用
   * @param tree 解析后的 AST
   * @param sourceCode 源码文本
   * @param filePath 文件路径
   */
  extract(
    tree: unknown,
    sourceCode: string,
    filePath: string,
  ): LanguageExtractionResult;
}

// ---------------------------------------------------------------------------
// Node ID 生成 (code namespace) — D8.4
// ---------------------------------------------------------------------------

export function makeCodeNodeId(filePath: string, qualifiedName: string): string {
  // Windows separators normalize to POSIX; POSIX backslashes are identity bytes.
  const normalizedPath = process.platform === 'win32' ? filePath.replace(/\\/g, '/') : filePath;
  return `code:${normalizedPath}:${qualifiedName}`;
}

export function makeFileNodeId(filePath: string): string {
  const normalizedPath = process.platform === 'win32' ? filePath.replace(/\\/g, '/') : filePath;
  return `code:${normalizedPath}:<file>`;
}

// ---------------------------------------------------------------------------
// 将 ExtractedSymbol 转换为 UnifiedNode
// ---------------------------------------------------------------------------

export function symbolToNode(symbol: ExtractedSymbol, now: number): UnifiedNode {
  return {
    id: makeCodeNodeId(symbol.filePath, symbol.qualifiedName),
    kind: symbol.kind as UnifiedNode['kind'],
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    filePath: symbol.filePath,
    language: symbol.language,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    startColumn: symbol.startColumn,
    endColumn: symbol.endColumn,
    docstring: symbol.docstring,
    signature: symbol.signature,
    visibility: symbol.visibility as UnifiedNode['visibility'],
    isExported: symbol.isExported,
    isAsync: symbol.isAsync,
    isStatic: symbol.isStatic,
    isAbstract: symbol.isAbstract,
    decorators: symbol.decorators,
    typeParameters: symbol.typeParameters,
    sourceType: 'codegraph',
    definition: '',
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: { ...(symbol.metadata ?? {}) },
    updatedAt: now,
  };
}
