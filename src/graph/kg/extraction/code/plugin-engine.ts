// src/graph/kg/extraction/code/plugin-engine.ts
// PluginEngine — load extractors.yaml, run declarative + script plugins, merge results

import { resolve, dirname, relative, extname } from 'node:path';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Language } from '../../db/types.js';
import type { ExtractedSymbol, ExtractedReference, LanguageExtractionResult } from './tree-sitter-types.js';
import type {
  ExtractorPluginConfig,
  PluginDefinition,
  PatternRule,
  PluginExtractionResult,
  PluginExtractedSymbol,
  PluginContext,
  AstNodeView,
  ConflictPolicy,
} from './plugin-types.js';

// ---------------------------------------------------------------------------
// PluginEngine
// ---------------------------------------------------------------------------

export class PluginEngine {
  private config: ExtractorPluginConfig | null = null;
  private configPath: string;
  private scriptDir: string;
  private configMtime: number = 0;
  private scriptModules: Map<string, { extract: (ctx: PluginContext) => PluginExtractionResult | Promise<PluginExtractionResult> }> = new Map();

  constructor(private projectRoot: string) {
    this.configPath = resolve(projectRoot, '.workflow', 'kg', 'extractors.yaml');
    this.scriptDir = resolve(projectRoot, '.workflow', 'kg', 'extractors');
  }

  // ── Loading ────────────────────────────────────────────────────────

  async load(): Promise<boolean> {
    const hasConfig = existsSync(this.configPath);
    const hasScripts = existsSync(this.scriptDir);
    if (!hasConfig && !hasScripts) return false;

    if (hasConfig) {
      const stat = statSync(this.configPath);
      if (stat.mtimeMs !== this.configMtime) {
        this.config = this.parseConfig(readFileSync(this.configPath, 'utf-8'));
        this.configMtime = stat.mtimeMs;
      }
    }

    if (hasScripts) {
      await this.loadScriptPlugins();
    }

    return this.config !== null || this.scriptModules.size > 0;
  }

