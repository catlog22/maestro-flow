// src/graph/kg/extraction/code/code-extractor.ts
// 代码提取编排器 — 扫描源文件 → 语言检测 → tree-sitter 解析 → 生成 nodes + edges
// 参考: codegraph extraction pipeline

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, join, relative } from 'node:path';
import type { UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult, SourceType, Language } from '../../db/types.js';
import { getTreeSitterEngine, isTreeSitterAvailable } from './tree-sitter.js';
import { getExtractor, detectLanguageFromPath, isFileLevelOnlyLanguage, getSupportedLanguages } from './languages/index.js';
import { isGeneratedFile, isTestFile } from './generated-detection.js';
import { symbolToNode, makeCodeNodeId, makeFileNodeId } from './tree-sitter-types.js';
import type { ExtractedSymbol, ExtractedReference } from './tree-sitter-types.js';
import { extractVueSFC } from './vue-extractor.js';
import { extractSvelte } from './svelte-extractor.js';
import { extractLiquid } from './liquid-extractor.js';
import { extractMybatisXml } from './mybatis-extractor.js';
import { extractDfm } from './dfm-extractor.js';
import { createHash } from 'node:crypto';
import { PluginEngine } from './plugin-engine.js';
import type { PluginExtractedSymbol } from './plugin-types.js';

// ---------------------------------------------------------------------------
// 扫描配置
// ---------------------------------------------------------------------------

interface ScanOptions {
  /** 源码根目录 */
  srcDir: string;
  /** 项目根目录（用于插件加载） */
  projectRoot?: string;
  /** 排除的目录模式 */
  excludeDirs?: string[];
  /** 排除的文件模式 (glob) */
  excludeFiles?: string[];
  /** 是否包含测试文件 */
  includeTests?: boolean;
  /** 最大文件大小 (bytes) */
  maxFileSize?: number;
  /** 进度回调 */
  onProgress?: (file: string, count: number, total: number) => void;
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.workflow', '.codegraph', 'coverage', '.cache',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  '.claude', '.agy', '.agents', '.codex', '.history',
  '.idea', '.vscode', '.vs',
]);

const BINARY_EXTENSIONS = new Set([
  '.wasm', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm',
  '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib',
]);

const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB

// ---------------------------------------------------------------------------
// 文件扫描
// ---------------------------------------------------------------------------

interface ScannedFile {
  path: string;
  language: Language;
  size: number;
  modifiedAt: number;
  contentHash: string;
}

function scanFiles(options: ScanOptions): ScannedFile[] {
  const files: ScannedFile[] = [];
  const excludeDirs = options.excludeDirs
    ? new Set([...DEFAULT_EXCLUDE_DIRS, ...options.excludeDirs])
    : DEFAULT_EXCLUDE_DIRS;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  function walkDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!excludeDirs.has(entry)) {
          walkDir(fullPath);
        }
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > maxFileSize) continue;

      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      const language = detectLanguageFromPath(fullPath);
      if (language === 'unknown') continue;

      // 测试文件过滤
      if (!options.includeTests && isTestFile(fullPath)) continue;

      const content = readFileSync(fullPath);
      const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 16);

      files.push({
        path: fullPath,
        language,
        size: stat.size,
        modifiedAt: Math.floor(stat.mtimeMs),
        contentHash,
      });
    }
  }

  walkDir(options.srcDir);
  return files;
}

// ---------------------------------------------------------------------------
// 代码提取编排
// ---------------------------------------------------------------------------

export interface CodeExtractionStats {
  filesScanned: number;
  filesExtracted: number;
  filesSkipped: number;
  nodesCreated: number;
  edgesCreated: number;
  referencesCollected: number;
  errors: Array<{ filePath: string; message: string }>;
  durationMs: number;
}

/**
 * 批量代码提取 — 扫描目录 → tree-sitter 解析 → nodes + edges
 *
 * 设计: 逐文件提取, 汇总后一次性写入 DB
 * 支持: 自定义提取器 (vue/svelte/liquid/mybatis/dfm) 优先于通用 tree-sitter
 */
