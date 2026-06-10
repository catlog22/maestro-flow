---
title: ".workflow/ 产物目录体系"
---

---

## 一、全局概览

### 作用域

| 路径 | 作用域 | 说明 |
|------|--------|------|
| `.workflow/` | 项目级 | 当前项目的全部工作流状态 |
| `~/.maestro/` | 全局级 | 跨项目的模板、配置、overlay |
| `.workflow/collab/` | 团队级 | 人类团队协作，与 `.workflow/.team/`（Agent 总线）严格隔离 |

### 核心原则

- `.workflow/` 加入 `.gitignore`，不进版本控制（`project.md` 可选例外）
- 所有产物路径相对于 `.workflow/` 根目录
- 每个目录/文件职责单一，不交叉存储
- 所有命令输出通过 `state.json.artifacts[]` 统一注册，支持跨阶段追踪

---

## 二、目录树

<details>
<summary>完整目录结构</summary>

```
.workflow/
├── state.json                    # 项目状态机 + Artifact Registry
├── config.json                   # 用户工作流配置
├── project.md                    # 项目定义（Core Value, Requirements, Key Decisions）
├── roadmap.md                    # 里程碑/阶段路线图
├── wiki-index.json               # Wiki 统一索引（WikiIndexer 自动生成）
│
├── specs/                        # 规范文件（6 类，项目级）
│   ├── coding-conventions.md     # 编码规范（核心）
│   ├── architecture-constraints.md # 架构约束（核心）
│   ├── knowhow.md                # 知识索引（核心）
│   ├── quality-rules.md          # 质量规则（可选）
│   ├── test-conventions.md       # 测试规范（可选）
│   ├── debug-notes.md            # 调试笔记（可选）
│   ├── review-standards.md       # 审查标准（可选）
│   └── learnings.md              # 学习记录（可选）
│
├── knowhow/                      # 知识文档（9 种前缀 + learn 特殊前缀）
│   ├── .maestro-learn/           # maestro-learn 会话状态
│   ├── KNW-*.md                  # session
│   ├── TIP-*.md                  # tip
│   ├── TPL-*.md                  # template
│   ├── RCP-*.md                  # recipe
│   ├── REF-*.md                  # reference
│   ├── DCS-*.md                  # decision
│   ├── AST-*.md                  # asset
│   ├── BLP-*.md                  # blueprint
│   ├── DOC-*.md                  # document
│   ├── KNW-follow-*.md           # learn-follow
│   ├── KNW-decompose-*.md        # learn-decompose
│   ├── KNW-retro-*.md/json       # learn-retro
│   ├── KNW-opinion-*.md          # learn-second-opinion
│   ├── KNW-investigate-*/        # learn-investigate
│   ├── KNW-digest-*.md           # wiki-digest
│   └── wiki-connections-*.md     # wiki-connect
│
├── scratch/                      # 执行产物（{YYYYMMDD}-{type}[-P{N}]-{slug}）
│   ├── *-analyze-*/              # 分析：discussion.md, analysis.md, conclusions.json, context.md, context-package.json
│   ├── *-plan-*/                 # 规划：plan.json, .task/TASK-*.json
│   │   └── .summaries/           # 执行：TASK-{NNN}-summary.md
│   ├── *-verify-*/               # 验证：verification.json
│   ├── *-review-*/               # 审查：review.json
│   ├── *-debug-*/                # 调试：understanding.md, evidence.ndjson
│   ├── *-test-*/                 # 测试：uat.md, test-results.json, coverage-report.json
│   ├── *-auto-test-*/            # 自动测试：report.json
│   ├── *-brainstorm-*/           # 头脑风暴：guidance-specification.md, {role}/, context-package.json
│   ├── *-collab-*/               # 协作：collab-report.md, context.md, context-package.json, per-tool/
│   ├── *-import-*/               # 外部文档导入：source.{ext}, context-package.json
│   └── *-ui-design-*/            # UI 设计：MASTER.md, design-tokens.json
│
├── issues/                       # 问题追踪
│   ├── issues.jsonl              # 活跃问题
│   ├── issue-history.jsonl       # 归档问题
│   └── discoveries/              # 发现会话
│
├── milestones/                   # 里程碑归档
│   └── {M}/
│       ├── artifacts/            # 归档产物
│       ├── audit-report.md
│       ├── summary.md
│       └── roadmap-snapshot.md
│
├── codebase/                     # 代码库文档（mapper agent 生成）
│   ├── doc-index.json
│   ├── tech-stack.md
│   ├── architecture.md
│   ├── features.md
│   └── concerns.md
│
├── blueprint/                    # 规范蓝图包（maestro-blueprint）
│   ├── blueprint-config.json
│   ├── product-brief.md
│   ├── glossary.json
│   ├── requirements/REQ-*.md, NFR-*.md
│   ├── architecture/ADR-*.md
│   ├── epics/EPIC-*.md
│   ├── readiness-report.md
│   └── blueprint-summary.md
│
├── collab/                       # 人类团队协作
│   ├── specs/                    # 团队级规范
│   └── specs/{uid}/              # 个人级规范
│
├── .maestro/                     # Agent 会话状态（内部）
│   ├── maestro-*/status.json
│   ├── ralph-*/status.json
│   ├── player-*/status.json
│   └── coord-*/walker-state.json
│
├── .team/{session-id}/.msg/      # Agent 团队消息总线
│   └── messages.jsonl
│
├── templates/design-drafts/      # 工作流模板设计草稿
├── reference_style/              # UI 设计系统参考
├── impeccable/                   # Impeccable UI 设计上下文
│   ├── PRODUCT.md
│   ├── DESIGN.md
│   ├── design.json
│   ├── critique/
│   └── live/config.json, sessions/
│
├── worktrees.json                # Worktree 注册表
├── worktree-scope.json           # Worktree 作用域标记
├── harvest-log.jsonl             # 收获日志
└── harvest-report-{date}.md      # 收获报告
```

