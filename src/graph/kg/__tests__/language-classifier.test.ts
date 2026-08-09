import { describe, expect, it } from 'vitest';
import { classifyLanguageForSource } from '../extraction/code/language-classifier.js';
import { detectLanguageFromPath } from '../extraction/code/languages/index.js';
import type { Language } from '../db/types.js';

interface ClassificationFixture {
  name: string;
  filePath: string;
  source: string;
  pathLanguage: Language;
  expectedLanguage: Language;
  expectedReason: string;
  expectedSignals?: string[];
}

describe('source-aware language classifier', () => {
  const fixtures: ClassificationFixture[] = [
    {
      name: 'defaults a pure C header to C',
      filePath: 'include/demo.h',
      source: 'typedef struct Demo { int value; } Demo;\nint demo_value(Demo *demo);',
      pathLanguage: 'c',
      expectedLanguage: 'c',
      expectedReason: 'header-default-c',
    },
    {
      name: 'routes a C++ header from strong syntax',
      filePath: 'include/demo.h',
      source: 'namespace demo { template <typename T> class Box { public: T value; }; }',
      pathLanguage: 'c',
      expectedLanguage: 'cpp',
      expectedReason: 'cpp-strong-signal',
      expectedSignals: ['namespace', 'template', 'class-declaration', 'access-label'],
    },
    {
      name: 'routes an Objective-C header from declarations',
      filePath: 'include/Demo.h',
      source: '@interface Demo : NSObject\n@property(nonatomic) NSInteger value;\n- (void)consume:(id)value;\n@end',
      pathLanguage: 'c',
      expectedLanguage: 'objc',
      expectedReason: 'objc-strong-signal',
      expectedSignals: ['@interface', '@property', 'objc-method'],
    },
    {
      name: 'gives Objective-C priority in a mixed Objective-C++ header',
      filePath: 'include/Mixed.h',
      source: '#import <Foundation/Foundation.h>\nnamespace demo { class Box; }\n@interface Mixed : NSObject\n@end',
      pathLanguage: 'c',
      expectedLanguage: 'objc',
      expectedReason: 'objc-strong-signal',
      expectedSignals: ['@interface', '#import'],
    },
    {
      name: 'routes an import-only bridging header',
      filePath: 'Config/Bridge.h',
      source: '#import "LegacyThing.h"\n@import Photos;',
      pathLanguage: 'c',
      expectedLanguage: 'objc',
      expectedReason: 'objc-strong-signal',
      expectedSignals: ['#import', '@import'],
    },
    {
      name: 'recognizes Objective-C implementation protocol and forward declarations',
      filePath: 'include/Declarations.h',
      source: '@class Forward;\n@protocol DemoProtocol\n@end\n@implementation HiddenDemo\n@end',
      pathLanguage: 'c',
      expectedLanguage: 'objc',
      expectedReason: 'objc-strong-signal',
      expectedSignals: ['@implementation', '@protocol', '@class'],
    },
    {
      name: 'ignores Objective-C tokens in comments strings and character literals',
      filePath: 'include/FalsePositive.h',
      source: [
        '// @interface CommentOnly',
        '/* #import "CommentOnly.h" */',
        'static const char *text = "@property #import \\"Fake.h\\"";',
        'static const char *raw = R"tag("quoted" @interface RawOnly #import "Fake.h")tag";',
        "static const char marker = '@';",
        'int plain_c(void);',
      ].join('\n'),
      pathLanguage: 'c',
      expectedLanguage: 'c',
      expectedReason: 'header-default-c',
    },
    {
      name: 'recognizes extern C after literal sanitization',
      filePath: 'include/Bridge.h',
      source: '#ifdef __cplusplus\nextern "C" {\n#endif\nvoid bridge(void);',
      pathLanguage: 'c',
      expectedLanguage: 'cpp',
      expectedReason: 'cpp-strong-signal',
      expectedSignals: ['extern-c'],
    },
    {
      name: 'keeps .m routed to Objective-C regardless of source',
      filePath: 'Demo.m',
      source: 'namespace misleading { class Value; }',
      pathLanguage: 'cpp',
      expectedLanguage: 'objc',
      expectedReason: 'path-language',
    },
    {
      name: 'keeps .mm routed to Objective-C declaration surface',
      filePath: 'Demo.mm',
      source: 'namespace native { class Value; }',
      pathLanguage: 'cpp',
      expectedLanguage: 'objc',
      expectedReason: 'path-language',
    },
    {
      name: 'keeps .swift routed to Swift regardless of source',
      filePath: 'Demo.swift',
      source: '@interface Misleading',
      pathLanguage: 'objc',
      expectedLanguage: 'swift',
      expectedReason: 'path-language',
    },
  ];

  it.each(fixtures)('$name', fixture => {
    const result = classifyLanguageForSource(
      fixture.filePath,
      fixture.source,
      fixture.pathLanguage,
    );

    expect(result.language).toBe(fixture.expectedLanguage);
    expect(result.reason).toBe(fixture.expectedReason);
    expect(result.matchedSignals).toEqual(fixture.expectedSignals ?? []);
  });

  it('preserves the path-only header API', () => {
    expect(detectLanguageFromPath('include/ObjectiveCHeader.h')).toBe('c');
    expect(detectLanguageFromPath('src/typed-module.luau')).toBe('luau');
    expect(detectLanguageFromPath('forms/Main.dfm')).toBe('pascal');
    expect(detectLanguageFromPath('forms/Mobile.fmx')).toBe('pascal');
  });
});
