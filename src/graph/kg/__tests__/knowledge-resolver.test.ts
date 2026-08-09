import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Language, SourceType, UnifiedNode, UnifiedNodeKind } from '../db/types.js';
import { MaestroGraph } from '../engine.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';

function makeNode(overrides: Partial<UnifiedNode> & Pick<UnifiedNode, 'id' | 'name'>): UnifiedNode {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'class' as UnifiedNodeKind,
    name: overrides.name,
    qualifiedName: overrides.qualifiedName ?? overrides.name,
    filePath: overrides.filePath ?? '/project/Sources/Fixture.swift',
    language: overrides.language ?? 'swift' as Language,
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: '',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: overrides.sourceType ?? 'codegraph' as SourceType,
    definition: '',
    aliases: [],
    keywords: overrides.keywords ?? [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {},
    updatedAt: Date.now(),
  };
}

describe('knowledge resolver Swift nominal kinds', () => {
  it('allows specs to constrain struct, enum, and protocol nodes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-knowledge-kinds-'));
    try {
      const graph = await MaestroGraph.init(root);
      try {
        graph.getQueryBuilder().insertNodes([
          makeNode({
            id: 'spec:swift-kinds',
            name: 'Swift nominal constraints',
            kind: 'spec_entry',
            sourceType: 'spec',
            keywords: ['swiftstruct', 'swiftenum', 'swiftprotocol'],
          }),
          makeNode({ id: 'code:swift-struct', name: 'SwiftStruct', kind: 'struct' }),
          makeNode({ id: 'code:swift-enum', name: 'SwiftEnum', kind: 'enum' }),
          makeNode({ id: 'code:swift-protocol', name: 'SwiftProtocol', kind: 'protocol' }),
        ]);

        const result = resolveKnowledgeEdges(graph.rawDb);
        const constrainedTargets = result.edges
          .filter(edge => edge.source === 'spec:swift-kinds' && edge.kind === 'constrains')
          .map(edge => edge.target)
          .sort();
        expect(constrainedTargets).toEqual([
          'code:swift-enum',
          'code:swift-protocol',
          'code:swift-struct',
        ]);
      } finally {
        graph.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
