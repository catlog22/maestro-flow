// src/graph/kg/resolution/code-resolver.ts — 代码引用解析 (unresolved_refs → edges)
// 接通 schema.sql 宣称的两阶段模型: extraction → unresolved_refs → resolution → edges
//
// Rule A: imports 引用 → file→file 边 (ImportResolver 解析模块路径 → 目标文件 file 节点)
// Rule B: calls  引用 → file→符号 边 (name 精确匹配 nodes, 过滤全局/DOM 噪声)

import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedEdge } from '../db/types.js';
import { makeFileNodeId } from '../extraction/code/tree-sitter-types.js';
import { ImportResolver } from './import-resolver.js';
import { sqliteTransaction } from '../db/connection.js';

// 同名符号目标上限 — 防止泛化名 (label/main/e) 产生爆炸性连边
const MAX_CALL_TARGETS_PER_NAME = 20;

// calls 目标只匹配这些 kind (property 等低级符号不参与, 避免噪声)
const CALL_TARGET_KINDS = ['function', 'method', 'class', 'interface', 'struct', 'trait', 'type_alias', 'enum', 'variable'];

export interface CodeResolutionOptions {
  projectPath?: string;
  /** The caller already owns the surrounding SQLite transaction. */
  transactionMode?: 'managed' | 'caller-owned';
}

export interface CodeResolutionResult {
  edgesCreated: number;
  importsEdges: number;
  callsEdges: number;
  /** 未能解析为边的引用数 (外部包 / 无匹配符号) */
  unresolvedCount: number;
  durationMs: number;
  edges: UnifiedEdge[];
}

interface UnresolvedRefRow {
  from_node_id: string;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number;
  file_path: string;
  language: string;
}

interface PlannedEdge {
  edge: UnifiedEdge;
  reference: UnresolvedRefRow;
}

