<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Drift Realign Workflow

## Prerequisites

- `.workflow/` 已初始化（`.workflow/state.json` 存在）
- Git 仓库可访问（`git log` 可执行）
- 至少一个 `.workflow/` artifact 存在
- REQUIRED: wiki indexed via `maestro wiki rebuild` (supports session association)


---

## Argument Shape

```
/drift-realign --scope all                          → 全量扫描所有 scope（交互式）
/drift-realign --scope spec --since 2026-06-01      → 仅扫 spec 漂移，指定起始时间
/drift-realign --scope roadmap --depth deep          → 深度扫描 roadmap
/drift-realign --scope all --dry-run                 → 完整预演，不写盘
/drift-realign --scope all --report                  → 仅出报告不动盘
/drift-realign --scope codebase --auto-archive       → 自动归档 codebase 漂移
/drift-realign --scope all --interactive             → 逐条交互决策
```

| Flag | Effect |
|------|--------|
| `--scope <type>` | 目标 scope: roadmap / spec / codebase / state / issue / knowhow / project / all（默认 all） |
| `--since <date\|commit>` | 起始时间点（日期或 commit hash），覆盖自动推断 |
| `--depth <level>` | shallow（正则 + 路径校验）/ deep（LLM 语义分析），默认 shallow |
| `--dry-run` | 全流程预演，展示所有 findings 和建议 action，不写盘 |
| `--report` | 仅生成报告到 `.workflow/.drift-realign/`，跳过交互和 apply |
| `--auto-archive` | P1/P2 自动归档，P0 保留人工审查 |
| `--interactive` | 逐条交互决策（默认开启，除非 `--report` 或 `--auto-archive`）|

互斥规则：`--report` 强制 read-only，覆盖其他 mode；`--auto-archive` 与 `--interactive` 互斥；`--auto-archive` 覆盖 `--interactive`。

---

## Stage 1: parse_input

```
验证 .workflow/ 存在（否则 E001）。解析参数：
  scope: roadmap | spec | codebase | state | issue | knowhow | project | all（默认 all，E002 若非法值）
  since: 显式指定 → 使用提供的日期/commit
         state.json.last_drift_realign 存在 → 使用该值
         state.json.last_pruned 存在 → 使用该值
         兜底 → 90 天前
  depth: shallow（默认）| deep
  mode: interactive（默认）| dry-run | report | auto-archive

互斥校验：
  --report → 强制覆盖 mode 为 read-only
  --auto-archive 覆盖 --interactive（非错误，静默降级）; flag session as [LOW CONFIDENCE] (interactive skipped)

检查 git 可用性（E003）。
初始化 .workflow/.drift-realign/ 目录。
```

---

## Stage 2: reconstruct_timeline

```
运行 maestro timeline --since <resolved_date> --json --output .workflow/.drift-realign/timeline-{date}.json

timeline 每条 session 事件包含以下字段（已足够 shallow 分析）：
  id:           session 唯一标识
  title:        session 标题
  summary:      用户首条提问摘要（≤200 字符）
  edited_files: 该 session 编辑的文件列表
  code_paths:   该 session 涉及的代码路径
  platform:     平台标识（claude / codex / unknown）

解析输出提取以下结构：
  window: { from, to, total_days }
  git_summary: { commit_count, files_changed, insertions, deletions }
  session_summary: { total, with_edits, last_session_date, by_platform: { claude: N, codex: N, ... } }
  events: 按时间戳排序的 commit + session 事件交织列表
  hot_paths: 变更频率最高的目录列表（包含 git files + session edited_files + code_paths）
  cold_workflow_files: 在窗口内未修改的 .workflow/ 文件列表
```

### 2a. 平台问询（交互式）

```
检查 session_summary.by_platform 分布。
如果存在多个平台且 session 总量 > 20：
  使用 AskUserQuestion 向用户展示平台分布并询问：
    "检测到多个 session 平台（claude: 80, codex: 40, unknown: 12）。
     修改主要在哪个平台进行？聚焦特定平台可以缩小分析范围。"
    选项:
      - 全部平台（不过滤）
      - Claude（仅 Claude Code session）
      - Codex（仅 Codex session）

  如果用户选择特定平台：
    重新运行 maestro timeline --since <date> --platform <选择> --json --output ...
    后续 scanner agent 仅使用该平台的 session 上下文。
```

### 2b. Session 详情按需加载

