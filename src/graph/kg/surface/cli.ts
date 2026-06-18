// src/graph/kg/surface/cli.ts — maestro kg CLI 命令注册
// 参考: plan-maestrograph.md CLI 命令设计 + src/commands/kg.ts (现有命令)

import type { Command } from 'commander';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { MaestroGraph } from '../engine.js';
import { searchUnified, parseQuery } from '../query/search.js';
import { bfs, findShortestPath, getCallers, getCallees, getImpactRadius } from '../query/traversal.js';
import { buildContext } from '../query/context-builder.js';
import { syncKnowledgeGraph } from '../extraction/orchestrator.js';
import { getKgDatabasePath } from '../db/connection.js';
import type { UnifiedNode, SourceType } from '../db/types.js';

function parseCsv(value: string | undefined): string[] | undefined {
  return value
    ? value.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined;
}

function normalizeSources(value: string | undefined): SourceType[] | undefined {
  return parseCsv(value) as SourceType[] | undefined;
}

function printSyncResults(results: Awaited<ReturnType<typeof syncKnowledgeGraph>>): void {
  let totalNodes = 0;
  let totalEdges = 0;
  for (const r of results) {
    totalNodes += r.nodesAdded;
    totalEdges += r.edgesAdded;
    console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
  }
  console.log(`\nTotal: ${totalNodes} nodes, ${totalEdges} edges`);
}

async function syncProject(
  opts: { full?: boolean; source?: string; json?: boolean },
  label = 'Syncing MaestroGraph...',
): Promise<void> {
  const projectRoot = resolve('.');
  const sources = normalizeSources(opts.source);

  if (!opts.json) console.log(label);
  const results = await syncKnowledgeGraph(projectRoot, {
    full: opts.full,
    sources,
  });

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  printSyncResults(results);
}

async function openGraph(): Promise<MaestroGraph> {
  const projectRoot = resolve('.');
  if (!MaestroGraph.isInitialized(projectRoot)) {
    console.error('MaestroGraph not initialized for this project.');
    console.error('  Run: maestro kg sync');
    process.exit(1);
  }
  return MaestroGraph.open(projectRoot);
}

function formatNodeLabel(node: UnifiedNode): string {
  const loc = node.filePath ? ` ${node.filePath}:${node.startLine}` : '';
  const detail = node.signature || node.definition;
  const suffix = detail ? ` -- ${detail.substring(0, 80)}` : '';
  return `[${node.sourceType}:${node.kind}] ${node.name}${loc}${suffix}`;
}

function resolveNodeOrExit(mg: MaestroGraph, query: string): UnifiedNode {
  const direct = mg.getNode(query);
  if (direct) return direct;

  const matches = mg.searchUnified(query, { sourceTypes: ['codegraph'], limit: 5 }).directMatches;
  if (matches.length === 0) {
    console.error(`Node not found: ${query}`);
    process.exit(1);
  }
  return matches[0].node;
}

// ---------------------------------------------------------------------------
// 注册 maestro kg 子命令
// ---------------------------------------------------------------------------

