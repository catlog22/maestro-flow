import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeParseRunner } from '../extraction/code/worker-parser.js';
import { isTreeSitterAvailable } from '../extraction/code/tree-sitter.js';
import { makeCodeNodeId } from '../extraction/code/tree-sitter-types.js';
import type { LanguageExtractionResult } from '../extraction/code/tree-sitter-types.js';
import { validateStructuralReference } from '../resolution/structural-reference.js';

const BASIC_SOURCE = `
import Foundation
protocol RepositoryProtocol {
  func find(id: String) -> String
}
final class UserRepository: RepositoryProtocol, Hashable {
  func find(id: String) -> String {
    return helper(id) + items.joined()
  }
  func helper(_ id: String) -> String { id }
}
struct User: Codable { let name: String }
enum Status: String { case active }
extension UserRepository {
  /// Returns the current count.
  func count() -> Int { 0 }
}
`.trim();

const SAME_FILE_SOURCE = `
import Foundation
protocol ParentProtocol {}
protocol Worker: ParentProtocol {
  var title: String { get }
  func execute()
}
class Base {}
class Child: Base, Worker {
  struct Nested {}
  var value: Int = 0
}
actor ActorWorker: Worker {}
enum Choice: Worker { case one }
struct Item: Worker {}
extension Child {
  func extra() {}
}
`.trim();

const CROSS_FILE_SOURCE = `
#if canImport(RemoteKit)
import class RemoteKit.RemoteBase
final class CrossChild: RemoteBase {}
#endif
`.trim();

const EXTENSION_SOURCE = `
import RemoteKit
extension RemoteType: RemoteProtocol {
  var flag: Bool { true }
}
`.trim();

const AMBIGUOUS_SOURCE = `
class Left { class Parent {} }
class Right { class Parent {} }
class Child: Parent {}
`.trim();

interface SwiftFixtureResults {
  basic: LanguageExtractionResult;
  sameFile: LanguageExtractionResult;
  crossFile: LanguageExtractionResult;
  extension: LanguageExtractionResult;
  ambiguous: LanguageExtractionResult;
}

