# chains 子系统移除清单

**状态（2026-07-15）**：数据层已删除，代码层待后续执行。本文是代码层移除的完整闭包地图，执行前无需重新调查。

## 背景与决策

chains/ 是早期的「确定性图执行」方案（graph JSON + GraphWalker 引擎 + `maestro coordinate` CLI）。功能上已被 ralph（DAG 编排）与 maestro skill（LLM 路由）取代：

- 全仓 `.claude/commands/`、`prepare/`、`workflows/` 无任何 `maestro coordinate` 调用
- 唯一提及是 maestro-help 的命令目录清单
- `workflows/maestro.md` 的 "Chain Reference" 表是 LLM 路由概念表（maestro skill 自身的管线定义），不读 chains/*.json
- chains 中 3 个 singles（test-gen / business-test / integration-test）自 81707e05（2026-05-03 测试命令合并）起就指向已删除的命令，死链一年未被发现——侧面证明无人使用
- `chains/quality-loop.json` 的 `eval: ctx.result.business_test_status` 字段在 output-parser 的 FIELD_PATTERNS 中不存在，判定永远走 default 边——同样是无人使用的证据

用户裁定（2026-07-15）：整体移除。分两阶段——数据先删，代码按本清单后续删。

## 已完成（2026-07-15）

- [x] `chains/` 目录整体删除（graph JSON + singles/ + `_intent-map.json` + `_router.json`）

## 中间态说明（当前可接受）

- `maestro coordinate` CLI 仍存在；repo 内 chains/ 已删，`resolvePaths` 回退读 `~/.maestro/chains`（全局副本仍在）——直接运行仍可工作，属预期中间态
- `component-defs.ts` 的 chains 组件 source 缺失 → `scanComponents` 计 `fileCount=0, available=false` → 安装器跳过，不会崩（install-backend.ts:393-400；uninstall 白名单构建有 `existsSync` 守卫，install-backend.ts:1227）
- maestro-help 目录仍列出 coordinate 命令

## 待删——Ring 1（chains 专属，无外部依赖，可直接删）

| 项 | 位置 | 动作 |
|----|------|------|
| coordinate CLI | `src/commands/coordinate.ts` | 删除文件 |
| CLI 注册 | `src/cli.ts:45`（`coordinate:` 条目） | 删除行；确认 `coord` 别名一并消失 |
| 图引擎 | `src/coordinator/`：graph-loader.ts、graph-walker.ts、intent-router.ts、expr-evaluator.ts、output-parser.ts、prompt-assembler.ts、llm-decider.ts、parallel-executor.ts、coordinate-broker-adapter.ts、step-analyzer.ts、chain-graph.schema.json | 删除；`index.ts` 裁剪对应导出 |
| 引擎测试 | `src/coordinator/__tests__/` 全部 10 个文件 | 删除 |
| 安装组件 | `src/core/component-defs.ts:185-192`（chains 条目） | 删除条目 |
| TUI 测试 mock | `src/tui/install-ui/ComponentGrid.logic.test.ts:45,47,174`、`BlueprintPreview.logic.test.ts:130` | mock id 列表移除 'chains'（纯 mock，不影响断言逻辑，同步即可） |
| 帮助目录 | `.claude/skills/maestro-help/index/catalog.json:160`、`.claude/skills/maestro-help/phases/02-search-present.md:204` | 删除 coordinate 条目/行 |

## 保留——共享依赖（勿删）

| 文件 | 原因 |
|------|------|
| `src/coordinator/cli-executor.ts` | `SpawnFn` 被 `src/agents/parallel-cli-runner.ts:11` 使用（explore 并行执行的活跃链路） |
| `src/coordinator/graph-types.ts` | `AgentType` 被 parallel-cli-runner:12 使用；`CommandNode`/`WalkerState`/`ExecuteResult` 被 `src/hooks/workflow-hooks.ts:13-17` 类型引用 |
| `src/hooks/coordinator-tracker.ts` | 名字中的 coordinator 指 **/maestro skill 会话追踪**，与 chains 无关：`src/commands/hooks.ts:1304` 的 `coordinator-tracker` hook 写 bridge；statusline.ts:28、auto-mode.ts:10、skill-context.ts:17 读取 |

可选后续：将 cli-executor.ts 与 graph-types.ts（裁剪到仅存活类型）迁至 `src/agents/`，彻底清空 `src/coordinator/` 目录。

## Ring 2——coordinate 删除后成为死代码（二阶段裁决）

in-process 插件系统的唯一驱动者是 coordinate.ts（graph-walker 生命周期钩子）：

| 项 | 位置 | 备注 |
|----|------|------|
| HookManager | `src/hooks/hook-manager.ts` | 唯一消费者 coordinate.ts:171 |
| WorkflowHookRegistry | `src/hooks/workflow-hooks.ts` | 及其底层 `hook-engine.ts`（先确认无其他用户） |
| 5 个 in-process plugin | `src/hooks/plugins/`：telemetry、spec-injection、decision-log、spec-analytics、explore | 仅 coordinate.ts:26-30 装配。注意：spec 注入的**运行时实现**是 hooks.ts 的 CLI hook（spec-injector），与 spec-injection-plugin 无关，删 plugin 不影响注入功能 |
| guards 的 plugin 导出段 | `src/hooks/guards/workflow-guard.ts:122`、`prompt-guard.ts:51` | **双用途文件不可整删**：`src/commands/hooks.ts:7-9` 使用其中的 `evaluate*` 函数（CLI hook 路径）。仅移除 "In-process plugin for coordinator graph-walker" 导出段 |
| MaestroPlugin 类型 | `src/types/index.ts:1` | 随 WorkflowHookRegistry 删除 |
| 相关测试 | `src/hooks/__tests__/plugins.test.ts` 等 | 删除 |

## 全局副本清理

组件条目删除后：`maestro install --force` 不再管理 `~/.maestro/chains`；手动删除该目录，或跑一次 uninstall/prune。

## 文档残留（随代码阶段一并清理）

- guide/、docs-site/ 中 `maestro coordinate` 的提及
- `workflows/maestro.md` "Chain Reference" 表**保留**（LLM 路由概念，与 chains/*.json 无关）

## 验证步骤

1. `bun run build` 编译通过（确认无残余 import）
2. `vitest run` 全绿（coordinator 测试已删，hooks 测试通过）
3. `grep -r "coordinate" src/cli.ts src/commands/` 无 chains 相关命中
4. `maestro install --force` 正常，`maestro --help` 无 coordinate 命令
