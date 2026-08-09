import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  canonicalizeCodeFilePath,
  makePathComparisonKey,
  makeStructuralReferenceKey,
  ScanPathComparisonIndex,
  validateStructuralReference,
  type ImportReference,
  type StructuralReference,
  type StructuralReferenceKeyInput,
} from '../resolution/structural-reference.js';
import {
  extractCode,
  markStructuralReferencePathCollisions,
  normalizeImportReferences,
} from '../extraction/code/code-extractor.js';
import { makeCodeNodeId } from '../extraction/code/tree-sitter-types.js';

function makeReference(overrides: Partial<StructuralReference> = {}): StructuralReference {
  const keyInput: StructuralReferenceKeyInput = {
    normalizedOriginPath: '/project/Sources/Child.swift',
    anchorNodeId: 'code:/project/Sources/Child.swift:Child',
    relationHint: 'inherits-or-conforms',
    edgeOrientation: 'anchor-to-target',
    rawTargetName: 'Parent',
    line: 7,
    column: 14,
  };
  return {
    kind: 'type',
    refKey: makeStructuralReferenceKey(keyInput),
    anchorNodeId: keyInput.anchorNodeId,
    anchorQualifiedName: 'Child',
    rawTargetName: keyInput.rawTargetName,
    sourceDeclarationKind: 'class',
    lookupScope: 'project-and-external',
    relationHint: keyInput.relationHint,
    edgeOrientation: keyInput.edgeOrientation,
    targetKindHints: ['class', 'protocol'],
    targetLanguageHints: ['swift', 'objc'],
    moduleHints: [],
    targetFileHints: [],
    origin: {
      filePath: keyInput.normalizedOriginPath,
      language: 'swift',
      line: keyInput.line,
      column: keyInput.column,
    },
    evidenceProvenance: 'tree-sitter',
    status: 'pending',
    ...overrides,
  } as StructuralReference;
}

