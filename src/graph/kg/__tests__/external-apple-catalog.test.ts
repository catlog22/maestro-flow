import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION,
  findAppleExternalCatalogCandidates,
  loadAppleExternalCatalog,
  makeAppleExternalNodeId,
  materializeAppleExternalCatalog,
} from '../extraction/code/external/apple-catalog.js';
import {
  makeStructuralReferenceKey,
  type StructuralReference,
} from '../resolution/structural-reference.js';

function makeReference(
  rawTargetName: string,
  moduleHints: string[],
  originFilePath = '/virtual/Project/Sources/Child.swift',
): StructuralReference {
  const anchorNodeId = `code:${originFilePath}:Child`;
  const keyInput = {
    normalizedOriginPath: originFilePath,
    anchorNodeId,
    relationHint: 'inherits-or-conforms' as const,
    edgeOrientation: 'anchor-to-target' as const,
    rawTargetName,
    line: 7,
    column: 14,
  };
  return {
    kind: 'type',
    refKey: makeStructuralReferenceKey(keyInput),
    anchorNodeId,
    anchorQualifiedName: 'Child',
    rawTargetName,
    sourceDeclarationKind: 'class',
    lookupScope: 'project-and-external',
    relationHint: 'inherits-or-conforms',
    edgeOrientation: 'anchor-to-target',
    targetKindHints: ['class', 'protocol'],
    targetLanguageHints: ['swift', 'objc'],
    moduleHints,
    targetFileHints: [],
    origin: {
      filePath: originFilePath,
      language: 'swift',
      line: 7,
      column: 14,
    },
    evidenceProvenance: 'tree-sitter',
  };
}

function entry(
  module: string,
  objcName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    module,
    objcName,
    kind: 'class',
    swiftVisibleAliases: [],
    parent: null,
    protocols: [],
    ...overrides,
  };
}

function document(entries: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema_version: APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION,
    entries,
  };
}

