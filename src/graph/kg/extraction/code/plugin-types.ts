// src/graph/kg/extraction/code/plugin-types.ts
// MaestroGraph extractor plugin system types
// Supports declarative (YAML rules) and script (.mjs) modes

import type { Language } from '../../db/types.js';
import type { ExtractedSymbol, ExtractedReference } from './tree-sitter-types.js';

// ---------------------------------------------------------------------------
// Plugin config (loaded from .workflow/kg/extractors.yaml)
// ---------------------------------------------------------------------------

export interface ExtractorPluginConfig {
  version: 1;
  defaults?: PluginDefaults;
  plugins: PluginDefinition[];
}

export interface PluginDefaults {
  timeoutMs?: number;        // default 200
  onError?: 'warn' | 'fail'; // default 'warn'
  conflictPolicy?: ConflictPolicy; // default 'merge-metadata'
}

export type ConflictPolicy = 'core-wins' | 'plugin-wins' | 'merge-metadata';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export interface PluginDefinition {
  id: string;
  description?: string;
  enabled?: boolean;           // default true
  languages: (Language | 'all')[];
  filePatterns?: string[];
  excludePatterns?: string[];
  priority?: number;           // default 100, lower = higher priority
  mode: 'declarative' | 'script';
  declarative?: DeclarativeSpec;
  script?: ScriptSpec;
}

// ---------------------------------------------------------------------------
// Declarative mode — YAML-based pattern rules
// ---------------------------------------------------------------------------

export interface DeclarativeSpec {
  rules: PatternRule[];
}

export interface PatternRule {
  id: string;
  description?: string;
  match: PatternMatch;
  extract: ExtractSpec;
}

export type PatternMatchType = 'call' | 'assignment' | 'regex';
export type PatternScope = 'module' | 'class' | 'any';

export interface PatternMatch {
  type: PatternMatchType;
  // For 'call': function call pattern e.g. "builder.define_constant($NAME, $_)"
  // For 'assignment': assignment pattern e.g. "$NAME = $_"
  // For 'regex': regex pattern applied to source lines
  pattern: string;
  nameRegex?: string;          // optional regex constraint on captured $NAME
  scope?: PatternScope;        // default 'any'
}

export interface ExtractSpec {
  kind: string;                // maps to ExtractedSymbol.kind, must be valid CodeNodeKind
  name?: string;               // template: "$NAME", "$1", etc.
  qualifiedName?: string;      // template, defaults to name
  signature?: string;
  visibility?: string;         // default 'public'
  isExported?: boolean;        // default false
  isStatic?: boolean;
  decorators?: string[];
  metadata?: Record<string, string | boolean | number>;
}

// ---------------------------------------------------------------------------
// Script mode — .mjs plugin modules
// ---------------------------------------------------------------------------

export interface ScriptSpec {
  module: string;              // relative path to .mjs file
  export?: string;             // export name, default 'extract'
  timeoutMs?: number;          // override default timeout
}

// ---------------------------------------------------------------------------
// Plugin extraction result (output from both declarative and script plugins)
// ---------------------------------------------------------------------------

export interface PluginExtractionResult {
  symbols: PluginExtractedSymbol[];
  references?: ExtractedReference[];
  edges?: Array<{
    source: string;
    target: string;
    kind: string;
    line?: number;
    col?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Extended symbol with plugin provenance
// ---------------------------------------------------------------------------

export interface PluginExtractedSymbol extends ExtractedSymbol {
  pluginMetadata?: Record<string, unknown>;
  sourcePluginId?: string;
  sourceRuleId?: string;
}

// ---------------------------------------------------------------------------
// Context passed to script plugins
// ---------------------------------------------------------------------------

export interface PluginContext {
  filePath: string;
  language: Language;
  sourceCode: string;
  tree: unknown;               // raw tree-sitter tree (only if permissions.rawTree)
  findAll(nodeType: string): AstNodeView[];
  text(startLine: number, endLine: number): string;
  makeSymbol(input: Partial<PluginExtractedSymbol>): PluginExtractedSymbol;
}

export interface AstNodeView {
  type: string;
  text: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  children: AstNodeView[];
  namedChildren: AstNodeView[];
  childForFieldName(name: string): AstNodeView | null;
}
