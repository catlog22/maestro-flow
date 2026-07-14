import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MaestroGraph } from '../engine.js';
import { syncKnowledgeGraph } from '../extraction/orchestrator.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';
import { getExtractor } from '../extraction/code/languages/index.js';
import { FileLock } from '../sync/file-lock.js';
import type { Language, SourceType, UnifiedNode, UnifiedNodeKind } from '../db/types.js';

function makeNode(overrides: Partial<UnifiedNode> & Pick<UnifiedNode, 'id' | 'name'>): UnifiedNode {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'class' as UnifiedNodeKind,
    name: overrides.name,
    qualifiedName: overrides.qualifiedName ?? overrides.name,
    filePath: overrides.filePath ?? 'src/example.ts',
    language: overrides.language ?? 'typescript' as Language,
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
    definition: overrides.definition ?? '',
    aliases: overrides.aliases ?? [],
    keywords: overrides.keywords ?? [],
    category: overrides.category ?? '',
    roles: [],
    priority: '',
    status: overrides.status ?? 'active',
    body: overrides.body ?? '',
    metadata: {},
    updatedAt: Date.now(),
  };
}

describe('MaestroGraph safety regressions', () => {
  it('rolls back code replacement failures and keeps caller-owned graphs open', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-atomic-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(root, 'src', 'app.yml'), 'service:\n  name: before\n');
      await syncKnowledgeGraph(root, { sources: ['codegraph'], codegraph: { createMaestroIgnore: false } });

      const graph = await MaestroGraph.open(root);
      try {
        const queries = graph.getQueryBuilder();
        const beforeIds = queries.getNodesBySourceType('codegraph').map(node => node.id).sort();
        const originalDelete = queries.deleteNodesBySourceType.bind(queries);
        queries.deleteNodesBySourceType = ((sourceType: SourceType) => {
          originalDelete(sourceType);
          throw new Error('injected write failure');
        }) as typeof queries.deleteNodesBySourceType;

        await expect(syncKnowledgeGraph(root, {
          sources: ['codegraph'],
          codegraph: { createMaestroIgnore: false },
          graph,
        })).rejects.toThrow('injected write failure');

        queries.deleteNodesBySourceType = originalDelete;
        expect(queries.getNodesBySourceType('codegraph').map(node => node.id).sort()).toEqual(beforeIds);
        expect(() => graph.getStats()).not.toThrow();
      } finally {
        graph.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects code source roots outside the project boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'maestro-outside-'));
    try {
      writeFileSync(join(outside, 'secret.yml'), 'secret: true\n');
      await expect(syncKnowledgeGraph(root, {
        sources: ['codegraph'],
        codegraph: { srcDirs: [outside], createMaestroIgnore: false },
      })).rejects.toThrow('must be inside project root');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('repairs a missing FTS table atomically and preserves knowledge search', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-fts-'));
    try {
      const graph = await MaestroGraph.init(root);
      try {
        const queries = graph.getQueryBuilder();
        queries.insertNodes([makeNode({
          id: 'spec:fixture',
          name: 'Protected Data Store',
          kind: 'spec_entry',
          sourceType: 'spec',
          definition: 'file lock backup cache validation',
        })]);
        graph.rawDb.exec('DROP TABLE knowledge_fts');

        const results = queries.searchKnowledgeFTS('protected data store', { limit: 10 });
        expect(results.map(node => node.id)).toContain('spec:fixture');
        expect(graph.rawDb.prepare("SELECT name FROM sqlite_master WHERE name = 'knowledge_fts'").get()).toBeTruthy();
      } finally {
        graph.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves constrains edges through normalized name tokens', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-resolver-'));
    try {
      const graph = await MaestroGraph.init(root);
      try {
        graph.getQueryBuilder().insertNodes([
          makeNode({ id: 'spec:service-rule', name: 'Service rule', kind: 'spec_entry', sourceType: 'spec', keywords: ['service'] }),
          makeNode({ id: 'code:service', name: 'Service', kind: 'class', sourceType: 'codegraph' }),
        ]);
        const result = resolveKnowledgeEdges(graph.rawDb);
        expect(result.edges).toEqual(expect.arrayContaining([
          expect.objectContaining({ source: 'spec:service-rule', target: 'code:service', kind: 'constrains' }),
        ]));
        expect(graph.resolveReferences().edgesCreated).toBeGreaterThanOrEqual(1);
      } finally {
        graph.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps TSX and JSX symbol metadata aligned with the selected extractor', () => {
    const identifier = { type: 'identifier', text: 'Demo', namedChildren: [], startPosition: { row: 0, column: 9 }, endPosition: { row: 0, column: 13 } };
    const declaration = {
      type: 'class_declaration',
      text: 'class Demo {}',
      namedChildren: [],
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 13 },
      childForFieldName: (name: string) => name === 'name' ? identifier : null,
    };
    const tree = { rootNode: {
      type: 'program',
      namedChildren: [declaration],
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 13 },
    } } as never;

    expect(getExtractor('tsx')!.extract(tree, '', 'demo.tsx').symbols[0].language).toBe('tsx');
    expect(getExtractor('jsx')!.extract(tree, '', 'demo.jsx').symbols[0].language).toBe('jsx');
  });

  it('recovers stale lock files before entering the critical section', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-lock-'));
    try {
      const lockPath = join(root, 'maestro.db.lock');
      writeFileSync(lockPath, JSON.stringify({ token: 'stale', pid: 999_999, createdAt: 0 }));
      const value = await new FileLock(lockPath, { staleMs: 1, timeoutMs: 500 }).withLock(async () => 42);
      expect(value).toBe(42);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