export function resolveCodeReferences(
  db: DatabaseSync,
  options?: CodeResolutionOptions,
): CodeResolutionResult {
  const startMs = Date.now();
  const projectRoot = options?.projectPath ?? process.cwd();
  const resolver = new ImportResolver(projectRoot);

  const refs = db.prepare(
    `SELECT from_node_id, reference_name, reference_kind, line, col, file_path, language
     FROM unresolved_refs`
  ).all() as unknown as UnresolvedRefRow[];

  const plannedEdges: PlannedEdge[] = [];
  const callsRefs: UnresolvedRefRow[] = [];

  // ── Rule A: imports → file→file ──────────────────────────────────
  for (const ref of refs) {
    if (ref.reference_kind === 'imports') {
      const resolved = resolver.resolveImport(ref.reference_name, ref.file_path, ref.language);
      if (resolved?.targetFilePath) {
        plannedEdges.push({
          reference: ref,
          edge: {
            source: ref.from_node_id,
            target: makeFileNodeId(resolved.targetFilePath),
            kind: 'imports',
            provenance: 'code-resolution',
            line: ref.line,
            column: ref.col,
            metadata: { strategy: resolved.strategy, confidence: resolved.confidence },
          },
        });
      }
    } else if (ref.reference_kind === 'calls' || ref.reference_kind === 'extends' || ref.reference_kind === 'implements') {
      callsRefs.push(ref);
    }
  }

  // ── Rule B: calls/extends → file→symbol (按名匹配 nodes) ─────────
  if (callsRefs.length > 0) {
    const names = [...new Set(callsRefs.map(r => r.reference_name))];
    const byName = new Map<string, Array<{ id: string; file_path: string; kind: string }>>();

    const BATCH = 500;
    // extends/implements 引用允许 struct/trait/protocol 目标 (Go 嵌入/Rust trait/ObjC 协议);
    // calls 引用排除低级符号避免噪声。
    const targetKinds = callsRefs.some(r => r.reference_kind === 'extends' || r.reference_kind === 'implements')
      ? ['function', 'method', 'class', 'interface', 'struct', 'trait', 'protocol', 'type_alias', 'enum', 'variable']
      : CALL_TARGET_KINDS;
    const kindsSql = targetKinds.map(() => '?').join(',');
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, name, file_path, kind FROM nodes
         WHERE source_type = 'codegraph'
           AND kind IN (${kindsSql})
           AND name IN (${placeholders})
           AND file_path NOT LIKE '%node_modules%'`
      ).all(...targetKinds, ...batch) as unknown as Array<{ id: string; name: string; file_path: string; kind: string }>;
      for (const row of rows) {
        const list = byName.get(row.name);
        if (list) list.push(row);
        else byName.set(row.name, [row]);
      }
    }

    // 调用点所在目录 → 优先同目录/同文件符号 (降低跨项目同名噪声)
    for (const ref of callsRefs) {
      const targets = byName.get(ref.reference_name);
      if (!targets || targets.length === 0) continue;

      const fromDir = ref.file_path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const sameFile = targets.filter(t => t.file_path.replace(/\\/g, '/') === ref.file_path.replace(/\\/g, '/'));
      const sameDir = sameFile.length > 0 ? sameFile
        : targets.filter(t => t.file_path.replace(/\\/g, '/').startsWith(fromDir + '/'));
      const pool = (sameDir.length > 0 ? sameDir : targets).slice(0, MAX_CALL_TARGETS_PER_NAME);

      for (const target of pool) {
        const edgeKind = ref.reference_kind === 'extends' || ref.reference_kind === 'implements'
          ? (ref.reference_kind as 'extends' | 'implements')
          : 'calls';
        plannedEdges.push({
          reference: ref,
          edge: {
            source: ref.from_node_id,
            target: target.id,
            kind: edgeKind,
            provenance: 'code-resolution',
            line: ref.line,
            column: ref.col,
            metadata: { targetKind: target.kind },
          },
        });
      }
    }
  }

  // ── 幂等写入: 先清旧 code-resolution 边, 再插入 ─────────────────
  // 端点必须存在于 nodes (edges FK) — imports 边目标文件可能未被索引
  // (排除/未扫描), 批量查 nodes 过滤后再写, 避免逐条 FK 失败。
  const insertedEdges: UnifiedEdge[] = [];
  const insertedKeys = new Set<string>();
  const persistEdges = (): void => {
    db.prepare(`DELETE FROM edges WHERE provenance = 'code-resolution'`).run();
    if (plannedEdges.length === 0) return;

    const stmt = db.prepare(
      `INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const seen = new Set<string>();

    const endpointIds = new Set<string>();
    for (const { edge } of plannedEdges) {
      endpointIds.add(edge.source);
      endpointIds.add(edge.target);
    }
    const existingIds = new Set<string>();
    const idList = [...endpointIds];
    const BATCH = 500;
    for (let i = 0; i < idList.length; i += BATCH) {
      const batch = idList.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id FROM nodes WHERE id IN (${placeholders})`
      ).all(...batch) as unknown as Array<{ id: string }>;
      for (const row of rows) existingIds.add(row.id);
    }

    let skippedMissingEndpoint = 0;
    for (const { edge } of plannedEdges) {
      const key = edgeIdentity(edge);
      if (seen.has(key)) continue; // 去重
      seen.add(key);
      if (!existingIds.has(edge.source) || !existingIds.has(edge.target)) {
        skippedMissingEndpoint++;
        continue;
      }
      stmt.run(
        edge.source, edge.target, edge.kind,
        edge.metadata ? JSON.stringify(edge.metadata) : null,
        edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
      );
      insertedEdges.push(edge);
      insertedKeys.add(key);
    }
    if (skippedMissingEndpoint > 0 && process.env.MAESTRO_DEBUG === '1') {
      console.warn(`[KG] code-resolution skipped ${skippedMissingEndpoint} edges with missing endpoints`);
    }
  };
  if (options?.transactionMode === 'caller-owned') {
    persistEdges();
  } else {
    sqliteTransaction(db, persistEdges);
  }

  const resolvedRefs = new Set<UnresolvedRefRow>();
  for (const plan of plannedEdges) {
    if (insertedKeys.has(edgeIdentity(plan.edge))) resolvedRefs.add(plan.reference);
  }
  const writtenImports = insertedEdges.filter(edge => edge.kind === 'imports').length;
  const writtenCalls = insertedEdges.filter(edge => edge.kind === 'calls').length;

  return {
    edgesCreated: insertedEdges.length,
    importsEdges: writtenImports,
    callsEdges: writtenCalls,
    unresolvedCount: refs.length - resolvedRefs.size,
    durationMs: Date.now() - startMs,
    edges: insertedEdges,
  };
}

function edgeIdentity(edge: UnifiedEdge): string {
  return `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
}
