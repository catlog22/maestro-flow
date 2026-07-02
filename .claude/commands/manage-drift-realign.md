---
name: manage-drift-realign
description: Detect and realign .workflow/ artifact drift against code reality after refactoring
argument-hint: "[--scope <roadmap|spec|codebase|state|issue|knowhow|project|all>] [--since YYYY-MM-DD|commit|HEAD~N] [--depth shallow|deep] [--dry-run] [--report] [--auto-archive] [--interactive]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
检测代码重构/增量变更后，代码现实与 .workflow/ 文档之间的漂移。互补于 `manage-knowledge-audit`（检测知识存储内部矛盾）。本命令通过 git 时间线 + session 历史检测 code↔document 漂移。
</purpose>

<required_reading>
@~/.maestro/workflows/drift-realign.md
</required_reading>

<deferred_reading>
- ~/.maestro/workflows/knowledge-audit.md (交叉引用已有审计发现)
- ~/.maestro/workflows/sync.md (codebase 文档严重漂移时自动触发)
- ~/.maestro/workflows/codebase-rebuild.md (sync 不足时的回退方案)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Scope：** `roadmap` | `spec` | `codebase` | `state` | `issue` | `knowhow` | `project` | `all`（默认 `all`）

**`--since`：** 分析起始点。支持日期（`YYYY-MM-DD`）、commit ref（`abc1234`）、相对引用（`HEAD~N`）。默认自动检测：优先读 `state.json` 的 `last_drift_realign` 或 `last_pruned` 时间戳，回退 90 天。

**`--depth`：** `shallow`（mtime + 引用检查）vs `deep`（LLM 语义分析）。默认 `shallow`。

**`--dry-run`：** 预览模式，不执行任何写入。

**`--report`：** 仅生成报告，不进入交互分诊。

**`--auto-archive`：** 自动归档陈旧项，跳过逐项确认。

**`--interactive`：** 逐项交互分诊（默认）。

**互斥规则：**
- `--report` 覆盖 `--interactive`
- `--auto-archive` 覆盖 `--interactive`
- `--report` 与 `--auto-archive` 互斥（同时传入 → E006）

**状态文件读取：**
- `.workflow/state.json`
- `.workflow/roadmap.md`
- `.workflow/specs/*.md`
- `.workflow/codebase/*.md`
- `.workflow/issues/issues.jsonl`
- `.workflow/knowhow/*.md`
- `.workflow/project.md`

使用 `maestro timeline` CLI 构建统一的 git+session 时间线。

**Output boundary**: ALL file writes MUST target `.workflow/` metadata files (specs, codebase docs, roadmap.md, state.json, issues.jsonl) or `.workflow/.trash/drift-realign-{timestamp}/` (backups) or `.workflow/.drift-realign/` (session details). NEVER modify source code files.
</context>

<invariants>
1. **Code-as-Truth** — 代码是唯一真理源；当文档说 X 但代码做 Y 时，文档漂移，NEVER 反向修改代码来匹配文档
2. **Backup before mutate** — MUST create backup tarball in `.workflow/.trash/` before any file modification (E005 if backup fails)
3. **Never modify source code** — drift-realign only updates `.workflow/` metadata; source code files are read-only
4. **Mutual exclusion** — `--report` 与 `--auto-archive` 互斥；同时传入 MUST trigger E006
5. **Auto-depth escalation** — `drift_window` > 180 天 MUST auto-upgrade to `--depth deep` with W002 warning
6. **Audit trail** — every triage decision MUST be logged in `drift-log.jsonl` with finding ID, action, and timestamp
7. **Rebuild trigger** — codebase scope 的 3+ P0 finding MUST auto-trigger `/quality-sync --full` after triage
</invariants>

<execution>
Follow `~/.maestro/workflows/drift-realign.md` Stages 1-9 in order.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Timeline** (Stages 1-2)
- REQUIRED: `.workflow/` 存在，scope 解析通过，`--since` 已解析。
- REQUIRED: `maestro timeline --since <date> --json` 产出有效时间线。
- BLOCKED if `.workflow/` 缺失 (E001)、scope 非法 (E002)、git 不可用 (E003)。

**GATE 2: Timeline → Scan** (Stages 2-3 → Stage 4)
- REQUIRED: `timeline.json` 已生成且包含事件。
- REQUIRED: `drift_score` 已计算（LOW/MODERATE/SEVERE）。
- REQUIRED: 若 SEVERE 且 `--depth shallow`，发出 W002 建议 `--depth deep`。
- BLOCKED if 时间线为空（`--since` 之后无变更）。

