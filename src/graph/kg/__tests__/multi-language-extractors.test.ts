import { describe, it, expect, beforeAll } from 'vitest';
import { CodeParseRunner } from '../extraction/code/worker-parser.js';
import { isTreeSitterAvailable } from '../extraction/code/tree-sitter.js';
import type { ExtractedReference, LanguageExtractionResult } from '../extraction/code/tree-sitter-types.js';

// ---------------------------------------------------------------------------
// 多语言提取器回归测试 — calls / extends / implements 引用
// (本次多 agent 增强引入: python/go/java/rust/csharp/kotlin/scala/ruby/php/c/cpp/dart/objc/lua/pascal)
// ---------------------------------------------------------------------------

interface LangCase {
  lang: string;
  source: string;
  /** 期望的引用 (kind:name 对) */
  expectRefs: Array<[string, string]>;
  /** Swift/ObjC 等严格结构引用 (relation:name 对)。 */
  expectStructuralRefs?: Array<[string, string]>;
  /** 期望的符号名 (任意子集匹配) */
  expectSymbols?: string[];
}

const CASES: LangCase[] = [
  {
    lang: 'python',
    source: 'class B(A, C):\n    def m(self):\n        return helper(1) + self.go()\n',
    expectRefs: [['calls', 'helper'], ['calls', 'go'], ['extends', 'A'], ['extends', 'C']],
    expectSymbols: ['B', 'B.m'],
  },
  {
    lang: 'go',
    source: 'package p\n\ntype B struct {\n    A\n    I\n}\n\ntype J interface {\n    io.Reader\n}\n\nfunc f() { helper(1); obj.Method(2) }\n',
    expectRefs: [['calls', 'helper'], ['calls', 'Method'], ['extends', 'A'], ['implements', 'Reader']],
    expectSymbols: ['B', 'f'],
  },
  {
    lang: 'java',
    source: 'package p;\n\npublic class B extends A implements I1, I2 {\n    public String m() { return helper() + obj.method(); }\n}\n\ninterface IX extends IBase {}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['implements', 'I1'], ['implements', 'I2'], ['extends', 'IBase']],
    expectSymbols: ['B', 'B.m', 'IX'],
  },
  {
    lang: 'rust',
    source: 'struct B;\n\ntrait T {}\n\nimpl T for B {}\n\nfn f() { helper(1); obj.method(2); std::io::read(3) }\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['calls', 'read'], ['implements', 'T']],
    expectSymbols: ['B', 'T'],
  },
  {
    lang: 'csharp',
    source: 'namespace N;\n\npublic class B : A, IFace {\n    public void M() { helper(1); obj.Method(2); var f = new Foo(); }\n}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'Method'], ['calls', 'Foo'], ['extends', 'A'], ['implements', 'IFace']],
    expectSymbols: ['B'],
  },
  {
    lang: 'cpp',
    source: '#include <vector>\n\nclass B : public A, public I {\npublic:\n    void m() { helper(1); obj->method(2); }\n};\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['extends', 'I']],
    expectSymbols: ['B', 'B.m'],
  },
  {
    lang: 'kotlin',
    source: 'class B : A(), I1 {\n    fun m() {\n        helper(1)\n        obj.method(2)\n    }\n}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['implements', 'I1']],
    expectSymbols: ['B'],
  },
  {
    lang: 'scala',
    source: 'class B extends A with T {\n  def m(): Unit = { helper(1); obj.method(2) }\n}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['implements', 'T']],
    expectSymbols: ['B'],
  },
  {
    lang: 'ruby',
    source: 'class B < A\n  include M\n  extend E\n  require "json"\n  def m\n    helper(1)\n    obj.method(2)\n  end\nend\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['mixes_in', 'M'], ['mixes_in', 'E'], ['imports', 'json']],
    expectSymbols: ['B', 'B.m'],
  },
  {
    lang: 'php',
    source: '<?php\nclass B extends \\A\\Base implements I1, \\I2 {\n    use SharedTrait;\n    public function m() { helper($x); $obj->method($y); A::staticCall($z); }\n}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['calls', 'staticCall'], ['extends', 'Base'], ['implements', 'I1'], ['implements', 'I2'], ['mixes_in', 'SharedTrait']],
    expectSymbols: ['B'],
  },
  {
    lang: 'dart',
    source: 'class B extends A implements I {\n  void m() { helper(1); obj.method(2); }\n}\n',
    expectRefs: [['calls', 'helper'], ['calls', 'method'], ['extends', 'A'], ['implements', 'I']],
    expectSymbols: ['B'],
  },
  {
    lang: 'objc',
    source: '@interface B : A <P1>\n@end\n\n@implementation B\n- (void)m { [self go]; helper(1); }\n@end\n',
    expectRefs: [['calls', 'go'], ['calls', 'helper']],
    expectStructuralRefs: [['extends', 'A'], ['implements', 'P1']],
    expectSymbols: ['B'],
  },
  {
    // Zig 容器一律匿名 (`pub const T = struct {}`)，名字必须从父级 const 绑定回当。
    lang: 'zig',
    source: 'const std = @import("std");\nconst rel = @import("./sibling.zig");\n\npub const Kind = enum { all, skill, mcp };\n\npub const Set = struct {\n    items: []const Kind = &.{},\n\n    pub fn includes(self: Set) bool {\n        return helper(1) > 0;\n    }\n};\n\npub fn top(n: usize) ![]u8 {\n    return helper(n);\n}\n\nfn helper(n: usize) usize {\n    return n;\n}\n\ntest "named case" {\n    try std.testing.expect(helper(2));\n}\n',
    expectRefs: [['calls', 'helper'], ['imports', './sibling.zig']],
    expectSymbols: ['Kind', 'Set', 'Set.includes', 'top', 'helper'],
  },
];