export async function extractCode(
  options: ScanOptions,
): Promise<{ results: ExtractionResult[]; stats: CodeExtractionStats }> {
  const startMs = Date.now();
  const engine = getTreeSitterEngine();
  const hasTreeSitter = engine.isAvailable();

  // 插件引擎
  const projectRoot = options.projectRoot ?? resolve(options.srcDir, '..');
  const pluginEngine = new PluginEngine(projectRoot);
  let hasPlugins = false;
  try { hasPlugins = await pluginEngine.load(); } catch { /* plugins optional */ }

  // 扫描文件
  const scannedFiles = scanFiles(options);
  const results: ExtractionResult[] = [];
  const errors: Array<{ filePath: string; message: string }> = [];
  let totalNodes = 0;
  let totalEdges = 0;
  let totalRefs = 0;
  let extractedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < scannedFiles.length; i++) {
    const file = scannedFiles[i];
    options.onProgress?.(file.path, i + 1, scannedFiles.length);

    try {
      const sourceCode = readFileSync(file.path, 'utf-8');
      const relPath = relative(options.srcDir, file.path).replace(/\\/g, '/');

      // 自定义提取器优先 (vue/svelte/liquid/mybatis/dfm)
      const customResult = await extractWithCustomExtractor(sourceCode, file.path);
      if (customResult) {
        const { nodes, edges } = buildResultFromCustomExtractor(
          customResult.symbols, customResult.references, customResult.edges,
          file, relPath,
        );
        results.push({
          nodes,
          edges,
          fileRecord: createFileRecord(file, nodes.length),
        });
        totalNodes += nodes.length;
        totalEdges += edges.length;
        totalRefs += customResult.references.length;
        extractedCount++;
        continue;
      }

      // file-level-only 语言 (yaml/twig/properties)
      if (isFileLevelOnlyLanguage(file.language)) {
        const fileNode = createFileLevelNode(file, relPath);
        results.push({
          nodes: [fileNode],
          edges: [],
          fileRecord: createFileRecord(file, 1),
        });
        totalNodes++;
        extractedCount++;
        continue;
      }

      // tree-sitter 通用提取
      if (!hasTreeSitter) {
        skippedCount++;
        continue;
      }

      const extractor = getExtractor(file.language);
      if (!extractor) {
        skippedCount++;
        continue;
      }

      const tree = await engine.parse(sourceCode, file.language);
      if (!tree) {
        errors.push({ filePath: file.path, message: 'tree-sitter parse failed' });
        skippedCount++;
        continue;
      }

      let extracted = extractor.extract(tree, sourceCode, file.path);

      // 插件扩展提取
      if (hasPlugins) {
        try {
          const pluginResult = await pluginEngine.run(file.path, sourceCode, file.language, tree, extracted);
          if (pluginResult.symbols.length > 0 || (pluginResult.references?.length ?? 0) > 0 || (pluginResult.edges?.length ?? 0) > 0) {
            extracted = pluginEngine.mergeResults(extracted, pluginResult);
          }
        } catch { /* plugin errors don't block core extraction */ }
      }

      // 将 ExtractedSymbol 转换为 UnifiedNode
      const now = Date.now();
      const nodes: UnifiedNode[] = extracted.symbols.map(s => {
        const node = symbolToNode(s, now);
        const pSym = s as PluginExtractedSymbol;
        if (pSym.pluginMetadata) {
          node.metadata = { ...node.metadata, plugin: pSym.pluginMetadata };
        }
        return node;
      });

      // 引用 → unresolved_refs (由 resolution 阶段解析)
      // 此处只计数, 实际写入在 resolution 阶段
      const edges: UnifiedEdge[] = extracted.edges.map(e => ({
        source: e.source,
        target: e.target,
        kind: e.kind as UnifiedEdge['kind'],
        line: e.line,
        column: e.col,
        provenance: 'tree-sitter' as UnifiedEdge['provenance'],
      }));

      // generated file 标记
      const isGenerated = isGeneratedFile(file.path);
      if (isGenerated) {
        for (const node of nodes) {
          node.metadata = { ...node.metadata, generated: true };
        }
      }

      results.push({
        nodes,
        edges,
        fileRecord: createFileRecord(file, nodes.length),
      });

      totalNodes += nodes.length;
      totalEdges += edges.length;
      totalRefs += extracted.references.length;
      extractedCount++;

    } catch (err) {
      errors.push({
        filePath: file.path,
        message: err instanceof Error ? err.message : String(err),
      });
      skippedCount++;
    }
  }

  return {
    results,
    stats: {
      filesScanned: scannedFiles.length,
      filesExtracted: extractedCount,
      filesSkipped: skippedCount,
      nodesCreated: totalNodes,
      edgesCreated: totalEdges,
      referencesCollected: totalRefs,
      errors,
      durationMs: Date.now() - startMs,
    },
  };
}