**GATE 3: Scan → Triage** (Stage 4 → Stages 5-6)
- REQUIRED: 4 个并行漂移扫描 agent 全部返回结果（或 W003 部分覆盖）。
- REQUIRED: `DriftFinding[]` 已合并、去重、按严重度排序。
- BLOCKED if 所有 agent 均失败。

**GATE 4: Triage → Apply** (Stages 6-7 → Stage 8)
- REQUIRED: 备份 tarball 生成于 `.workflow/.trash/drift-realign-{timestamp}/`。
- REQUIRED: 所有用户决策已记录（或 `--auto-archive`/`--report` 已生效）。
- REQUIRED: codebase scope 的 rebuild 动作自动触发 `/quality-sync --full`。
- BLOCKED if 备份失败 (E005)。

### Execution Constraints

- **Code-as-Truth**: 代码是唯一真理源。当文档说 X 但代码做 Y 时，文档漂移。
- **Parallel scan**: Stage 4 在单条消息中派发 4 个 agent（roadmap-scanner、spec-scanner、codebase-scanner、artifact-scanner）。
- **Auto-rebuild**: 当 codebase-scanner 检测到严重漂移（3+ P0 finding）时，分诊后自动触发 `/quality-sync --full`。若 sync 报告重大结构变更，建议 `/manage-codebase-rebuild`。
- **Long gap handling**: 当 `drift_window` > 180 天时，自动升级为 `--depth deep` 并警告用户 (W002)。

### Platform Inquiry（Stage 2a，交互式）

当 `session_summary.by_platform` 包含多个平台且 session 总量 > 20 时，使用 AskUserQuestion 询问用户修改主要在哪个平台进行。用户选择后以 `--platform` 参数重新获取 timeline，缩小后续分析范围。

### Session 详情加载策略（Stage 2b）

`maestro timeline` 每条 session 事件已包含：`summary`（用户提问摘要）、`edited_files`、`code_paths`、`platform`。这些信息在 `--depth shallow` 模式下足以支撑漂移检测。

当 `--depth deep` 时，对与 cold_workflow_files 有 edited_files 交集的 session，通过 `maestro load --type session --id <id> --json` 按需加载完整 body 和 related 字段：
- 仅加载 edited_files 与 cold_workflow_files 有交集的 session
- 最多加载 10 个（按交集文件数降序排序）
- 结果写入 `.workflow/.drift-realign/session-details-{date}.json`
- scanner agent 在 deep 模式下同时接收 timeline.json + session-details.json
</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| codebase 文档已重建 | `/manage-status` |
| spec 标记待更新 | 手动编辑标记的 spec 文件 |
| roadmap 已过时 | `/maestro-roadmap` 重新生成 |
| state.json 需清理 | `/manage-knowledge-audit --scope artifact` |
| 需要完整同步 | `/quality-sync --full` |
| project.md 已过时 | 编辑 `.workflow/project.md` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` 未初始化 | 先跑 `/maestro-init` |
| E002 | error | `--scope` 非法 | 提供有效 scope: roadmap/spec/codebase/state/issue/knowhow/project/all |
| E003 | error | git 不可用（非 git 仓库） | 初始化 git |
| E004 | error | `--since` 无法解析 | 检查日期格式或 commit ref |
| E005 | error | 备份失败 | 检查磁盘空间 |
| E006 | error | `--report` 与 `--auto-archive` 同时传入 | 二选一：`--report` 仅生成报告，`--auto-archive` 执行归档 |
| W001 | warning | session 历史不可用（wiki 未索引） | 运行 `maestro wiki rebuild` |
| W002 | warning | `drift_window` > 180 天 | 建议使用 `--depth deep` |
| W003 | warning | 部分 scanner agent 失败 | 以部分覆盖继续 |
| W004 | warning | git log > 1000 commits | 自动截断至最近 1000 条 |
</error_codes>

<success_criteria>
- [ ] Scope 正确解析，互斥标志校验通过
- [ ] `maestro timeline` 已调用，`timeline.json` 已生成
- [ ] `drift_score` 已计算（LOW/MODERATE/SEVERE 已展示）
- [ ] 4 个并行 scanner agent 已派发
- [ ] `DriftFinding[]` 已合并并按 P0 > P1 > P2 排序
- [ ] 如 `--interactive`：用户已分诊所有 finding
- [ ] 变更前备份 tarball 已生成
- [ ] archive 动作已将文件移入 `.trash/`
- [ ] update 动作已注入 TODO 标记及提示
- [ ] rebuild 动作已自动触发 `/quality-sync --full`
- [ ] `state.json` 已更新 `last_drift_realign` 时间戳
- [ ] `drift-report-{date}.md` 已生成
- [ ] `drift-log.jsonl` 已追加
- [ ] 摘要展示及下一步路由已输出
</success_criteria>
