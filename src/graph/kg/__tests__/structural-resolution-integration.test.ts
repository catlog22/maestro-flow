import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { MaestroGraph } from '../engine.js';
import {
  CodegraphSyncCommittedError,
  syncKnowledgeGraph,
} from '../extraction/orchestrator.js';
import { extractCode } from '../extraction/code/code-extractor.js';
import { getSyncStateHealth, readSyncState } from '../sync-state.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectFixture(): {
  root: string;
  sources: string;
  features: string;
  podHeader: string;
  manifestPath: string;
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maestro-structural-integration-')));
  roots.push(root);
  const sources = join(root, 'Sources');
  const features = join(root, 'Features');
  const podHeader = join(root, 'Pods', 'PodKit', 'PodBase.h');
  const manifestPath = join(root, '.workflow', 'kg', 'external-surfaces.json');
  mkdirSync(sources, { recursive: true });
  mkdirSync(features, { recursive: true });
  mkdirSync(join(root, 'Pods', 'PodKit'), { recursive: true });
  mkdirSync(join(root, '.workflow', 'kg'), { recursive: true });
  writeFileSync(join(sources, 'ProjectBase.h'), `
@protocol DemoProtocol
@end
@interface ProjectBase : NSObject <DemoProtocol>
@end
`);
  writeFileSync(join(sources, 'Empty.h'), '#pragma once\n');
  writeFileSync(join(features, 'Child.swift'), `
final class Child: ProjectBase, DemoProtocol {}
`);
  writeFileSync(join(features, 'PodChild.swift'), `
import PodKit
#if canImport(PodKit)
final class PodChild: PodBase {}
#endif
`);
  writeFileSync(podHeader, '@interface PodBase : NSObject\n@end\n');
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 'kg-external-surfaces/1.0',
    files: [{ module: 'PodKit', language: 'objc', path: 'Pods/PodKit/PodBase.h' }],
  }));
  return { root, sources, features, podHeader, manifestPath };
}

async function syncFixture(fixture: ReturnType<typeof projectFixture>, faultInjection?: {
  beforeSourceScan?: (srcDir: string, index: number) => void;
  beforeStructuralResolution?: () => void;
  beforeFtsRebuild?: () => void;
  beforeTransactionCommit?: () => void;
  beforeSyncStateCommit?: () => void;
}, onProgress?: (file: string, count: number, total: number) => void): Promise<void> {
  await syncKnowledgeGraph(fixture.root, {
    sources: ['codegraph'],
    codegraph: {
      srcDirs: [fixture.sources, fixture.features],
      createMaestroIgnore: false,
      includeTests: true,
      onProgress,
    },
    faultInjection,
  });
}