</details>

---

## 三、核心文件详解

| 文件 | 用途 | 关键字段 |
|------|------|----------|
| `state.json` | 项目状态机 + Artifact Registry | `version`, `status`, `current_milestone`, `current_phase`, `artifacts[]`, `milestones[]`, `milestone_history[]` |
| `config.json` | 用户工作流配置（`maestro-init` 创建 + 各命令分段写入） | `workflow.{research,reflection}`, `execution.{method,auto_commit,default_executor}`, `git.commit_docs`, `gates.{confirm_roadmap,confirm_plan}`, `codebase.auto_sync_after_execute`, `worktree.{root,branch_prefix}`, `guard.*`, `collab.*`, `specInjection.*`, `dashboard.port` |
| `project.md` | 项目定义（`maestro-init` 创建） | Core Value, Requirements, Key Decisions, Context |
| `roadmap.md` | 里程碑/阶段路线图（`maestro-roadmap` 创建） | 里程碑列表、success criteria、依赖关系、Phase Progress Table |
| `wiki-index.json` | Wiki 统一索引（WikiIndexer 自动生成） | 索引 project/specs/knowhow/issues/roadmap |

### state.json Schema

```json
{
  "version": "3.0",
  "status": "idle|active",
  "current_milestone": "M1",
  "current_phase": 1,
  "milestones": [{ "id": "M1", "status": "active|completed|forked", "phases": [1, 2] }],
  "milestone_history": [{ "milestone_id": "M1", "completed_at": "ISO-8601" }],
  "artifacts": [{ "id": "ANL-001", "type": "analyze", "path": "scratch/...", "status": "completed" }],
  "artifact_archive": [{ "id": "ANL-000", "type": "analyze", "milestone": "M0", "graduated_at": "ISO-8601", "knowhow_ref": "graduated-analyze-ANL-000", "summary": "..." }],
  "accumulated_context": {
    "key_decisions": [{ "decision": "...", "rationale": "...", "source": "analyze:ANL-001", "locked_at": "ISO-8601" }],
    "deferred": [{ "title": "...", "reason": "...", "status": "open|resolved|cancelled|superseded", "source": "..." }],
    "blockers": [{ "title": "...", "severity": "...", "status": "open|investigating|resolved", "source": "..." }]
  },
  "last_pruned": "ISO-8601"
}
```

