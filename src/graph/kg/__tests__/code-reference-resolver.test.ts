import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { KgDatabaseConnection } from '../db/connection.js';
import { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode } from '../db/types.js';
import { resolveCodeStructuralReferences } from '../resolution/code-reference-resolver.js';
import {
  makeStructuralReferenceKey,
  type StructuralReference,
  type StructuralRelationHint,
} from '../resolution/structural-reference.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openGraph(): { conn: KgDatabaseConnection; queries: KgQueryBuilder } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-code-resolver-'));
  roots.push(root);
  const conn = new KgDatabaseConnection();
  conn.initialize(join(root, 'maestro.db'));
  return { conn, queries: new KgQueryBuilder(conn) };
}

function node(
  name: string,
  filePath: string,
  overrides: Partial<UnifiedNode> = {},
): UnifiedNode {
  const qualifiedName = overrides.qualifiedName ?? name;
  return {
    id: overrides.id ?? `code:${filePath}:${qualifiedName}`,
    kind: overrides.kind ?? 'class',
    name,
    qualifiedName,
    filePath,
    language: overrides.language ?? 'swift',
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: overrides.decorators ?? [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: '',
    aliases: overrides.aliases ?? [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: overrides.metadata ?? {},
    updatedAt: 1,
  };
}

function reference(
  anchor: UnifiedNode,
  rawTargetName: string,
  options: {
    relationHint?: StructuralRelationHint;
    sourceDeclarationKind?: string;
    moduleHints?: string[];
    targetFileHints?: string[];
    targetKindHints?: StructuralReference['targetKindHints'];
    line?: number;
    compilationCondition?: string;
  } = {},
): StructuralReference {
  const relationHint = options.relationHint ?? 'inherits-or-conforms';
  const line = options.line ?? 7;
  const edgeOrientation = relationHint === 'contains-owner'
    ? 'target-to-anchor' as const
    : 'anchor-to-target' as const;
  const keyInput = {
    normalizedOriginPath: anchor.filePath,
    anchorNodeId: anchor.id,
    relationHint,
    edgeOrientation,
    rawTargetName,
    line,
    column: 5,
  };
  const common = {
    refKey: makeStructuralReferenceKey(keyInput),
    anchorNodeId: anchor.id,
    anchorQualifiedName: anchor.qualifiedName,
    rawTargetName,
    sourceDeclarationKind: options.sourceDeclarationKind ?? anchor.kind,
    lookupScope: 'project-and-external' as const,
    targetKindHints: options.targetKindHints ?? ['class', 'protocol'],
    targetLanguageHints: ['swift', 'objc'] as Array<'swift' | 'objc'>,
    moduleHints: options.moduleHints ?? [],
    targetFileHints: options.targetFileHints ?? [],
    origin: {
      filePath: anchor.filePath,
      language: anchor.language,
      line,
      column: 5,
    },
    ...(options.compilationCondition
      ? { compilationCondition: options.compilationCondition }
      : {}),
    evidenceProvenance: 'tree-sitter' as const,
  };
  if (relationHint === 'contains-owner') {
    return {
      ...common,
      kind: 'owner',
      relationHint,
      edgeOrientation,
    };
  }
  return {
    ...common,
    kind: 'type',
    relationHint,
    edgeOrientation,
  } as StructuralReference;
}

describe('strict code structural resolver', () => {
  it('resolves cross-language inheritance, protocol, owner, and category edges', () => {
    const { conn, queries } = openGraph();
    try {
      const child = node('Child', '/project/Child.swift');
      const parent = node('Parent', '/project/Pods/Parent.h', {
        language: 'objc',
        metadata: { module: 'PodKit', externalSurface: true },
      });
      const protocol = node('DemoProtocol', '/project/DemoProtocol.h', {
        kind: 'protocol',
        language: 'objc',
      });
      const protocolChild = node('ChildProtocol', '/project/ChildProtocol.swift', { kind: 'protocol' });
      const member = node('run', '/project/Extension.swift', { kind: 'method', qualifiedName: 'Parent.run' });
      const category = node('Parent (Debug)', '/project/Parent+Debug.m', {
        language: 'objc',
        decorators: ['category'],
      });
      queries.insertNodes([child, parent, protocol, protocolChild, member, category]);
      const refs = [
        reference(child, 'Parent', { moduleHints: ['PodKit'], line: 1 }),
        reference(child, 'DemoProtocol', { targetKindHints: ['protocol'], line: 2 }),
        reference(protocolChild, 'DemoProtocol', { targetKindHints: ['protocol'], line: 3 }),
        reference(member, 'Parent', {
          relationHint: 'contains-owner',
          sourceDeclarationKind: 'extension',
          line: 4,
        }),
        reference(category, 'Parent', {
          relationHint: 'decorates',
          sourceDeclarationKind: 'category',
          targetKindHints: ['class'],
          line: 5,
        }),
      ];
      queries.stageStructuralReferences(refs, 1);

      const result = conn.transaction(() => resolveCodeStructuralReferences(queries, 2));
      expect(result).toMatchObject({ resolved: 5, ambiguous: 0, notFound: 0, edgesCreated: 5 });
      expect(queries.getOutgoingEdges(child.id).map(edge => [edge.target, edge.kind])).toEqual([
        [parent.id, 'extends'],
        [protocol.id, 'implements'],
      ]);
      expect(queries.getOutgoingEdges(protocolChild.id)[0]).toMatchObject({
        target: protocol.id,
        kind: 'extends',
      });
      expect(queries.getOutgoingEdges(parent.id).some(edge => (
        edge.target === member.id && edge.kind === 'contains'
      ))).toBe(true);
      expect(queries.getOutgoingEdges(category.id)[0]).toMatchObject({
        target: parent.id,
        kind: 'decorates',
      });
    } finally {
      conn.close();
    }
  });

  it('keeps duplicate modules ambiguous and rejects fuzzy, suffix, and ObjC-to-unexposed-Swift guesses', () => {
    const { conn, queries } = openGraph();
    try {
      const child = node('Child', '/project/Child.swift');
      const objcChild = node('ObjCChild', '/project/ObjCChild.m', { language: 'objc' });
      const baseA = node('Base', '/project/A/Base.h', {
        language: 'objc',
        metadata: { module: 'ModuleA', externalSurface: true },
      });
      const baseB = node('Base', '/project/B/Base.h', {
        language: 'objc',
        metadata: { module: 'ModuleB', externalSurface: true },
      });
      const swiftOnly = node('SwiftOnly', '/project/SwiftOnly.swift');
      const appleUrlProtocol = node('NSURLProtocol', '@external/apple/Foundation', {
        language: 'objc',
        qualifiedName: 'Foundation.NSURLProtocol',
        aliases: ['URLProtocol'],
        metadata: { provider: 'apple', module: 'Foundation' },
      });
      const remoteBase = node('RemoteBase', '/project/Pods/RemoteKit/RemoteBase.h', {
        language: 'objc',
        metadata: { module: 'RemoteKit', externalSurface: true },
      });
      const legacyInterface = node('Legacy', '/project/Public/Legacy.h', {
        language: 'objc',
        decorators: ['interface'],
      });
      const unrelatedImplementation = node('Legacy', '/project/Internal/Legacy.m', {
        language: 'objc',
        decorators: ['implementation'],
      });
      queries.insertNodes([
        child,
        objcChild,
        baseA,
        baseB,
        swiftOnly,
        appleUrlProtocol,
        remoteBase,
        legacyInterface,
        unrelatedImplementation,
      ]);
      const ambiguous = reference(child, 'Base', { line: 1 });
      const fuzzy = reference(child, 'Bas', { line: 2 });
      const suffix = reference(child, 'Unknown.Base', { line: 3 });
      const objcToSwift = reference(objcChild, 'SwiftOnly', { line: 4 });
      const swiftAlias = reference(child, 'URLProtocol', {
        moduleHints: ['Foundation'],
        line: 5,
      });
      const objcAlias = reference(objcChild, 'URLProtocol', {
        moduleHints: ['Foundation'],
        line: 6,
      });
      const fileNarrowed = reference(child, 'Base', {
        targetFileHints: [baseB.filePath],
        line: 7,
      });
      const qualifiedAlias = reference(child, 'Foundation.URLProtocol', { line: 8 });
      const qualifiedRemote = reference(child, 'RemoteKit.RemoteBase', { line: 9 });
      const unsafeLocalDedupe = reference(child, 'Legacy', { line: 10 });
      queries.stageStructuralReferences([
        ambiguous,
        fuzzy,
        suffix,
        objcToSwift,
        swiftAlias,
        objcAlias,
        fileNarrowed,
        qualifiedAlias,
        qualifiedRemote,
        unsafeLocalDedupe,
      ], 1);

      const result = conn.transaction(() => resolveCodeStructuralReferences(queries, 2));
      expect(result).toMatchObject({ resolved: 4, ambiguous: 2, notFound: 4 });
      expect(queries.getStructuralReference(ambiguous.refKey)).toMatchObject({
        status: 'ambiguous',
        candidates: [baseA.id, baseB.id].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
      });
      expect(queries.getStructuralReference(fuzzy.refKey)).toMatchObject({ status: 'not_found', candidates: [] });
      expect(queries.getStructuralReference(suffix.refKey)).toMatchObject({ status: 'not_found', candidates: [] });
      expect(queries.getStructuralReference(objcToSwift.refKey)).toMatchObject({ status: 'not_found' });
      expect(queries.getStructuralReference(swiftAlias.refKey)).toMatchObject({
        status: 'resolved',
        resolvedNodeId: appleUrlProtocol.id,
      });
      expect(queries.getStructuralReference(objcAlias.refKey)).toMatchObject({ status: 'not_found' });
      expect(queries.getStructuralReference(fileNarrowed.refKey)).toMatchObject({
        status: 'resolved',
        resolvedNodeId: baseB.id,
      });
      expect(queries.getStructuralReference(qualifiedAlias.refKey)).toMatchObject({
        status: 'resolved',
        resolvedNodeId: appleUrlProtocol.id,
      });
      expect(queries.getStructuralReference(qualifiedRemote.refKey)).toMatchObject({
        status: 'resolved',
        resolvedNodeId: remoteBase.id,
      });
      expect(queries.getStructuralReference(unsafeLocalDedupe.refKey)).toMatchObject({
        status: 'ambiguous',
        candidates: [legacyInterface.id, unrelatedImplementation.id]
          .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
      });
      expect(conn.raw.prepare('SELECT * FROM edges WHERE origin_ref_key IS NOT NULL').all()).toHaveLength(4);
    } finally {
      conn.close();
    }
  });

  it('dedupes only an explicit canonical generated surface and preserves condition metadata', () => {
    const { conn, queries } = openGraph();
    try {
      const child = node('Child', '/project/Child.swift');
      const canonical = node('Image', '/project/Pods/Kit/ios-arm64/Kit-Swift.h', {
        language: 'objc',
        metadata: {
          module: 'Kit',
          externalSurface: true,
          generatedSwiftHeader: true,
          externalSurfaceCanonical: true,
          swiftRuntimeIdentity: '_TtC3Kit5Image',
        },
      });
      const simulator = node('Image', '/project/Pods/Kit/simulator/Kit-Swift.h', {
        language: 'objc',
        metadata: {
          module: 'Kit',
          externalSurface: true,
          generatedSwiftHeader: true,
          swiftRuntimeIdentity: '_TtC3Kit5Image',
        },
      });
      const otherCanonical = node('Image', '/project/Pods/OtherKit/ios-arm64/OtherKit-Swift.h', {
        language: 'objc',
        metadata: {
          module: 'OtherKit',
          externalSurface: true,
          generatedSwiftHeader: true,
          externalSurfaceCanonical: true,
          swiftRuntimeIdentity: '_TtC8OtherKit5Image',
        },
      });
      queries.insertNodes([child, canonical, simulator, otherCanonical]);
      const ref = reference(child, 'Image', {
        moduleHints: ['Kit'],
        line: 9,
        compilationCondition: '#if canImport(Kit)',
      });
      const crossModule = reference(child, 'Image', {
        moduleHints: ['Kit', 'OtherKit'],
        line: 10,
      });
      queries.stageStructuralReferences([ref, crossModule], 1);

      const result = conn.transaction(() => resolveCodeStructuralReferences(queries, 2));
      expect(result).toMatchObject({ resolved: 1, ambiguous: 1, notFound: 0 });
      expect(queries.getStructuralReference(ref.refKey)).toMatchObject({
        resolvedNodeId: canonical.id,
        candidates: [canonical.id],
        confidence: 1,
      });
      expect(queries.getOutgoingEdges(child.id)[0]).toMatchObject({
        target: canonical.id,
        metadata: { compilationCondition: '#if canImport(Kit)' },
        originRefKey: ref.refKey,
      });
      expect(queries.getStructuralReference(crossModule.refKey)).toMatchObject({
        status: 'ambiguous',
        candidates: [canonical.id, otherCanonical.id]
          .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
      });
    } finally {
      conn.close();
    }
  });

  it('does not fold a module-less project type into an ambient imported generated surface', () => {
    const { conn, queries } = openGraph();
    try {
      const child = node('Child', '/project/Child.swift');
      const projectImage = node('Image', '/project/Image.swift');
      const canonical = node('Image', '/project/Pods/Kit/Kit-Swift.h', {
        language: 'objc',
        metadata: {
          module: 'Kit',
          externalSurface: true,
          generatedSwiftHeader: true,
          externalSurfaceCanonical: true,
          swiftRuntimeIdentity: '_TtC3Kit5Image',
        },
      });
      queries.insertNodes([child, projectImage, canonical]);
      const ambientImport = reference(child, 'Image', {
        moduleHints: ['Kit'],
        line: 11,
      });
      queries.stageStructuralReferences([ambientImport], 1);

      const result = conn.transaction(() => resolveCodeStructuralReferences(queries, 2));
      expect(result).toMatchObject({ resolved: 0, ambiguous: 1, notFound: 0, edgesCreated: 0 });
      expect(queries.getStructuralReference(ambientImport.refKey)).toMatchObject({
        status: 'ambiguous',
        candidates: [canonical.id, projectImage.id]
          .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
      });
      expect(conn.raw.prepare(
        'SELECT COUNT(*) AS count FROM edges WHERE origin_ref_key = ?'
      ).get(ambientImport.refKey)).toEqual({ count: 0 });
    } finally {
      conn.close();
    }
  });

  it('replays target deletion/re-add and refuses NFC path collisions', () => {
    const { conn, queries } = openGraph();
    try {
      const child = node('Child', '/project/Child.swift');
      const parent = node('Parent', '/project/Parent.h', { language: 'objc' });
      const composed = node('CollisionA', '/project/Caf\u00e9.swift');
      const decomposedPath = '/project/Cafe\u0301.swift';
      queries.insertNodes([child, parent, composed]);
      queries.upsertFile({
        path: decomposedPath,
        contentHash: 'zero-node-collision',
        language: 'swift',
        size: 0,
        modifiedAt: 1,
        indexedAt: 1,
        nodeCount: 0,
        errors: [],
        sourceType: 'codegraph',
      });
      const replay = reference(child, 'Parent', { line: 1 });
      const collision = reference(composed, 'Parent', { line: 2 });
      queries.stageStructuralReferences([replay, collision], 1);

      let result = conn.transaction(() => resolveCodeStructuralReferences(queries, 2));
      expect(result).toMatchObject({ resolved: 1, ambiguous: 1 });
      expect(queries.getStructuralReference(collision.refKey)).toMatchObject({
        status: 'ambiguous',
        resolutionStrategy: 'unicode-path-collision',
      });

      queries.deleteNode(parent.id);
      result = conn.transaction(() => resolveCodeStructuralReferences(queries, 3));
      expect(result.notFound).toBe(1);
      expect(queries.getStructuralReference(replay.refKey)).toMatchObject({
        status: 'not_found',
        resolvedNodeId: null,
      });

      queries.insertNode(parent);
      result = conn.transaction(() => resolveCodeStructuralReferences(queries, 4));
      expect(result.resolved).toBe(1);
      expect(conn.raw.prepare(
        'SELECT * FROM edges WHERE origin_ref_key = ?'
      ).all(replay.refKey)).toHaveLength(1);
      expect(conn.raw.prepare(
        'SELECT * FROM edges WHERE origin_ref_key = ?'
      ).all(collision.refKey)).toHaveLength(0);
    } finally {
      conn.close();
    }
  });
});
