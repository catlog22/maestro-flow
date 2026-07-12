# Session/Run 全量迁移

## 1. Requirement & Criteria

目标：以 `guide/session-run-structure-guide.md` 为目标模型，在当前项目内完成 Session → Run → Artifact 的可运行迁移，而非仅替换 prompt 文本。

已确认范围：

- 实现 `maestro run create/check/complete`、SessionStore、Artifact Runtime 与 legacy shim。
- 审计全部 68 个 command，迁移所有会话/产物写入型 command，并新增独立 verify Run。
- 同步迁移 commands 引用的项目 `workflows/`。
- 审计全部 45 个 skill，迁移其中 28 个有状态 skill。
- 优化 Maestro Search，使其增量索引 sealed/archived Session 与 typed artifacts，避免 draft、临时目录和投影重复。
- 通过 lint、typecheck、单元/集成测试与端到端 pilot 验收。

验收标准为 `session.json.acceptance_criteria` 中 AC1–AC7，用户已选择“全量迁移”。

## 2. Plan

计划按依赖顺序执行：

1. T1：实现 Session/Run 核心 runtime。
2. T2：实现 legacy shim、contract parser 与迁移 lint。
3. T3：迁移 analyze → plan → execute → verify 与质量核心。
4. T4：迁移其余 command 及其引用 workflow。
5. T5：迁移有状态 skill 与 authoring 模板。
6. T6：优化 Maestro Search 的 Session/Artifact 增量索引。
7. T7：同步 mirrors、help 与迁移文档。
8. T8：运行 lint、strict typecheck、测试、build 与端到端 pilot，并修复所有缺口。

执行配置：`backend → codex`，`frontend → claude`，其余使用本地 Agent；code review 跳过；执行后验证门使用 `codex`。`-y` 已启用。

## 3. Execution

已完成 T1–T8：

- Runtime：新增 `src/run/`，实现严格 Zod schema、跨进程锁、备份、mtime cache、事务批写/回滚、`create/check/complete/seal-session`、Gate、typed Artifact、report frontmatter、sealed 不可变。
- 兼容：legacy `state.json.artifacts[]` 可投影为新 upstream；sealed Run artifacts 双写给旧消费者。
- 核心链：analyze → plan → execute → `maestro-verify`，以及 review/test/debug，全部深度迁移为 typed outputs + report/handoff。
- 全量定义：69 commands、45 skills、122 workflows 均有显式 Session/Run 分类；43 个 Run command contract 可解析；28 个 stateful skill 的全部 role 文件具备 Run Artifact Boundary。
- Search：仅索引 sealed/archived Session/Run，typed artifact 优先，排除 running/draft/work/tmp/diagnostics/events，保留 legacy archive，并用深层 mtime 做增量失效。
- 验证：runtime 10/10、Search 38/38、prompt lint、strict typecheck、build、mirrors 全过；真实 CLI pilot 完成 create/check/complete/seal-session/search。

外部验证首次指出非核心 contract 意图、child-role 覆盖与验收记录证据不足，均已针对性修复；“缺少 verify command”为路径识别误报，实际新增文件是 `.claude/commands/maestro-verify.md`。

## 4. Verification

待 S_VERIFY 填写。

## 5. Fix Log

待 S_FIX 填写。

## 6. Generalization

待 S_GENERALIZE 填写。

## 7. Discoveries

待 S_DISCOVER 填写。

## 8. Learnings

待 S_RECORD 填写。