### artifacts[] Schema

```json
{
  "id": "ANL-001",
  "type": "analyze",
  "milestone": "M1",
  "phase": 1,
  "scope": "phase|milestone|adhoc|standalone",
  "path": "scratch/20260513-analyze-P1-auth",
  "status": "created|completed|failed",
  "depends_on": null,
  "harvested": false,
  "context_package": "scratch/20260513-analyze-P1-auth/context-package.json",
  "created_at": "ISO-8601",
  "completed_at": "ISO-8601"
}
```

| 字段 | 说明 |
|------|------|
| `context_package` | 该 artifact 产出的 Context Package 路径（相对于 `.workflow/`）。`null` 表示未生成（如 plan/execute/verify）。用于 `--from` 快速定位。 |

### artifact_archive[] Schema

harvest `--prune` 将 graduated artifacts 从 `artifacts[]` 迁移到此数组。文件保留在磁盘，仅 state.json 引用移动。

```json
{
  "id": "ANL-001",
  "type": "analyze",
  "milestone": "M1",
  "path": "scratch/20260315-analyze-P2-security",
  "graduated_at": "ISO-8601",
  "knowhow_ref": "graduated-analyze-ANL-001",
  "summary": "Security audit P2 — 8 fragments → 3 wiki, 2 spec, 3 issue"
}
```

| 字段 | 说明 |
|------|------|
| `graduated_at` | 归档时间戳 |
| `knowhow_ref` | 对应 wiki knowhow 条目的 slug（通过 `maestro wiki load` 可检索完整摘要） |
| `summary` | 一行摘要：来源 + fragment 路由统计 |

### accumulated_context 管理

`accumulated_context` 随项目生命周期增长。harvest `--prune` 按以下规则清理：

| 字段 | 保留 | 清理 |
|------|------|------|
| `key_decisions[]` | 未在 specs 中出现的决策 | 已在 `architecture-constraints.md` 中存在（逐字匹配） |
| `deferred[]` | status ∈ {open, deferred} | status ∈ {resolved, cancelled, superseded} |
| `blockers[]` | status ∈ {open, investigating} | status == resolved |

### 产物生命周期

```
created → completed → harvested → archived
                     ↘ failed
```

---

## 四、知识系统

### specs/ — 规范文件

使用 `<spec-entry>` 闭合标签格式，WikiIndexer 自动索引。

| 文件 | Category | 核心 | 创建条件 |
|------|----------|------|----------|
| `coding-conventions.md` | coding | 是 | 始终 |
| `architecture-constraints.md` | arch | 是 | 始终 |
| `knowhow.md` | — | 是 | 始终 |
| `quality-rules.md` | review | 否 | 检测到 linter/CI |
| `test-conventions.md` | test | 否 | 检测到测试框架 |
| `debug-notes.md` | debug | 否 | 按需 |
| `review-standards.md` | review | 否 | 按需 |
| `learnings.md` | learning | 否 | 按需 |

Spec 作用域：

| Scope | 目录 | ID 前缀 |
|-------|------|---------|
| project | `.workflow/specs/` | `spec:project:` |
| global | `~/.maestro/specs/` | `spec:global:` |
| team | `.workflow/collab/specs/` | `spec:team:` |
| personal | `.workflow/collab/specs/{uid}/` | `spec:personal:{uid}:` |