export function registerKgCommands(program: Command): void {
  const kg = program
    .command('kg')
    .description('Unified knowledge graph — query, sync, and manage MaestroGraph');

  // ── init ──────────────────────────────────────────────────────────
  kg
    .command('init')
    .description('Initialize MaestroGraph database (.workflow/kg/maestro.db)')
    .action(async () => {
      const projectRoot = resolve('.');
      if (MaestroGraph.isInitialized(projectRoot)) {
        console.log('MaestroGraph already initialized.');
        return;
      }
      const mg = await MaestroGraph.init(projectRoot);
      const stats = mg.getStats();
      console.log(`MaestroGraph initialized: ${stats.dbSizeBytes} bytes, schema v${stats.schemaVersion}`);
      mg.close();
    });

  // ── sync ──────────────────────────────────────────────────────────
  kg
    .command('sync')
    .description('Sync knowledge graph — extract from all sources')
    .option('--full', 'Full rebuild (ignore file hashes)')
    .option('--source <sources>', 'Comma-separated sources: domain,spec,knowhow,codebase,issue,codegraph')
    .option('--json', 'Output as JSON')
    .action(async (opts) => syncProject(opts));

  kg
    .command('sync-all')
    .description('Compatibility alias for sync — sync all MaestroGraph sources')
    .option('--full', 'Full rebuild (ignore file hashes)')
    .option('--source <sources>', 'Comma-separated sources: domain,spec,knowhow,codebase,issue,codegraph')
    .option('--json', 'Output as JSON')
    .action(async (opts) => syncProject(opts, 'Syncing MaestroGraph (all knowledge sources)...'));

  kg
    .command('index')
    .description('Compatibility alias for sync --source codegraph')
    .option('--src <path>', 'Accepted for compatibility; MaestroGraph auto-detects source roots')
    .option('--json', 'Output as JSON')
    .action(async (opts) => syncProject({ source: 'codegraph', json: opts.json }, 'Indexing code with MaestroGraph...'));

  // ── query ─────────────────────────────────────────────────────────
  kg
    .command('query <text>')
    .description('Search across all knowledge layers')
    .option('--source <types>', 'Filter by source type (comma-separated)')
    .option('--kind <types>', 'Filter by node kind')
    .option('--depth <n>', 'Graph traversal depth', '1')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (text: string, opts) => {
      const mg = await MaestroGraph.open(resolve('.'));
      try {
        const parsed = parseQuery(text);
        const sourceTypes = opts.source?.split(',')
          ?? (parsed.sourceTypes.length > 0 ? parsed.sourceTypes : undefined);
        const kinds = opts.kind?.split(',')
          ?? (parsed.kinds.length > 0 ? parsed.kinds : undefined);
        const effectiveText = parsed.text || text;

        const output = mg.searchUnified(effectiveText, {
          sourceTypes: sourceTypes as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          kinds: kinds as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          limit: Math.min(Number(opts.limit) || 20, 500),
        });
        const results = output.directMatches;

        if (opts.json) {
          console.log(JSON.stringify({ query: text, parsed: { text: effectiveText, kinds, sourceTypes }, results: results.map(r => ({
            id: r.node.id, kind: r.node.kind, name: r.node.name, sourceType: r.node.sourceType,
            definition: r.node.definition.substring(0, 200), score: r.score,
          })), summary: output.summary }, null, 2));
          return;
        }

        console.log(`Query: "${effectiveText}" (${results.length} results)`);
        for (const r of results) {
          const def = r.node.definition ? ` — ${r.node.definition.substring(0, 80)}` : '';
          const scoreTag = r.score > 0 ? `  (${r.score.toFixed(1)})` : '';
          console.log(`  [${r.node.sourceType}:${r.node.kind}] ${r.node.name}${def}${scoreTag}`);
        }
      } finally {
        mg.close();
      }
    });

  kg
    .command('search <text>')
    .description('Compatibility alias for query')
    .option('--source <types>', 'Filter by source type (comma-separated)')
    .option('--kind <types>', 'Filter by node kind')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (text: string, opts) => {
      const mg = await openGraph();
      try {
        const parsed = parseQuery(text);
        const sourceTypes = parseCsv(opts.source) ?? (parsed.sourceTypes.length > 0 ? parsed.sourceTypes : undefined);
        const kinds = parseCsv(opts.kind) ?? (parsed.kinds.length > 0 ? parsed.kinds : undefined);
        const effectiveText = parsed.text || text;
        const output = mg.searchUnified(effectiveText, {
          sourceTypes: sourceTypes as SourceType[] | undefined,
          kinds,
          limit: Math.min(Number(opts.limit) || 20, 500),
        });

        if (opts.json) {
          console.log(JSON.stringify({
            query: text,
            total: output.directMatches.length,
            nodes: output.directMatches.map(r => ({ ...r.node, score: r.score })),
            engine: 'maestrograph',
          }, null, 2));
          return;
        }

        console.log(`Search: "${effectiveText}"  (${output.directMatches.length} results, MaestroGraph)`);
        for (const r of output.directMatches) {
          console.log(`  ${r.node.id}  ${formatNodeLabel(r.node)}  (${r.score.toFixed(1)})`);
        }
      } finally {
        mg.close();
      }
    });

  // ── context ───────────────────────────────────────────────────────
  kg
    .command('context <node>')
    .description('Show full context for a node id or symbol name (all related layers)')
    .option('--depth <n>', 'Graph traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery);

        const traversal = mg.traverse(node.id, {
          maxDepth: Math.min(Number(opts.depth) || 1, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify({
            node: { id: node.id, kind: node.kind, name: node.name, sourceType: node.sourceType },
            related: [...traversal.nodes.values()].map(n => ({
              id: n.id, kind: n.kind, name: n.name, sourceType: n.sourceType,
            })),
            edges: traversal.edges,
            resolvedFrom: nodeQuery,
          }, null, 2));
          return;
        }

        if (node.id !== nodeQuery) console.log(`Resolved "${nodeQuery}" -> ${node.id}`);
        console.log(`Node: [${node.sourceType}:${node.kind}] ${node.name}`);
        if (node.definition) console.log(`  Definition: ${node.definition}`);
        if (node.filePath) console.log(`  File: ${node.filePath}:${node.startLine}`);

        if (traversal.nodes.size > 1) {
          console.log(`\nRelated (${traversal.nodes.size - 1}):`);
          for (const [id, related] of traversal.nodes) {
            if (id === node.id) continue;
            console.log(`  [${related.sourceType}:${related.kind}] ${related.name}`);
          }
        }
      } finally {
        mg.close();
      }
    });

  // ── path ──────────────────────────────────────────────────────────
  kg
    .command('path <from-id> <to-id>')
    .description('Find shortest path between two nodes')
    .option('--json', 'Output as JSON')
    .action(async (fromId: string, toId: string, opts) => {
      const mg = await MaestroGraph.open(resolve('.'));
      try {
        const queries = mg.getQueryBuilder();
        const path = findShortestPath(queries, fromId, toId);

        if (opts.json) {
          console.log(JSON.stringify({ from: fromId, to: toId, path }, null, 2));
          return;
        }

        if (!path) {
          console.log(`No path found from ${fromId} to ${toId}`);
        } else {
          console.log(`Path (${path.length} hops):`);
          for (const step of path) {
            const node = mg.getNode(step.nodeId);
            const edgeLabel = step.edge ? ` --[${step.edge.kind}]-->` : '';
            console.log(`  [${node?.sourceType ?? '?'}:${node?.kind ?? '?'}] ${node?.name ?? step.nodeId}${edgeLabel}`);
          }
        }
      } finally {
        mg.close();
      }
    });

  // ── callers ───────────────────────────────────────────────────────
  kg
    .command('callers <node>')
    .description('Show callers of a function/method by node id or symbol name')
    .option('--depth <n>', 'Traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery);
        const callers = mg.getCallers(node.id, Math.min(Number(opts.depth) || 1, 10));

        if (opts.json) {
          console.log(JSON.stringify({ node: node.id, callers: callers.map(c => ({
            id: c.node.id, name: c.node.name, kind: c.node.kind, edgeKind: c.edge.kind,
          })) }, null, 2));
          return;
        }

        console.log(`Callers of ${node.id} (${callers.length}):`);
        for (const { node, edge } of callers) {
          console.log(`  ${formatNodeLabel(node)} --${edge.kind}-->`);
        }
      } finally {
        mg.close();
      }
    });

  // ── callees ───────────────────────────────────────────────────────
  kg
    .command('callees <node>')
    .description('Show callees of a function/method by node id or symbol name')
    .option('--depth <n>', 'Traversal depth', '1')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery);
        const callees = mg.getCallees(node.id, Math.min(Number(opts.depth) || 1, 10));

        if (opts.json) {
          console.log(JSON.stringify({ node: node.id, callees: callees.map(c => ({
            id: c.node.id, name: c.node.name, kind: c.node.kind, edgeKind: c.edge.kind,
          })) }, null, 2));
          return;
        }

        console.log(`Callees of ${node.id} (${callees.length}):`);
        for (const { node, edge } of callees) {
          console.log(`  --${edge.kind}--> ${formatNodeLabel(node)}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── impact ────────────────────────────────────────────────────────
  kg
    .command('impact <node>')
    .description('Show transitive impact radius by node id or symbol name')
    .option('--depth <n>', 'Max depth', '3')
    .option('--json', 'Output as JSON')
    .action(async (nodeQuery: string, opts) => {
      const mg = await openGraph();
      try {
        const node = resolveNodeOrExit(mg, nodeQuery);
        const impact = mg.getImpact(node.id, Math.min(Number(opts.depth) || 3, 10));

        if (opts.json) {
          console.log(JSON.stringify({
            node: node.id,
            nodeCount: impact.nodes.size,
            edgeCount: impact.edges.length,
            nodes: [...impact.nodes.values()].map(n => ({ id: n.id, kind: n.kind, name: n.name })),
          }, null, 2));
          return;
        }

        console.log(`Impact radius for ${node.id}: ${impact.nodes.size} nodes, ${impact.edges.length} edges`);
        for (const related of impact.nodes.values()) {
          if (related.id === node.id) continue;
          console.log(`  ${formatNodeLabel(related)}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── stats ─────────────────────────────────────────────────────────
  kg
    .command('stats')
    .description('Show knowledge graph statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const mg = await MaestroGraph.open(resolve('.'));
      try {
        const stats = mg.getStats();

        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        console.log('MaestroGraph Statistics');
        console.log('─'.repeat(40));
        console.log(`Nodes: ${stats.nodeCount}`);
        for (const [kind, count] of Object.entries(stats.nodesByKind)) {
          console.log(`  ${kind}: ${count}`);
        }
        console.log(`\nEdges: ${stats.edgeCount}`);
        for (const [kind, count] of Object.entries(stats.edgesByKind)) {
          console.log(`  ${kind}: ${count}`);
        }
        console.log(`\nBy source:`);
        for (const [source, count] of Object.entries(stats.nodesBySourceType)) {
          console.log(`  ${source}: ${count}`);
        }
        console.log(`\nFiles: ${stats.fileCount}`);
        console.log(`DB size: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`Schema: v${stats.schemaVersion}`);
        console.log(`Staleness: ${(stats.stalenessRatio * 100).toFixed(1)}%`);
        if (stats.detectedFrameworks.length > 0) {
          console.log(`Frameworks: ${stats.detectedFrameworks.join(', ')}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── health ────────────────────────────────────────────────────────
  kg
    .command('health')
    .description('Check knowledge graph health')
    .action(async () => {
      const dbPath = getKgDatabasePath(resolve('.'));
      if (!existsSync(dbPath)) {
        console.log('✗ MaestroGraph not initialized. Run: maestro kg init');
        return;
      }

      const mg = await MaestroGraph.open(resolve('.'));
      try {
        const stats = mg.getStats();
        const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];

        // DB 存在
        checks.push({ name: 'Database', status: 'pass', detail: dbPath });

        // Schema 版本
        checks.push({
          name: 'Schema',
          status: stats.schemaVersion >= 2 ? 'pass' : 'warn',
          detail: `v${stats.schemaVersion}`,
        });

        // 过期率
        checks.push({
          name: 'Staleness',
          status: stats.stalenessRatio < 0.1 ? 'pass' : stats.stalenessRatio < 0.3 ? 'warn' : 'fail',
          detail: `${(stats.stalenessRatio * 100).toFixed(1)}%`,
        });

        // 节点数
        checks.push({
          name: 'Nodes',
          status: stats.nodeCount > 0 ? 'pass' : 'warn',
          detail: String(stats.nodeCount),
        });

        for (const check of checks) {
          const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
          console.log(`${icon} ${check.name}: ${check.detail}`);
        }
      } finally {
        mg.close();
      }
    });

  // ── migrate ──────────────────────────────────────────────────────
  kg
    .command('migrate')
    .description('Migrate legacy knowledge sources to MaestroGraph')
    .option('--dry-run', 'Show what would be migrated without writing')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const projectRoot = resolve('.');
      const workflowRoot = resolve(projectRoot, '.workflow');

      // Detect legacy sources
      const legacySources = [
        {
          name: 'codegraph-sqlite',
          path: resolve(projectRoot, '.codegraph'),
          estimateNodes: (p: string) => existsSync(p) ? 50 : 0,
        },
        {
          name: 'specs',
          path: resolve(workflowRoot, 'specs'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readdirSync } = require('node:fs');
              return readdirSync(p).filter((f: string) => f.endsWith('.md')).length;
            } catch { return 0; }
          },
        },
        {
          name: 'knowhow',
          path: resolve(workflowRoot, 'knowhow'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readdirSync } = require('node:fs');
              return readdirSync(p).filter((f: string) => f.endsWith('.md')).length;
            } catch { return 0; }
          },
        },
        {
          name: 'domain-glossary',
          path: resolve(workflowRoot, 'domain', 'glossary.json'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readFileSync } = require('node:fs');
              const data = JSON.parse(readFileSync(p, 'utf-8'));
              return Array.isArray(data) ? data.length : Object.keys(data).length;
            } catch { return 0; }
          },
        },
        {
          name: 'issues',
          path: resolve(workflowRoot, 'issues', 'issues.jsonl'),
          estimateNodes: (p: string) => {
            if (!existsSync(p)) return 0;
            try {
              const { readFileSync } = require('node:fs');
              return readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).length;
            } catch { return 0; }
          },
        },
      ];

      const detected = legacySources.map(s => ({
        name: s.name,
        path: s.path,
        detected: existsSync(s.path),
        estimatedNodes: s.estimateNodes(s.path),
      }));

      if (opts.dryRun) {
        if (opts.json) {
          console.log(JSON.stringify({ dryRun: true, sources: detected }, null, 2));
          return;
        }
        console.log('Legacy source detection (dry run):');
        for (const s of detected) {
          const icon = s.detected ? '✓' : '✗';
          console.log(`  ${icon} ${s.name}: ${s.path} (${s.estimatedNodes} estimated nodes)`);
        }
        return;
      }

      const hasAny = detected.some(s => s.detected);
      if (!hasAny) {
        console.log('No legacy sources detected. Nothing to migrate.');
        return;
      }

      console.log('Migrating legacy sources to MaestroGraph...');
      const startMs = Date.now();

      const results = await syncKnowledgeGraph(projectRoot);

      const durationMs = Date.now() - startMs;
      const totalNodes = results.reduce((sum, r) => sum + r.nodesAdded, 0);
      const totalEdges = results.reduce((sum, r) => sum + r.edgesAdded, 0);

      if (opts.json) {
        console.log(JSON.stringify({
          sources: detected,
          results,
          summary: { nodesImported: totalNodes, edgesCreated: totalEdges, durationMs },
        }, null, 2));
        return;
      }

      console.log('Sources detected:');
      for (const s of detected) {
        const icon = s.detected ? '✓' : '✗';
        console.log(`  ${icon} ${s.name} (${s.estimatedNodes} estimated nodes)`);
      }
      console.log('\nMigration results:');
      for (const r of results) {
        console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
      }
      console.log(`\nTotal: ${totalNodes} nodes imported, ${totalEdges} edges created in ${durationMs}ms`);
    });

  // ── rebuild ──────────────────────────────────────────────────────
  kg
    .command('rebuild')
    .description('Rebuild MaestroGraph database from scratch')
    .option('--json', 'Output as JSON')
    .option('--confirm', 'Skip confirmation warning')
    .action(async (opts) => {
      const projectRoot = resolve('.');
      const dbPath = getKgDatabasePath(projectRoot);

      if (existsSync(dbPath)) {
        if (!opts.confirm) {
          console.log(`⚠ Existing database will be deleted: ${dbPath}`);
          console.log('  Use --confirm to suppress this warning.');
        }
        unlinkSync(dbPath);
        console.log('Deleted existing database.');
      }

      console.log('Rebuilding MaestroGraph from scratch...');
      const startMs = Date.now();

      // Create fresh DB
      const mg = await MaestroGraph.init(projectRoot);
      mg.close();

      // Full sync from all sources
      const results = await syncKnowledgeGraph(projectRoot, { full: true });

      const durationMs = Date.now() - startMs;
      const totalNodes = results.reduce((sum, r) => sum + r.nodesAdded, 0);
      const totalEdges = results.reduce((sum, r) => sum + r.edgesAdded, 0);

      if (opts.json) {
        console.log(JSON.stringify({
          results,
          summary: { nodesImported: totalNodes, edgesCreated: totalEdges, durationMs },
        }, null, 2));
        return;
      }

      console.log('\nRebuild results:');
      for (const r of results) {
        console.log(`  ${r.source}: +${r.nodesAdded} nodes, +${r.edgesAdded} edges (${r.durationMs}ms)`);
      }
      console.log(`\nTotal: ${totalNodes} nodes, ${totalEdges} edges rebuilt in ${durationMs}ms`);
    });
}