```
timeline 事件中的 summary + edited_files + code_paths 足以支撑 shallow 扫描。
当 --depth deep 时，scanner agent 可能需要 session 完整内容来判断语义漂移：

  对于与 drifted .workflow/ 文件有交集的 session（edited_files 交集检测）：
    maestro load --type session --id <session_id> --json
    → 获取 body（详细描述）、related（关联条目）等完整字段

  按需加载规则：
    1. 仅 --depth deep 时触发
    2. 仅加载 edited_files 与 cold_workflow_files 有交集的 session
    3. 最多加载 10 个 session（按相关度排序：交集文件数降序）
    4. 加载结果写入 .workflow/.drift-realign/session-details-{date}.json
    5. scanner agent 在 deep 模式下同时接收 timeline.json + session-details.json
```

---

## Stage 3: compute_drift_score

```
公式：drift_score = drift_window_days × sqrt(changed_files_count) × scope_weight

changed_files_count 来源：git_summary.files_changed + session 中 edited_files 去重后的独立文件数。
合并公式：changed_files_count = |Set(git_files) ∪ Set(session_edited_files)|

scope_weight 映射：
  roadmap:  1.5  （结构性，影响所有下游）
  spec:     1.3  （影响编码指导）
  project:  1.4  （基础性）
  state:    1.2  （运行态）
  codebase: 1.0  （文档）
  issue:    0.8  （跟踪）
  knowhow:  0.7  （参考）

阈值判定：
  LOW:      score < 30   → 以 --depth shallow 继续
  MODERATE: 30 ≤ score < 100 → 以配置的 depth 继续
  SEVERE:   score ≥ 100  → 自动升级为 --depth deep，若 drift_window > 180 天则 emit W002

向用户展示 drift summary。
```

---

## Stage 4: parallel_drift_scan

**MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: 在单条消息中并行派发 4 个 agent。每个 agent 接收 timeline.json + 相关 scope 文件 + git diff 摘要。**

### 4a. roadmap-scanner

| Drift Type | Detection Algorithm | Severity |
|-----------|-------------------|----------|
| phantom_phase | roadmap.md 列出的 phase 在代码或 state.json 中无对应 | P0 |
| stale_progress | Phase Progress 表格百分比与实际 task 完成状态不符 | P1 |
| milestone_mismatch | state.json milestones 与 roadmap.md milestone 描述不一致 | P0 |
| outdated_criteria | 成功标准引用了已删除/重命名的 feature | P1 |
| dependency_ghost | 依赖引用指向已删除/重构的模块 | P1 |
| timeline_impossible | roadmap 中的日期已过期但 milestone 未标记完成 | P2 |

### 4b. spec-scanner

| Drift Type | Detection Algorithm | Severity |
|-----------|-------------------|----------|
| convention_violation | Spec 规定 "使用 X 模式" 但 git diff 显示代码使用 Y 模式 | P0 |
| dead_import_pattern | Spec 引用的 import 风格在 codebase 中已不存在 | P1 |
| architecture_breach | 新代码结构违反了架构约束 | P0 |
| stale_dependency | Spec 提及的库版本/API 与 package.json 矛盾 | P1 |
| naming_drift | Spec 中的命名规范与 hot_paths 实际命名不匹配 | P2 |
| test_convention_gap | 测试规范 spec vs 实际测试文件模式 | P2 |

检测方法：
- shallow：grep spec 引用的模式匹配 hot_paths 文件，检查文件是否存在
- deep：LLM 阅读 spec entry + hot_paths 代码采样，判断对齐度

### 4c. codebase-scanner

| Drift Type | Detection Algorithm | Severity |
|-----------|-------------------|----------|
| architecture_outdated | architecture.md 描述的结构已被 git diff 改变 | P0 |
| feature_missing | features.md 未提及近期 commit 中可见的新 feature | P1 |
| tech_stack_changed | tech-stack.md 列出已移除的依赖或遗漏新增依赖 | P0 |
| concern_drift | concerns.md 描述的模式已不存在 | P1 |
| doc_index_stale | doc-index.json 引用的文件在磁盘上不存在 | P0 |

检测方法：
- shallow：交叉校验 doc-index.json 路径与文件系统，检查文件 mtime
- deep：LLM 阅读每个 codebase 文档 + 采样近期代码，判断准确性

### 4d. artifact-scanner

