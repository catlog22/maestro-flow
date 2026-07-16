# MaestroGraph 代码边管道断裂诊断

> **状态**: 🔴 未修复 (2026-07-14 发现)
>
> **关联**: [plan-maestrograph.md](./_design/plan-maestrograph.md) — 设计文档标记"已完成"，但代码边管道未接通
>
> **影响范围**: `maestro kg callers/callees/impact/path` 返回空结果；`findDeadCode()` 误报

---

## 一、问题概述

MaestroGraph 的架构设计完整（数据模型、查询 API、CLI 命令），但 **代码→代码边（code-to-code edges）的生成管道从未被接通**。edges 表中仅有知识类边（defines/constrains/documents），零代码类边（imports/calls/extends/implements 等）。

**结论**: 不是 feature 空白，不是配置 bug，而是**管道接通问题**（wiring gap）——已实现的模块未在 sync 流程中被调用。

## 二、四个断裂点

### W-1: 语言提取器不产出边

**文件**: `src/graph/kg/extraction/code/languages/typescript.ts:185`

```typescript
return { symbols, references, edges: [] };  // edges 始终为空
```

TypeScript 提取器提取了 import `references`（import 语句的源路径），但 `edges` 数组硬编码为空。所有语言提取器（JavaScript、TSX、Python 等）均相同行为。

**references 被提取但未转化**: `referencesCollected` 在 `CodeExtractionStats` 中仅作为计数器，实际 reference 数据在提取完成后丢弃。

### W-2: `resolveReferences()` 是空壳

**文件**: `src/graph/kg/engine.ts:117`

```typescript
resolveReferences(): ResolutionResult {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return { edgesCreated: 0, edges: [], durationMs: 0 };  // stub
}
```

此方法应调用 `ImportResolver` + `name-matcher` 将提取的 references 解析为 `imports`/`calls`/`references` 边，但实现为硬编码空返回。

### W-3: sync 管道缺 Phase 3

**文件**: `src/graph/kg/extraction/orchestrator.ts`

当前 sync 流程:

```
Phase 1: Knowledge 源同步 → nodes + edges ✅
Phase 2: Code 提取 → nodes ✅, edges ❌ (提取器返回空)
Phase 2.5: resolveKnowledgeEdges() → defines/constrains/documents ✅
Phase 3: ❌ 不存在 — 代码引用解析未调用
```

缺失的 Phase 3 应包含:
1. 实例化 `ImportResolver`，解析 references → `imports` 边
2. 运行 `name-matcher`，解析符号引用 → `calls`/`references` 边
3. 批量写入 DB

### W-4: callback-synthesizer 从未被调用

**文件**: `src/graph/kg/resolution/callback-synthesizer.ts`

14 阶段回调通道发现器已完整实现（事件注册→触发配对、字段观察者、JSX 子节点等），但 `runCallbackSynthesis()` 在整个 sync 管道中**从未被调用**。

## 三、已完成模块 vs 未接通管道

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| tree-sitter AST 解析 | `extraction/code/tree-sitter.ts` | ✅ 工作 | 28+ 语言 WASM grammar |
| SQLite 图存储 | `db/connection.ts` | ✅ 工作 | nodes + edges + FTS5 |
| 21 种边类型 | `db/types.ts` | ✅ 定义 | 12 code + 9 knowledge |
| ImportResolver | `resolution/import-resolver.ts` | ✅ 实现 | tsconfig/go.mod/compile_commands/re-export |
| name-matcher | `resolution/name-matcher.ts` | ✅ 实现 | 6 级策略链 |
| callback-synthesizer | `resolution/callback-synthesizer.ts` | ✅ 实现 | 14 阶段 |
| knowledge-resolver | `resolution/knowledge-resolver.ts` | ✅ **接通** | defines/constrains/documents |
| 图遍历 API | `query/traversal.ts` | ✅ 实现 | callers/callees/impact/path/hierarchy |
| CLI 命令 | `surface/cli.ts` | ✅ 实现 | kg callers/callees/impact/path/context |
| **references → edges** | orchestrator.ts | ❌ **未接通** | 提取但丢弃 |
| **resolveReferences()** | engine.ts | ❌ **空壳** | 硬编码空返回 |
| **callback synthesis** | orchestrator.ts | ❌ **未调用** | 模块存在但管道不调用 |

## 四、当前影响

edges 表实际内容:

```
有:    defines (domain→code), constrains (spec→code), documents (knowhow→code)
缺:    imports, calls, extends, implements, references, type_of, returns,
       instantiates, overrides, decorates
```

受影响的 API:

| API/命令 | 预期行为 | 实际行为 |
|---------|---------|---------|
| `maestro kg callers <node>` | 返回调用方列表 | 0 callers |
| `maestro kg callees <node>` | 返回被调用列表 | 0 callees |
| `maestro kg impact <node>` | 返回影响半径 | 仅返回自身 |
| `getFileDependencies()` | 返回文件依赖 | 空数组 |
| `getFileDependents()` | 返回文件反向依赖 | 空数组 |
| `findDeadCode()` | 找无引用的非导出符号 | 误报全部非导出符号 |
| `getCallGraph()` | 返回调用子图 | 仅返回起始节点 |
| `findShortestPath()` | 代码节点间路径 | 仅知识→代码路径可达 |

## 五、修复方案

### 方案 A: 最小改动（推荐）

集中修改 2 个文件:

**1. `orchestrator.ts` — 增加 Phase 3**

在 code 节点写入后、credibility sync 前，增加代码引用解析:

```typescript
// Phase 3: Code reference resolution
if (shouldSync('codegraph') && allResults.length > 0) {
  const { ImportResolver } = await import('../resolution/import-resolver.js');
  const { matchReference } = await import('../resolution/name-matcher.js');
  const resolver = new ImportResolver(projectPath);

  // 3a: 将每个文件的 references 解析为 imports 边
  // 3b: 运行 name-matcher 解析 calls/references 边
  // 3c: 运行 callback-synthesizer
  // 3d: 批量写入 DB
}
```

**2. `engine.ts` — 替换 `resolveReferences()` 空壳**

调用 ImportResolver + name-matcher 的实际实现，使其可独立于 sync 流程单独执行。

### 方案 B: 提取器层面修复

让语言提取器在 `extract()` 中直接生成文件内边（contains、同文件 calls），跨文件边留给 orchestrator Phase 3。需要修改所有语言提取器。

### 前提条件

无论哪种方案，都需要先解决 **references 数据传递问题**:
- 当前 `forEachCodeExtractionResult()` 的回调接收 `ExtractionResult`（仅含 nodes + edges + fileRecord）
- `references` 在 `LanguageExtractionResult` 中，但 `buildResultFromTreeSitter()` 丢弃了它
- 需要扩展 `ExtractionResult` 或在 orchestrator 中保留 `LanguageExtractionResult` 的 references

## 六、当前可用的兜底路径

在修复前，调用关系分析的最优实践:

```bash
# 1. 定义点查找（KG 有效）
maestro search "TargetSymbol" --kg

# 2. 交叉搜索 — 两个角度并发
maestro explore \
  "FIND: import statements that import TargetSymbol\nSCOPE: src/\nEXPECTED: file:line list" \
  "FIND: function calls to TargetSymbol with call context\nSCOPE: src/\nEXPECTED: file:line + surrounding 3 lines" \
  --json

# 3. 对重要路径，用 Grep 做二次确认
# pattern: import.*TargetSymbol.*from
```

双命中 → 高置信；单命中 → Grep 确认；零命中 → 换角度或目标不存在。
