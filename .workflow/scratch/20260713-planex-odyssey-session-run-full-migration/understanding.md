# Session/Run 全量迁移

## 1. Requirement & Criteria

目标：以 `guide/session-run-structure-guide.md` 为目标模型，在当前项目内完成 Session → Run → Artifact 的可运行迁移，而非仅替换 prompt 文本。

已确认范围：

- 实现 `maestro run create/check/complete`、SessionStore、Artifact Runtime 与 legacy shim。
- 审计全部 68 个 command，迁移所有会话/产物写入型 command，并新增独立 verify Run。
- 同步迁移 commands 引用的项目 `workflows/`。
- 审计全部 45 个 skill，最终确认并迁移其中 30 个有状态 skill。
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
- 全量定义：69 commands、45 skills、122 workflows 均有显式 Session/Run 分类；43 个 Run command contract 可解析；30 个 stateful skill 的活动子流程具备 Run Artifact Boundary。
- Mirrors：`.agy` 改为正式 YAML round-trip；`.codex` 保留 Codex 专属 body/tools，并幂等同步 canonical Run boundary 与 contract。
- Search：仅索引 sealed/archived Session/Run，typed artifact 优先，排除 running/draft/work/tmp/diagnostics/events，保留 legacy archive，并用深层 mtime 做增量失效。
- 验证：runtime 10/10、Search 38/38、prompt lint、strict typecheck、build、mirrors 全过；真实 CLI pilot 完成 create/check/complete/seal-session/search。

外部验证首次指出非核心 contract 意图、child-role 覆盖与验收记录证据不足，均已针对性修复；“缺少 verify command”为路径识别误报，实际新增文件是 `.claude/commands/maestro-verify.md`。

## 4. Verification

| AC | 方法 | 结果 | 证据 |
|---|---|---|---|
| AC1 | test | passed | Runtime tests 10/10；CLI create/check/complete/seal-session pilot |
| AC2 | grep | passed | 69 commands 分类完整；43 个 Run contract 可解析；新增 `maestro-verify` |
| AC3 | grep | passed | 122 workflows 分类完整；legacy/bootstrap/deprecated 边界 lint 通过 |
| AC4 | grep | passed | 45 skills 分类完整（30 run / 15 none）；活动子流程边界通过；`team-executor` schema 示例为 safe |
| AC5 | test | passed | legacy 双向 shim、sealed artifact/Session 不可变测试通过 |
| AC6 | test | passed | Search tests 38/38；sealed pilot 可搜索 |
| AC7 | test | passed | prompt lint、strict typecheck、build、mirrors、pilot 全通过 |

Iteration 1：7/7 passed，无需进入 S_FIX。

## 5. Fix Log

未进入正式 S_FIX。S_GENERALIZE 发现的 4 个 actionable gap 已在 discovery 路由中直接修复：AGY YAML 丢失、Codex 镜像未同步、`scholar-rebuttal-pro` 与 `team-designer` 错分为 none。

## 6. Generalization

完成 syntax、semantic、structural 三层扫描，并补充历史 `git log -S parseSimpleYaml`：

- Syntax：发现 `.agy` 的 nested `contract` 变为空值、inline `allowed-tools` 被拆成畸形 token；改用 `yaml` 包完整解析/序列化。
- Semantic：发现 `.codex/skills` 保留平台专属实现时没有继承 canonical Run boundary；新增幂等同步脚本。
- Structural：发现父 `SKILL.md` 分类无法覆盖 child phase 的活动写入；lint 扩展为 whole-subtree active-write 检测。
- Historical：`parseSimpleYaml` 来自 Antigravity 初始转换提交，说明问题是镜像架构的历史回归风险，而非本次单文件偶发错误。

提取 3 个高置信模式；6 个 unique hits，4 个跨层确认，2 个 regression risk；深挖 mirror/skill 子树后 remaining actionable = 0。

## 7. Discoveries

| ID | 发现 | 分类 | 处理 |
|---|---|---|---|
| D1 | `.agy` nested contract/inline tools 损坏 | bug | 使用正式 YAML round-trip，并新增 semantic mirror lint |
| D2 | `.codex/skills` 继续执行旧私有 session 写入 | risk | 新增保留 Codex body/tools 的 Run-mode 同步脚本；二次运行 0 changes |
| D3 | `scholar-rebuttal-pro` phase 写 `.scratchpad`，父 skill 为 none | bug | 改为 run，向 6 个 child Markdown 注入 Run Artifact Boundary |
| D4 | `team-designer` phase 创建 `.workflow/.team` 私有 session，父 skill 为 none | bug | 改为 run，向 2 个活动 phase 注入边界 |
| D5 | `team-executor` schema 中出现 `.workflow/.team` | safe | 仅为外部 session 输入 schema 示例；没有创建该路径的活动写入 |
| D6 | inherited workflows 仍保留旧写入语句 | safe | 顶部 Run Mode Contract 明确覆盖；workflow lint 要求 legacy mapping，活动逻辑由当前 Run 承接 |

所有 hits 已逐项分类，remaining actionable = 0。

## 8. Learnings

本轮形成 3 条可复用规则：

1. Mirror frontmatter 不得使用手写 YAML 子集解析器；必须做结构化 round-trip，并比较 nested contract 语义。
2. 多平台 prompt 迁移应保留平台专属 body/tools，只同步 canonical lifecycle boundary；同步脚本必须幂等并进入 `build:mirrors`。
3. Stateful skill 判定必须扫描完整子树，并区分 executable write 与 schema/example，避免漏迁移和误报并存。

这些规则已固化在迁移脚本、mirror lint、prompt lint 和验收文档中，无需另建重复 spec。G1–G7 全部确认完成，最终状态 `ALL_PASSED`。
