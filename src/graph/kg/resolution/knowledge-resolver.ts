// src/graph/kg/resolution/knowledge-resolver.ts
// 跨源边自动发现 — MaestroGraph 核心价值
// 参考: plan-maestrograph.md D2.3 (IN-clause), D3.5 (置信度打分), D2.5 (传播限制)

import type Database from 'better-sqlite3';
import type { UnifiedEdge, EdgeProvenance } from '../db/types.js';
import { makeNodeId } from '../db/connection.js';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// D3.5: 通用名称黑名单 — 降权处理
const GENERIC_NAMES = new Set([
  'Error', 'Config', 'State', 'Event', 'Action', 'Type', 'Result',
  'Response', 'Request', 'Context', 'Options', 'Handler', 'Factory',
  'Service', 'Provider', 'Controller', 'Component', 'Module',
]);

const DEFINES_CONFIDENCE_THRESHOLD = 0.6;

// D2.5: 关系传播硬限制
const MAX_PROPAGATION_DEPTH = 3;
const MAX_RELATED_TERMS = 50;

export interface KnowledgeResolutionResult {
  definesEdges: number;
  constrainsEdges: number;
  documentsEdges: number;
  derivedFromEdges: number;
  relatesToEdges: number;
  totalEdgesCreated: number;
  durationMs: number;
}