  private parseConfig(raw: string): ExtractorPluginConfig | null {
    try {
      // Simple YAML-subset parser: support version, defaults, plugins array
      // For full YAML we'd use a library; here we parse the JSON-compatible subset
      // Users can write YAML or JSON — try JSON first, then basic YAML
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = this.parseSimpleYaml(raw);
      }

      const config = parsed as ExtractorPluginConfig;
      if (!config || config.version !== 1 || !Array.isArray(config.plugins)) {
        return null;
      }
      // Validate plugins
      config.plugins = config.plugins.filter(p => {
        if (!p.id || !p.mode || !Array.isArray(p.languages)) return false;
        if (p.enabled === false) return false;
        if (p.mode === 'declarative' && !p.declarative?.rules?.length) return false;
        if (p.mode === 'script' && !p.script?.module) return false;
        return true;
      });

      return config;
    } catch {
      return null;
    }
  }

  private parseSimpleYaml(raw: string): unknown {
    // Minimal YAML → JSON conversion for the extractors config format
    // Handles: key: value, arrays with -, nested objects via indentation, quoted strings
    // Not a full YAML parser — covers the extractors.yaml structure
    const lines = raw.split('\n');
    const result: Record<string, unknown> = {};
    const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];
    let currentArray: unknown[] | null = null;
    let currentArrayKey = '';
    let currentArrayIndent = -1;

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      // Array item
      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim();
        if (currentArray && indent >= currentArrayIndent) {
          if (value.includes(':')) {
            const item: Record<string, unknown> = {};
            this.parseInlineKeyValues(value, item);
            currentArray.push(item);
          } else {
            currentArray.push(this.parseValue(value));
          }
        }
        continue;
      }

      // Key: value
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();

        // Pop stack to find parent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        const parent = stack[stack.length - 1].obj;

        if (val === '' || val === '|') {
          // Nested object or block
          const child: Record<string, unknown> = {};
          parent[key] = child;
          stack.push({ obj: child, indent });
          currentArray = null;
        } else if (val.startsWith('[') && val.endsWith(']')) {
          // Inline array
          parent[key] = val.slice(1, -1).split(',').map(s => this.parseValue(s.trim()));
          currentArray = null;
        } else {
          parent[key] = this.parseValue(val);
          currentArray = null;
        }

        // Check if next lines are array items for this key
        if (val === '') {
          currentArrayKey = key;
          currentArrayIndent = indent + 2;
          const arr: unknown[] = [];
          parent[key] = arr;
          currentArray = arr;
        }
      }
    }

    return result;
  }

  private parseInlineKeyValues(text: string, target: Record<string, unknown>): void {
    const parts = text.split(/\s*,\s*/);
    for (const part of parts) {
      const ci = part.indexOf(':');
      if (ci > 0) {
        target[part.slice(0, ci).trim()] = this.parseValue(part.slice(ci + 1).trim());
      }
    }
  }

  private parseValue(val: string): string | number | boolean {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return '' as unknown as string;
    if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
    return val.replace(/^["']|["']$/g, '');
  }

  private async loadScriptPlugins(): Promise<void> {
    if (!existsSync(this.scriptDir)) return;
    const files = readdirSync(this.scriptDir).filter(f => f.endsWith('.mjs'));
    for (const file of files) {
      if (this.scriptModules.has(file)) continue;
      try {
        const fullPath = resolve(this.scriptDir, file);
        const mod = await import(pathToFileURL(fullPath).href);
        if (typeof mod.extract === 'function') {
          this.scriptModules.set(file, mod);
        }
      } catch { /* skip invalid scripts */ }
    }
  }

  // ── Execution ──────────────────────────────────────────────────────

  async run(
    filePath: string,
    sourceCode: string,
    language: Language,
    tree: unknown,
    coreResult: LanguageExtractionResult,
  ): Promise<PluginExtractionResult> {
    const allSymbols: PluginExtractedSymbol[] = [];
    const allRefs: ExtractedReference[] = [];
    const allEdges: PluginExtractionResult['edges'] = [];

    // Run declarative plugins
    if (this.config?.plugins) {
      for (const plugin of this.config.plugins) {
        if (plugin.mode !== 'declarative' || !plugin.declarative) continue;
        if (!this.matchesLanguage(plugin, language)) continue;
        if (!this.matchesFile(plugin, filePath)) continue;

        try {
          const result = this.runDeclarative(plugin, filePath, sourceCode, language, tree);
          allSymbols.push(...result.symbols);
          if (result.references) allRefs.push(...result.references);
          if (result.edges) allEdges.push(...result.edges);
        } catch {
          if (this.getOnError() === 'fail') throw new Error(`Plugin ${plugin.id} failed`);
        }
      }
    }

    // Run script plugins
    if (this.config?.plugins) {
      for (const plugin of this.config.plugins) {
        if (plugin.mode !== 'script' || !plugin.script) continue;
        if (!this.matchesLanguage(plugin, language)) continue;
        if (!this.matchesFile(plugin, filePath)) continue;

        const moduleName = plugin.script.module;
        const mod = this.scriptModules.get(moduleName);
        if (!mod) continue;

        try {
          const ctx = this.createPluginContext(filePath, sourceCode, language, tree);
          const exportName = plugin.script.export ?? 'extract';
          const fn = (mod as Record<string, unknown>)[exportName];
          if (typeof fn !== 'function') continue;
          const result = await fn(ctx);
          if (result?.symbols) {
            for (const sym of result.symbols) {
              sym.sourcePluginId = sym.sourcePluginId ?? plugin.id;
              allSymbols.push(sym);
            }
          }
          if (result?.references) allRefs.push(...result.references);
          if (result?.edges) allEdges.push(...result.edges);
        } catch {
          if (this.getOnError() === 'fail') throw new Error(`Script plugin ${plugin.id} failed`);
        }
      }
    }

    // Also run standalone script plugins (files in extractors/ not referenced in config)
    for (const [fileName, mod] of this.scriptModules) {
      const isReferenced = this.config?.plugins?.some(
        p => p.mode === 'script' && p.script?.module === fileName
      );
      if (isReferenced) continue;

      try {
        const ctx = this.createPluginContext(filePath, sourceCode, language, tree);
        const result = await mod.extract(ctx);
        if (result?.symbols) {
          for (const sym of result.symbols) {
            sym.sourcePluginId = sym.sourcePluginId ?? `script:${fileName}`;
            allSymbols.push(sym);
          }
        }
        if (result?.references) allRefs.push(...result.references);
        if (result?.edges) allEdges.push(...result.edges);
      } catch { /* skip */ }
    }

    return { symbols: allSymbols, references: allRefs, edges: allEdges };
  }

  // ── Declarative Runner ─────────────────────────────────────────────

  private runDeclarative(
    plugin: PluginDefinition,
    filePath: string,
    sourceCode: string,
    language: Language,
    tree: unknown,
  ): PluginExtractionResult {
    const symbols: PluginExtractedSymbol[] = [];

    for (const rule of plugin.declarative!.rules) {
      try {
        const matched = this.matchPattern(rule, sourceCode, filePath, language, tree);
        symbols.push(...matched);
      } catch { /* skip failed rules */ }
    }

    return { symbols };
  }

  private matchPattern(
    rule: PatternRule,
    sourceCode: string,
    filePath: string,
    language: Language,
    _tree: unknown,
  ): PluginExtractedSymbol[] {
    const { match, extract } = rule;
    const symbols: PluginExtractedSymbol[] = [];

    if (match.type === 'regex') {
      return this.matchRegex(rule, sourceCode, filePath, language);
    }

    if (match.type === 'call') {
      return this.matchCall(rule, sourceCode, filePath, language);
    }

    if (match.type === 'assignment') {
      return this.matchAssignment(rule, sourceCode, filePath, language);
    }

    return symbols;
  }

  private matchRegex(
    rule: PatternRule,
    sourceCode: string,
    filePath: string,
    language: Language,
  ): PluginExtractedSymbol[] {
    const symbols: PluginExtractedSymbol[] = [];
    const regex = new RegExp(rule.match.pattern, 'gm');
    const nameRegex = rule.match.nameRegex ? new RegExp(rule.match.nameRegex) : null;
    const lines = sourceCode.split('\n');

    let match;
    while ((match = regex.exec(sourceCode)) !== null) {
      const name = this.resolveTemplate(rule.extract.name ?? '$1', match);
      if (!name) continue;
      if (nameRegex && !nameRegex.test(name)) continue;

      const lineNum = sourceCode.slice(0, match.index).split('\n').length;
      symbols.push(this.buildSymbol(rule, name, filePath, language, lineNum, lines[lineNum - 1] ?? ''));
    }

    return symbols;
  }

  private matchCall(
    rule: PatternRule,
    sourceCode: string,
    filePath: string,
    language: Language,
  ): PluginExtractedSymbol[] {
    const symbols: PluginExtractedSymbol[] = [];
    // Parse call pattern: "builder.define_constant($NAME, $_)" → extract function name and arg positions
    const callPattern = rule.match.pattern;
    const funcMatch = callPattern.match(/^([A-Za-z_.$]+)\s*\(/);
    if (!funcMatch) return symbols;

    const funcName = funcMatch[1];
    // Find $NAME position in args
    const argsStr = callPattern.slice(callPattern.indexOf('(') + 1, callPattern.lastIndexOf(')'));
    const argParts = argsStr.split(',').map(s => s.trim());
    const nameArgIdx = argParts.findIndex(a => a === '$NAME');

    // Build regex to find function calls
    const escapedFunc = funcName.replace(/\./g, '\\.');
    const callRegex = new RegExp(`${escapedFunc}\\s*\\(`, 'g');
    const nameRegex = rule.match.nameRegex ? new RegExp(rule.match.nameRegex) : null;
    const lines = sourceCode.split('\n');

    let m;
    while ((m = callRegex.exec(sourceCode)) !== null) {
      const startIdx = m.index + m[0].length;
      const argValues = this.extractCallArgs(sourceCode, startIdx);
      if (nameArgIdx >= 0 && nameArgIdx < argValues.length) {
        const rawName = argValues[nameArgIdx].trim();
        const name = rawName.replace(/^["'`]|["'`]$/g, '');
        if (!name) continue;
        if (nameRegex && !nameRegex.test(name)) continue;

        const lineNum = sourceCode.slice(0, m.index).split('\n').length;
        symbols.push(this.buildSymbol(rule, name, filePath, language, lineNum, lines[lineNum - 1] ?? ''));
      }
    }

    return symbols;
  }

  private matchAssignment(
    rule: PatternRule,
    sourceCode: string,
    filePath: string,
    language: Language,
  ): PluginExtractedSymbol[] {
    const symbols: PluginExtractedSymbol[] = [];
    const nameRegex = rule.match.nameRegex ? new RegExp(rule.match.nameRegex) : null;
    const scope = rule.match.scope ?? 'any';
    const lines = sourceCode.split('\n');

    // Match assignments: NAME = ... / const NAME = ... / export const NAME = ... / NAME: type = ...
    const assignRegex = /^(\s*)(?:export\s+)?(?:(?:const|let|var|final|static\s+final)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^\n=]+)?\s*=\s*/gm;
    let m;
    while ((m = assignRegex.exec(sourceCode)) !== null) {
      const indent = m[1].length;
      const name = m[2];

      // Scope filtering
      if (scope === 'module' && indent > 0) continue;
      if (scope === 'class' && indent === 0) continue;

      if (nameRegex && !nameRegex.test(name)) continue;

      const lineNum = sourceCode.slice(0, m.index).split('\n').length;
      symbols.push(this.buildSymbol(rule, name, filePath, language, lineNum, lines[lineNum - 1] ?? ''));
    }

    return symbols;
  }

  private extractCallArgs(source: string, startIdx: number): string[] {
    const args: string[] = [];
    let depth = 1;
    let current = '';
    let inString: string | null = null;

    for (let i = startIdx; i < source.length && depth > 0; i++) {
      const ch = source[i];
      if (inString) {
        current += ch;
        if (ch === inString && source[i - 1] !== '\\') inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        current += ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; current += ch; continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) { args.push(current); break; }
        current += ch;
        continue;
      }
      if (ch === ',' && depth === 1) {
        args.push(current);
        current = '';
        continue;
      }
      current += ch;
    }

    return args;
  }

  // ── Symbol Builder ─────────────────────────────────────────────────

  private buildSymbol(
    rule: PatternRule,
    name: string,
    filePath: string,
    language: Language,
    lineNum: number,
    lineText: string,
  ): PluginExtractedSymbol {
    const ext = rule.extract;
    const relPath = relative(this.projectRoot, filePath).replace(/\\/g, '/');
    const qualifiedName = ext.qualifiedName
      ? ext.qualifiedName.replace('$NAME', name)
      : name;

    return {
      kind: ext.kind,
      name,
      qualifiedName,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 1,
      endColumn: lineText.length + 1,
      docstring: '',
      signature: ext.signature?.replace('$NAME', name) ?? lineText.trim().slice(0, 120),
      visibility: ext.visibility ?? 'public',
      isExported: ext.isExported ?? false,
      isAsync: false,
      isStatic: ext.isStatic ?? false,
      isAbstract: false,
      decorators: ext.decorators ?? [],
      typeParameters: [],
      pluginMetadata: ext.metadata ? { ...ext.metadata } : undefined,
      sourceRuleId: rule.id,
    };
  }

  private resolveTemplate(template: string, regexMatch: RegExpExecArray): string {
    return template.replace(/\$(\d+)/g, (_, idx) => regexMatch[Number(idx)] ?? '');
  }

  // ── Plugin Context ─────────────────────────────────────────────────

  private createPluginContext(
    filePath: string,
    sourceCode: string,
    language: Language,
    tree: unknown,
  ): PluginContext {
    const lines = sourceCode.split('\n');
    return {
      filePath,
      language,
      sourceCode,
      tree,
      findAll(nodeType: string): AstNodeView[] {
        // Walk tree-sitter AST and find all nodes of given type
        const results: AstNodeView[] = [];
        const root = (tree as { rootNode?: unknown })?.rootNode;
        if (!root) return results;
        walkNode(root as TSNode, nodeType, results);
        return results;
      },
      text(startLine: number, endLine: number): string {
        return lines.slice(startLine - 1, endLine).join('\n');
      },
      makeSymbol(input: Partial<PluginExtractedSymbol>): PluginExtractedSymbol {
        return {
          kind: input.kind ?? 'variable',
          name: input.name ?? '',
          qualifiedName: input.qualifiedName ?? input.name ?? '',
          filePath,
          language,
          startLine: input.startLine ?? 1,
          endLine: input.endLine ?? input.startLine ?? 1,
          startColumn: input.startColumn ?? 1,
          endColumn: input.endColumn ?? 1,
          docstring: input.docstring ?? '',
          signature: input.signature ?? '',
          visibility: input.visibility ?? 'public',
          isExported: input.isExported ?? false,
          isAsync: input.isAsync ?? false,
          isStatic: input.isStatic ?? false,
          isAbstract: input.isAbstract ?? false,
          decorators: input.decorators ?? [],
          typeParameters: input.typeParameters ?? [],
          pluginMetadata: input.pluginMetadata,
          sourcePluginId: input.sourcePluginId,
          sourceRuleId: input.sourceRuleId,
        };
      },
    };
  }

  // ── Merge ──────────────────────────────────────────────────────────

  mergeResults(
    coreResult: LanguageExtractionResult,
    pluginResult: PluginExtractionResult,
  ): LanguageExtractionResult {
    const policy = this.config?.defaults?.conflictPolicy ?? 'merge-metadata';
    const coreKeys = new Set(
      coreResult.symbols.map(s => `${s.filePath}::${s.qualifiedName}`)
    );

    const merged: ExtractedSymbol[] = [...coreResult.symbols];

    for (const pSym of pluginResult.symbols) {
      const key = `${pSym.filePath}::${pSym.qualifiedName}`;
      if (coreKeys.has(key)) {
        if (policy === 'plugin-wins') {
          const idx = merged.findIndex(s => `${s.filePath}::${s.qualifiedName}` === key);
          if (idx >= 0) merged[idx] = pSym;
        }
        // core-wins and merge-metadata: keep core symbol (metadata merge happens at UnifiedNode level)
        continue;
      }
      merged.push(pSym);
    }

    return {
      symbols: merged,
      references: [
        ...coreResult.references,
        ...(pluginResult.references ?? []),
      ],
      edges: [
        ...coreResult.edges,
        ...(pluginResult.edges ?? []),
      ],
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private matchesLanguage(plugin: PluginDefinition, language: Language): boolean {
    return plugin.languages.includes('all') || plugin.languages.includes(language);
  }

  private matchesFile(plugin: PluginDefinition, filePath: string): boolean {
    const rel = relative(this.projectRoot, filePath).replace(/\\/g, '/');
    if (plugin.excludePatterns?.length) {
      for (const pat of plugin.excludePatterns) {
        if (this.globMatch(rel, pat)) return false;
      }
    }
    if (!plugin.filePatterns?.length) return true;
    return plugin.filePatterns.some(pat => this.globMatch(rel, pat));
  }

  private globMatch(path: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(path);
  }

  private getOnError(): 'warn' | 'fail' {
    return this.config?.defaults?.onError ?? 'warn';
  }

  hasPlugins(): boolean {
    return (this.config?.plugins?.length ?? 0) > 0 || this.scriptModules.size > 0;
  }
}

// ---------------------------------------------------------------------------
// tree-sitter node walker (for script plugin API)
// ---------------------------------------------------------------------------

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TSNode[];
  namedChildren: TSNode[];
  childForFieldName(name: string): TSNode | null;
}

function toAstNodeView(node: TSNode): AstNodeView {
  return {
    type: node.type,
    text: node.text,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endColumn: node.endPosition.column + 1,
    get children() { return node.children.map(toAstNodeView); },
    get namedChildren() { return node.namedChildren.map(toAstNodeView); },
    childForFieldName(name: string) {
      const child = node.childForFieldName(name);
      return child ? toAstNodeView(child) : null;
    },
  };
}

function walkNode(node: TSNode, nodeType: string, results: AstNodeView[]): void {
  if (node.type === nodeType) {
    results.push(toAstNodeView(node));
  }
  for (const child of node.children) {
    walkNode(child, nodeType, results);
  }
}
