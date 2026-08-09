// src/graph/kg/extraction/code/plugin-engine.ts
// PluginEngine — load extractors.yaml, run declarative + script plugins, merge results

import { resolve, dirname, relative, extname } from 'node:path';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LANGUAGES, type Language } from '../../db/types.js';
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

const PLUGIN_LANGUAGES = new Set<string>([...LANGUAGES, 'all']);
const NO_PLUGIN_FAILURE_CAUSE = Symbol('no-plugin-failure-cause');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined
    || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writePluginWarning(message: string): void {
  process.stderr.write(`[MaestroGraph] Extractor plugin warning: ${message}\n`);
}

// ---------------------------------------------------------------------------
// PluginEngine
// ---------------------------------------------------------------------------

export class PluginEngine {
  private config: ExtractorPluginConfig | null = null;
  private configPath: string;
  private scriptDir: string;
  private configMtime: number = 0;
  private scriptModules: Map<string, Record<string, unknown>> = new Map();
  private globCache: Map<string, RegExp> = new Map();

  constructor(private projectRoot: string) {
    this.configPath = resolve(projectRoot, '.workflow', 'kg', 'extractors.yaml');
    this.scriptDir = resolve(projectRoot, '.workflow', 'kg', 'extractors');
  }

  // ── Loading ────────────────────────────────────────────────────────

  async load(options?: { allowScripts?: boolean }): Promise<boolean> {
    const hasConfig = existsSync(this.configPath);
    const hasScripts = existsSync(this.scriptDir);
    if (!hasConfig && !hasScripts) return false;

    if (hasConfig) {
      const stat = statSync(this.configPath);
      if (stat.mtimeMs !== this.configMtime) {
        const config = this.parseConfig(readFileSync(this.configPath, 'utf-8'));
        if (!config) throw new Error(`Invalid extractor plugin config: ${this.configPath}`);
        this.config = config;
        this.configMtime = stat.mtimeMs;
      }
    }

    if (hasScripts) {
      if (options?.allowScripts) {
        await this.loadScriptPlugins();
      } else {
        const scripts = readdirSync(this.scriptDir).filter(f => f.endsWith('.mjs'));
        if (scripts.length > 0) {
          process.stderr.write(
            `[MaestroGraph] Found ${scripts.length} script extractor(s) in ${this.scriptDir} — ` +
            'skipped for security. Use --allow-extractor-scripts to enable.\n',
          );
        }
      }
    }

    return this.config !== null || this.scriptModules.size > 0;
  }