function databaseSnapshot(graph: MaestroGraph): string {
  const db = graph.rawDb;
  const snapshot = {
    nodes: db.prepare('SELECT * FROM nodes ORDER BY id').all(),
    edges: db.prepare('SELECT * FROM edges ORDER BY id').all(),
    files: db.prepare('SELECT * FROM files ORDER BY path').all(),
    unresolvedRefs: db.prepare('SELECT * FROM unresolved_refs ORDER BY id').all(),
    refs: db.prepare('SELECT * FROM structural_refs ORDER BY ref_key').all(),
    fts: db.prepare('SELECT * FROM code_fts_docsize ORDER BY id').all(),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

describe('structural resolution integration', () => {
  it('preserves generic and structural references through the public insertion API', async () => {
    const fixture = projectFixture();
    const graph = await MaestroGraph.init(fixture.root);
    try {
      const extraction = await extractCode({
        projectRoot: fixture.root,
        srcDir: fixture.root,
        includeTests: true,
        createMaestroIgnore: false,
      });
      for (const result of extraction.results) graph.insertExtractionResults(result);

      expect(graph.rawDb.prepare(
        "SELECT COUNT(*) AS count FROM unresolved_refs WHERE reference_kind = 'imports'"
      ).get()).toEqual({ count: 1 });
      expect((graph.rawDb.prepare(
        'SELECT COUNT(*) AS count FROM structural_refs'
      ).get() as { count: number }).count).toBeGreaterThan(0);

      graph.resolveCodeStructuralReferences();
      const child = graph.rawDb.prepare(
        "SELECT id FROM nodes WHERE name = 'Child'"
      ).get() as { id: string };
      const projectBase = graph.rawDb.prepare(
        "SELECT id FROM nodes WHERE name = 'ProjectBase'"
      ).get() as { id: string };
      expect(graph.rawDb.prepare(
        "SELECT kind FROM edges WHERE source = ? AND target = ?"
      ).get(child.id, projectBase.id)).toEqual({ kind: 'extends' });
    } finally {
      graph.close();
    }
  });

  it('rolls back public insertion when reference persistence fails', async () => {
    const fixture = projectFixture();
    const graph = await MaestroGraph.init(fixture.root);
    try {
      const extraction = await extractCode({
        projectRoot: fixture.root,
        srcDir: fixture.root,
        includeTests: true,
        createMaestroIgnore: false,
      });
      const result = extraction.results.find(item =>
        (item.references?.length ?? 0) > 0 && (item.structuralReferences?.length ?? 0) > 0
      );
      expect(result).toBeDefined();
      graph.insertExtractionResults(result!);
      const before = databaseSnapshot(graph);

      const queries = graph.getQueryBuilder();
      const originalInsert = queries.insertUnresolvedRef.bind(queries);
      queries.insertUnresolvedRef = (() => {
        throw new Error('injected public insertion failure');
      }) as typeof queries.insertUnresolvedRef;
      try {
        expect(() => graph.insertExtractionResults(result!)).toThrow(
          'injected public insertion failure',
        );
      } finally {
        queries.insertUnresolvedRef = originalInsert;
      }

      expect(databaseSnapshot(graph)).toBe(before);
    } finally {
      graph.close();
    }
  });

  it('marks health stale when exact external inputs diverge from the watermark', async () => {
    const fixture = projectFixture();
    await MaestroGraph.init(fixture.root).then(graph => graph.close());
    await syncFixture(fixture);

    const graph = await MaestroGraph.open(fixture.root);
    try {
      expect(graph.getHealth().syncState).toMatchObject({ status: 'fresh', stale: false });
      writeFileSync(
        fixture.podHeader,
        `${readFileSync(fixture.podHeader, 'utf-8')}\n// changed after sync\n`,
      );
      expect(graph.getHealth().syncState).toMatchObject({ status: 'stale', stale: true });
    } finally {
      graph.close();
    }
  });

  it('atomically resolves project and exact-header ObjC targets across multiple srcDirs', async () => {
    const fixture = projectFixture();
    const initialized = await MaestroGraph.init(fixture.root);
    initialized.rawDb.prepare(`
      INSERT INTO nodes (
        id, kind, name, qualified_name, file_path, language, source_type, updated_at
      ) VALUES ('spec:knowledge-only', 'spec_entry', 'KnowledgeOnly', 'KnowledgeOnly', '', 'unknown', 'spec', 1)
    `).run();
    initialized.close();
    await syncFixture(fixture);

    const graph = await MaestroGraph.open(fixture.root);
    try {
      const db = graph.rawDb;
      const files = db.prepare(
        "SELECT path, node_count, language FROM files WHERE source_type = 'codegraph' ORDER BY path"
      ).all() as unknown as Array<{ path: string; node_count: number; language: string }>;
      expect(files).toHaveLength(5);
      expect(files.filter(file => file.path === fixture.podHeader)).toHaveLength(1);
      expect(files.find(file => file.path.endsWith('/Empty.h'))).toMatchObject({
        // Every scanned source owns one file node even when it has no symbols.
        node_count: 1,
        language: 'c',
      });

      const child = db.prepare("SELECT id FROM nodes WHERE name = 'Child'").get() as { id: string };
      const projectBase = db.prepare("SELECT id FROM nodes WHERE name = 'ProjectBase'").get() as { id: string };
      const demoProtocol = db.prepare("SELECT id FROM nodes WHERE name = 'DemoProtocol'").get() as { id: string };
      const podChild = db.prepare("SELECT id FROM nodes WHERE name = 'PodChild'").get() as { id: string };
      const podBase = db.prepare("SELECT id FROM nodes WHERE name = 'PodBase'").get() as { id: string };
      expect(db.prepare(
        "SELECT kind FROM edges WHERE source = ? AND target = ?"
      ).get(child.id, projectBase.id)).toEqual({ kind: 'extends' });
      expect(db.prepare(
        "SELECT kind FROM edges WHERE source = ? AND target = ?"
      ).get(child.id, demoProtocol.id)).toEqual({ kind: 'implements' });
      const conditional = db.prepare(
        "SELECT kind, metadata FROM edges WHERE source = ? AND target = ?"
      ).get(podChild.id, podBase.id) as { kind: string; metadata: string };
      expect(conditional.kind).toBe('extends');
      expect(JSON.parse(conditional.metadata)).toMatchObject({
        compilationCondition: '#if canImport(PodKit)',
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM structural_refs WHERE status != 'resolved'"
      ).get()).toEqual({ count: 0 });
      expect(db.prepare(
        'SELECT reference_name, reference_kind, language FROM unresolved_refs'
      ).all()).toEqual([{
        reference_name: 'PodKit',
        reference_kind: 'imports',
        language: 'swift',
      }]);

      const replayed = graph.resolveReferences();
      expect(replayed.codeStructuralEdgesCreated).toBeGreaterThan(0);
      expect(replayed.knowledgeEdgesCreated).toBe(0);
      expect(replayed.edgesCreated).toBe(
        replayed.codeStructuralEdgesCreated + replayed.knowledgeEdgesCreated,
      );

      const ftsDifference = db.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT rowid AS identity FROM nodes WHERE source_type = 'codegraph'
          EXCEPT SELECT id AS identity FROM code_fts_docsize
        )
      `).get() as { count: number };
      expect(ftsDifference.count).toBe(0);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'KnowledgeOnly'"
      ).get()).toEqual({ count: 0 });
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      const firstCounts = {
        nodes: db.prepare("SELECT COUNT(*) AS count FROM nodes WHERE source_type='codegraph'").get(),
        edges: db.prepare('SELECT COUNT(*) AS count FROM edges').get(),
        files: db.prepare("SELECT COUNT(*) AS count FROM files WHERE source_type='codegraph'").get(),
        refs: db.prepare('SELECT ref_key FROM structural_refs ORDER BY ref_key').all(),
      };
      graph.close();
      await syncFixture(fixture);
      const second = await MaestroGraph.open(fixture.root);
      try {
        expect({
          nodes: second.rawDb.prepare("SELECT COUNT(*) AS count FROM nodes WHERE source_type='codegraph'").get(),
          edges: second.rawDb.prepare('SELECT COUNT(*) AS count FROM edges').get(),
          files: second.rawDb.prepare("SELECT COUNT(*) AS count FROM files WHERE source_type='codegraph'").get(),
          refs: second.rawDb.prepare('SELECT ref_key FROM structural_refs ORDER BY ref_key').all(),
        }).toEqual(firstCounts);
      } finally {
        second.close();
      }
      rmSync(join(fixture.sources, 'Empty.h'));
      await syncFixture(fixture);
      const shrunk = await MaestroGraph.open(fixture.root);
      try {
        expect(shrunk.rawDb.prepare(
          "SELECT COUNT(*) AS count FROM files WHERE path LIKE '%/Empty.h'"
        ).get()).toEqual({ count: 0 });
      } finally {
        shrunk.close();
      }
      return;
    } finally {
      graph.close();
    }
  });

  it('rolls back graph, refs, files, and rebuilt FTS for pre-COMMIT faults', async () => {
    const fixture = projectFixture();
    await MaestroGraph.init(fixture.root).then(graph => graph.close());
    await syncFixture(fixture);
    const initial = await MaestroGraph.open(fixture.root);
    const beforeHash = databaseSnapshot(initial);
    initial.close();
    const beforeState = readFileSync(join(fixture.root, '.workflow', 'kg', 'sync-state.json'), 'utf-8');
    const priorSuccessful = readSyncState(fixture.root)?.lastSuccessful;

    writeFileSync(join(fixture.features, 'Child.swift'), 'final class Replacement: ProjectBase {}\n');
    await expect(syncFixture(fixture, {
      beforeTransactionCommit: () => { throw new Error('fault-after-fts'); },
    })).rejects.toThrow('fault-after-fts');

    const after = await MaestroGraph.open(fixture.root);
    try {
      expect(databaseSnapshot(after)).toBe(beforeHash);
      expect(after.rawDb.prepare("SELECT COUNT(*) AS count FROM nodes WHERE name='Replacement'").get())
        .toEqual({ count: 0 });
      expect(after.rawDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(after.rawDb.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      after.close();
    }
    expect(readFileSync(join(fixture.root, '.workflow', 'kg', 'sync-state.json'), 'utf-8'))
      .not.toBe(beforeState);
    expect(readSyncState(fixture.root)).toMatchObject({
      lastSuccessful: priorSuccessful,
      lastAttempt: { status: 'failed', error: 'fault-after-fts' },
    });
    expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });

    const childPath = join(fixture.features, 'Child.swift');
    const unavailableChildPath = `${childPath}-unavailable`;
    let movedScheduledFile = false;
    await expect(syncFixture(fixture, undefined, (file) => {
      if (file !== childPath || movedScheduledFile) return;
      renameSync(childPath, unavailableChildPath);
      movedScheduledFile = true;
    })).rejects.toThrow();
    try {
      const afterExtractionFault = await MaestroGraph.open(fixture.root);
      try {
        expect(databaseSnapshot(afterExtractionFault)).toBe(beforeHash);
      } finally {
        afterExtractionFault.close();
      }
      expect(readSyncState(fixture.root)).toMatchObject({
        lastSuccessful: priorSuccessful,
        lastAttempt: { status: 'failed' },
      });
      expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });
    } finally {
      if (movedScheduledFile) renameSync(unavailableChildPath, childPath);
    }

    await expect(syncFixture(fixture, {
      beforeStructuralResolution: () => { throw new Error('resolver-fault'); },
    })).rejects.toThrow('resolver-fault');
    const afterResolverFault = await MaestroGraph.open(fixture.root);
    try {
      expect(databaseSnapshot(afterResolverFault)).toBe(beforeHash);
    } finally {
      afterResolverFault.close();
    }
    expect(readSyncState(fixture.root)).toMatchObject({
      lastSuccessful: priorSuccessful,
      lastAttempt: { status: 'failed', error: 'resolver-fault' },
    });
    expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });

    const unavailableFeatures = `${fixture.features}-unavailable`;
    renameSync(fixture.features, unavailableFeatures);
    try {
      await expect(syncFixture(fixture)).rejects.toThrow('Code source directory does not exist');
      const afterMissingRoot = await MaestroGraph.open(fixture.root);
      try {
        expect(databaseSnapshot(afterMissingRoot)).toBe(beforeHash);
      } finally {
        afterMissingRoot.close();
      }
      expect(readSyncState(fixture.root)).toMatchObject({
        lastSuccessful: priorSuccessful,
        lastAttempt: { status: 'failed', error: expect.stringContaining('does not exist') },
      });
      expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });
    } finally {
      renameSync(unavailableFeatures, fixture.features);
    }

    let movedDuringScan = false;
    await expect(syncFixture(fixture, {
      beforeSourceScan: (_srcDir, index) => {
        if (index !== 1) return;
        renameSync(fixture.features, unavailableFeatures);
        movedDuringScan = true;
      },
    })).rejects.toThrow('became unavailable during scan');
    try {
      const afterScanRace = await MaestroGraph.open(fixture.root);
      try {
        expect(databaseSnapshot(afterScanRace)).toBe(beforeHash);
      } finally {
        afterScanRace.close();
      }
      expect(readSyncState(fixture.root)).toMatchObject({
        lastSuccessful: priorSuccessful,
        lastAttempt: { status: 'failed', error: expect.stringContaining('became unavailable') },
      });
      expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });
    } finally {
      if (movedDuringScan) renameSync(unavailableFeatures, fixture.features);
    }

    writeFileSync(fixture.manifestPath, '{invalid');
    await expect(syncFixture(fixture)).rejects.toThrow('Invalid external surface manifest');
    const afterManifestFault = await MaestroGraph.open(fixture.root);
    try {
      expect(databaseSnapshot(afterManifestFault)).toBe(beforeHash);
    } finally {
      afterManifestFault.close();
    }
    expect(readSyncState(fixture.root)).toMatchObject({
      lastSuccessful: priorSuccessful,
      lastAttempt: { status: 'failed', error: expect.stringContaining('Invalid external surface manifest') },
    });
    expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });
  });

  it('keeps a committed graph and records retryable stale health when watermark write fails', async () => {
    const fixture = projectFixture();
    await MaestroGraph.init(fixture.root).then(graph => graph.close());
    await syncFixture(fixture);
    const prior = readSyncState(fixture.root)?.lastSuccessful;
    writeFileSync(join(fixture.features, 'Child.swift'), 'final class Replacement: ProjectBase {}\n');

    let committedError: unknown;
    try {
      await syncFixture(fixture, {
        beforeSyncStateCommit: () => { throw new Error('watermark-fault'); },
      });
    } catch (error) {
      committedError = error;
    }
    expect(committedError).toBeInstanceOf(CodegraphSyncCommittedError);
    expect(committedError).toMatchObject({ graphCommitted: true, retryable: true });

    const graph = await MaestroGraph.open(fixture.root);
    try {
      expect(graph.rawDb.prepare(
        "SELECT COUNT(*) AS count FROM nodes WHERE name='Replacement'"
      ).get()).toEqual({ count: 1 });
      expect(graph.rawDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(graph.rawDb.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      graph.close();
    }
    const failedState = readSyncState(fixture.root);
    expect(failedState?.lastSuccessful).toEqual(prior);
    expect(failedState?.lastAttempt).toMatchObject({
      status: 'failed',
      error: 'watermark-fault',
    });
    expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'error', stale: true });

    await syncFixture(fixture);
    expect(readSyncState(fixture.root)?.lastAttempt).toMatchObject({ status: 'succeeded', error: null });
    expect(getSyncStateHealth(fixture.root)).toMatchObject({ status: 'fresh', stale: false });
  });
});
