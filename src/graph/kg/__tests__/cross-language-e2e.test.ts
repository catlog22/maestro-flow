import { Command } from 'commander';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaestroGraph } from '../engine.js';
import { syncKnowledgeGraph } from '../extraction/orchestrator.js';
import { makeCodeNodeId } from '../extraction/code/tree-sitter-types.js';
import { registerKgCommands } from '../surface/cli.js';
import { handleMcpTool } from '../surface/mcp-tools.js';

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'swift-objc-crosslang',
);
const roots: string[] = [];

interface CrossLanguageFixture {
  root: string;
  sources: string;
  projectObjCBase: string;
  projectObjCBaseSource: string;
  externalFiles: string[];
  unlistedSibling: string;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFixture(): CrossLanguageFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maestro-cross-language-e2e-')));
  roots.push(root);
  const sources = join(root, 'Sources');
  const moduleA = join(root, 'Pods', 'ModuleA');
  const moduleB = join(root, 'Pods', 'ModuleB');
  const selectedPod = join(root, 'Pods', 'SelectedPod');
  const generatedPod = join(root, 'Pods', 'GeneratedPod');
  const workflow = join(root, '.workflow', 'kg');
  for (const directory of [sources, moduleA, moduleB, selectedPod, generatedPod, workflow]) {
    mkdirSync(directory, { recursive: true });
  }

  const copy = (fixtureName: string, target: string): string => {
    copyFileSync(join(FIXTURE_ROOT, fixtureName), target);
    return realpathSync(target);
  };
  copy('ProjectBase.swift', join(sources, 'ProjectBase.swift'));
  copy('ProjectChild.swift', join(sources, 'ProjectChild.swift'));
  const projectObjCBaseSource = readFileSync(join(FIXTURE_ROOT, 'ProjectObjCBase.h'), 'utf8');
  const projectObjCBase = copy('ProjectObjCBase.h', join(sources, 'ProjectObjCBase.h'));
  const externalFiles = [
    copy('AmbiguousA.h', join(moduleA, 'SharedParent.h')),
    copy('AmbiguousB.h', join(moduleB, 'SharedParent.h')),
    copy('SelectedPodParent.h', join(selectedPod, 'SelectedPodParent.h')),
    copy('GeneratedPod-Swift.h', join(generatedPod, 'GeneratedPod-Swift.h')),
  ];
  const unlistedSibling = join(selectedPod, 'UnlistedSibling.h');
  writeFileSync(unlistedSibling, '@interface UnlistedSibling : NSObject\n@end\n');
  writeFileSync(join(root, '.gitignore'), 'Pods/\n');
  writeFileSync(join(workflow, 'external-surfaces.json'), JSON.stringify({
    schema_version: 'kg-external-surfaces/1.0',
    files: [
      { module: 'ModuleA', language: 'objc', path: 'Pods/ModuleA/SharedParent.h' },
      { module: 'ModuleB', language: 'objc', path: 'Pods/ModuleB/SharedParent.h' },
      { module: 'SelectedPod', language: 'objc', path: 'Pods/SelectedPod/SelectedPodParent.h' },
      { module: 'GeneratedPod', language: 'objc', path: 'Pods/GeneratedPod/GeneratedPod-Swift.h' },
    ],
  }, null, 2));
  return {
    root,
    sources,
    projectObjCBase,
    projectObjCBaseSource,
    externalFiles,
    unlistedSibling,
  };
}

async function syncFixture(fixture: CrossLanguageFixture): Promise<void> {
  await syncKnowledgeGraph(fixture.root, {
    sources: ['codegraph'],
    codegraph: {
      srcDirs: [fixture.sources],
      createMaestroIgnore: false,
      includeTests: true,
    },
  });
}

function exactId(filePath: string, qualifiedName: string): string {
  return makeCodeNodeId(realpathSync(filePath), qualifiedName);
}