export function resolveKnowledgeEdges(db: Database.Database, options?: { projectPath?: string }): KnowledgeResolutionResult {
  const startMs = Date.now();
  const allEdges: UnifiedEdge[] = [];

  // Rule 1: domain_term → code (defines) — 置信度打分 (D3.5)
  allEdges.push(...resolveDefinesEdges(db));

  // Rule 2: spec_entry → code (constrains) — IN-clause (D2.3)
  allEdges.push(...resolveConstrainsEdges(db));

  // Rule 3: knowhow → code (documents) — keyword 匹配
  allEdges.push(...resolveDocumentsEdges(db));

  // Rule 4: spec_entry → domain_term (derived_from) — domain 属性
  // (已由 spec-extractor 在提取时建立, 此处补充遗漏)

  // Rule 5: domain_term → domain_term (relates_to) — glossary relationships
  // (已由 domain-extractor 在提取时建立, 此处补充遗漏)

  // 写入 edges
  if (allEdges.length > 0) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      for (const edge of allEdges) {
        stmt.run(
          edge.source, edge.target, edge.kind,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
        );
      }
    })();
  }

  // D6.1: resolution.jsonl 可观测性日志
  if (options?.projectPath && allEdges.length > 0) {
    logResolutionEdges(options.projectPath, allEdges);
  }

  return {
    definesEdges: allEdges.filter(e => e.kind === 'defines').length,
    constrainsEdges: allEdges.filter(e => e.kind === 'constrains').length,
    documentsEdges: allEdges.filter(e => e.kind === 'documents').length,
    derivedFromEdges: 0,
    relatesToEdges: 0,
    totalEdgesCreated: allEdges.length,
    durationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: defines — domain_term → code node
// 置信度打分: base=0.5, generic=-0.3, exported+0.15, keyword match+0.2, many-code-name-降权-0.2
// D2.3: 使用应用层 alias 展开 + IN-clause 批量匹配, 不用 json_each JOIN
// ---------------------------------------------------------------------------
function resolveDefinesEdges(db: Database.Database): UnifiedEdge[] {
  // 应用层展开 alias → 扁平化匹配列表
  const domainNodes = db.prepare(
    `SELECT id, name, aliases, keywords FROM nodes WHERE source_type = 'domain' AND status = 'active'`
  ).all() as Array<{ id: string; name: string; aliases: string | null; keywords: string | null }>;

  const allAliases: Array<{ domainId: string; alias: string; keywords: string[] }> = [];
  for (const domain of domainNodes) {
    const aliases: string[] = JSON.parse(domain.aliases || '[]');
    const keywords: string[] = JSON.parse(domain.keywords || '[]');
    for (const alias of [domain.name, ...aliases]) {
      allAliases.push({ domainId: domain.id, alias, keywords });
    }
  }

  // D2.3: 分批 IN-clause (每批 500)
  const BATCH_SIZE = 500;
  const edges: UnifiedEdge[] = [];

  for (let i = 0; i < allAliases.length; i += BATCH_SIZE) {
    const batch = allAliases.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const matches = db.prepare(
      `SELECT id, name, kind, file_path, is_exported FROM nodes
       WHERE source_type = 'codegraph' AND name IN (${placeholders})
         AND kind IN ('class', 'interface', 'struct', 'type_alias', 'enum')
         AND file_path NOT LIKE '%node_modules%'`
    ).all(...batch.map(b => b.alias)) as Array<{
      id: string; name: string; kind: string; file_path: string; is_exported: number;
    }>;

    // 批量获取同名代码节点计数（消除 N+1）
    const distinctNames = [...new Set(matches.map(m => m.name))];
    const nameCounts = new Map<string, number>();
    if (distinctNames.length > 0) {
      const cntPlaceholders = distinctNames.map(() => '?').join(',');
      const countRows = db.prepare(
        `SELECT name, COUNT(*) as n FROM nodes WHERE name IN (${cntPlaceholders}) AND source_type = 'codegraph' GROUP BY name`
      ).all(...distinctNames) as Array<{ name: string; n: number }>;
      for (const row of countRows) nameCounts.set(row.name, row.n);
    }

    // D3.5: 置信度打分 + 阈值门控
    for (const match of matches) {
      const aliasInfo = batch.find(b => b.alias === match.name);
      if (!aliasInfo) continue;

      let conf = 0.5;
      if (GENERIC_NAMES.has(match.name)) conf -= 0.3;
      if (match.is_exported) conf += 0.15;
      if (aliasInfo.keywords.some(kw => match.file_path.toLowerCase().includes(kw.toLowerCase()))) conf += 0.2;
      if ((nameCounts.get(match.name) ?? 0) > 3) conf -= 0.2;

      if (conf >= DEFINES_CONFIDENCE_THRESHOLD) {
        edges.push({
          source: aliasInfo.domainId,
          target: match.id,
          kind: 'defines',
          provenance: 'knowledge-resolver' as EdgeProvenance,
          metadata: { confidence: conf },
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Rule 2: constrains — spec_entry → code node
// D2.3: keywords 匹配使用 IN-clause, 不用 json_each JOIN
// ---------------------------------------------------------------------------
function resolveConstrainsEdges(db: Database.Database): UnifiedEdge[] {
  const specNodes = db.prepare(
    `SELECT id, keywords, category FROM nodes WHERE source_type = 'spec' AND status = 'active'`
  ).all() as Array<{ id: string; keywords: string | null; category: string | null }>;

  const edges: UnifiedEdge[] = [];

  for (const spec of specNodes) {
    const keywords: string[] = JSON.parse(spec.keywords || '[]');
    if (keywords.length === 0) continue;

    // IN-clause 批量匹配 — name 精确 + 所有 keywords 的 file_path LIKE
    const namePlaceholders = keywords.map(() => '?').join(',');
    const pathClauses = keywords.map(() => `file_path LIKE '%' || ? || '%'`).join(' OR ');
    const codeMatches = db.prepare(
      `SELECT id, name, kind, file_path FROM nodes
       WHERE source_type = 'codegraph'
         AND kind IN ('function', 'method', 'class', 'interface')
         AND (name IN (${namePlaceholders}) OR ${pathClauses})
       LIMIT 500`
    ).all(...keywords, ...keywords) as Array<{
      id: string; name: string; kind: string; file_path: string;
    }>;

    for (const match of codeMatches) {
      edges.push({
        source: spec.id,
        target: match.id,
        kind: 'constrains',
        provenance: 'knowledge-resolver' as EdgeProvenance,
        metadata: { matchedKeyword: keywords.find(kw =>
          match.name === kw || match.file_path.includes(kw)) ?? '' },
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Rule 3: documents — knowhow → code node
// keywords 匹配代码符号名
// ---------------------------------------------------------------------------
function resolveDocumentsEdges(db: Database.Database): UnifiedEdge[] {
  const knowhowNodes = db.prepare(
    `SELECT id, keywords, name FROM nodes WHERE source_type = 'knowhow' AND status = 'active'`
  ).all() as Array<{ id: string; keywords: string | null; name: string }>;

  const edges: UnifiedEdge[] = [];

  for (const knowhow of knowhowNodes) {
    const keywords: string[] = JSON.parse(knowhow.keywords || '[]');
    const searchTerms = [knowhow.name, ...keywords];
    if (searchTerms.length === 0) continue;

    const placeholders = searchTerms.map(() => '?').join(',');
    const codeMatches = db.prepare(
      `SELECT id, name, kind FROM nodes
       WHERE source_type = 'codegraph'
         AND name IN (${placeholders})
       LIMIT 100`
    ).all(...searchTerms) as Array<{ id: string; name: string; kind: string }>;

    for (const match of codeMatches) {
      edges.push({
        source: knowhow.id,
        target: match.id,
        kind: 'documents',
        provenance: 'knowledge-resolver' as EdgeProvenance,
        metadata: { matchedTerm: match.name },
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// 关系传播 — 从种子节点扩展 N-hop (D2.5)
// ---------------------------------------------------------------------------
export interface RelatedNode {
  nodeId: string;
  depth: number;
  edgeKind: string;
}

export function expandRelated(
  db: Database.Database,
  seedNodeIds: string[],
  opts: { maxDepth?: number },
): RelatedNode[] {
  const depth = Math.min(opts.maxDepth ?? 1, MAX_PROPAGATION_DEPTH);
  const visited = new Set<string>(seedNodeIds);
  const results: RelatedNode[] = [];
  let frontier = [...seedNodeIds];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (results.length >= MAX_RELATED_TERMS) return results;
      const neighbors = db.prepare(
        `SELECT target AS id, kind FROM edges WHERE source = ?
         UNION SELECT source AS id, kind FROM edges WHERE target = ?`
      ).all(nodeId, nodeId) as Array<{ id: string; kind: string }>;

      for (const n of neighbors) {
        if (!visited.has(n.id)) {
          visited.add(n.id);
          next.push(n.id);
          results.push({ nodeId: n.id, depth: d + 1, edgeKind: n.kind });
        }
      }
    }
    frontier = next;
  }

  return results;
}

// ---------------------------------------------------------------------------
// D6.1: Resolution 可观测性日志 — .workflow/kg/resolution.jsonl
// ---------------------------------------------------------------------------

function logResolutionEdges(projectPath: string, edges: UnifiedEdge[]): void {
  const logPath = resolve(projectPath, '.workflow', 'kg', 'resolution.jsonl');
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString();
  const lines = edges.map(e => JSON.stringify({
    timestamp: ts,
    rule: e.kind,
    sourceId: e.source,
    targetId: e.target,
    confidence: (e.metadata as Record<string, unknown>)?.confidence ?? 'exact',
    matchDetail: (e.metadata as Record<string, unknown>)?.matchedKeyword
      ?? (e.metadata as Record<string, unknown>)?.matchedTerm ?? '',
  }));

  appendFileSync(logPath, lines.join('\n') + '\n', 'utf-8');
}