```xml
<spec-entry category="coding" keywords="exports,naming" date="2026-05-13" source="spec-add" roles="implement">
  规范内容...
</spec-entry>
```

### knowhow/ — 知识文档前缀

文件名格式：`{PREFIX}-{YYYYMMDD}-{HHMM}.md`

| 前缀 | 类型 | 说明 |
|------|------|------|
| KNW- | session | 会话状态压缩 |
| TIP- | tip | 快速提示 |
| TPL- | template | 代码/配置模板 |
| RCP- | recipe | 分步操作指南 |
| REF- | reference | 外部文档摘要 |
| DCS- | decision | 架构决策记录（proposed/accepted/superseded） |
| AST- | asset | 可复用资产（api-contract/data-model/prompt/config） |
| BLP- | blueprint | 架构蓝图 |
| DOC- | document | 通用文档 |

Learn 特殊前缀：`KNW-follow-`, `KNW-decompose-`, `KNW-retro-`, `KNW-opinion-`, `KNW-investigate-`, `KNW-digest-`

---

## 五、问题追踪

`issues/issues.jsonl` — 每行一个 JSON 对象：

```json
{
  "id": "ISS-XXXXXXXX-NNN",
  "title": "问题描述",
  "severity": "blocker|critical|major|minor|cosmetic",
  "status": "open|registered|planned|in_progress|resolved|closed",
  "source": "discover|review|verify|retrospective|harvest",
  "phase": 1,
  "tags": [], "related_files": [], "task_refs": [],
  "analysis": { "root_cause": "...", "fix_direction": "...", "confidence": "high|medium|low" },
  "history": [{ "action": "created|analyzed|planned|executed|closed", "at": "ISO-8601" }]
}
```

- `issues/issue-history.jsonl` — 已关闭问题归档
- `issues/discoveries/` — `manage-issue-discover` 会话产物

---

## 六、里程碑归档

里程碑完成时 `maestro-milestone-complete` 创建归档：

1. `maestro-milestone-audit` 验证完整性 → `audit-report.md`
2. scratch 产物移入 `milestones/{M}/artifacts/`
3. `state.json.artifacts[]` 移入 `milestone_history[]`
4. 提取 knowhow，推进下一里程碑

---

## 七、全局路径（~/.maestro/）

```
~/.maestro/
├── cli-tools.json              # CLI 工具配置（delegate 路由）
├── workflows/                  # 工作流定义（maestro.md, plan.md, execute.md 等 40+ 文件）
├── templates/                  # 模板系统（state.json, plan.json, task.json, workflows/ 等）
├── overlays/                   # 命令扩展（*.json, docs/, _shipped/）
└── specs/                      # 全局规范（*.md）
```

---

## 八、命名规则速查

### Scratch 目录

**格式**：`{YYYYMMDD}-{type}[-P{N}|-M{N}]-{slug}`

| 组成 | 值 | 说明 |
|------|----|------|
| `{YYYYMMDD}` | 日期 | 按时间排序 |
| `{type}` | analyze, plan, verify, review, debug, test, auto-test, brainstorm, collab, ui-design | 产物类型 |
| `P{N}` / `M{N}` | P1, M1 等 | Phase / Milestone 作用域（adhoc/standalone 省略） |
| `{slug}` | kebab-case | 内容摘要 |

### Artifact 类型与命令

| Type | ID 前缀 | Scope | 命令 |
|------|---------|-------|------|
| analyze | ANL-{NNN} | phase, adhoc, standalone | maestro-analyze |
| plan | PLN-{NNN} | phase, adhoc | maestro-plan |
| execute | EXC-{NNN} | phase | maestro-execute |
| verify | VRF-{NNN} | phase, milestone | maestro-execute (E2.7) |
| review | REV-{NNN} | phase | quality-review |
| debug | DBG-{NNN} | phase, standalone | quality-debug |
| test | TST-{NNN} | phase | quality-test |
| brainstorm | BRN-{NNN} | adhoc | maestro-brainstorm |
| collab | CLB-{NNN} | adhoc | maestro-collab |
| import | IMP-{NNN} | standalone | `--from @file` 自动创建 |
| ui-design | — | phase, scratch | maestro-impeccable --chain build |

