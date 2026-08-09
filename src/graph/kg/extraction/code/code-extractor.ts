// src/graph/kg/extraction/code/code-extractor.ts
// 代码提取编排器 — 扫描源文件 → 语言检测 → tree-sitter 解析 → 生成 nodes + edges
// 参考: codegraph extraction pipeline

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve, extname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult, SourceType, Language } from '../../db/types.js';
import { getTreeSitterEngine } from './tree-sitter.js';
import { getExtractor, detectLanguageFromPath, isFileLevelOnlyLanguage } from './languages/index.js';
import { isGeneratedFile, isTestFile } from './generated-detection.js';
import { symbolToNode, makeCodeNodeId, makeFileNodeId } from './tree-sitter-types.js';
import type { ExtractedSymbol, ExtractedReference, LanguageExtractionResult } from './tree-sitter-types.js';
import { extractVueSFC } from './vue-extractor.js';
import { extractSvelte } from './svelte-extractor.js';
import { extractLiquid } from './liquid-extractor.js';
import { extractMybatisXml } from './mybatis-extractor.js';
import { extractDfm } from './dfm-extractor.js';
import { createHash } from 'node:crypto';
import { PluginEngine } from './plugin-engine.js';
import type { PluginExtractedSymbol } from './plugin-types.js';
import { buildScanScope } from './scan-scope.js';
import { CodeParseRunner } from './worker-parser.js';
import { classifyLanguageForSource } from './language-classifier.js';
import {
  loadExternalSurfaceManifest,
  readExactFile,
  verifyExactFileIdentity,
  type LoadedExternalSurfaceManifest,
  type ResolvedExternalSurfaceFile,
} from './external/external-surface-manifest.js';
import {
  canonicalizeCodeFilePath,
  ScanPathComparisonIndex,
  type ImportReference,
  type StructuralReference,
} from '../../resolution/structural-reference.js';

// ---------------------------------------------------------------------------
// 扫描配置
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** 源码根目录 */
  srcDir: string;
  /** 项目根目录，用于插件加载和解析 .gitignore/.maestroignore */
  projectRoot?: string;
  /** 排除的目录模式 */
  excludeDirs?: string[];
  /** 排除的文件模式 (glob) */
  excludeFiles?: string[];
  /** 是否在缺失时创建 .maestroignore */
  createMaestroIgnore?: boolean;
  /** 允许执行 .workflow/kg/extractors/*.mjs 脚本插件 */
  allowExtractorScripts?: boolean;
  /** 是否包含测试文件 */
  includeTests?: boolean;
  /** 最大文件大小 (bytes) */
  maxFileSize?: number;
  /** 进度回调 */
  onProgress?: (file: string, count: number, total: number) => void;
  /**
   * Orchestrator-owned immutable external snapshot. Standalone extraction
   * prepares the same snapshot itself before scanning.
   */
  externalSurfaceScan?: PreparedExternalSurfaceScan;
  /** Only one srcDir may inject the exact external files. */
  includeExternalSurfaces?: boolean;
  /** Atomic replacement treats every scheduled-file omission as fatal. */
  failOnSkippedFile?: boolean;
}

export interface PreparedExternalSurfaceFile {
  file: ResolvedExternalSurfaceFile;
  sourceCode: string;
  contentDigest: string;
}

export interface PreparedExternalSurfaceScan {
  manifest: LoadedExternalSurfaceManifest;
  files: readonly PreparedExternalSurfaceFile[];
  /** Manifest digest plus exact identity/content snapshot. */
  externalFingerprint: string;
}

/**
 * Captures the exact external bytes before a destructive transaction starts.
 * Extraction reuses these bytes instead of reopening the path, binding the
 * graph snapshot and sync watermark to one immutable input.
 */
export function prepareExternalSurfaceScan(projectRoot: string): PreparedExternalSurfaceScan {
  const canonicalProjectRoot = realpathSync(resolve(projectRoot));
  const manifest = loadExternalSurfaceManifest(canonicalProjectRoot);
  const files = manifest.files.map((file) => {
    const sourceCode = readExactFile(file);
    return Object.freeze({
      file,
      sourceCode,
      contentDigest: createHash('sha256').update(sourceCode).digest('hex'),
    });
  });
  const externalFingerprint = createHash('sha256').update(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    manifestDigest: manifest.digest,
    files: files.map(item => ({
      path: item.file.canonicalPath,
      module: item.file.module,
      language: item.file.language,
      size: item.file.size,
      mtimeMs: item.file.mtimeMs,
      device: item.file.device,
      inode: item.file.inode,
      contentDigest: item.contentDigest,
    })),
  })).digest('hex');
  return Object.freeze({
    manifest,
    files: Object.freeze(files),
    externalFingerprint,
  });
}