| Drift Type | Detection Algorithm | Severity |
|-----------|-------------------|----------|
| issue_code_ref_dead | issues.jsonl 的 related_files 指向已移动/删除的路径 | P1 |
| issue_stale_open | Open issue 的 fix_direction 引用了已重构的代码 | P1 |
| knowhow_code_ref_dead | Knowhow entry 引用的代码路径已不存在 | P1 |
| orphan_session | active/ 中的 session 在 state.json 中无对应 artifact | P2 |
| project_tech_drift | project.md Tech Stack 部分 vs 实际 package.json/code | P0 |
| project_req_drift | project.md Requirements 部分 vs 已实现的 feature | P1 |
| accumulated_stale | state.json accumulated_context.key_decisions 引用已重构区域 | P1 |
| deferred_resolved | state.json deferred items 实际已被 git 历史证明已实现 | P2 |

每个 agent 返回：
```
DriftFinding {
  id: "DFT-{8hex}",
  scope: "roadmap" | "spec" | "codebase" | "state" | "issue" | "knowhow" | "project",
  severity: "P0" | "P1" | "P2",
  target: { file: string, section?: string },
  drift_type: string,
  evidence: { code_reality: string, doc_claim: string, git_ref?: string },
  suggested_action: "keep" | "update" | "archive" | "rebuild",
  update_hint?: string
}
```

---

## Stage 5: synthesize_findings

```
合并所有 agent 结果为统一 DriftFinding[]。

去重：若多个 agent 标记同一 file+section，保留最高 severity。
排序：P0 优先，然后 P1，然后 P2。
按 --scope 过滤（若非 "all"）。
按 scope 和 severity 统计计数。

Conflict-marker 集成：
  MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: 运行 maestro spec conflict list → 已标记的冲突条目
  对于已有 conflict-marker 的 spec 条目，若 drift scanner 也检测到同一文件：
    合并为同一 finding（提升 severity 到 P0，来源标注 "drift + conflict-marker"）
  对于 drift scanner 发现但无 conflict-marker 的条目：保持 scanner 原始 severity
```

---

## Stage 6: interactive_triage

```
若 --report → 跳至 Stage 9。
若 --auto-archive → 自动应用每个 finding 的 suggested_action（P1/P2 直接执行，P0 保留人工审查）。
若 --dry-run → 展示所有 findings 及建议 action，跳过 Stage 7-8。

否则，逐条交互：
```

```
[!] Drift Detected (P0 - architecture_outdated)
Scope:    codebase
Target:   .workflow/codebase/architecture.md §Module Boundaries
Evidence: Code added new src/payments/ module not described in architecture.md
Git Ref:  commit abc123 (2026-06-10)
Hint:     Add Payments module section describing src/payments/ structure
Suggestion: [u]pdate

Action?  [k]eep / [u]pdate / [a]rchive / [r]ebuild / [s]kip / [q]uit
> _
```

| Action | 行为 |
|--------|------|
| `keep` | 确认无漂移或可接受，标记为已审查（记录到 drift-log.jsonl action=keep）|
| `update` | 在目标文件顶部注入 TODO 标记：`<!-- DRIFT-TODO: {update_hint} (DFT-{id}, {date}) -->` |
| `archive` | 移动到 .trash/（先备份）|
| `rebuild` | 标记为自动重建目标（codebase scope 触发 `/quality-sync --full`）|
| `skip` | 跳过本条不做决策（记录到 drift-log.jsonl action=skipped，下次 re-run 会重新出现）|

---

## Stage 7: backup

```
mkdir .workflow/.trash/drift-realign-{ISO_timestamp}/
for each actionable finding:
  cp target.file → .trash/{timestamp}/{relative_path}
也备份 state.json → .trash/{timestamp}/state.json.bak
若任一备份失败 → E005，禁止 Stage 8
```

---

## Stage 8: apply_actions

| Action | 实施 |
|--------|------|
| `keep` | 写 drift-log.jsonl 一条 action=keep 记录 |
| `skip` | 写 drift-log.jsonl 一条 action=skipped 记录（不标记 reviewed，下次 re-run 重现）|
| `update` | 在目标文件头部插入 TODO 注释块：`<!-- DRIFT-TODO: {update_hint} (DFT-{id}, {date}) -->` |
| `archive` | 移动文件到 `.trash/{timestamp}/` + 更新 state.json 引用 |
| `rebuild` | 收集 rebuild 目标；全部其他 action 完成后：通过 `Skill()` 自动调用 `/quality-sync --full` |