  private parseConfig(raw: string): ExtractorPluginConfig | null {
    // Simple YAML-subset parser: support version, defaults, plugins array.
    // For full YAML we'd use a library; here we parse the JSON-compatible subset.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = this.parseSimpleYaml(raw);
    }

    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.plugins)) {
      return null;
    }

    const { defaults, errors: defaultErrors } = this.normalizeDefaults(parsed.defaults);
    const onError = defaults.onError ?? 'warn';
    const errors = [...defaultErrors];
    const plugins: PluginDefinition[] = [];

    for (const [index, candidate] of parsed.plugins.entries()) {
      if (isRecord(candidate) && candidate.enabled === false) continue;

      const validationError = this.validatePluginDefinition(candidate, index);
      if (validationError) {
        errors.push(validationError);
        continue;
      }
      plugins.push(candidate as unknown as PluginDefinition);
    }

    if (errors.length > 0) {
      if (onError === 'fail') {
        throw new Error(`Invalid extractor plugin config: ${errors.join('; ')}`);
      }
      for (const error of errors) {
        writePluginWarning(`Invalid config skipped: ${error}`);
      }
    }

    return {
      version: 1,
      defaults,
      plugins,
    };
  }

  private normalizeDefaults(
    value: unknown,
  ): { defaults: NonNullable<ExtractorPluginConfig['defaults']>; errors: string[] } {
    const defaults: NonNullable<ExtractorPluginConfig['defaults']> = {};
    const errors: string[] = [];
    if (value === undefined) return { defaults, errors };
    if (!isRecord(value)) {
      return { defaults, errors: ['defaults must be an object'] };
    }

    if (value.onError !== undefined) {
      if (value.onError === 'warn' || value.onError === 'fail') {
        defaults.onError = value.onError;
      } else {
        errors.push('defaults.onError must be warn or fail');
      }
    }
    if (value.conflictPolicy !== undefined) {
      if (
        value.conflictPolicy === 'core-wins'
        || value.conflictPolicy === 'plugin-wins'
        || value.conflictPolicy === 'merge-metadata'
      ) {
        defaults.conflictPolicy = value.conflictPolicy;
      } else {
        errors.push('defaults.conflictPolicy is invalid');
      }
    }
    if (value.timeoutMs !== undefined) {
      if (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 0) {
        defaults.timeoutMs = value.timeoutMs;
      } else {
        errors.push('defaults.timeoutMs must be a non-negative finite number');
      }
    }

    return { defaults, errors };
  }

  private validatePluginDefinition(value: unknown, index: number): string | null {
    if (!isRecord(value)) return `plugins[${index}] must be an object`;
    const label = typeof value.id === 'string' && value.id.trim()
      ? `plugin ${value.id}`
      : `plugins[${index}]`;

    if (typeof value.id !== 'string' || !value.id.trim()) return `${label} requires a non-empty id`;
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
      return `${label}.enabled must be a boolean`;
    }
    if (value.mode !== 'declarative' && value.mode !== 'script') return `${label} has an invalid mode`;
    if (
      !Array.isArray(value.languages)
      || value.languages.length === 0
      || value.languages.some(language => typeof language !== 'string' || !PLUGIN_LANGUAGES.has(language))
    ) {
      return `${label} requires at least one supported language`;
    }
    if (!isOptionalStringArray(value.filePatterns)) return `${label}.filePatterns must be a string array`;
    if (!isOptionalStringArray(value.excludePatterns)) return `${label}.excludePatterns must be a string array`;

    if (value.mode === 'script') {
      if (!isRecord(value.script) || typeof value.script.module !== 'string' || !value.script.module.trim()) {
        return `${label}.script.module must be a non-empty string`;
      }
      if (value.script.export !== undefined && typeof value.script.export !== 'string') {
        return `${label}.script.export must be a string`;
      }
      if (
        value.script.timeoutMs !== undefined
        && (
          typeof value.script.timeoutMs !== 'number'
          || !Number.isFinite(value.script.timeoutMs)
          || value.script.timeoutMs < 0
        )
      ) {
        return `${label}.script.timeoutMs must be a non-negative finite number`;
      }
      return null;
    }

    if (!isRecord(value.declarative) || !Array.isArray(value.declarative.rules) || value.declarative.rules.length === 0) {
      return `${label}.declarative.rules must be a non-empty array`;
    }
    for (const [ruleIndex, rule] of value.declarative.rules.entries()) {
      const ruleError = this.validatePatternRule(rule, `${label}.declarative.rules[${ruleIndex}]`);
      if (ruleError) return ruleError;
    }
    return null;
  }

  private validatePatternRule(value: unknown, label: string): string | null {
    if (!isRecord(value)) return `${label} must be an object`;
    if (typeof value.id !== 'string' || !value.id.trim()) return `${label}.id must be a non-empty string`;
    if (!isRecord(value.match)) return `${label}.match must be an object`;
    if (!['regex', 'call', 'assignment'].includes(String(value.match.type))) {
      return `${label}.match.type is invalid`;
    }
    if (typeof value.match.pattern !== 'string' || !value.match.pattern.trim()) {
      return `${label}.match.pattern must be a non-empty string`;
    }
    if (value.match.nameRegex !== undefined && typeof value.match.nameRegex !== 'string') {
      return `${label}.match.nameRegex must be a string`;
    }
    if (
      value.match.scope !== undefined
      && value.match.scope !== 'module'
      && value.match.scope !== 'class'
      && value.match.scope !== 'any'
    ) {
      return `${label}.match.scope is invalid`;
    }
    if (value.match.type === 'call') {
      const openParen = value.match.pattern.indexOf('(');
      const closeParen = value.match.pattern.lastIndexOf(')');
      const nameArgument = value.match.pattern
        .slice(openParen + 1, closeParen)
        .split(',')
        .some(argument => argument.trim() === '$NAME');
      if (!/^([A-Za-z_.$]+)\s*\(/.test(value.match.pattern) || closeParen <= openParen || !nameArgument) {
        return `${label}.match.pattern is not a valid call pattern`;
      }
    }
    if (value.match.type === 'assignment' && !value.match.pattern.includes('$NAME')) {
      return `${label}.match.pattern must identify $NAME`;
    }
    if (!isRecord(value.extract) || typeof value.extract.kind !== 'string' || !value.extract.kind.trim()) {
      return `${label}.extract.kind must be a non-empty string`;
    }
    for (const key of ['name', 'qualifiedName', 'signature', 'visibility'] as const) {
      if (value.extract[key] !== undefined && typeof value.extract[key] !== 'string') {
        return `${label}.extract.${key} must be a string`;
      }
    }
    if (value.extract.decorators !== undefined && !isOptionalStringArray(value.extract.decorators)) {
      return `${label}.extract.decorators must be a string array`;
    }
    for (const key of ['isExported', 'isStatic'] as const) {
      if (value.extract[key] !== undefined && typeof value.extract[key] !== 'boolean') {
        return `${label}.extract.${key} must be a boolean`;
      }
    }
    return null;
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
        if (indent >= currentArrayIndent && currentArrayKey) {
          if (!currentArray) {
            const parent = stack[stack.length - 1].obj;
            const arr: unknown[] = [];
            parent[currentArrayKey] = arr;
            currentArray = arr;
          }
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

        if (val === '' || val === '|') {
          currentArrayKey = key;
          currentArrayIndent = indent + 2;
          currentArray = null;
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
        const mod = await import(pathToFileURL(fullPath).href) as Record<string, unknown>;
        this.scriptModules.set(file, mod);
      } catch (error) {
        const configuredPlugins = this.config?.plugins
          .filter(plugin => plugin.mode === 'script' && plugin.script?.module === file)
          .map(plugin => plugin.id) ?? [];
        const ownership = configuredPlugins.length > 0
          ? `plugin ${configuredPlugins.join(',')}`
          : 'standalone module';
        this.handleFailure(`Script plugin ${file} failed to load (${ownership})`, error);
      }
    }
  }

  hasMatchingPlugin(filePath: string, language: Language): boolean {
    if (this.config?.plugins) {
      for (const plugin of this.config.plugins) {
        if (!this.matchesLanguage(plugin, language)) continue;
        if (!this.matchesFile(plugin, filePath)) continue;
        return true;
      }
    }
    return false;
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
        } catch (error) {
          this.handleFailure(`Plugin ${plugin.id} failed`, error);
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
        if (!mod) {
          this.handleFailure(`Script plugin ${plugin.id} module ${moduleName} is not loaded`);
          continue;
        }

        const exportName = plugin.script.export ?? 'extract';
        const fn = mod[exportName];
        if (typeof fn !== 'function') {
          this.handleFailure(
            `Script plugin ${plugin.id} failed: module ${moduleName} export ${exportName} is not a function`,
          );
          continue;
        }
        try {
          const ctx = this.createPluginContext(filePath, sourceCode, language, tree);
          const result = await fn(ctx);
          if (result?.symbols) {
            for (const sym of result.symbols) {
              sym.sourcePluginId = sym.sourcePluginId ?? plugin.id;
              allSymbols.push(sym);
            }
          }
          if (result?.references) allRefs.push(...result.references);
          if (result?.edges) allEdges.push(...result.edges);
        } catch (error) {
          this.handleFailure(
            `Script plugin ${plugin.id} failed: module ${moduleName} export ${exportName}`,
            error,
          );
        }
      }
    }

    // Also run standalone script plugins (files in extractors/ not referenced in config)
    for (const [fileName, mod] of this.scriptModules) {
      const isReferenced = this.config?.plugins?.some(
        p => p.mode === 'script' && p.script?.module === fileName
      );
      if (isReferenced) continue;

      const fn = mod.extract;
      if (typeof fn !== 'function') {
        this.handleFailure(`Standalone script plugin ${fileName} has no extract export`);
        continue;
      }
      try {
        const ctx = this.createPluginContext(filePath, sourceCode, language, tree);
        const result = await fn(ctx);
        if (result?.symbols) {
          for (const sym of result.symbols) {
            sym.sourcePluginId = sym.sourcePluginId ?? `script:${fileName}`;
            allSymbols.push(sym);
          }
        }
        if (result?.references) allRefs.push(...result.references);
        if (result?.edges) allEdges.push(...result.edges);
      } catch (error) {
        this.handleFailure(`Standalone script plugin ${fileName} failed: export extract`, error);
      }
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
      } catch (error) {
        this.handleFailure(`Declarative plugin ${plugin.id} rule ${rule.id} failed`, error);
      }
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
    const { match } = rule;

    if (match.type === 'regex') {
      return this.matchRegex(rule, sourceCode, filePath, language);
    }

    if (match.type === 'call') {
      return this.matchCall(rule, sourceCode, filePath, language);
    }

    if (match.type === 'assignment') {
      return this.matchAssignment(rule, sourceCode, filePath, language);
    }

    throw new Error(`Unsupported declarative match type: ${String(match.type)}`);
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
    const MAX_MATCHES = 10_000;

    let match;
    let count = 0;
    while ((match = regex.exec(sourceCode)) !== null && count++ < MAX_MATCHES) {
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
    const MAX_MATCHES = 10_000;

    let m;
    let count = 0;
    while ((m = callRegex.exec(sourceCode)) !== null && count++ < MAX_MATCHES) {
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

    const assignRegex = /^(\s*)(?:export\s+)?(?:(?:const|let|var|final|static\s+final)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^\n=]+)?\s*=\s*/gm;
    let m;
    let count = 0;
    const MAX_MATCHES = 10_000;
    while ((m = assignRegex.exec(sourceCode)) !== null && count++ < MAX_MATCHES) {
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
        if (ch === inString) {
          let bs = 0;
          for (let j = i - 1; j >= startIdx && source[j] === '\\'; j--) bs++;
          if (bs % 2 === 0) inString = null;
        }
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
      importReferences: coreResult.importReferences ?? [],
      structuralReferences: coreResult.structuralReferences ?? [],
      diagnostics: coreResult.diagnostics,
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
    let re = this.globCache.get(pattern);
    if (!re) {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*\\\*/g, '§§')
        .replace(/\\\*/g, '[^/]*')
        .replace(/§§/g, '.*')
        .replace(/\\\?/g, '.');
      try {
        re = new RegExp(`^${escaped}$`);
      } catch {
        return false;
      }
      this.globCache.set(pattern, re);
    }
    return re.test(path);
  }

  private getOnError(): 'warn' | 'fail' {
    return this.config?.defaults?.onError ?? 'warn';
  }

  private handleFailure(
    message: string,
    cause: unknown = NO_PLUGIN_FAILURE_CAUSE,
  ): void {
    const hasCause = cause !== NO_PLUGIN_FAILURE_CAUSE;
    const detail = hasCause ? `${message}: ${errorMessage(cause)}` : message;
    if (this.getOnError() === 'fail') {
      if (!hasCause) throw new Error(detail);
      throw new Error(detail, { cause });
    }
    writePluginWarning(detail);
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