// ---------------------------------------------------------------------------
// 自定义提取器路由
// ---------------------------------------------------------------------------

async function extractWithCustomExtractor(
  source: string,
  filePath: string,
): Promise<{ symbols: ExtractedSymbol[]; references: ExtractedReference[]; edges: Array<{ source: string; target: string; kind: string }> } | null> {
  const ext = extname(filePath).toLowerCase();

  // Vue SFC
  if (ext === '.vue') {
    const result = await extractVueSFC(source, filePath);
    return { symbols: result.symbols, references: result.references, edges: result.edges };
  }

  // Svelte
  if (ext === '.svelte') {
    const result = await extractSvelte(source, filePath);
    return { symbols: result.symbols, references: result.references, edges: result.edges };
  }

  // Liquid
  if (ext === '.liquid') {
    const result = extractLiquid(source, filePath);
    return { symbols: result.symbols, references: result.references, edges: result.edges };
  }

  // MyBatis XML mapper (检测是否包含 <mapper> 标签)
  if (ext === '.xml' && source.includes('<mapper')) {
    const result = extractMybatisXml(source, filePath);
    return { symbols: result.symbols, references: result.references, edges: result.edges };
  }

  // Delphi DFM/FMX
  if (ext === '.dfm' || ext === '.fmx') {
    const result = extractDfm(source, filePath);
    return { symbols: result.symbols, references: result.references, edges: result.edges };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function buildResultFromCustomExtractor(
  symbols: ExtractedSymbol[],
  references: ExtractedReference[],
  rawEdges: Array<{ source: string; target: string; kind: string }>,
  file: ScannedFile,
  relPath: string,
): { nodes: UnifiedNode[]; edges: UnifiedEdge[] } {
  const now = Date.now();
  const nodes: UnifiedNode[] = symbols.map(s => symbolToNode(s, now));
  const edges: UnifiedEdge[] = rawEdges.map(e => ({
    source: e.source,
    target: e.target,
    kind: e.kind as UnifiedEdge['kind'],
    provenance: 'tree-sitter' as UnifiedEdge['provenance'],
  }));
  return { nodes, edges };
}

function createFileLevelNode(file: ScannedFile, relPath: string): UnifiedNode {
  return {
    id: makeFileNodeId(relPath),
    kind: 'file',
    name: relPath.split('/').pop() ?? relPath,
    qualifiedName: relPath,
    filePath: file.path,
    language: file.language,
    startLine: 1,
    endLine: 0,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: '',
    isExported: false,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: '',
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {},
    updatedAt: Date.now(),
  };
}

function createFileRecord(file: ScannedFile, nodeCount: number): FileRecord {
  return {
    path: file.path,
    contentHash: file.contentHash,
    language: file.language,
    size: file.size,
    modifiedAt: file.modifiedAt,
    indexedAt: Date.now(),
    nodeCount,
    errors: [],
    sourceType: 'codegraph' as SourceType,
  };
}