const BINARY_EXTENSIONS = new Set([
  '.wasm', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm',
  '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib',
]);

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB, aligned with CodeGraph

// ---------------------------------------------------------------------------
// 文件扫描
// ---------------------------------------------------------------------------

interface ScannedFile {
  path: string;
  language: Language;
  size: number;
  modifiedAt: number;
  contentHash: string;
  externalSurface?: {
    module: string;
    language: 'objc';
    configuredPath: string;
    schemaVersion: string;
    file: ResolvedExternalSurfaceFile;
    sourceCode: string;
    contentDigest: string;
  };
}

/** One canonical identity space shared by traversal, callbacks, reads, and output records. */
interface CodeScanPlan {
  readonly projectRoot: string;
  readonly srcDir: string;
  readonly files: ScannedFile[];
}

function prepareCodeScanPlan(options: ScanOptions): CodeScanPlan {
  const files: ScannedFile[] = [];
  const fileIndexByPath = new Map<string, number>();
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const requestedSrcDir = resolve(options.srcDir);
  const requestedProjectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : resolve(requestedSrcDir, '..');
  const projectRoot = realpathSync(requestedProjectRoot);
  // Resolve/read the fixed allowlist before any ignore traversal or extractor/plugin dispatch.
  const externalScan = options.externalSurfaceScan ?? prepareExternalSurfaceScan(projectRoot);
  const externalManifest = externalScan.manifest;
  const externalByPath = new Map(externalScan.files.map(file => [file.file.canonicalPath, file]));
  const includeExternalSurfaces = options.includeExternalSurfaces ?? true;

  const addScannedFile = (file: ScannedFile, prefer = false): void => {
    const existingIndex = fileIndexByPath.get(file.path);
    if (existingIndex === undefined) {
      fileIndexByPath.set(file.path, files.length);
      files.push(file);
      return;
    }
    if (prefer) files[existingIndex] = file;
  };
  const addExactExternalFile = (prepared: PreparedExternalSurfaceFile): void => {
    const file = prepared.file;
    addScannedFile({
      path: file.canonicalPath,
      language: file.language,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentHash: '',
      externalSurface: {
        module: file.module,
        language: file.language,
        configuredPath: file.configuredPath,
        schemaVersion: externalManifest.schemaVersion,
        file,
        sourceCode: prepared.sourceCode,
        contentDigest: prepared.contentDigest,
      },
    }, true);
  };

  if (!existsSync(requestedSrcDir)) {
    if (options.failOnSkippedFile) {
      throw new Error(`Code source directory became unavailable during scan: ${requestedSrcDir}`);
    }
    if (includeExternalSurfaces) {
      for (const file of externalScan.files) addExactExternalFile(file);
    }
    return { projectRoot, srcDir: requestedSrcDir, files };
  }
  const srcDir = realpathSync(requestedSrcDir);
  const scanRoot = options.projectRoot ? projectRoot : srcDir;
  const scope = buildScanScope({
    projectRoot: scanRoot,
    srcDir,
    excludeDirs: options.excludeDirs,
    excludeFiles: options.excludeFiles,
    createMaestroIgnore: options.createMaestroIgnore,
  });

  function collectFile(fullPath: string): void {
    let identityPath: string;
    let stat;
    try {
      identityPath = canonicalizeCodeFilePath(scanRoot, fullPath);
      stat = statSync(identityPath);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('code-path-outside-project:')) throw err;
      if (options.failOnSkippedFile) {
        throw new Error(`Code scan failed to inspect file: ${fullPath}`, { cause: err });
      }
      return;
    }

    if (!stat.isFile()) return;
    // Exact allowlisted identities are injected only through the immutable
    // external snapshot, never rediscovered by overlapping srcDirs.
    if (externalByPath.has(identityPath)) return;
    if (scope.ignores(identityPath)) return;
    if (stat.size > maxFileSize) return;

    const ext = extname(identityPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return;

    const language = detectLanguageFromPath(identityPath);
    if (language === 'unknown') return;

    if (!options.includeTests && isTestFile(identityPath)) return;

    addScannedFile({
      path: identityPath,
      language,
      size: stat.size,
      modifiedAt: Math.floor(stat.mtimeMs),
      contentHash: '',
    });
  }

  function collectGitVisibleFiles(): boolean {
    const srcRel = relative(scope.projectRoot, srcDir).replace(/\\/g, '/') || '.';
    if (srcRel.startsWith('..')) return false;
    try {
      const insideWorkTree = execFileSync(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        {
          cwd: scope.projectRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 5000,
          windowsHide: true,
        },
      ).trim();
      if (insideWorkTree !== 'true') return false;
    } catch {
      return false;
    }
    try {
      const output = execFileSync(
        'git',
        ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', srcRel],
        {
          cwd: scope.projectRoot,
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 30_000,
          windowsHide: true,
        },
      );
      for (const relPath of output.split('\0').filter(Boolean)) {
        const fullPath = resolve(scope.projectRoot, relPath);
        try {
          statSync(fullPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          if (options.failOnSkippedFile) {
            throw new Error(`Code scan failed to inspect git-visible file: ${fullPath}`, { cause: error });
          }
          continue;
        }
        collectFile(fullPath);
      }
      return true;
    } catch (error) {
      if (options.failOnSkippedFile) {
        throw new Error(`Code scan failed to enumerate git-visible files: ${srcDir}`, { cause: error });
      }
      return false;
    }
  }

  function walkDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      if (options.failOnSkippedFile) {
        throw new Error(`Code scan failed to read directory: ${dir}`, { cause: error });
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch (error) {
        if (options.failOnSkippedFile) {
          throw new Error(`Code scan failed to inspect directory entry: ${fullPath}`, { cause: error });
        }
        continue;
      }

      if (stat.isDirectory()) {
        if (!scope.ignores(fullPath, true)) walkDir(fullPath);
        continue;
      }

      collectFile(fullPath);
    }
  }

  if (!collectGitVisibleFiles()) {
    walkDir(srcDir);
  }
  // Exact entries bypass ignore rules one file at a time. Their parent is never
  // added to srcDirs and no sibling/import target is discovered from here.
  if (includeExternalSurfaces) {
    for (const file of externalScan.files) addExactExternalFile(file);
  }
  return { projectRoot, srcDir, files };
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

export type CodeExtractionResultHandler = (result: ExtractionResult) => void | Promise<void>;

/**
 * 批量代码提取 — 扫描目录 → tree-sitter 解析 → nodes + edges
 *
 * 设计: 逐文件提取, 汇总后返回结果；大仓库写库请使用 forEachCodeExtractionResult()
 * 支持: 自定义提取器 (vue/svelte/liquid/mybatis/dfm) 优先于通用 tree-sitter
 */
export async function extractCode(
  options: ScanOptions,
): Promise<{ results: ExtractionResult[]; stats: CodeExtractionStats }> {
  return runCodeExtraction(options, undefined, true);
}

/**
 * 流式代码提取 — 每个文件提取完成后立即回调，避免在内存中累积全量结果。
 */
export async function forEachCodeExtractionResult(
  options: ScanOptions,
  onResult: CodeExtractionResultHandler,
): Promise<CodeExtractionStats> {
  const { stats } = await runCodeExtraction(options, onResult, false);
  return stats;
}

async function runCodeExtraction(
  options: ScanOptions,
  onResult: CodeExtractionResultHandler | undefined,
  collectResults: boolean,
): Promise<{ results: ExtractionResult[]; stats: CodeExtractionStats }> {
  const startMs = Date.now();
  // Manifest validation and exact-file resolution must happen before plugins are loaded.
  const scanPlan = prepareCodeScanPlan(options);
  const { files: scannedFiles, projectRoot, srcDir: resolvedSrcDir } = scanPlan;
  const engine = getTreeSitterEngine();
  const hasTreeSitter = engine.isAvailable();
  const parser = new CodeParseRunner();

  // 插件引擎
  const pluginEngine = new PluginEngine(projectRoot);
  let hasPlugins = false;
  if (scannedFiles.some(file => !file.externalSurface)) {
    hasPlugins = await pluginEngine.load({ allowScripts: options.allowExtractorScripts });
  }

  const pathComparisonIndex = new ScanPathComparisonIndex(scannedFiles.map(file => file.path));
  const results: ExtractionResult[] = [];
  const errors: Array<{ filePath: string; message: string }> = [];
  let totalNodes = 0;
  let totalEdges = 0;
  let totalRefs = 0;
  let extractedCount = 0;
  let skippedCount = 0;

  const emitResult = async (result: ExtractionResult, referencesCount: number): Promise<void> => {
    if (collectResults) {
      results.push(result);
    }
    await onResult?.(result);
    totalNodes += result.nodes.length;
    totalEdges += result.edges.length;
    totalRefs += referencesCount;
    extractedCount++;
  };

  try {
    for (let i = 0; i < scannedFiles.length; i++) {
      const file = scannedFiles[i];
      options.onProgress?.(file.path, i + 1, scannedFiles.length);

      try {
        if (file.externalSurface) verifyExactFileIdentity(file.externalSurface.file);
        const sourceCode = file.externalSurface
          ? file.externalSurface.sourceCode
          : readFileSync(file.path, 'utf-8');
        const contentDigest = createHash('sha256').update(sourceCode).digest('hex');
        if (file.externalSurface && contentDigest !== file.externalSurface.contentDigest) {
          throw new Error(`exact external surface snapshot digest mismatch: ${file.path}`);
        }
        file.contentHash = contentDigest.substring(0, 16);
        // `.h` 在扫描时只做 provisional route；读取内容后收敛为全管线共用的最终语言。
        file.language = file.externalSurface?.language
          ?? classifyLanguageForSource(file.path, sourceCode, file.language).language;
        const relPath = relative(
          file.externalSurface ? projectRoot : resolvedSrcDir,
          file.path,
        ).replace(/\\/g, '/');

        // 自定义提取器优先 (vue/svelte/liquid/mybatis/dfm)
        const customResult = file.externalSurface
          ? null
          : await extractWithCustomExtractor(
            sourceCode,
            file.path,
            options.failOnSkippedFile ? 'fail' : 'warn',
          );
        if (customResult) {
          const { nodes, edges } = buildResultFromCustomExtractor(
            customResult.symbols, customResult.edges, file,
          );
          applyExternalSurfaceMetadata(nodes, file);
          const normalizedRefs = normalizeExtractionReferences(
            customResult.references,
            customResult.importReferences,
            file,
          );
          const structuralReferences = markStructuralReferencePathCollisions(
            customResult.structuralReferences ?? [],
            pathComparisonIndex,
          );
          await emitResult({
            nodes,
            edges,
            references: normalizedRefs,
            fileRecord: createFileRecord(file, nodes.length, customResult.diagnostics ?? []),
            structuralReferences,
          }, normalizedRefs.length + structuralReferences.length);
          continue;
        }

        // file-level-only 语言 (yaml/twig/properties)
        if (isFileLevelOnlyLanguage(file.language)) {
          const fileNode = createFileLevelNode(file, relPath);
          await emitResult({
            nodes: [fileNode],
            edges: [],
            references: [],
            fileRecord: createFileRecord(file, 1),
            structuralReferences: [],
          }, 0);
          continue;
        }

        // tree-sitter 通用提取
        if (!hasTreeSitter) {
          if (file.externalSurface || options.failOnSkippedFile) {
            throw new Error(`${file.externalSurface ? 'exact external surface' : 'scheduled file'} requires an available tree-sitter engine`);
          }
          skippedCount++;
          continue;
        }

        const extractor = getExtractor(file.language);
        if (!extractor) {
          if (file.externalSurface || options.failOnSkippedFile) {
            throw new Error(`${file.externalSurface ? 'exact external surface' : 'scheduled file'} has no ${file.language} extractor`);
          }
          skippedCount++;
          continue;
        }

        let extracted: LanguageExtractionResult | null = null;
        const fileMatchesPlugin = !file.externalSurface
          && hasPlugins
          && pluginEngine.hasMatchingPlugin(file.path, file.language);
        if (fileMatchesPlugin) {
          const tree = await engine.parse(sourceCode, file.language);
          if (tree) {
            try {
              extracted = extractor.extract(tree, sourceCode, file.path);
              // PluginEngine 自身执行 onError 策略；fail 必须交给外层的逐文件失败处理。
              const pluginResult = await pluginEngine.run(file.path, sourceCode, file.language, tree, extracted);
              if (pluginResult.symbols.length > 0 || (pluginResult.references?.length ?? 0) > 0 || (pluginResult.edges?.length ?? 0) > 0) {
                extracted = pluginEngine.mergeResults(extracted, pluginResult);
              }
            } finally {
              tree.delete();
            }
          }
        } else {
          extracted = await parser.extract(sourceCode, file.language, file.path);
        }

        if (!extracted) {
          if (file.externalSurface || options.failOnSkippedFile) {
            throw new Error(`${file.externalSurface ? 'exact external surface' : 'scheduled file'} tree-sitter parse failed`);
          }
          errors.push({ filePath: file.path, message: 'tree-sitter parse failed' });
          skippedCount++;
          continue;
        }

        const { nodes, edges, references: normalizedRefs } = buildResultFromTreeSitter(extracted, file);
        applyExternalSurfaceMetadata(nodes, file);

        const structuralReferences = markStructuralReferencePathCollisions(
          extracted.structuralReferences ?? [],
          pathComparisonIndex,
        );
        await emitResult({
          nodes,
          edges,
          references: normalizedRefs,
          fileRecord: createFileRecord(file, nodes.length, extracted.diagnostics ?? []),
          structuralReferences,
        }, normalizedRefs.length + structuralReferences.length);

      } catch (err) {
        if (file.externalSurface || options.failOnSkippedFile) throw err;
        errors.push({
          filePath: file.path,
          message: err instanceof Error ? err.message : String(err),
        });
        skippedCount++;
      }
    }
  } finally {
    parser.dispose();
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
  onEmbeddedParseError: 'warn' | 'fail',
): Promise<LanguageExtractionResult | null> {
  const ext = extname(filePath).toLowerCase();

  // Vue SFC
  if (ext === '.vue') {
    return extractVueSFC(source, filePath, onEmbeddedParseError);
  }

  // Svelte
  if (ext === '.svelte') {
    return extractSvelte(source, filePath, onEmbeddedParseError);
  }

  // Liquid
  if (ext === '.liquid') {
    return extractLiquid(source, filePath);
  }

  // MyBatis XML mapper (检测是否包含 <mapper> 标签)
  if (ext === '.xml' && source.includes('<mapper')) {
    return extractMybatisXml(source, filePath);
  }

  // Delphi DFM/FMX
  if (ext === '.dfm' || ext === '.fmx') {
    return extractDfm(source, filePath);
  }

  return null;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function buildResultFromCustomExtractor(
  symbols: ExtractedSymbol[],
  rawEdges: Array<{ source: string; target: string; kind: string }>,
  file: ScannedFile,
): { nodes: UnifiedNode[]; edges: UnifiedEdge[] } {
  const now = Date.now();
  const nodes: UnifiedNode[] = symbols.map(s => symbolToNode(s, now));
  const edges: UnifiedEdge[] = rawEdges.map(e => ({
    source: e.source,
    target: e.target,
    kind: e.kind as UnifiedEdge['kind'],
    provenance: 'tree-sitter' as UnifiedEdge['provenance'],
  }));
  // 自定义提取器 (vue/svelte/liquid) 也必须建 file 节点 —
  // 否则引用锚点 (makeFileNodeId) 无对应节点, unresolved_refs FK 插入失败,
  // 所有 calls/imports 引用被逐文件静默丢弃 (曾致 vue/svelte script 内引用全丢)
  nodes.push(createFileNode(file));
  return { nodes, edges };
}

function buildResultFromTreeSitter(
  extracted: LanguageExtractionResult,
  file: ScannedFile,
): { nodes: UnifiedNode[]; edges: UnifiedEdge[]; references: ExtractedReference[] } {
  const now = Date.now();
  const nodes: UnifiedNode[] = extracted.symbols.map(s => {
    const node = symbolToNode(s, now);
    const pSym = s as PluginExtractedSymbol;
    if (pSym.pluginMetadata) {
      node.metadata = { ...node.metadata, plugin: pSym.pluginMetadata };
    }
    return node;
  });

  // 统一引用锚点 — 旧格式 fromSymbolId (\`\${filePath}:<module>\` / \`\${filePath}:\${parent}\`) 不是合法节点 ID,
  // unresolved_refs 有 FK → nodes, 非 code: 前缀的锚点全部改为 file 节点 ID (code:...:<file>)
  const fileNodeId = makeFileNodeId(file.path);
  const normalizedRefs = normalizeExtractionReferences(
    extracted.references,
    extracted.importReferences,
    file,
  );

  const edges: UnifiedEdge[] = [];
  for (const e of extracted.edges) {
    if (e.source.startsWith('code:')) {
      edges.push({
        source: e.source,
        target: e.target,
        kind: e.kind as UnifiedEdge['kind'],
        line: e.line,
        column: e.col,
        provenance: 'tree-sitter' as UnifiedEdge['provenance'],
      });
    } else if (e.kind === 'contains') {
      // 裸名 contains (父级符号未用节点 ID) → 转当前文件节点 ID
      edges.push({
        source: makeCodeNodeId(file.path, e.source),
        target: makeCodeNodeId(file.path, e.target),
        kind: 'contains',
        line: e.line,
        provenance: 'tree-sitter' as UnifiedEdge['provenance'],
      });
    } else if (e.kind === 'extends' || e.kind === 'implements') {
      // java/rust/cpp 继承边端点用裸名 (跨文件无法本地解析) → 转 extends/implements 引用,
      // 由 code-resolution 阶段按名匹配库内符号 (匹配不到则自然过滤)
      normalizedRefs.push({
        fromSymbolName: '<file>',
        fromSymbolId: fileNodeId,
        referenceName: e.target,
        referenceKind: e.kind,
        line: e.line ?? 0,
        col: e.col ?? 0,
        filePath: file.path,
        language: file.language,
      });
    }
  }

  // 为每个文件创建 file 节点 — 作为 imports 边的锚点与 contains 层级根
  // (id 用绝对路径 makeFileNodeId(file.path), 与符号节点 filePath 命名空间一致)
  const fileNode = createFileNode(file);
  nodes.push(fileNode);

  // file → 顶层符号 contains 边
  for (const s of extracted.symbols) {
    if (!s.qualifiedName.includes('.')) {
      edges.push({
        source: fileNodeId,
        target: makeCodeNodeId(s.filePath, s.qualifiedName),
        kind: 'contains',
        line: s.startLine,
        provenance: 'tree-sitter',
      });
    }
  }

  // 通用 contains 边 — 按 qualifiedName 层级推导 (覆盖所有语言),
  // 与提取器手动产出的 contains 边去重 (保留先出现的带 line 版本)
  const containsByKey = new Map<string, UnifiedEdge>();
  for (const e of edges) {
    if (e.kind === 'contains') containsByKey.set(`${e.source}\u0000${e.target}`, e);
  }
  for (const s of extracted.symbols) {
    const parts = s.qualifiedName.split('.');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('.');
      const child = parts.slice(0, i + 1).join('.');
      const src = makeCodeNodeId(s.filePath, parent);
      const tgt = makeCodeNodeId(s.filePath, child);
      const key = `${src}\u0000${tgt}`;
      if (!containsByKey.has(key)) {
        const e: UnifiedEdge = { source: src, target: tgt, kind: 'contains', provenance: 'tree-sitter' };
        containsByKey.set(key, e);
        edges.push(e);
      }
    }
  }

  if (isGeneratedFile(file.path)) {
    for (const node of nodes) {
      node.metadata = { ...node.metadata, generated: true };
    }
  }

  return { nodes, edges, references: normalizedRefs };
}

// 统一引用锚点 — 所有语言提取器的 fromSymbolId 若非合法节点 ID (code: 前缀)
// 一律改写为 file 节点 ID, 保证 unresolved_refs FK 与 code-resolution JOIN 可用
function normalizeReferenceAnchors(
  refs: readonly ExtractedReference[],
  file: Pick<ScannedFile, 'path' | 'language'>,
): ExtractedReference[] {
  const fileNodeId = makeFileNodeId(file.path);
  return refs.map(ref => ({
    ...ref,
    fromSymbolId: ref.fromSymbolId.startsWith('code:') ? ref.fromSymbolId : fileNodeId,
    filePath: file.path,
  }));
}

/**
 * Converts strict import facts into the public generic reference contract and
 * de-duplicates them against extractor/plugin references before persistence.
 */
function normalizeExtractionReferences(
  references: readonly ExtractedReference[],
  importReferences: readonly ImportReference[] | undefined,
  file: ScannedFile,
): ExtractedReference[] {
  const normalized = normalizeReferenceAnchors(references, file);
  const fileNodeId = makeFileNodeId(file.path);
  for (const reference of normalizeImportReferences(importReferences ?? [], file.path)) {
    normalized.push({
      fromSymbolName: '<file>',
      fromSymbolId: fileNodeId,
      referenceName: reference.rawTarget,
      referenceKind: 'imports',
      line: reference.line,
      col: reference.column,
      filePath: file.path,
      language: file.language,
    });
  }

  const seen = new Set<string>();
  return normalized.filter((reference) => {
    const key = [
      reference.fromSymbolId,
      reference.referenceKind,
      reference.referenceName,
      reference.line,
      reference.col,
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 创建 file 节点 (与符号节点共享 code: 命名空间, id = code:<abs-path>:<file>)
function createFileNode(file: ScannedFile): UnifiedNode {
  return {
    id: makeFileNodeId(file.path),
    kind: 'file',
    name: file.path.split(/[\\/]/).pop() ?? file.path,
    qualifiedName: file.path.replace(/\\/g, '/'),
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

function createFileLevelNode(file: ScannedFile, relPath: string): UnifiedNode {
  // id 用绝对路径命名空间 (与符号节点 filePath 一致), 保证 imports/contains 边可 JOIN
  return {
    id: makeFileNodeId(file.path),
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

function applyExternalSurfaceMetadata(nodes: UnifiedNode[], file: ScannedFile): void {
  if (!file.externalSurface) return;
  const generatedSwiftHeader = /-Swift\.h$/.test(basename(file.path));
  const externalSurfaceCanonical = /(?:^|\/)ios-arm64(?:\/|$)/.test(
    file.externalSurface.configuredPath.replace(/\\/g, '/'),
  );
  for (const node of nodes) {
    node.metadata = {
      ...node.metadata,
      externalSurface: true,
      externalSurfaceSchemaVersion: file.externalSurface.schemaVersion,
      externalSurfacePath: file.externalSurface.configuredPath,
      module: file.externalSurface.module,
      language: file.externalSurface.language,
      ...(generatedSwiftHeader ? { generatedSwiftHeader: true } : {}),
      ...(externalSurfaceCanonical ? { externalSurfaceCanonical: true } : {}),
    };
  }
}

export function normalizeImportReferences(
  references: readonly unknown[],
  identityFilePath: string,
): ImportReference[] {
  const normalized: ImportReference[] = [];
  for (const value of references) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const reference = value as Record<string, unknown>;
    if (
      reference.kind === 'import'
      && typeof reference.rawTarget === 'string'
      && reference.rawTarget.trim() !== ''
      && typeof reference.importKind === 'string'
      && Number.isInteger(reference.line)
      && Number(reference.line) > 0
      && Number.isInteger(reference.column)
      && Number(reference.column) > 0
    ) {
      normalized.push({
        kind: 'import',
        originFilePath: identityFilePath,
        importKind: reference.importKind,
        rawTarget: reference.rawTarget,
        line: Number(reference.line),
        column: Number(reference.column),
      });
      continue;
    }
    // Backward-compatible script-plugin adapter for pre-v5 import payloads.
    if (
      reference.referenceKind === 'imports'
      && typeof reference.referenceName === 'string'
      && reference.referenceName.trim() !== ''
      && Number.isInteger(reference.line)
      && Number(reference.line) > 0
      && Number.isInteger(reference.col)
      && Number(reference.col) > 0
    ) {
      normalized.push({
        kind: 'import',
        originFilePath: identityFilePath,
        importKind: 'module',
        rawTarget: reference.referenceName,
        line: Number(reference.line),
        column: Number(reference.col),
      });
    }
  }
  return normalized;
}

export function markStructuralReferencePathCollisions(
  references: StructuralReference[],
  pathComparisonIndex: ScanPathComparisonIndex,
): StructuralReference[] {
  return references.map((reference) => {
    const paths = [reference.origin.filePath, ...reference.targetFileHints];
    const hasCollision = paths.some(path => !pathComparisonIndex.get(path).ok);
    return hasCollision ? { ...reference, status: 'ambiguous' } : reference;
  });
}

function createFileRecord(file: ScannedFile, nodeCount: number, errors: string[] = []): FileRecord {
  return {
    path: file.path,
    contentHash: file.contentHash,
    language: file.language,
    size: file.size,
    modifiedAt: file.modifiedAt,
    indexedAt: Date.now(),
    nodeCount,
    errors,
    sourceType: 'codegraph' as SourceType,
  };
}
