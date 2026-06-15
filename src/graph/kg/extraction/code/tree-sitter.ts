// src/graph/kg/extraction/code/tree-sitter.ts
// tree-sitter WASM 解析核心 — 直接加载 web-tree-sitter + tree-sitter-wasms
// 参考: codegraph/src/extraction/grammars.ts + tree-sitter.ts

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ensureWasmStability, ParserResetCounter } from './wasm-stability.js';
import type { Language } from '../../db/types.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// tree-sitter 类型 (web-tree-sitter)
// ---------------------------------------------------------------------------

interface TreeSitterLanguage {
  nodeTypes: unknown[];
}

interface TreeSitterParser {
  setLanguage(language: TreeSitterLanguage): void;
  parse(input: string | Uint8Array, oldTree?: unknown): TreeSitterTree;
  delete(): void;
  getLanguage(): TreeSitterLanguage | null;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
  delete(): void;
}

interface TreeSitterNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  text: string;
  childCount: number;
  childFieldName(i: number): string | null;
  child(i: number): TreeSitterNode | null;
  children: TreeSitterNode[];
  parent: TreeSitterNode | null;
  namedChildren: TreeSitterNode[];
}

interface TreeSitterModule {
  Language: {
    load(path: string): Promise<TreeSitterLanguage>;
  };
  Parser: (new () => TreeSitterParser) & {
    init(): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Language → WASM grammar 文件名映射 (对齐 codegraph grammars.ts)
// ---------------------------------------------------------------------------

type GrammarLanguage = Exclude<Language, 'svelte' | 'vue' | 'liquid' | 'yaml' | 'twig' | 'xml' | 'properties' | 'unknown'>;

const WASM_GRAMMAR_FILES: Record<GrammarLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  php: 'tree-sitter-php.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  swift: 'tree-sitter-swift.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  dart: 'tree-sitter-dart.wasm',
  pascal: 'tree-sitter-pascal.wasm',
  scala: 'tree-sitter-scala.wasm',
  lua: 'tree-sitter-lua.wasm',
  luau: 'tree-sitter-luau.wasm',
  objc: 'tree-sitter-objc.wasm',
};

// 自定义 WASM — ABI 版本不兼容 tree-sitter-wasms 的语言
const VENDORED_WASM_LANGUAGES = new Set<string>(['pascal', 'scala', 'lua', 'luau']);

export const LANGUAGE_TO_GRAMMAR: Record<Language, string> = {
  typescript: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  tsx: 'tree-sitter-typescript',
  jsx: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c-sharp',
  php: 'tree-sitter-php',
  ruby: 'tree-sitter-ruby',
  swift: 'tree-sitter-swift',
  kotlin: 'tree-sitter-kotlin',
  dart: 'tree-sitter-dart',
  svelte: 'tree-sitter-svelte',
  vue: 'tree-sitter-vue',
  liquid: 'tree-sitter-liquid',
  pascal: 'tree-sitter-pascal',
  scala: 'tree-sitter-scala',
  lua: 'tree-sitter-lua',
  luau: 'tree-sitter-luau',
  objc: 'tree-sitter-objc',
  yaml: 'tree-sitter-yaml',
  twig: 'tree-sitter-twig',
  xml: 'tree-sitter-xml',
  properties: 'tree-sitter-properties',
  unknown: '',
};

// ---------------------------------------------------------------------------
// TreeSitterEngine — 单例, 管理解析器池 + grammar 缓存
// ---------------------------------------------------------------------------

export class TreeSitterEngine {
  private static _instance: TreeSitterEngine | null = null;
  private _module: TreeSitterModule | null = null;
  private _grammarCache: Map<string, TreeSitterLanguage> = new Map();
  private _unavailableGrammars: Map<string, string> = new Map();
  private _parserPool: TreeSitterParser[] = [];
  private _resetCounter: ParserResetCounter;
  private _available: boolean | null = null;
  private _initPromise: Promise<void> | null = null;
  private _parserInitialized = false;

  private constructor() {
    this._resetCounter = new ParserResetCounter();
  }

  static getInstance(): TreeSitterEngine {
    if (!TreeSitterEngine._instance) {
      TreeSitterEngine._instance = new TreeSitterEngine();
    }
    return TreeSitterEngine._instance;
  }

