/**
 * KG Context Builder — code structure sections for prompt context
 *
 * Injects Knowledge Graph code structure context (callers, callees, exported
 * symbols) using MaestroGraph as the data source. The keyword prompt injector
 * owns composition and budgeting; this module only builds KG sections.
 */

import { truncateMaestroContext, wrapMaestroContext, type ContextSection } from './context-format.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgInjectionResult {
  inject: boolean;
  content?: string;
  reason?: string;
}

interface CodeContextNode {
  id: string;
  name: string;
  kind: string;
  filePath?: string;
  startLine?: number;
  signature?: string;
}

interface CodeContextEdge {
  kind: string;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

const FILE_RE = /([\w\/\\.-]+\.(ts|tsx|js|jsx|py|go|rs|java))/g;
const BACKTICK_SYMBOL_RE = /`(\w+)`/g;
const CODE_SYMBOL_RE = /\b[a-z]+[A-Z][a-zA-Z0-9]*\b|\b[a-z]+_[a-z0-9_]+\b/g;

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
  for (const m of text.matchAll(BACKTICK_SYMBOL_RE)) {
    const s = m[1];
    if (s.length >= 3 && !/^(the|and|for|not|but|has|get|set|new|var|let|use)$/i.test(s)) {
      if (!seen.has(s)) seen.add(s);
    }
  }
  for (const symbol of text.match(CODE_SYMBOL_RE) ?? []) {
    if (!seen.has(symbol)) seen.add(symbol);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCaller(c: { node: CodeContextNode; edge: CodeContextEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `${name} (${loc}) --${c.edge.kind}-->` : `${name} --${c.edge.kind}-->`;
}

function formatCallee(c: { node: CodeContextNode; edge: CodeContextEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `--> ${name} (${loc})` : `--> ${name}`;
}

function buildRichSymbolSection(
  node: CodeContextNode,
  callers: Array<{ node: CodeContextNode; edge: CodeContextEdge }>,
  callees: Array<{ node: CodeContextNode; edge: CodeContextEdge }>,
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

/** Build KG sections for the shared UserPromptSubmit context pipeline. */
export async function buildKgContextSections(
  prompt: string,
  projectPath: string,
): Promise<ContextSection[]> {
  const symbols = extractSymbols(prompt).slice(0, MAX_SYMBOLS);
  const files = extractFilePaths(prompt).slice(0, MAX_FILES);
  if (symbols.length === 0 && files.length === 0) return [];

  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(projectPath)) return [];

    const mg = await MaestroGraph.open(projectPath);
    try {
      const sections: ContextSection[] = [];

      for (const sym of symbols) {
        const results = mg.searchCode(sym, { limit: 1 });
        if (results.length === 0) continue;
        const node = results[0];
        const callers = mg.getCallers(node.id, 1);
        const callees = mg.getCallees(node.id, 1);
        sections.push(buildRichSymbolSection(node, callers, callees));
      }

      for (const fp of files) {
        const fileNodes = mg.getQueryBuilder().getNodesByFile(fp);
        const exported = fileNodes
          .filter(node => node.isExported)
          .slice(0, 8)
          .map(node => `${node.kind}:${node.name}`);
        if (exported.length > 0) {
          sections.push({
            label: `kg-file[${fp}]`,
            lines: [`exports: ${exported.join(', ')}`],
          });
        }
      }

      return sections;
    } finally {
      try { mg.close(); } catch { /* best-effort */ }
    }
  } catch {
    return [];
  }
}

/**
 * Compatibility wrapper for direct consumers. New hook paths should compose
 * buildKgContextSections() with the other prompt context sections instead.
 */
export async function evaluateKgContextInjection(
  _agentType: string,
  prompt: string,
  projectPath: string,
): Promise<KgInjectionResult> {
  const sections = await buildKgContextSections(prompt, projectPath);
  if (sections.length === 0) return { inject: false, reason: 'no-matches' };

  const usedChars = sections.reduce(
    (sum, section) => sum + section.lines.reduce((acc, line) => acc + line.length, 0),
    0,
  );
  let content = wrapMaestroContext(sections, { used: usedChars, max: MAX_CONTENT });
  content = truncateMaestroContext(content, MAX_CONTENT);
  return { inject: true, content };
}
