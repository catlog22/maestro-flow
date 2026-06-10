/**
 * KG Context Injector — PreToolUse:Agent Hook
 *
 * Injects Knowledge Graph code structure context (callers, callees, exported
 * symbols) into subagent prompts. Uses dynamic require() for graph modules so
 * the hook is a no-op when better-sqlite3 is unavailable.
 *
 * When CodeGraph has indexed the project, function-level `calls` edges are
 * available and the output includes rich caller/callee info.  When only the
 * regex indexer was used, the output falls back to file-level exports and a
 * hint nudging agents to re-index with CodeGraph.
 */

import { existsSync } from 'node:fs';
import type { EnhancedNode, EnhancedEdge } from '../graph/types.js';
import { wrapMaestroContext, type ContextSection } from './context-format.js';

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
    // Skip very short or common noise words
    if (s.length >= 3 && !/^(the|and|for|not|but|has|get|set|new|var|let|use)$/i.test(s)) {
      if (!seen.has(s)) seen.add(s);
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a single caller entry with arrow notation. */
function formatCaller(c: { node: EnhancedNode; edge: EnhancedEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `${name} (${loc}) --${c.edge.kind}-->` : `${name} --${c.edge.kind}-->`;
}

/** Format a single callee entry with arrow notation. */
function formatCallee(c: { node: EnhancedNode; edge: EnhancedEdge }): string {
  const loc = c.node.filePath ? `${c.node.filePath}:${c.node.startLine}` : '';
  const name = c.node.name;
  return loc ? `--> ${name} (${loc})` : `--> ${name}`;
}

/**
 * Build a rich symbol section when function-level call data is available.
 *
 * Output (one ContextSection per symbol):
 *   ## kg-calls[loadSpecs]
 *   - loadSpecs (function) src/tools/spec-loader.ts:45
 *   - callers: evaluateSpecInjection (src/hooks/spec-injector.ts:87) --calls-->
 *   - callees: --> parseSpecEntries (src/tools/spec-entry-parser.ts:54)
 */
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

/**
 * Build a file-level section when only regex-indexed data is available.
 *
 * Output:
 *   ## kg-file[src/tools/spec-loader.ts]
 *   - exports: loadSpecs, resolveSpecDir, formatFileContent
 *   - imported by: 7 files
 *   - function-level calls unavailable -- run "maestro kg index" with codegraph
 */
function buildFileLevelSection(
  filePath: string,
  exported: string[],
  importerCount: number,
): ContextSection {
  const lines: string[] = [];
  if (exported.length > 0) {
    lines.push(`exports: ${exported.join(', ')}`);
  }
  if (importerCount > 0) {
    lines.push(`imported by: ${importerCount} files`);
  }
  lines.push('function-level calls unavailable -- run "maestro kg index" with codegraph for full call graph');
  return { label: `kg-file[${filePath}]`, lines };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_CONTENT = 3072;
const MAX_SYMBOLS = 3;
const MAX_FILES = 2;

/**
 * Evaluate whether to inject KG code structure context for a given prompt.
 *
 * @param _agentType The subagent_type (reserved for future filtering)
 * @param prompt     The agent prompt text to extract references from
 * @param projectPath Working directory for DB resolution
 */
export function evaluateKgContextInjection(
  _agentType: string,
  prompt: string,
  projectPath: string,
): KgInjectionResult {
  try {
    // Dynamic import to avoid crash when better-sqlite3 is unavailable
    const { getDatabasePath, DatabaseConnection } = require('../graph/db/index.js');
    const { QueryBuilder } = require('../graph/db/queries.js');
    const { GraphTraverser } = require('../graph/traversal.js');

    const dbPath = getDatabasePath(projectPath);
    if (!existsSync(dbPath)) {
      return { inject: false, reason: 'no-kg' };
    }

    const symbols = extractSymbols(prompt).slice(0, MAX_SYMBOLS);
    const files = extractFilePaths(prompt).slice(0, MAX_FILES);
    if (symbols.length === 0 && files.length === 0) {
      return { inject: false, reason: 'no-references' };
    }

    const conn = new DatabaseConnection();
    try {
      conn.open(dbPath);
      const qb = new QueryBuilder(conn);
      const traverser = new GraphTraverser(qb);
      const sections: ContextSection[] = [];

      // Detect whether function-level edges exist (CodeGraph indexed)
      const stats = qb.getStats();
      const hasCallEdges = (stats.edgesByKind['calls'] ?? 0) > 0;

      // Symbol lookups: search + callers/callees
      for (const sym of symbols) {
        const nodes = qb.searchNodes(sym, { limit: 1 });
        if (nodes.length === 0) continue;
        const node = nodes[0];

        if (hasCallEdges) {
          // Rich format: function-level callers + callees
          const callers = traverser.getCallers(node.id, 1);
          const callees = traverser.getCallees(node.id, 1);
          sections.push(buildRichSymbolSection(node, callers, callees));
        } else {
          // Compact format (regex-indexed, no call edges)
          const loc = node.filePath ? ` (${node.filePath}:${node.startLine})` : '';
          const sig = node.signature ? ` -- ${node.signature}` : '';
          sections.push({
            label: `kg-symbol[${node.name}]`,
            lines: [`[${node.kind}] ${node.name}${sig}${loc}`],
          });
        }
      }

      // File lookups: exported symbols + import count
      for (const fp of files) {
        const fileNodes = qb.getNodesByFile(fp);
        if (fileNodes.length === 0) continue;

        const exported = fileNodes
          .filter((n: EnhancedNode) => n.isExported)
          .slice(0, 8)
          .map((n: EnhancedNode) => n.name);

        if (hasCallEdges) {
          // Rich format: include file section with export names + kinds
          const exportedWithKind = fileNodes
            .filter((n: EnhancedNode) => n.isExported)
            .slice(0, 8)
            .map((n: EnhancedNode) => `${n.kind}:${n.name}`);
          if (exportedWithKind.length > 0) {
            sections.push({
              label: `kg-file[${fp}]`,
              lines: [`exports: ${exportedWithKind.join(', ')}`],
            });
          }
        } else {
          // File-level fallback: count importers via incoming import edges
          // Find the file node, then count incoming 'imports' edges to any node in this file
          const fileNodeIds = fileNodes.map((n: EnhancedNode) => n.id);
          const importerFiles = new Set<string>();
          for (const nodeId of fileNodeIds) {
            const incoming = qb.getIncomingEdges(nodeId, ['imports']);
            for (const edge of incoming) {
              const sourceNodes = qb.getNodesByIds([edge.source]);
              const sourceNode = sourceNodes.get(edge.source);
              if (sourceNode && sourceNode.filePath && sourceNode.filePath !== fp) {
                importerFiles.add(sourceNode.filePath);
              }
            }
          }
          sections.push(buildFileLevelSection(fp, exported, importerFiles.size));
        }
      }

      if (sections.length === 0) {
        return { inject: false, reason: 'no-matches' };
      }

      // Per-injector budget reporting (format-only; no cross-injector pooling yet).
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
      conn.close();
    }
  } catch {
    // Graph modules unavailable or DB corrupt — graceful degradation
    return { inject: false, reason: 'kg-unavailable' };
  }
}