rebuild 后处理：
- 若 W001 或重大结构变更 → MUST run `/manage-codebase-rebuild`

Conflict-marker 清除：
- 对于 update/archive 的 spec 目标文件，若存在 conflict-marker：
  maestro spec conflict clear <file> <line>
  （与 knowledge-audit 的 deprecate/delete 清除行为对称）

更新 state.json：设置 `last_drift_realign = now`（ISO-8601）

state.json 原子写：备份 → 写新版本 → re-read 验证。

---

## Stage 9: report

写 `.workflow/.drift-realign/drift-report-{date}.md`：

```markdown
# Drift Realign Report — {date}

## Timeline Window
- From: {from} → To: {to} ({days} days)
- Git: {commits} commits, {files_changed} files changed
- Sessions: {total} total, {with_edits} with edits
- Drift Score: {score} ({LOW|MODERATE|SEVERE})

## Scan Summary
- Total findings: {N} ({P0} P0 / {P1} P1 / {P2} P2)
- By scope: roadmap {N} / spec {N} / codebase {N} / state {N} / issue {N} / knowhow {N} / project {N}

## Actions Applied
| # | Scope | Drift Type | Target | Action | Status |
|---|-------|-----------|--------|--------|--------|
| 1 | codebase | architecture_outdated | architecture.md §Module Boundaries | update | OK |
| 2 | spec | convention_violation | coding-conventions.md §Import Rules | archive | OK |

## Kept (no drift or user chose keep)
| Finding | Reason |
|---------|--------|
| DFT-abc12345 | User chose keep — marked as reviewed |

## Auto-Rebuilt
- /quality-sync --full triggered: {yes/no}
- /manage-codebase-rebuild suggested: {yes/no}

## Backup
- Location: .workflow/.trash/drift-realign-{timestamp}/
```

同时追加结构化条目到 `.workflow/.drift-realign/drift-log.jsonl`（每行一条 JSON）：

```json
{
  "realign_id": "DFT-RUN-{timestamp}",
  "finding_id": "DFT-{8hex}",
  "scope": "codebase",
  "drift_type": "architecture_outdated",
  "severity": "P0",
  "target": { "file": ".workflow/codebase/architecture.md", "section": "Module Boundaries" },
  "action": "update",
  "applied_at": "2026-06-24T15:30:00.000Z",
  "backup_path": ".workflow/.trash/drift-realign-20260624T153000/"
}
```

显示摘要并引导后续步骤：

```
=== DRIFT REALIGN COMPLETE ===
Scope: all

  Findings:  18 total (4 P0 / 9 P1 / 5 P2)
  Updated:   6 (TODO markers injected)
  Archived:  3 (moved to .trash/)
  Rebuilt:   2 (via /quality-sync --full)
  Kept:      7 (marked as reviewed)

  Report:  .workflow/.drift-realign/drift-report-2026-06-24.md
  Backup:  .workflow/.trash/drift-realign-20260624T153000/

Next:
  → 处理 TODO 标记:           grep -r "DRIFT-TODO" .workflow/
  → 内部矛盾审查:             /manage-knowledge-audit --scope all
  → 全量 codebase 重建:       /manage-codebase-rebuild
  → 周期巡检 (REQUIRED at milestone end): run --scope all --report
```

---

### Safety invariants

1. **Code-as-Truth** — 代码永远是对的；当代码和文档不一致时，是文档漂移了
2. **Backup before mutate** — Stage 7 必须成功才能执行 Stage 8；state.json 原子写（备份 → 写新 → re-read 校验）
3. **No auto-delete** — drift-realign 绝不物理删除文件；archive 仅移动到 `.trash/`
4. **Rebuild is scoped** — 自动重建仅对 codebase scope 触发，绝不对 spec/roadmap 触发
5. **Idempotent** — 相同输入产生相同 findings（git 状态 + 文件状态确定性）
6. **Graceful degradation** — wiki/session 不可用时（W001），以 git-only timeline 继续; flag timeline as [LOW CONFIDENCE] (wiki/session unavailable)
7. **Preserve user work** — TODO 标记是注释，绝不覆盖文件内容
8. **State.json atomic** — 所有 state.json 变更遵循 备份 → 写新 → 验证 模式