function stableMetrics(graph: MaestroGraph): unknown {
  const db = graph.rawDb;
  return {
    nodes: db.prepare("SELECT id FROM nodes WHERE source_type = 'codegraph' ORDER BY id").all(),
    edges: db.prepare(`
      SELECT source, target, kind, COALESCE(origin_ref_key, '') AS origin_ref_key
      FROM edges ORDER BY source, target, kind, origin_ref_key
    `).all(),
    files: db.prepare("SELECT path, language FROM files WHERE source_type = 'codegraph' ORDER BY path").all(),
    refs: db.prepare(`
      SELECT ref_key, status, COALESCE(resolved_node_id, '') AS resolved_node_id,
             candidates, COALESCE(resolution_strategy, '') AS resolution_strategy
      FROM structural_refs ORDER BY ref_key
    `).all(),
  };
}

describe('Swift and Objective-C cross-language E2E', () => {
  it('resolves exact project, Apple, and allowlisted surfaces while preserving negative boundaries', async () => {
    const fixture = createFixture();
    await MaestroGraph.init(fixture.root).then(graph => graph.close());
    await syncFixture(fixture);

    let graph = await MaestroGraph.open(fixture.root);
    const projectChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'ProjectChild');
    const projectBase = exactId(join(fixture.sources, 'ProjectBase.swift'), 'ProjectBase');
    const projectObjCChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'ProjectObjCChild');
    const projectObjCBase = exactId(fixture.projectObjCBase, 'ProjectObjCBase');
    const appleAliasChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'AppleAliasChild');
    const appleUrlProtocol = 'code:@external/apple/Foundation:NSURLProtocol';
    const selectedPodChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'SelectedPodChild');
    const selectedPodParent = exactId(fixture.externalFiles[2], 'SelectedPodParent');
    const conditionalChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'ConditionalGeneratedChild');
    const generatedParent = exactId(fixture.externalFiles[3], 'GeneratedPodParent');
    const ambiguousChild = exactId(join(fixture.sources, 'ProjectChild.swift'), 'AmbiguousChild');

    const expectEdge = (source: string, target: string): { kind: string; metadata: string | null } => {
      const row = graph.rawDb.prepare(`
        SELECT kind, metadata FROM edges
        WHERE source = ? AND target = ? AND kind IN ('extends', 'implements')
      `).get(source, target) as unknown as { kind: string; metadata: string | null } | undefined;
      expect(row).toBeDefined();
      return row!;
    };

    expectEdge(projectChild, projectBase);
    expectEdge(projectObjCChild, projectObjCBase);
    expectEdge(appleAliasChild, appleUrlProtocol);
    expectEdge(selectedPodChild, selectedPodParent);
    const conditional = expectEdge(conditionalChild, generatedParent);
    expect(JSON.parse(conditional.metadata ?? '{}')).toMatchObject({
      compilationCondition: '#if canImport(GeneratedPod)',
      structuralReference: { rawTargetName: 'GeneratedPodParent' },
    });

    const ambiguity = graph.rawDb.prepare(`
      SELECT ref_key, status, candidates FROM structural_refs
      WHERE anchor_node_id = ? AND raw_target_name = 'SharedParent'
    `).get(ambiguousChild) as unknown as { ref_key: string; status: string; candidates: string };
    expect(ambiguity.status).toBe('ambiguous');
    expect(JSON.parse(ambiguity.candidates)).toHaveLength(2);
    expect(graph.rawDb.prepare(
      'SELECT COUNT(*) AS count FROM edges WHERE origin_ref_key = ?'
    ).get(ambiguity.ref_key)).toEqual({ count: 0 });
    expect(graph.rawDb.prepare(
      "SELECT COUNT(*) AS count FROM edges WHERE kind = 'imports'"
    ).get()).toEqual({ count: 0 });
    expect(graph.rawDb.prepare(
      "SELECT COUNT(*) AS count FROM nodes WHERE name = 'UnlistedSibling'"
    ).get()).toEqual({ count: 0 });
    expect(graph.rawDb.prepare(
      'SELECT COUNT(*) AS count FROM files WHERE path = ?'
    ).get(fixture.unlistedSibling)).toEqual({ count: 0 });
    expect((graph.rawDb.prepare(`
      SELECT path FROM files WHERE path LIKE ? ORDER BY path
    `).all(`${fixture.root}/Pods/%`) as unknown as Array<{ path: string }>).map(row => row.path))
      .toEqual([...fixture.externalFiles].sort());

    expect(graph.getTypeHierarchy(projectObjCChild, { direction: 'parents', depth: 1 })
      .parents.map(node => node.id)).toContain(projectObjCBase);
    expect(graph.getTypeHierarchy(projectObjCBase, { direction: 'children', depth: 1 })
      .children.map(node => node.id)).toContain(projectObjCChild);
    expect(graph.getImpact(projectObjCBase, 1, 'incoming').nodes.has(projectObjCChild)).toBe(true);
    expect(graph.findShortestPath(projectObjCChild, projectObjCBase)?.[1])
      .toMatchObject({ nodeId: projectObjCBase, traversalDirection: 'outgoing' });
    expect(graph.findShortestPath(projectObjCBase, projectObjCChild)?.[1])
      .toMatchObject({ nodeId: projectObjCChild, traversalDirection: 'incoming' });

    const cli = await runCli(fixture.root, [
      'kg', 'hierarchy', projectObjCChild, '--direction', 'parents', '--depth', '1', '--json',
    ]);
    const mcp = await handleMcpTool('maestro_kg_hierarchy', {
      symbol: projectObjCChild,
      direction: 'parents',
      depth: 1,
    }, fixture.root);
    expect(cli.exitCode).toBeUndefined();
    expect(mcp.isError).toBe(false);
    expect(JSON.parse(mcp.content[0].text)).toEqual(JSON.parse(cli.stdout));

    const beforeDeleteReference = graph.rawDb.prepare(`
      SELECT ref_key FROM structural_refs
      WHERE anchor_node_id = ? AND raw_target_name = 'ProjectObjCBase'
    `).get(projectObjCChild) as unknown as { ref_key: string };
    graph.close();
    unlinkSync(fixture.projectObjCBase);
    await syncFixture(fixture);
    graph = await MaestroGraph.open(fixture.root);
    expect(graph.rawDb.prepare(
      'SELECT status FROM structural_refs WHERE ref_key = ?'
    ).get(beforeDeleteReference.ref_key)).toEqual({ status: 'not_found' });
    expect(graph.rawDb.prepare(
      'SELECT COUNT(*) AS count FROM edges WHERE origin_ref_key = ?'
    ).get(beforeDeleteReference.ref_key)).toEqual({ count: 0 });
    graph.close();

    writeFileSync(fixture.projectObjCBase, fixture.projectObjCBaseSource);
    await syncFixture(fixture);
    graph = await MaestroGraph.open(fixture.root);
    expect(graph.rawDb.prepare(`
      SELECT status, resolved_node_id FROM structural_refs WHERE ref_key = ?
    `).get(beforeDeleteReference.ref_key)).toEqual({
      status: 'resolved',
      resolved_node_id: projectObjCBase,
    });
    const firstStable = stableMetrics(graph);
    graph.close();
    await syncFixture(fixture);
    graph = await MaestroGraph.open(fixture.root);
    expect(stableMetrics(graph)).toEqual(firstStable);
    expect(graph.rawDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(graph.rawDb.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    graph.close();
  });
});

async function runCli(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation(value => { stdout.push(String(value)); });
  const error = vi.spyOn(console, 'error').mockImplementation(value => { stderr.push(String(value)); });
  process.exitCode = undefined;
  try {
    process.chdir(root);
    const program = new Command();
    program.exitOverride();
    registerKgCommands(program);
    await program.parseAsync(['node', 'maestro', ...args]);
    return {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exitCode: process.exitCode,
    };
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}