### Session ID 格式

| 类型 | 格式 | 示例 |
|------|------|------|
| maestro 主会话 | `maestro-{YYYYMMDD-HHmmss}` | `maestro-20260513-143022` |
| ralph 会话 | `ralph-{YYYYMMDD-HHmmss}` | `ralph-20260513-143022` |
| player 会话 | `player-{YYYYMMDD-HHmmss}` | `player-20260513-143022` |
| delegate ID | `{prefix}-{HHmmss}-{rand4}` | `gem-143022-a7f2` |
| Issue ID | `ISS-XXXXXXXX-NNN` | `ISS-a1b2c3d4-001` |

---

## 九、Context Package 体系

### 设计动机

下游命令（roadmap / analyze / plan / blueprint）消费上游产出时存在三个问题：
1. **格式耦合**——每个消费者硬编码上游文件结构（如 roadmap 知道 guidance-specification.md §10 是 features）
2. **输入封闭**——只支持 `--from-brainstorm`，无法传入任意用户文档（PRD、RFC、会议纪要）
3. **价值泄漏**——brainstorm 角色分析（Decision Digest）未被 roadmap/plan 利用

Context Package 是跨命令的**标准数据合约**——上游按统一 schema 输出，下游按统一接口消费。

### 放置位置

每个产出上下文的 session 内生成 `context-package.json`，artifact entry 通过 `context_package` 字段指向它。

```
.workflow/scratch/20260521-brainstorm-cache/
├── guidance-specification.md         # 原始产出（保留）
├── system-architect/analysis.md      # 原始产出（保留）
├── context.md                        # 人类可读摘要（保留）
└── context-package.json              # 标准化机器合约（新增）
```

不放根目录——避免多 session 覆盖冲突，保留溯源。

### Context Package Schema

```jsonc
{
  "$schema": "context-package/1.0",

  // ── 溯源 ──
  "source": {
    "type": "brainstorm|analyze|collab|import",   // 产出源类型
    "artifact_id": "BRN-001",                      // state.json artifact ID
    "session_path": "scratch/20260521-brainstorm-cache/",
    "generated_at": "2026-05-21T12:00:00Z"
  },

  // ── 需求 ── roadmap/spec-gen 主消费
  "requirements": [
    {
      "id": "F-001",
      "title": "用户认证系统",
      "description": "支持 OAuth2 + 本地密码登录",
      "priority": "must|should|may",
      "acceptance": "用户可通过 Google/GitHub OAuth 登录",
      "ref": "guidance-specification.md#§10"
    }
  ],

  // ── 约束 ── plan/execute 主消费
  "constraints": [
    {
      "id": "C-001",
      "area": "authentication",
      "constraint": "MUST use stateless JWT tokens",
      "rationale": "微服务架构下无法共享 session",
      "status": "locked|open|deferred",
      "ref": "system-architect/analysis.md#§2-Decisions"
    }
  ],

  // ── 领域知识 ──
  "domain": {
    "problem_statement": "...",
    "terminology": [
      { "term": "Tenant", "definition": "多租户隔离单元", "ref": "guidance-specification.md#§5" }
    ],
    "audience": "企业用户",
    "industry": "SaaS"
  },

  // ── 排除项 ──
  "non_goals": [
    { "title": "移动端适配", "rationale": "V2 范围", "ref": "guidance-specification.md#§6" }
  ],

  // ── 角色洞察 ── plan 直接利用（可选，仅 brainstorm 产出）
  "insights": [
    {
      "role": "system-architect",
      "area": "data-model",
      "summary": "推荐 PostgreSQL JSONB 存储租户配置",
      "ref": "system-architect/analysis.md#§3-Data-Model"
    }
  ],

  // ── 开放问题 ── analyze 重点关注
  "open_questions": [
    {
      "area": "caching",
      "question": "Redis vs Memcached for session cache?",
      "options": ["Redis（功能丰富）", "Memcached（更简单）"],
      "ref": "guidance-specification.md#§8"
    }
  ],

  // ── 原始文件引用 ── 消费者按需深读
  "references": [
    { "type": "guidance", "path": "guidance-specification.md" },
    { "type": "role-analysis", "path": "system-architect/analysis.md" },
    { "type": "role-analysis", "path": "ux-expert/analysis.md" }
  ]
}
```

