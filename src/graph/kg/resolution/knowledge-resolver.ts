// src/graph/kg/resolution/knowledge-resolver.ts
// 跨源边自动发现 — MaestroGraph 核心价值
// 参考: plan-maestrograph.md D2.3 (IN-clause), D3.5 (置信度打分), D2.5 (传播限制)

import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedEdge, EdgeProvenance } from '../db/types.js';
import { makeNodeId, sqliteTransaction } from '../db/connection.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; }
  catch { return fallback; }
}

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
  edges: UnifiedEdge[];
  definesEdges: number;
  constrainsEdges: number;
  documentsEdges: number;
  derivedFromEdges: number;
  relatesToEdges: number;
  totalEdgesCreated: number;
  durationMs: number;
}

export function resolveKnowledgeEdges(db: DatabaseSync, options?: { projectPath?: string }): KnowledgeResolutionResult {
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

  // 幂等写入：先清除旧的 knowledge-resolver 边，再插入新边
  sqliteTransaction(db, () => {
    db.prepare(`DELETE FROM edges WHERE provenance = 'knowledge-resolver'`).run();
    if (allEdges.length > 0) {
      const stmt = db.prepare(
        `INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const edge of allEdges) {
        stmt.run(
          edge.source, edge.target, edge.kind,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
        );
      }
    }
  });

  // D6.1: resolution.jsonl 可观测性日志
  if (options?.projectPath && allEdges.length > 0) {
    logResolutionEdges(options.projectPath, allEdges);
  }

  return {
    edges: allEdges,
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
function resolveDefinesEdges(db: DatabaseSync): UnifiedEdge[] {
  // 应用层展开 alias → 扁平化匹配列表
  const domainNodes = db.prepare(
    `SELECT id, name, aliases, keywords FROM nodes WHERE source_type = 'domain' AND status = 'active'`
  ).all() as unknown as Array<{ id: string; name: string; aliases: string | null; keywords: string | null }>;

  const allAliases: Array<{ domainId: string; alias: string; keywords: string[] }> = [];
  for (const domain of domainNodes) {
    const aliases: string[] = safeJsonParse(domain.aliases, []);
    const keywords: string[] = safeJsonParse(domain.keywords, []);
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
    ).all(...batch.map(b => b.alias)) as unknown as Array<{
      id: string; name: string; kind: string; file_path: string; is_exported: number;
    }>;

    // 批量获取同名代码节点计数（消除 N+1）
    const distinctNames = [...new Set(matches.map(m => m.name))];
    const nameCounts = new Map<string, number>();
    if (distinctNames.length > 0) {
      const cntPlaceholders = distinctNames.map(() => '?').join(',');
      const countRows = db.prepare(
        `SELECT name, COUNT(*) as n FROM nodes WHERE name IN (${cntPlaceholders}) AND source_type = 'codegraph' GROUP BY name`
      ).all(...distinctNames) as unknown as Array<{ name: string; n: number }>;
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
function resolveConstrainsEdges(db: DatabaseSync): UnifiedEdge[] {
  const specNodes = db.prepare(
    `SELECT id, keywords, category FROM nodes WHERE source_type = 'spec' AND status = 'active'`
  ).all() as unknown as Array<{ id: string; keywords: string | null; category: string | null }>;

  // 收集所有 spec 的 keywords，建立标准化 keyword → spec 映射
  const keywordToSpecs = new Map<string, Array<{ id: string; keywords: string[] }>>();

  for (const spec of specNodes) {
    const keywords: string[] = safeJsonParse(spec.keywords, []);
    if (keywords.length === 0) continue;
    for (const rawKeyword of keywords) {
      const kw = rawKeyword.trim().toLowerCase();
      if (!kw) continue;
      if (!keywordToSpecs.has(kw)) {
        keywordToSpecs.set(kw, []);
      }
      keywordToSpecs.get(kw)!.push({ id: spec.id, keywords });
    }
  }

  if (keywordToSpecs.size === 0) return [];

  // 单次读取候选代码节点，并建立 name/path-token 倒排索引。
  // 避免 leading-wildcard LIKE 扫描和 match × keyword 笛卡尔循环。
  const codeNodes = db.prepare(
    `SELECT id, name, kind, file_path FROM nodes
     WHERE source_type = 'codegraph'
       AND kind IN ('function', 'method', 'class', 'interface')`
  ).all() as unknown as Array<{ id: string; name: string; kind: string; file_path: string }>;
  const matchesByKeyword = new Map<string, Map<string, typeof codeNodes[number]>>();
  const addMatch = (keyword: string, node: typeof codeNodes[number]): void => {
    if (!keywordToSpecs.has(keyword)) return;
    let matches = matchesByKeyword.get(keyword);
    if (!matches) {
      matches = new Map();
      matchesByKeyword.set(keyword, matches);
    }
    matches.set(node.id, node);
  };
  for (const node of codeNodes) {
    addMatch(node.name.toLowerCase(), node);
    const pathTokens = node.file_path.toLowerCase().split(/[^a-z0-9_$-]+/).filter(token => token.length >= 3);
    for (const token of pathTokens) addMatch(token, node);
  }

  const edges: UnifiedEdge[] = [];
  const seen = new Set<string>();
  for (const [kw, specs] of keywordToSpecs) {
    const matches = matchesByKeyword.get(kw);
    if (!matches) continue;
    for (const match of matches.values()) {
      for (const spec of specs) {
        const key = `${spec.id}->${match.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: spec.id,
          target: match.id,
          kind: 'constrains',
          provenance: 'knowledge-resolver' as EdgeProvenance,
          metadata: { matchedKeyword: kw },
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Rule 3: documents — knowhow → code node
// keywords 匹配代码符号名
// ---------------------------------------------------------------------------
function resolveDocumentsEdges(db: DatabaseSync): UnifiedEdge[] {
  const knowhowNodes = db.prepare(
    `SELECT id, keywords, name FROM nodes WHERE source_type = 'knowhow' AND status = 'active'`
  ).all() as unknown as Array<{ id: string; keywords: string | null; name: string }>;

  // 收集所有 search terms，建立 term → knowhow 映射
  const termToKnowhows = new Map<string, string[]>();
  const allTerms: string[] = [];

  for (const knowhow of knowhowNodes) {
    const keywords: string[] = safeJsonParse(knowhow.keywords, []);
    const searchTerms = [knowhow.name, ...keywords];
    for (const term of searchTerms) {
      if (!term) continue;
      if (!termToKnowhows.has(term)) {
        termToKnowhows.set(term, []);
        allTerms.push(term);
      }
      termToKnowhows.get(term)!.push(knowhow.id);
    }
  }

  if (allTerms.length === 0) return [];

  // 分批 IN-clause 查询代码节点 (每批 500)
  const BATCH_SIZE = 500;
  const allCodeMatches: Array<{ id: string; name: string; kind: string }> = [];

  for (let i = 0; i < allTerms.length; i += BATCH_SIZE) {
    const batch = allTerms.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const matches = db.prepare(
      `SELECT id, name, kind FROM nodes
       WHERE source_type = 'codegraph'
         AND name IN (${placeholders})`
    ).all(...batch) as unknown as Array<{ id: string; name: string; kind: string }>;
    allCodeMatches.push(...matches);
  }

  // 应用层关联：按 term 匹配 knowhow → code
  const edges: UnifiedEdge[] = [];
  const seen = new Set<string>();

  for (const match of allCodeMatches) {
    const knowhowIds = termToKnowhows.get(match.name);
    if (!knowhowIds) continue;
    for (const knowhowId of knowhowIds) {
      const key = `${knowhowId}->${match.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source: knowhowId,
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
  db: DatabaseSync,
  seedNodeIds: string[],
  opts: { maxDepth?: number },
): RelatedNode[] {
  const depth = Math.min(opts.maxDepth ?? 1, MAX_PROPAGATION_DEPTH);
  const visited = new Set<string>(seedNodeIds);
  const results: RelatedNode[] = [];
  let frontier = [...seedNodeIds];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    const neighbors: Array<{ id: string; kind: string }> = [];
    for (let i = 0; i < frontier.length; i += 500) {
      const batch = frontier.slice(i, i + 500);
      const placeholders = batch.map(() => '?').join(',');
      neighbors.push(...db.prepare(
        `SELECT target AS id, kind FROM edges WHERE source IN (${placeholders})
         UNION SELECT source AS id, kind FROM edges WHERE target IN (${placeholders})`
      ).all(...batch, ...batch) as unknown as Array<{ id: string; kind: string }>);
    }

    for (const n of neighbors) {
      if (results.length >= MAX_RELATED_TERMS) return results;
      if (!visited.has(n.id)) {
        visited.add(n.id);
        next.push(n.id);
        results.push({ nodeId: n.id, depth: d + 1, edgeKind: n.kind });
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

  // G-A12: 覆盖写而非追加 — debug 产物只保留最近一次 sync 的边，历史无消费方，
  // 追加曾导致无界增长（实测 37MB）。
  writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');
}
