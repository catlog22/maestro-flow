import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeParseRunner } from '../extraction/code/worker-parser.js';
import { isTreeSitterAvailable } from '../extraction/code/tree-sitter.js';
import { makeCodeNodeId } from '../extraction/code/tree-sitter-types.js';
import type { LanguageExtractionResult } from '../extraction/code/tree-sitter-types.js';
import { validateStructuralReference } from '../resolution/structural-reference.js';

const LOCAL_SOURCE = `
#import <Foundation/Foundation.h>
#include "Support.h"
@import DemoKit.Submodule;

@protocol Parent
@end

@protocol Demo <Parent>
@end

@implementation Base
- (void)consume:(id)value count:(NSInteger)count {}
@end

@interface Base : NSObject
@property(nonatomic) NSInteger count;
@property(nonatomic, strong) NSString *title;
@property(nonatomic, copy) NSArray<NSString *> *items;
@property(nonatomic, copy) void (^completion)(BOOL finished);
@property(nonatomic) int (wrapped);
@property(nonatomic) int values[4];
@property(nonatomic) NSInteger left, right;
- (void)consume:(id)value count:(NSInteger)count;
- (BOOL)doThing:(id)value withError:(NSError **)error;
- (void)setupFocusViewWithDefaultFocusImage:(id)defaultImage
                              focusingImage:(id)focusingImage
                                finishImage:(id)finishImage;
+ (instancetype)shared;
@end

@interface Child : Base <Demo>
@end

@implementation Base (Extra)
- (void)extra {}
@end

@interface Base (Extra) <Demo>
- (void)extra;
@end
`.trim();

const EXTERNAL_SOURCE = `
#import <UIKit/UIKit.h>
#if TARGET_OS_IOS
@interface RemoteChild : UIView <RemoteProtocol>
@end

@interface RemoteOwner (Extra)
- (void)extra;
@end
#endif
`.trim();

const GENERATED_HEADER_SOURCE = `
#define SWIFT_CLASS(_name)
#define SWIFT_EXTENSION(_module) _module
SWIFT_CLASS("_TtC13FixtureModule14FixtureRequest")
@interface FixtureRequest : NSObject
@property (nonatomic, copy) NSString *taskID;
- (void)doThing:(id)value withError:(NSError **)error;
@end

@interface FixtureRequest (SWIFT_EXTENSION(FixtureModule))
@property (nonatomic, readonly, copy) NSString *description;
@end
`.trim();

const OBJCXX_SOURCE = `
@interface Hybrid : NSObject
- (void)consume:(id)value count:(NSInteger)count;
@end

@implementation Hybrid
- (void)consume:(id)value count:(NSInteger)count {
  std::vector<int> values;
}
@end
`.trim();

interface ObjCFixtureResults {
  local: LanguageExtractionResult;
  external: LanguageExtractionResult;
  generated: LanguageExtractionResult;
  objcxx: LanguageExtractionResult;
}