**字段说明**：

| 字段 | 必填 | 生产者 | 主消费者 | 说明 |
|------|------|--------|---------|------|
| `source` | 是 | 所有 | 所有 | 溯源元数据 |
| `requirements` | 是 | brainstorm, import | roadmap, spec-gen | 需求列表，priority 映射自 RFC 2119 |
| `constraints` | 是 | brainstorm, analyze | plan, execute | `status` 字段驱动 plan 分流：locked→不可变，open→自由决策，deferred→排除 |
| `domain` | 否 | brainstorm, import | 所有 | 领域知识背景 |
| `non_goals` | 否 | brainstorm, import | roadmap, spec-gen | 明确排除项，防 scope creep |
| `insights` | 否 | brainstorm | plan | 角色分析洞察（数据模型、状态机等），plan 直接利用 |
| `open_questions` | 否 | brainstorm, import | analyze | 未决问题，analyze 重点分析 |
| `references` | 否 | 所有 | harvest, 深读场景 | 文件级引用索引 |

**Per-item `ref` 格式**：`{file}#{section-anchor}`，路径相对于 session 目录。用于：
- 多源合并冲突时定位各自出处
- 消费者需要深读某条约束的完整上下文
- harvest 提取 knowledge fragment 时标注原始出处

### Source Adapter 映射

| 源类型 | → requirements | → constraints | → domain | → non_goals | → insights | → open_questions |
|--------|---------------|---------------|----------|-------------|-----------|-----------------|
| **brainstorm** guidance-spec | §10 features | §4-N MUST/MUST NOT → locked | §1-3 problem/terms/audience | §non-goals | — | §4-N SHOULD/MAY → open |
| **brainstorm** {role}/analysis.md §2 | — | Decisions[locked] | — | — | Cross-Cutting → insights | Decisions[open] |
| **analyze** context.md | — | Locked → locked | — | Deferred → non_goals | — | Free → open_questions |
| **analyze** conclusions.json | implementation_scope → requirements | — | — | — | recommendations → insights | — |
| **collab** conclusions.json | — | consensus decisions → locked | — | — | unique findings → insights | conflicts → open |
| **import** (@file) | LLM 提取 | LLM 提取 | LLM 提取 | LLM 提取 | — | LLM 提取 |

### 统一输入：`--from` 标志

替代原有的 `--from-brainstorm`（保留为别名），支持多种输入源：

```bash
# 按 artifact 类型+ID
maestro-roadmap --from brainstorm:BRN-001
maestro-plan --from analyze:ANL-002

# 按 session 路径
maestro-plan --from .workflow/scratch/20260521-brainstorm-cache/

# 导入外部文档（自动创建 import session）
maestro-roadmap --from @requirements.md
maestro-analyze --from @competitor-analysis.pdf

# 多源合并
maestro-plan --from brainstorm:BRN-001 --from @tech-constraints.md

# 向后兼容
maestro-roadmap --from-brainstorm SESSION-ID   # 等价于 --from brainstorm:{resolve(SESSION-ID)}
```

**解析优先级**：

