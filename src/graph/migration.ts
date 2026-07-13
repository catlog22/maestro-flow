import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { loadGraph } from './loader.js';
import { DatabaseConnection, getDatabasePath } from './db/connection.js';
import { QueryBuilder } from './db/queries.js';
import type { KnowledgeGraph, GraphNode, GraphEdge, EnhancedNode, EnhancedEdge, Language, NodeKind, EdgeKind } from './types.js';

const NODE_TYPE_TO_KIND: Record<string, NodeKind> = {
  file: 'file', function: 'function', func: 'function', class: 'class',
  module: 'module', interface: 'interface', enum: 'enum', type: 'type_alias',
  type_alias: 'type_alias', variable: 'variable', constant: 'constant',
  method: 'method', property: 'property', field: 'field',
  struct: 'struct', trait: 'trait', namespace: 'namespace',
  component: 'component', route: 'route',
  concept: 'module', config: 'file', document: 'file',
  service: 'module', endpoint: 'route', pipeline: 'module',
  schema: 'module', resource: 'module', domain: 'module',
  flow: 'module', step: 'function',
  article: 'file', entity: 'module', topic: 'module', claim: 'variable', source: 'file',
};

const EDGE_TYPE_TO_KIND: Record<string, EdgeKind> = {
  imports: 'imports', calls: 'calls', contains: 'contains',
  tested_by: 'references', extends: 'extends', implements: 'implements',
  references: 'references', type_of: 'type_of', returns: 'returns',
  exports: 'exports', instantiates: 'instantiates', overrides: 'overrides',
  decorates: 'decorates',
};

function graphNodeToEnhanced(node: GraphNode): EnhancedNode {
  const kind = NODE_TYPE_TO_KIND[node.type] ?? 'module';
  return {
    id: node.id,
    kind,
    name: node.name,
    qualifiedName: node.id,
    filePath: node.filePath ?? '',
    language: 'unknown' as Language,
    startLine: 0, endLine: 0, startColumn: 0, endColumn: 0,
    docstring: node.summary ?? '',
    signature: '',
    visibility: '',
    isExported: false,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    updatedAt: new Date().toISOString(),
  };
}

function graphEdgeToEnhanced(edge: GraphEdge): EnhancedEdge {
  const kind = EDGE_TYPE_TO_KIND[edge.type] ?? 'references';
  return {
    source: edge.source,
    target: edge.target,
    kind,
    provenance: 'json-migration',
  };
}

export function migrateJsonToSqlite(jsonPath?: string, dbPath?: string): {
  nodes: number; edges: number; dbPath: string;
} {
  const graph = loadGraph(jsonPath);
  const targetDb = dbPath ?? getDatabasePath();
  const dir = dirname(targetDb);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const conn = new DatabaseConnection();
  conn.initialize(targetDb);
  const queries = new QueryBuilder(conn);

  const enhancedNodes = graph.nodes.map(graphNodeToEnhanced);
  const enhancedEdges = graph.edges
    .map(graphEdgeToEnhanced)
    .filter(e => enhancedNodes.some(n => n.id === e.source) && enhancedNodes.some(n => n.id === e.target));

  conn.transaction(() => {
    queries.insertNodes(enhancedNodes);
    queries.insertEdges(enhancedEdges);

    if (graph.project) {
      queries.setMetadata('project_name', graph.project.name);
      queries.setMetadata('languages', JSON.stringify(graph.project.languages));
      queries.setMetadata('frameworks', JSON.stringify(graph.project.frameworks));
    }
  });

  conn.runMaintenance();
  conn.close();

  return { nodes: enhancedNodes.length, edges: enhancedEdges.length, dbPath: targetDb };
}

export function exportSqliteToJson(dbPath?: string): KnowledgeGraph {
  const targetDb = dbPath ?? getDatabasePath();
  const conn = new DatabaseConnection();
  conn.open(targetDb);
  const queries = new QueryBuilder(conn);

  const stats = queries.getStats();
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  for (const [kind] of Object.entries(stats.nodesByKind)) {
    const nodes = queries.getNodesByKind(kind as NodeKind);
    for (const n of nodes) {
      allNodes.push({
        id: n.id,
        type: n.kind,
        name: n.name,
        filePath: n.filePath || undefined,
        summary: n.docstring || n.signature || `${n.kind}: ${n.name}`,
        tags: [n.kind, n.language].filter(Boolean),
        complexity: undefined,
      });
    }
  }

  for (const node of allNodes) {
    const outEdges = queries.getOutgoingEdges(node.id);
    for (const e of outEdges) {
      allEdges.push({
        source: e.source,
        target: e.target,
        type: e.kind,
        direction: 'forward',
      });
    }
  }

  const projectName = queries.getMetadata('project_name') ?? 'unknown';
  const languages = JSON.parse(queries.getMetadata('languages') ?? '[]');
  const frameworks = JSON.parse(queries.getMetadata('frameworks') ?? '[]');

  conn.close();

  return {
    version: '1.0.0',
    valid: true,
    project: {
      name: projectName,
      languages,
      frameworks,
      description: `Exported from SQLite: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`,
      analyzedAt: new Date().toISOString(),
    },
    nodes: allNodes,
    edges: allEdges,
    layers: [],
    tour: [],
  };
}