describe.skipIf(!isTreeSitterAvailable())('objcExtractor structural facts', () => {
  const runner = new CodeParseRunner();
  let results: ObjCFixtureResults;

  beforeAll(async () => {
    const [local, external, generated, objcxx] = await Promise.all([
      runner.extract(LOCAL_SOURCE, 'objc', '/project/Sources/local.h'),
      runner.extract(EXTERNAL_SOURCE, 'objc', '/project/Sources/external.h'),
      runner.extract(GENERATED_HEADER_SOURCE, 'objc', '/project/Pods/FixtureModule-Swift.h'),
      runner.extract(OBJCXX_SOURCE, 'objc', '/project/Sources/hybrid.mm'),
    ]);
    expect(local).not.toBeNull();
    expect(external).not.toBeNull();
    expect(generated).not.toBeNull();
    expect(objcxx).not.toBeNull();
    results = {
      local: local!,
      external: external!,
      generated: generated!,
      objcxx: objcxx!,
    };
  });

  afterAll(() => runner.dispose());

  it('keeps class, protocol, and named category identities distinct', () => {
    expect(results.local.symbols.map(symbol => [symbol.qualifiedName, symbol.kind])).toEqual(
      expect.arrayContaining([
        ['Parent', 'protocol'],
        ['Demo', 'protocol'],
        ['Base', 'class'],
        ['Child', 'class'],
        ['Base (Extra)', 'class'],
      ]),
    );
    expect(results.local.symbols.filter(symbol => symbol.qualifiedName === 'Base')).toHaveLength(1);
    expect(results.local.symbols.find(symbol => symbol.qualifiedName === 'Base')?.decorators)
      .toEqual(['interface']);
    expect(results.local.symbols.find(symbol => symbol.qualifiedName === 'Base (Extra)')?.decorators)
      .toContain('category');
    expect(new Set(['Base', 'Demo', 'Base (Extra)'].map(qualifiedName =>
      makeCodeNodeId('/project/Sources/local.h', qualifiedName))).size).toBe(3);
  });

  it('extracts every scalar, pointer, generic, block, parenthesized, array, and comma declarator', () => {
    expect(results.local.symbols
      .filter(symbol => symbol.kind === 'property')
      .map(symbol => symbol.qualifiedName))
      .toEqual([
        'Base.count',
        'Base.title',
        'Base.items',
        'Base.completion',
        'Base.wrapped',
        'Base.values',
        'Base.left',
        'Base.right',
      ]);
  });

  it('preserves complete selectors and instance/class method metadata', () => {
    const methods = new Map(results.local.symbols
      .filter(symbol => symbol.kind === 'method')
      .map(symbol => [symbol.qualifiedName, symbol]));
    expect([...methods.keys()]).toEqual(expect.arrayContaining([
      'Base.consume:count:',
      'Base.doThing:withError:',
      'Base.setupFocusViewWithDefaultFocusImage:focusingImage:finishImage:',
      'Base.shared',
      'Base (Extra).extra',
    ]));
    expect(methods.get('Base.consume:count:')).toMatchObject({
      isStatic: false,
      decorators: ['instance'],
    });
    expect(methods.get('Base.shared')).toMatchObject({
      isStatic: true,
      decorators: ['class_method'],
    });
  });

  it('emits local contains, extends, implements, and decorates edges with valid endpoints', () => {
    const filePath = '/project/Sources/local.h';
    expect(results.local.edges.map(edge => [edge.source, edge.target, edge.kind])).toEqual(
      expect.arrayContaining([
        [makeCodeNodeId(filePath, 'Base'), makeCodeNodeId(filePath, 'Base.count'), 'contains'],
        [makeCodeNodeId(filePath, 'Base'), makeCodeNodeId(filePath, 'Base.consume:count:'), 'contains'],
        [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Base'), 'extends'],
        [makeCodeNodeId(filePath, 'Child'), makeCodeNodeId(filePath, 'Demo'), 'implements'],
        [makeCodeNodeId(filePath, 'Demo'), makeCodeNodeId(filePath, 'Parent'), 'extends'],
        [makeCodeNodeId(filePath, 'Base (Extra)'), makeCodeNodeId(filePath, 'Base'), 'decorates'],
        [makeCodeNodeId(filePath, 'Base (Extra)'), makeCodeNodeId(filePath, 'Base (Extra).extra'), 'contains'],
      ]),
    );
    const symbolIds = new Set(results.local.symbols.map(symbol =>
      makeCodeNodeId(filePath, symbol.qualifiedName)));
    for (const edge of results.local.edges) {
      expect(symbolIds.has(edge.source)).toBe(true);
      expect(symbolIds.has(edge.target)).toBe(true);
    }
  });

  it('keeps external superclass, protocol, and category owner facts typed and conditional', () => {
    expect(results.external.edges.filter(edge =>
      edge.kind === 'extends' || edge.kind === 'implements' || edge.kind === 'decorates')).toEqual([]);
    const structuralReferences = results.external.structuralReferences ?? [];
    expect(structuralReferences.map(reference => ({
      anchor: reference.anchorQualifiedName,
      target: reference.rawTargetName,
      relation: reference.relationHint,
      condition: reference.compilationCondition,
    }))).toEqual(expect.arrayContaining([
      { anchor: 'RemoteChild', target: 'UIView', relation: 'extends', condition: '#if TARGET_OS_IOS' },
      { anchor: 'RemoteChild', target: 'RemoteProtocol', relation: 'implements', condition: '#if TARGET_OS_IOS' },
      { anchor: 'RemoteOwner (Extra)', target: 'RemoteOwner', relation: 'decorates', condition: '#if TARGET_OS_IOS' },
    ]));
    for (const reference of structuralReferences) {
      expect(reference).toMatchObject({
        kind: 'type',
        edgeOrientation: 'anchor-to-target',
        lookupScope: 'project-and-external',
        targetLanguageHints: ['objc', 'swift'],
        moduleHints: ['UIKit'],
      });
      expect(validateStructuralReference(reference)).toEqual({ ok: true, errors: [] });
    }
  });

  it('keeps imports file-anchored and never fabricates imports edges', () => {
    expect(results.local.references).toEqual([
      {
        fromSymbolName: '<file>',
        fromSymbolId: 'code:/project/Sources/local.h:<file>',
        referenceName: 'Foundation/Foundation.h',
        referenceKind: 'imports',
        line: 1,
        col: 1,
        filePath: '/project/Sources/local.h',
        language: 'objc',
      },
      {
        fromSymbolName: '<file>',
        fromSymbolId: 'code:/project/Sources/local.h:<file>',
        referenceName: 'Support.h',
        referenceKind: 'imports',
        line: 2,
        col: 1,
        filePath: '/project/Sources/local.h',
        language: 'objc',
      },
      {
        fromSymbolName: '<file>',
        fromSymbolId: 'code:/project/Sources/local.h:<file>',
        referenceName: 'DemoKit.Submodule',
        referenceKind: 'imports',
        line: 3,
        col: 1,
        filePath: '/project/Sources/local.h',
        language: 'objc',
      },
    ]);
    expect(results.local.importReferences).toEqual([
      {
        kind: 'import',
        originFilePath: '/project/Sources/local.h',
        importKind: 'objc-import',
        rawTarget: 'Foundation/Foundation.h',
        line: 1,
        column: 1,
      },
      {
        kind: 'import',
        originFilePath: '/project/Sources/local.h',
        importKind: 'include',
        rawTarget: 'Support.h',
        line: 2,
        column: 1,
      },
      {
        kind: 'import',
        originFilePath: '/project/Sources/local.h',
        importKind: 'module',
        rawTarget: 'DemoKit.Submodule',
        line: 3,
        column: 1,
      },
    ]);
    expect(results.local.edges.some(edge => edge.kind === 'imports')).toBe(false);
  });

  it('handles generated Swift header macros without collapsing category identity', () => {
    expect(results.generated.symbols.map(symbol => symbol.qualifiedName)).toEqual(
      expect.arrayContaining([
        'FixtureRequest',
        'FixtureRequest.taskID',
        'FixtureRequest.doThing:withError:',
        'FixtureRequest (SWIFT_EXTENSION(FixtureModule))',
        'FixtureRequest (SWIFT_EXTENSION(FixtureModule)).description',
      ]),
    );
    expect(results.generated.symbols.find(symbol => symbol.qualifiedName === 'FixtureRequest')?.metadata)
      .toMatchObject({ swiftRuntimeIdentity: '_TtC13FixtureModule14FixtureRequest' });
  });

  it('extracts the Objective-C surface from .mm without inventing C++ semantic nodes', () => {
    expect(results.objcxx.symbols.map(symbol => symbol.qualifiedName)).toEqual([
      'Hybrid',
      'Hybrid.consume:count:',
    ]);
    expect(results.objcxx.symbols.some(symbol => symbol.name === 'vector')).toBe(false);
    expect(results.objcxx.diagnostics).toContain(
      'objcxx-partial-parse: tree-sitter Objective-C grammar reported syntax errors',
    );
  });
});