| 优先级 | 模式 | 处理 |
|--------|------|------|
| 1 | `@file` | 文档适配器：创建 import session → delegate 提取 → context-package.json |
| 2 | `type:ID` | state.json 查询 `artifacts[type+id].context_package` → 加载 |
| 3 | 目录路径 | 检查 `path/context-package.json` → 加载；不存在则现场生成 |
| 4 | 裸 ID | 模糊匹配 state.json artifacts（按 id / session slug） |

**多源合并策略**：

| 字段类型 | 合并规则 |
|---------|---------|
| 数组（requirements, constraints, non_goals, insights, open_questions） | 追加去重（按 id 或 title） |
| 对象（domain） | 后源覆盖前源的标量字段；terminology 合并去重 |
| 冲突约束（同 area + 矛盾 constraint） | 标记 `status: "conflicted"`，消费者处理 |
| open_questions | 合并后检查：若 constraints 已锁定同一 area → 自动移除 |
| source | 变为 `sources[]` 数组（记录多个来源） |

### 外部文档导入流程

```
maestro-roadmap --from @prd.md
    │
    ├── 1. 创建 import session: .workflow/scratch/{date}-import-prd/
    ├── 2. 复制原始文档 → source.{ext}
    ├── 3. delegate 提取（analysis 模式）→ context-package.json
    ├── 4. 注册 artifact: { type: "import", context_package: "..." }
    └── 5. 返回 package 供消费（后续引用: --from import:IMP-001）
```

提取只发生一次——后续命令直接读已有 `context-package.json`，不重复提取。

### 与 accumulated_context 的关系

| 维度 | context-package | accumulated_context |
|------|----------------|---------------------|
| 生命周期 | 单次 session 产出，不可变快照 | 跨项目生命周期持续增长 |
| 触发 | `--from` 显式加载 | 每个命令自动继承 |
| 内容 | 完整上下文（需求/约束/领域/洞察） | 精选摘要（key_decisions/blockers/deferred） |
| 写入者 | brainstorm / analyze / collab / import | analyze / roadmap / milestone 完成时 |
| 关系 | `constraints[locked]` → 提升为 `accumulated_context.key_decisions[]` |

**联动**：analyze 完成时既生成 context-package（供未来 `--from` 查询），同时将 locked decisions 增量同步到 `accumulated_context.key_decisions[]`，确保全局约束传播。

### 各命令消费改造

| 命令 | 原消费方式 | 改造后 |
|------|-----------|--------|
| roadmap | `--from-brainstorm` → 硬编码读 guidance-spec §10 | `--from` → 读 `context-package.requirements[]` |
| analyze | state.json 自动发现 → 硬编码读 guidance-spec §4-N | `--from` 或自动发现 → 读 `constraints[locked]` 跳过已决策 |
| plan | 读 analyze 的 context.md | `--from` → 读 `constraints[]` + `insights[]`；fallback 读 context.md |
| spec-gen | `--from-brainstorm` → 全量读 guidance-spec | `--from` → 读全部字段（requirements/domain/non_goals 等） |
| init | `--from-brainstorm` → 读 guidance-spec | `--from` → 读 `domain` + `requirements` |
| harvest | 扫描原始文件提取 fragments | 增加 context-package 作为可选输入（提取效率更高）；`--prune` 管理 state.json 膨胀（graduated → knowhow → archive） |

### 反模式清单

| 禁止放入 context-package | 原因 |
|-------------------------|------|
| 完整文档内容 / 大段代码 | 用 `ref` 指向原始文件，消费者按需深读 |
| 执行状态 / 进度追踪 | 属于 plan.json / state.json |
| 消费者专属字段（如 `roadmap_hints`） | 违反语义中立原则 |
| LLM 推理过程 | 属于 discussion.md |
| git 历史 / diff | 用 git 命令实时获取 |
| 置信度 / 评分 | 属于 analysis.md，消费者不需要上游自评 |
| 中间过程文件（exploration.json 等） | 非结构化决策，不属于合约 |
| plan → execute 任务结构 | 已有强类型合约（plan.json），不需要抽象层 |