  isAvailable(): boolean {
    if (this._available !== null) return this._available;
    this._available = this.tryLoadModule();
    return this._available;
  }

  private tryLoadModule(): boolean {
    try {
      const ts = require('web-tree-sitter');
      this._module = ts as TreeSitterModule;
      return true;
    } catch { /* web-tree-sitter not installed */ }

    return false;
  }

  async ensureInitialized(): Promise<void> {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._init();
    return this._initPromise;
  }

  private async _init(): Promise<void> {
    ensureWasmStability();
    if (!this.isAvailable() || !this._module) {
      throw new Error('web-tree-sitter not available. Run: npm install web-tree-sitter tree-sitter-wasms');
    }
    if (!this._parserInitialized) {
      // web-tree-sitter 0.25: Parser.init() 初始化 WASM 运行时
      await this._module.Parser.init();
      this._parserInitialized = true;
    }
  }

  async loadGrammar(language: Language): Promise<TreeSitterLanguage | null> {
    await this.ensureInitialized();
    if (!this._module) return null;

    const wasmFile = WASM_GRAMMAR_FILES[language as GrammarLanguage];
    if (!wasmFile) return null;

    if (this._grammarCache.has(wasmFile)) {
      return this._grammarCache.get(wasmFile)!;
    }
    if (this._unavailableGrammars.has(wasmFile)) return null;

    try {
      const wasmPath = this.resolveGrammarPath(language as GrammarLanguage, wasmFile);
      if (!wasmPath) {
        this._unavailableGrammars.set(wasmFile, 'WASM file not found');
        return null;
      }
      const grammar = await this._module.Language.load(wasmPath);
      this._grammarCache.set(wasmFile, grammar);
      return grammar;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._unavailableGrammars.set(wasmFile, msg);
      if (process.env.DEBUG) {
        console.warn(`[MaestroGraph] Failed to load grammar ${wasmFile}: ${msg}`);
      }
      return null;
    }
  }

  async parse(
    sourceCode: string,
    language: Language,
  ): Promise<TreeSitterTree | null> {
    await this.ensureInitialized();
    if (!this._module) return null;

    const grammar = await this.loadGrammar(language);
    if (!grammar) return null;

    let parser = this._parserPool.pop() ?? new this._module.Parser();
    parser.setLanguage(grammar);

    if (this._resetCounter.tickAndCheckReset()) {
      parser.delete();
      parser = new this._module.Parser();
      parser.setLanguage(grammar);
    }

    try {
      const tree = parser.parse(sourceCode);
      this._parserPool.push(parser);
      return tree;
    } catch (err) {
      parser.delete();
      if (process.env.DEBUG) {
        console.warn(`[MaestroGraph] Parse error (${language}):`, err);
      }
      return null;
    }
  }

  private resolveGrammarPath(language: GrammarLanguage, wasmFile: string): string | null {
    // 自定义 WASM — 从本地 wasm/ 目录加载
    if (VENDORED_WASM_LANGUAGES.has(language)) {
      const vendoredPath = join(__dirname, 'wasm', wasmFile);
      if (existsSync(vendoredPath)) return vendoredPath;
    }

    // 标准 grammar — 从 tree-sitter-wasms 包加载
    try {
      return require.resolve(`tree-sitter-wasms/out/${wasmFile}`);
    } catch { /* not found */ }

    // 回退: 本地 wasm/ 目录
    const localPath = join(__dirname, 'wasm', wasmFile);
    if (existsSync(localPath)) return localPath;

    return null;
  }

  dispose(): void {
    for (const parser of this._parserPool) {
      try { parser.delete(); } catch { /* ignore */ }
    }
    this._parserPool = [];
    this._grammarCache.clear();
    this._unavailableGrammars.clear();
  }
}

// ---------------------------------------------------------------------------
// 便捷函数
// ---------------------------------------------------------------------------

export function getTreeSitterEngine(): TreeSitterEngine {
  return TreeSitterEngine.getInstance();
}

export function isTreeSitterAvailable(): boolean {
  return TreeSitterEngine.getInstance().isAvailable();
}
