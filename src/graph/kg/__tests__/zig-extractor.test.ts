import { describe, expect, it, afterAll } from 'vitest';
import { CodeParseRunner } from '../extraction/code/worker-parser.js';
import { isTreeSitterAvailable } from '../extraction/code/tree-sitter.js';
import type { LanguageExtractionResult } from '../extraction/code/tree-sitter-types.js';

// ---------------------------------------------------------------------------
// Zig 提取器回归测试
//
// Zig 的类型声明一律匿名 (`pub const T = struct {}`)，符号名只能取自父级 const
// 绑定，所以它不能复用 createGenericExtractor（那个靠 childForFieldName('name')）。
// 本文件锁住这套命名语义，以及两个方向相反的失败模式：
//   - 漏：容器/方法/enum variant 没被命名成层级符号
//   - 多：函数体里的局部 const 被当成声明导出，污染图
// ---------------------------------------------------------------------------

const SOURCE = `
const std = @import("std");
const rel = @import("./sibling.zig");
const up = @import("../core/shared/io.zig");

pub const Kind = enum { all, skill, mcp };

pub const Registry = struct {
    items: []const Kind = &.{},
    count: usize = 0,

    pub fn includes(self: Registry, domain: Kind) bool {
        const scratch = self.items.len;
        return scratch > 0 and helper(scratch) > 0;
    }

    fn private(self: Registry) usize {
        return self.count;
    }
};

const Tagged = union(enum) { rejected: u8, committed: []const u8 };
const Alias = std.mem.Allocator;
const Opaque = opaque {};
var counter: usize = 0;

pub fn top(alloc: *anyopaque, n: usize) ![]u8 {
    counter += 1;
    const p = alloc.alloc(n) catch return error.OutOfMemory;
    return helper(p.len);
}

inline fn helper(n: usize) usize {
    return n;
}

test "registry admits only declared kinds" {
    try std.testing.expect(helper(2) > 0);
}
`.trim();

const EMPTY_CONTAINER_SOURCE = `
const test_io_mod = if (std_builtin.is_test)
    @import("../core/shared/io.zig")
else
    struct {};

pub fn real() u8 {
    return 1;
}
`.trim();

const runner = new CodeParseRunner();
afterAll(() => runner.dispose());

async function extract(source: string, path = '/project/src/registry.zig'): Promise<LanguageExtractionResult> {
  const result = await runner.extract(source, 'zig', path);
  expect(result, 'zig extractor must be registered').not.toBeNull();
  return result!;
}

describe.skipIf(!isTreeSitterAvailable())('zig extractor', () => {
  it('names anonymous containers from their const binding', async () => {
    const { symbols } = await extract(SOURCE);
    const byQn = new Map(symbols.map(s => [s.qualifiedName, s.kind]));

    expect(byQn.get('Kind')).toBe('enum');
    expect(byQn.get('Registry')).toBe('struct');
    expect(byQn.get('Tagged')).toBe('struct');
    expect(byQn.get('Opaque')).toBe('struct');
    // enum variant vs struct field 必须区分开
    expect(byQn.get('Kind.skill')).toBe('enum_member');
    expect(byQn.get('Registry.items')).toBe('field');
    expect(byQn.get('Registry.count')).toBe('field');
  });

  it('extracts methods with qualified names and container ownership', async () => {
    const { symbols } = await extract(SOURCE);
    const byQn = new Map(symbols.map(s => [s.qualifiedName, s.kind]));

    expect(byQn.get('Registry.includes')).toBe('method');
    expect(byQn.get('Registry.private')).toBe('method');
    expect(byQn.get('top')).toBe('function');
    expect(byQn.get('helper')).toBe('function');
  });

  it('classifies const/var/type-alias bindings distinctly', async () => {
    const { symbols } = await extract(SOURCE);
    const byQn = new Map(symbols.map(s => [s.qualifiedName, s.kind]));

    expect(byQn.get('Alias')).toBe('type_alias');   // const Alias = std.mem.Allocator
    expect(byQn.get('counter')).toBe('variable');   // var counter: usize = 0
  });

  it('does not export function-local bindings as declarations', async () => {
    // `const scratch = ...` 和 `const p = ...` 都在 fn 体内。
    // grammar 还会把 `counter += 1;` 解析成 variable_declaration；
    // 两者都不能进入符号表，否则每个函数都会产出一堆假声明。
    const { symbols } = await extract(SOURCE);
    const names = symbols.map(s => s.name);

    for (const local of ['scratch', 'p']) {
      expect(names, `local const ${local} must not be a symbol`).not.toContain(local);
    }
    // counter 只应作为文件级 var 出现一次，不能被复合赋值再产出一遍
    expect(names.filter(n => n === 'counter')).toHaveLength(1);
  });

  it('turns @import into import references without emitting alias symbols', async () => {
    const { symbols, references } = await extract(SOURCE);
    const imports = references.filter(r => r.referenceKind === 'imports').map(r => r.referenceName);

    expect(imports).toContain('std');
    expect(imports).toContain('./sibling.zig');
    expect(imports).toContain('../core/shared/io.zig');
    // 模块别名由文件节点代表，再产出 constant 只是噪声
    expect(symbols.map(s => s.name)).not.toContain('rel');
    expect(symbols.map(s => s.name)).not.toContain('up');
  });

  it('records calls through qualified and wrapped callees', async () => {
    const { references } = await extract(SOURCE);
    const calls = references.filter(r => r.referenceKind === 'calls').map(r => r.referenceName);

    expect(calls).toContain('helper');
    expect(calls).toContain('alloc');    // self.items.len 之后的 alloc.alloc(n)
    expect(calls).toContain('expect');   // try std.testing.expect(...) 解开 try
  });

  it('names Zig test blocks so they are discoverable', async () => {
    const { symbols } = await extract(SOURCE);
    const tests = symbols.filter(s => s.qualifiedName.startsWith('test '));

    expect(tests.map(t => t.qualifiedName)).toEqual([
      'test registry admits only declared kinds',
    ]);
    expect(tests[0]!.kind).toBe('function');
  });

  it('reports a partial-parse diagnostic for the empty-container grammar gap', async () => {
    // tree-sitter-zig 对空 `struct {}` / `union {}` 会插入 MISSING identifier。
    // 它不致命（其余声明照常产出），但必须可见，否则"只解析了一半"的语言
    // 看起来和完全解析一模一样。
    const result = await extract(EMPTY_CONTAINER_SOURCE, '/project/src/gap.zig');

    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('zig-partial-parse'),
    );
    // 关键：报错不影响同文件其余声明
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('real');
    expect(names).toContain('test_io_mod');
    // 也不能为那个 MISSING identifier 造出一个空名符号
    expect(names).not.toContain('');
  });
});