describe.skipIf(!isTreeSitterAvailable())('multi-language extractors: calls / extends / implements', () => {
  for (const c of CASES) {
    it(`${c.lang} — extracts calls + inheritance references`, async () => {
      const runner = new CodeParseRunner();
      try {
        const result = await runner.extract(c.source, c.lang, `test.${c.lang === 'objc' ? 'm' : c.lang === 'cpp' ? 'cpp' : c.lang === 'csharp' ? 'cs' : c.lang}`);
        expect(result).not.toBeNull();
        const refs = (result?.references ?? []) as ExtractedReference[];
        // rust/cpp 继承走裸名 edges (由 code-extractor 通用层转为引用), 断言合并两者
        const pairs = new Set<string>();
        for (const r of refs) pairs.add(`${r.referenceKind}:${r.referenceName}`);
        for (const e of (result?.edges ?? [])) pairs.add(`${e.kind}:${e.target}`);
        for (const [kind, name] of c.expectRefs) {
          expect(pairs.has(`${kind}:${name}`), `${c.lang} missing ${kind}:${name} (got: ${[...pairs].join(', ')})`).toBe(true);
        }
        const structuralPairs = new Set((result?.structuralReferences ?? [])
          .map(reference => `${reference.relationHint}:${reference.rawTargetName}`));
        for (const [kind, name] of c.expectStructuralRefs ?? []) {
          expect(
            structuralPairs.has(`${kind}:${name}`),
            `${c.lang} missing structural ${kind}:${name} (got: ${[...structuralPairs].join(', ')})`,
          ).toBe(true);
        }
        if (c.expectStructuralRefs) {
          expect(refs.some(reference =>
            reference.referenceKind === 'extends'
            || reference.referenceKind === 'implements')).toBe(false);
        }
        if (c.expectSymbols) {
          const symNames = new Set((result?.symbols ?? []).map(s => s.qualifiedName));
          for (const s of c.expectSymbols) {
            expect(symNames.has(s), `${c.lang} missing symbol ${s} (got: ${[...symNames].join(', ')})`).toBe(true);
          }
        }
      } finally {
        runner.dispose();
      }
    }, 30000);
  }

  it('python contains edges derive from qualified names (multi-level)', async () => {
    const runner = new CodeParseRunner();
    try {
      const result = await runner.extract(
        'class A:\n    class B:\n        def m(self): pass\n',
        'python', 'test.py',
      );
      expect(result).not.toBeNull();
      const qns = (result?.symbols ?? []).map(s => s.qualifiedName);
      expect(qns).toContain('A.B');
      expect(qns).toContain('A.B.m');
    } finally {
      runner.dispose();
    }
  });

  it('keeps C++ header imports tagged with the selected extractor language', async () => {
    const runner = new CodeParseRunner();
    try {
      const result = await runner.extract('#include "dep.h"\nclass Box {};\n', 'cpp', 'Box.h');
      expect(result?.references).toContainEqual(expect.objectContaining({
        referenceKind: 'imports',
        referenceName: 'dep.h',
        language: 'cpp',
      }));
    } finally {
      runner.dispose();
    }
  });
});
