/**
 * KG Context Injector — PreToolUse:Agent Hook
 *
 * Injects Knowledge Graph code structure context (callers, callees, exported
 * symbols) into subagent prompts using CodeGraph as the sole data source.
 *
 * Requires @colbymchenry/codegraph — gracefully returns no-inject when unavailable.
 */

import { createRequire } from 'node:module';
import type { EnhancedNode, EnhancedEdge } from '../graph/types.js';
import { wrapMaestroContext, type ContextSection } from './context-format.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgInjectionResult {
  inject: boolean;
  content?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

const FILE_RE = /([\w\/\\.-]+\.(ts|tsx|js|jsx|py|go|rs|java))/g;
const SYMBOL_RE = /`(\w+)`/g;

function extractFilePaths(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(FILE_RE)) {
    const p = m[1].replace(/\\/g, '/');
    if (!seen.has(p)) seen.add(p);
  }
  return [...seen];
}

function extractSymbols(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(SYMBOL_RE)) {
    const s = m[1];
    if (s.length >= 3 && !/^(the|and|for|not|but|has|get|set|new|var|let|use)$/i.test(s)) {
      if (!seen.has(s)) seen.add(s);
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCaller(c: { node: EnhancedNode; edge: EnhancedEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `${name} (${loc}) --${c.edge.kind}-->` : `${name} --${c.edge.kind}-->`;
}

function formatCallee(c: { node: EnhancedNode; edge: EnhancedEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `--> ${name} (${loc})` : `--> ${name}`;
}

function buildRichSymbolSection(
  node: EnhancedNode,
  callers: Array<{ node: EnhancedNode; edge: EnhancedEdge }>,
  callees: Array<{ node: EnhancedNode; edge: EnhancedEdge }>,
): ContextSection {
  const lines: string[] = [];
  const loc = node.filePath ? ` ${node.filePath}:${node.startLine}` : '';
  const sig = node.signature ? ` — ${node.signature}` : '';
  lines.push(`${node.name} (${node.kind})${loc}${sig}`);

  if (callers.length > 0) {
    const shown = callers.slice(0, 5).map(formatCaller).join('; ');
    const more = callers.length > 5 ? ` (+${callers.length - 5} more)` : '';
    lines.push(`callers: ${shown}${more}`);
  }

  if (callees.length > 0) {
    const shown = callees.slice(0, 5).map(formatCallee).join('; ');
    const more = callees.length > 5 ? ` (+${callees.length - 5} more)` : '';
    lines.push(`callees: ${shown}${more}`);
  }

  return { label: `kg-calls[${node.name}]`, lines };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_CONTENT = 3072;
const MAX_SYMBOLS = 3;
const MAX_FILES = 2;

/**
 * Evaluate whether to inject KG code structure context for a given prompt.
 * Uses CodeGraph as the sole data source.
 */
export async function evaluateKgContextInjection(
  _agentType: string,
  prompt: string,
  projectPath: string,
): Promise<KgInjectionResult> {
  const symbols = extractSymbols(prompt).slice(0, MAX_SYMBOLS);
  const files = extractFilePaths(prompt).slice(0, MAX_FILES);
  if (symbols.length === 0 && files.length === 0) {
    return { inject: false, reason: 'no-references' };
  }

  try {
    const { isCodeGraphAvailable, CodeGraphAdapter } = require('../graph/codegraph-adapter.js');
    if (!isCodeGraphAvailable()) {
      return { inject: false, reason: 'codegraph-unavailable' };
    }

    const adapter = new CodeGraphAdapter(projectPath);
    try {
      if (!adapter.isInitialized()) {
        return { inject: false, reason: 'codegraph-not-initialized' };
      }

      const sections: ContextSection[] = [];

      for (const sym of symbols) {
        const results = await adapter.searchNodes(sym, { limit: 1 });
        if (results.length === 0) continue;
        const node = results[0].node ?? results[0];

        const callers = await adapter.getCallers(node.id, 1);
        const callees = await adapter.getCallees(node.id, 1);
        sections.push(buildRichSymbolSection(node, callers, callees));
      }

      for (const fp of files) {
        const fileNodes = await adapter.getNodesInFile(fp);
        if (fileNodes.length === 0) continue;
        const exported = fileNodes
          .filter((n: EnhancedNode) => n.isExported)
          .slice(0, 8)
          .map((n: EnhancedNode) => `${n.kind}:${n.name}`);
        if (exported.length > 0) {
          sections.push({
            label: `kg-file[${fp}]`,
            lines: [`exports: ${exported.join(', ')}`],
          });
        }
      }

      if (sections.length === 0) {
        return { inject: false, reason: 'no-matches' };
      }

      const usedChars = sections.reduce(
        (sum, s) => sum + s.lines.reduce((acc, l) => acc + l.length, 0),
        0,
      );
      let content = wrapMaestroContext(sections, { used: usedChars, max: MAX_CONTENT });
      if (content.length > MAX_CONTENT) {
        content = content.slice(0, MAX_CONTENT - 20) + '...\n</maestro-context>';
      }

      return { inject: true, content };
    } finally {
      try { adapter.close(); } catch { /* best-effort */ }
    }
  } catch {
    return { inject: false, reason: 'codegraph-unavailable' };
  }
}