describe('StructuralReference identity contract', () => {
  it('builds stable keys and changes every identity-bearing field', () => {
    const base: StructuralReferenceKeyInput = {
      normalizedOriginPath: '/project/Sources/Child.swift',
      anchorNodeId: 'code:/project/Sources/Child.swift:Child',
      relationHint: 'extends',
      edgeOrientation: 'anchor-to-target',
      rawTargetName: 'Parent',
      line: 5,
      column: 9,
    };
    const key = makeStructuralReferenceKey(base);
    expect(key).toMatch(/^structref:v1:[0-9a-f]{64}$/);
    expect(makeStructuralReferenceKey(base)).toBe(key);

    const variants: StructuralReferenceKeyInput[] = [
      { ...base, normalizedOriginPath: '/project/Sources/Other.swift' },
      { ...base, anchorNodeId: 'code:/project/Sources/Child.swift:Other' },
      { ...base, relationHint: 'implements' },
      { ...base, edgeOrientation: 'target-to-anchor' },
      { ...base, rawTargetName: 'OtherParent' },
      { ...base, line: 6 },
      { ...base, column: 10 },
    ];
    for (const variant of variants) {
      expect(makeStructuralReferenceKey(variant)).not.toBe(key);
    }
  });

  it('canonicalizes local path spellings without Unicode folding', () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro path identity '));
    try {
      const directory = join(root, 'Sources', 'Caf\u00e9');
      mkdirSync(directory, { recursive: true });
      const file = join(directory, 'Exact Header.h');
      writeFileSync(file, '@interface ExactHeader : NSObject\n@end\n');

      const absolute = canonicalizeCodeFilePath(root, file);
      const relative = canonicalizeCodeFilePath(root, join('Sources', 'Caf\u00e9', 'Exact Header.h'));
      expect(absolute).toBe(relative);
      expect(absolute).toBe(realpathSync(file).replace(/\\/g, '/'));

      const input = {
        normalizedOriginPath: absolute,
        anchorNodeId: `code:${absolute}:ExactHeader`,
        relationHint: 'extends' as const,
        edgeOrientation: 'anchor-to-target' as const,
        rawTargetName: 'NSObject',
        line: 1,
        column: 26,
      };
      expect(makeStructuralReferenceKey(input)).toBe(makeStructuralReferenceKey({ ...input }));
      expect(canonicalizeCodeFilePath(root, '@external/apple/UIKit')).toBe('@external/apple/UIKit');
      expect(() => canonicalizeCodeFilePath(root, '@external/../@external/apple/UIKit')).toThrow(
        'external-code-path-noncanonical',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects local paths that escape the canonical project boundary', () => {
    const container = mkdtempSync(join(tmpdir(), 'maestro-path-boundary-'));
    const root = join(container, 'project');
    const outside = join(container, 'Outside.h');
    try {
      mkdirSync(root);
      writeFileSync(outside, 'void outside(void);\n');
      expect(() => canonicalizeCodeFilePath(root, outside)).toThrow('code-path-outside-project');
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  });

  it('reports deterministic Unicode comparison collisions without merging identity paths', () => {
    const composed = '/project/Sources/Caf\u00e9/Owner.h';
    const decomposed = '/project/Sources/Cafe\u0301/Owner.h';
    expect(composed).not.toBe(decomposed);

    const result = makePathComparisonKey(composed, [composed, decomposed]);
    expect(result).toEqual({
      ok: false,
      error: 'unicode-path-collision',
      key: composed.normalize('NFC'),
      identityPath: composed,
      identityPaths: [composed, decomposed].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))),
    });
    expect(makePathComparisonKey(composed, [composed])).toEqual({
      ok: true,
      key: composed.normalize('NFC'),
      identityPath: composed,
    });
    expect(new ScanPathComparisonIndex([composed]).get(decomposed)).toEqual({
      ok: true,
      key: composed.normalize('NFC'),
      identityPath: decomposed,
    });

    const ref = makeReference({
      refKey: makeStructuralReferenceKey({
        normalizedOriginPath: composed,
        anchorNodeId: `code:${composed}:Child`,
        relationHint: 'inherits-or-conforms',
        edgeOrientation: 'anchor-to-target',
        rawTargetName: 'Parent',
        line: 7,
        column: 14,
      }),
      anchorNodeId: `code:${composed}:Child`,
      origin: { filePath: composed, language: 'swift', line: 7, column: 14 },
    });
    const marked = markStructuralReferencePathCollisions(
      [ref],
      new ScanPathComparisonIndex([composed, decomposed]),
    );
    expect(marked[0].status).toBe('ambiguous');
  });

  it.runIf(process.platform !== 'win32')('preserves legal POSIX backslashes in file and node identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-backslash-identity-'));
    try {
      const literalBackslash = join(root, 'a\\b.ts');
      const nestedDirectory = join(root, 'a');
      const nestedSlash = join(nestedDirectory, 'b.ts');
      mkdirSync(nestedDirectory);
      writeFileSync(literalBackslash, 'export class LiteralBackslash {}\n');
      writeFileSync(nestedSlash, 'export class NestedSlash {}\n');

      const first = canonicalizeCodeFilePath(root, literalBackslash);
      const second = canonicalizeCodeFilePath(root, nestedSlash);
      expect(first).not.toBe(second);
      expect(makeCodeNodeId(first, 'LiteralBackslash')).not.toBe(makeCodeNodeId(second, 'LiteralBackslash'));

      const { results } = await extractCode({ srcDir: root, projectRoot: root, includeTests: true });
      expect(results.map(result => result.fileRecord.path).sort()).toEqual([first, second].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates discriminators, orientation, target and status at runtime', () => {
    expect(validateStructuralReference(makeReference())).toEqual({ ok: true, errors: [] });

    const invalidCases: Array<[Partial<StructuralReference>, string]> = [
      [{ anchorNodeId: 'domain:Child' }, 'code: namespace'],
      [{ rawTargetName: '' }, 'rawTargetName'],
      [{ relationHint: 'contains-owner', edgeOrientation: 'anchor-to-target' } as Partial<StructuralReference>, 'contains-owner'],
      [{ relationHint: 'unknown' } as Partial<StructuralReference>, 'unknown relationHint'],
      [{ status: 'unknown' } as Partial<StructuralReference>, 'unknown structural reference status'],
      [{ kind: 'unknown' } as Partial<StructuralReference>, 'unknown structural reference kind'],
      [{ origin: { filePath: 'Sources/Child.swift', language: 'swift', line: 7, column: 14 } }, 'canonical absolute'],
      [{ origin: { filePath: '/project//Sources/Child.swift', language: 'swift', line: 7, column: 14 } }, 'canonical absolute'],
      [{ origin: { filePath: '/project/Sources/Child.swift/', language: 'swift', line: 7, column: 14 } }, 'canonical absolute'],
    ];
    for (const [overrides, expected] of invalidCases) {
      const result = validateStructuralReference(makeReference(overrides));
      expect(result.ok).toBe(false);
      expect(result.errors.join('; ')).toContain(expected);
    }
  });

  it('keeps import references file-anchored and free of synthetic node IDs', () => {
    const ref: ImportReference = {
      kind: 'import',
      originFilePath: '/project/Sources/App.swift',
      importKind: 'module',
      rawTarget: 'UIKit',
      line: 1,
      column: 1,
    };
    expect(ref).not.toHaveProperty('fromSymbolId');
    expect(ref).not.toHaveProperty('fromSymbolName');
  });

  it('normalizes strict imports into the generic ExtractionResult reference contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-import-contract-'));
    try {
      const sourcePath = join(root, 'App.ts');
      writeFileSync(sourcePath, "import { Parent } from './Parent';\nexport class Child {}\n");
      const { results } = await extractCode({ srcDir: root, projectRoot: root, includeTests: true });
      expect(results).toHaveLength(1);
      const identityPath = realpathSync(sourcePath).replace(/\\/g, '/');
      expect(results[0].references).toEqual([{
        fromSymbolName: '<file>',
        fromSymbolId: `code:${identityPath}:<file>`,
        referenceName: './Parent',
        referenceKind: 'imports',
        line: 1,
        col: 1,
        filePath: identityPath,
        language: 'typescript',
      }]);
      expect(results[0].references?.[0]).toHaveProperty('fromSymbolId');
      expect(results[0].structuralReferences).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adapts legacy script-plugin imports without leaking synthetic node fields', () => {
    const imports = normalizeImportReferences([{
      fromSymbolName: '<module>',
      fromSymbolId: '/project/App.ts:<module>',
      referenceName: './Legacy',
      referenceKind: 'imports',
      line: 3,
      col: 5,
      filePath: '/plugin/spelling/App.ts',
      language: 'typescript',
    }], '/project/App.ts');
    expect(imports).toEqual([{
      kind: 'import',
      originFilePath: '/project/App.ts',
      importKind: 'module',
      rawTarget: './Legacy',
      line: 3,
      column: 5,
    }]);
    expect(imports[0]).not.toHaveProperty('fromSymbolId');
  });
});