describe.skipIf(!isTreeSitterAvailable())('swiftExtractor', () => {
  const runner = new CodeParseRunner();
  let results: SwiftFixtureResults;

  beforeAll(async () => {
    const [basic, sameFile, crossFile, extension, ambiguous] = await Promise.all([
      runner.extract(BASIC_SOURCE, 'swift', '/project/Sources/basic.swift'),
      runner.extract(SAME_FILE_SOURCE, 'swift', '/project/Sources/same.swift'),
      runner.extract(CROSS_FILE_SOURCE, 'swift', '/project/Sources/cross.swift'),
      runner.extract(EXTENSION_SOURCE, 'swift', '/project/Sources/extension.swift'),
      runner.extract(AMBIGUOUS_SOURCE, 'swift', '/project/Sources/ambiguous.swift'),
    ]);
    expect(basic).not.toBeNull();
    expect(sameFile).not.toBeNull();
    expect(crossFile).not.toBeNull();
    expect(extension).not.toBeNull();
    expect(ambiguous).not.toBeNull();
    results = {
      basic: basic!,
      sameFile: sameFile!,
      crossFile: crossFile!,
      extension: extension!,
      ambiguous: ambiguous!,
    };
  });

  afterAll(() => runner.dispose());

  it('preserves symbols, nested ownership, calls, imports, and doc comments', () => {
    const filePath = '/project/Sources/basic.swift';
    const kinds = new Map(results.basic.symbols.map(symbol => [symbol.qualifiedName, symbol.kind]));
    expect(kinds.get('RepositoryProtocol')).toBe('protocol');
    expect(kinds.get('UserRepository')).toBe('class');
    expect(kinds.get('User')).toBe('struct');
    expect(kinds.get('Status')).toBe('enum');
    expect(kinds.get('Status.active')).toBe('enum_member');
    expect(kinds.get('UserRepository.find')).toBe('method');
    expect(kinds.get('UserRepository.count')).toBe('method');

    expect(results.basic.edges).toEqual(expect.arrayContaining([
      {
        source: makeCodeNodeId(filePath, 'UserRepository'),
        target: makeCodeNodeId(filePath, 'UserRepository.find'),
        kind: 'contains',
        line: expect.any(Number),
        col: expect.any(Number),
      },
      {
        source: makeCodeNodeId(filePath, 'UserRepository'),
        target: makeCodeNodeId(filePath, 'RepositoryProtocol'),
        kind: 'implements',
        line: expect.any(Number),
        col: expect.any(Number),
      },
    ]));
    const calls = results.basic.references.filter(reference => reference.referenceKind === 'calls');
    expect(calls.map(reference => reference.referenceName)).toEqual(expect.arrayContaining([
      'helper',
      'joined',
    ]));
    expect(results.basic.references).toContainEqual(expect.objectContaining({
      fromSymbolId: makeCodeNodeId(filePath, '<file>'),
      referenceKind: 'imports',
      referenceName: 'Foundation',
    }));
    expect(results.basic.importReferences).toContainEqual(expect.objectContaining({
      kind: 'import',
      originFilePath: filePath,
      rawTarget: 'Foundation',
    }));
    expect(results.basic.symbols.find(symbol => symbol.qualifiedName === 'UserRepository.count')?.docstring)
      .toContain('Returns the current count');

    const structuralTargets = (results.basic.structuralReferences ?? [])
      .map(reference => reference.rawTargetName);
    expect(structuralTargets).toEqual(expect.arrayContaining(['Hashable', 'Codable']));
    expect(results.basic.references.some(reference =>
      reference.referenceKind === 'extends'
      || reference.referenceKind === 'implements')).toBe(false);
  });

  it('extracts corrected nominal/member kinds without duplicating extension owners', () => {
    expect(results.sameFile.symbols.map(symbol => [symbol.qualifiedName, symbol.kind])).toEqual(
      expect.arrayContaining([
        ['ParentProtocol', 'protocol'],
        ['Worker', 'protocol'],
        ['Worker.title', 'property'],
        ['Worker.execute', 'method'],
        ['Base', 'class'],
        ['Child', 'class'],
        ['Child.Nested', 'struct'],
        ['Child.value', 'property'],
        ['ActorWorker', 'class'],
        ['Choice', 'enum'],
        ['Item', 'struct'],
        ['Child.extra', 'method'],
      ]),
    );
    expect(results.sameFile.symbols.filter(symbol => symbol.qualifiedName === 'Child')).toHaveLength(1);
    expect(results.sameFile.symbols.find(symbol => symbol.name === 'ActorWorker')?.decorators).toContain('actor');
  });

  it('emits direct structural edges only between extracted node IDs', () => {
    const filePath = '/project/Sources/same.swift';
    const edgeTriples = results.sameFile.edges.map(edge => [edge.source, edge.target, edge.kind]);
    expect(edgeTriples).toEqual(expect.arrayContaining([
      [makeCodeNodeId(filePath, 'Worker'), makeCodeNodeId(filePath, 'Worker.title'), 'contains'],
      [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Child.Nested'), 'contains'],
      [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Child.extra'), 'contains'],
      [makeCodeNodeId(filePath, 'Worker'), makeCodeNodeId(filePath, 'ParentProtocol'), 'extends'],
      [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Base'), 'extends'],
      [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Worker'), 'implements'],
      [makeCodeNodeId(filePath, 'ActorWorker'), makeCodeNodeId(filePath, 'Worker'), 'implements'],
      [makeCodeNodeId(filePath, 'Choice'), makeCodeNodeId(filePath, 'Worker'), 'implements'],
      [makeCodeNodeId(filePath, 'Item'), makeCodeNodeId(filePath, 'Worker'), 'implements'],
    ]));

    const symbolIds = new Set(results.sameFile.symbols.map(symbol =>
      makeCodeNodeId(filePath, symbol.qualifiedName)));
    for (const edge of results.sameFile.edges) {
      expect(symbolIds.has(edge.source)).toBe(true);
      expect(symbolIds.has(edge.target)).toBe(true);
    }
    expect(results.sameFile.structuralReferences ?? []).toEqual([]);
  });

  it('keeps unresolved cross-file inheritance as an exact typed reference', () => {
    expect(results.crossFile.edges).toEqual([]);
    const references = results.crossFile.structuralReferences ?? [];
    expect(references).toHaveLength(1);
    const reference = references[0];
    expect(reference).toMatchObject({
      kind: 'type',
      anchorQualifiedName: 'CrossChild',
      rawTargetName: 'RemoteBase',
      sourceDeclarationKind: 'class',
      relationHint: 'inherits-or-conforms',
      edgeOrientation: 'anchor-to-target',
      lookupScope: 'project-and-external',
      targetLanguageHints: ['swift', 'objc'],
      moduleHints: ['RemoteKit'],
      compilationCondition: '#if canImport(RemoteKit)',
    });
    expect(validateStructuralReference(reference)).toEqual({ ok: true, errors: [] });
  });

  it('anchors cross-file extension members and resolves ownership target-to-anchor', () => {
    expect(results.extension.symbols.map(symbol => symbol.qualifiedName)).toEqual(['RemoteType.flag']);
    expect(results.extension.symbols.some(symbol => symbol.qualifiedName === 'RemoteType')).toBe(false);
    expect(results.extension.edges).toEqual([]);
    const references = results.extension.structuralReferences ?? [];
    expect(references).toHaveLength(1);
    expect(references.some(reference => reference.rawTargetName === 'RemoteProtocol')).toBe(false);
    for (const reference of references) {
      expect(reference).toMatchObject({
        kind: 'owner',
        rawTargetName: 'RemoteType',
        sourceDeclarationKind: 'extension',
        relationHint: 'contains-owner',
        edgeOrientation: 'target-to-anchor',
        moduleHints: ['RemoteKit'],
      });
      expect(validateStructuralReference(reference)).toEqual({ ok: true, errors: [] });
    }
  });

  it('does not choose the first same-file candidate when an unqualified target is ambiguous', () => {
    const inheritanceEdges = results.ambiguous.edges.filter(edge =>
      edge.kind === 'extends' || edge.kind === 'implements');
    expect(inheritanceEdges).toEqual([]);
    const references = results.ambiguous.structuralReferences ?? [];
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      anchorQualifiedName: 'Child',
      rawTargetName: 'Parent',
      relationHint: 'inherits-or-conforms',
    });
  });
});