describe('Apple external catalog', () => {
  it('keeps stable IDs independent of virtual project root and SDK fixture', () => {
    const fixtures = [
      '/virtual/xcode-15/iPhoneOS17.0.sdk/Project/Child.swift',
      '/another/root/xcode-26/iPhoneOS26.5.sdk/Project/Child.swift',
    ];
    const ids = fixtures.map(origin => {
      const result = materializeAppleExternalCatalog(
        [makeReference('URLProtocol', ['Foundation'], origin)],
        { now: 1 },
      );
      return result.nodes.find(node => node.name === 'NSURLProtocol')?.id;
    });

    expect(ids).toEqual([
      'code:@external/apple/Foundation:NSURLProtocol',
      'code:@external/apple/Foundation:NSURLProtocol',
    ]);
  });

  it('matches URLProtocol only through its explicit Foundation alias', () => {
    const reference = makeReference('URLProtocol', ['Foundation']);
    const candidates = findAppleExternalCatalogCandidates(reference);
    expect(candidates).toEqual([{
      referenceRefKey: reference.refKey,
      rawTargetName: 'URLProtocol',
      matchKind: 'swift-alias',
      matchedCatalogName: 'Foundation.URLProtocol',
      canonicalNodeId: 'code:@external/apple/Foundation:NSURLProtocol',
      canonicalQualifiedName: 'Foundation.NSURLProtocol',
      canonicalObjcName: 'NSURLProtocol',
      module: 'Foundation',
      kind: 'class',
    }]);

    const materialized = materializeAppleExternalCatalog([reference], { now: 1 });
    const node = materialized.nodes.find(item => item.name === 'NSURLProtocol');
    expect(node?.metadata).toMatchObject({
      provider: 'apple',
      module: 'Foundation',
      catalogSchemaVersion: APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION,
      swiftVisibleAliases: ['URLProtocol'],
      objcCanonicalName: 'NSURLProtocol',
    });
    expect(node?.language).toBe('objc');
    expect(node?.sourceType).toBe('codegraph');
  });

  it('materializes UIView with explicit ancestors but no unrelated entries', () => {
    const result = materializeAppleExternalCatalog(
      [makeReference('UIView', ['UIKit'])],
      { now: 1 },
    );
    expect(result.nodes.map(node => node.id)).toEqual([
      'code:@external/apple/Foundation:NSObject',
      'code:@external/apple/UIKit:UIResponder',
      'code:@external/apple/UIKit:UIView',
    ]);
    expect(result.nodes.some(node => node.name === 'UILabel')).toBe(false);
    expect(result.nodes.some(node => node.name === 'NSURLProtocol')).toBe(false);
    expect(result.edges.map(edge => [edge.source, edge.target, edge.kind, edge.provenance])).toEqual([
      [
        'code:@external/apple/UIKit:UIResponder',
        'code:@external/apple/Foundation:NSObject',
        'extends',
        'framework',
      ],
      [
        'code:@external/apple/UIKit:UIView',
        'code:@external/apple/UIKit:UIResponder',
        'extends',
        'framework',
      ],
    ]);
  });

  it('keeps UICollectionViewCell and flow-layout parent chains child-to-parent', () => {
    const result = materializeAppleExternalCatalog([
      makeReference('UICollectionViewCell', ['UIKit']),
      makeReference('UICollectionViewFlowLayout', ['UIKit']),
    ], { now: 1 });
    const edgeKeys = new Set(result.edges.map(edge => `${edge.source}->${edge.target}:${edge.kind}`));

    expect(edgeKeys).toContain(
      'code:@external/apple/UIKit:UICollectionViewCell'
      + '->code:@external/apple/UIKit:UICollectionReusableView:extends',
    );
    expect(edgeKeys).toContain(
      'code:@external/apple/UIKit:UICollectionReusableView'
      + '->code:@external/apple/UIKit:UIView:extends',
    );
    expect(edgeKeys).toContain(
      'code:@external/apple/UIKit:UICollectionViewFlowLayout'
      + '->code:@external/apple/UIKit:UICollectionViewLayout:extends',
    );
    expect(edgeKeys).toContain(
      'code:@external/apple/UIKit:UICollectionViewLayout'
      + '->code:@external/apple/Foundation:NSObject:extends',
    );
  });

  it('fails closed on duplicate IDs, duplicate aliases, alias collisions, and missing targets', () => {
    expect(() => loadAppleExternalCatalog(document([
      entry('Foundation', 'NSObject'),
      entry('Foundation', 'NSObject'),
    ]))).toThrow(/duplicate stable ID/);

    expect(() => loadAppleExternalCatalog(document([
      entry('Foundation', 'NSObject', { swiftVisibleAliases: ['Object', 'Object'] }),
    ]))).toThrow(/duplicate alias/);

    expect(() => loadAppleExternalCatalog(document([
      entry('Foundation', 'NSObject'),
      entry('Foundation', 'NSProxy', { swiftVisibleAliases: ['NSObject'] }),
    ]))).toThrow(/alias collision/);

    expect(() => loadAppleExternalCatalog(document([
      entry('Foundation', 'NSURLProtocol', { parent: 'Foundation.NSObject' }),
    ]))).toThrow(/missing relation target/);
  });

  it('does not read Xcode, SDK, or header paths while loading the shipped catalog', () => {
    const readFile = vi.spyOn(fs, 'readFileSync');
    const readdir = vi.spyOn(fs, 'readdirSync');
    const stat = vi.spyOn(fs, 'statSync');
    const realpath = vi.spyOn(fs, 'realpathSync');
    try {
      const catalog = loadAppleExternalCatalog();
      expect(catalog.entriesByNodeId.get(
        makeAppleExternalNodeId('Foundation', 'NSURLProtocol'),
      )?.objcName).toBe('NSURLProtocol');

      const trace = [
        ...readFile.mock.calls.map(call => String(call[0])),
        ...readdir.mock.calls.map(call => String(call[0])),
        ...stat.mock.calls.map(call => String(call[0])),
        ...realpath.mock.calls.map(call => String(call[0])),
      ];
      expect(trace).not.toEqual(expect.arrayContaining([
        expect.stringContaining('/Applications/Xcode.app'),
      ]));
      expect(trace.some(value => value.includes('.sdk/') || value.endsWith('.h'))).toBe(false);
      expect(trace).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
