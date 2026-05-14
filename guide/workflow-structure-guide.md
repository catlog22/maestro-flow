# .workflow/ 产物目录体系

---

## 一、全局概览

### 设计理念

`.workflow/` 是 Maestro 的**单一工作空间**（Single Workspace），存储项目的全部工作流状态和产物。它遵循三个核心原则：

1. **单一工作空间** — 所有命令读写同一个 `.workflow/` 目录，状态集中管理
2. **产物注册** — 每个命令输出通过 `state.json.artifacts[]` 统一注册，支持跨阶段追踪
3. **阶段驱动** — 产物按分析（analyze）→ 规划（plan）→ 执行（execute）→ 验证（verify）生命周期流转

### 核心原则

- 每个目录/文件的职责单一，不交叉存储
- `.workflow/` 被加入 `.gitignore`，不进入版本控制（除 `project.md` 可选例外）
- 所有产物路径相对于 `.workflow/` 根目录

### 作用域

| 路径 | 作用域 | 说明 |
|------|--------|------|
| `.workflow/` | 项目级 | 当前项目的全部工作流状态 |
| `~/.maestro/` | 全局级 | 跨项目的模板、配置、overlay |
| `.workflow/collab/` | 团队级 | 人类团队协作，与 `.workflow/.team/`（Agent 总线）严格隔离 |

---

## 二、目录树（完整）

```
.workflow/
├── state.json                    # 项目状态机 + Artifact Registry
├── config.json                   # 用户工作流配置
├── project.md                    # 项目定义（Core Value, Requirements, Key Decisions）
├── roadmap.md                    # 里程碑/阶段路线图
├── wiki-index.json               # Wiki 统一索引（由 WikiIndexer 自动生成）
│
├── specs/                        # 规范文件（6 类，项目级）
│   ├── coding-conventions.md     # 编码规范（核心，始终存在）
│   ├── architecture-constraints.md # 架构约束（核心，始终存在）
│   ├── knowhow.md                # 知识索引（核心，始终存在）
│   ├── quality-rules.md          # 质量规则（可选，检测到 linter/CI 时创建）
│   ├── test-conventions.md       # 测试规范（可选，检测到测试框架时创建）
│   ├── debug-notes.md            # 调试笔记（可选，按需创建）
│   ├── review-standards.md       # 审查标准（可选，按需创建）
│   ├── ui-conventions.md          # UI 规范（可选，检测到前端框架时创建）
│   └── learnings.md              # 学习记录（`<spec-entry>` 块，跨阶段查询）
│
├── knowhow/                      # 知识文档（9 种前缀类型）
│   ├── .maestro-learn/           # maestro-learn 会话状态
│   │   └── learn-{timestamp}/
│   │       └── status.json       # 学习会话状态
│   ├── KNW-{date}-{time}.md      # 会话压缩（session compact）
│   ├── TIP-{date}-{time}.md      # 快速提示
│   ├── TPL-{date}-{time}.md      # 代码/配置模板
│   ├── RCP-{date}-{time}.md      # 分步指南（recipe）
│   ├── REF-{date}-{time}.md      # 外部文档摘要（reference）
│   ├── DCS-{date}-{time}.md      # 架构决策记录（decision）
│   ├── AST-{date}-{time}.md      # 可复用资产（asset）
│   ├── BLP-{date}-{time}.md      # 架构蓝图（blueprint）
│   ├── DOC-{date}-{time}.md      # 通用文档
│   ├── KNW-follow-{slug}-{date}.md      # learn-follow 产物
│   ├── KNW-decompose-{slug}-{date}.md   # learn-decompose 产物
│   ├── KNW-retro-{date}.md             # learn-retro 产物
│   ├── KNW-retro-{date}.json           # learn-retro 结构化指标
│   ├── KNW-opinion-{slug}-{date}.md    # learn-second-opinion 产物
│   ├── KNW-investigate-{slug}/         # learn-investigate 产物目录
│   │   ├── evidence.ndjson       # 结构化证据（NDJSON）
│   │   ├── understanding.md      # 演进理解
│   │   └── report.md             # 最终报告
│   ├── KNW-digest-{slug}-{date}.md     # wiki-digest 产物
│   └── wiki-connections-{date}.md      # wiki-connect 产物
│
├── scratch/                      # 执行产物（按日期+类型组织）
│   ├── {YYYYMMDD}-analyze-{slug}/      # 分析产物
│   │   ├── discussion.md         # 讨论时间线
│   │   ├── analysis.md           # 6 维度评分
│   │   ├── conclusions.json      # 结论与建议
│   │   └── context.md            # Locked/Free/Deferred 决策
│   ├── {YYYYMMDD}-plan-P{N}-{slug}/    # 规划产物
│   │   ├── plan.json             # 执行计划（waves + tasks）
│   │   └── .task/
│   │       └── TASK-{NNN}.json   # 任务定义文件
│   ├── {YYYYMMDD}-execute-{slug}/      # 执行产物（在 plan 目录内）
│   │   └── .summaries/
│   │       └── TASK-{NNN}-summary.md   # 任务执行摘要
│   ├── {YYYYMMDD}-verify-P{N}-{slug}/  # 验证产物
│   │   └── verification.json     # 验证结果
│   ├── {YYYYMMDD}-review-P{N}-{slug}/  # 审查产物
│   │   └── review.json           # 审查结果
│   ├── {YYYYMMDD}-debug-P{N}-{slug}/   # 调试产物
│   │   ├── understanding.md      # 演进理解
│   │   └── evidence.ndjson       # 证据链（NDJSON）
│   ├── {YYYYMMDD}-test-P{N}-{slug}/    # 测试产物
│   │   ├── uat.md                # UAT 会话记录
│   │   ├── test-results.json     # 测试结果
│   │   ├── coverage-report.json  # 覆盖率报告
│   │   └── .tests/
│   │       └── auto-test/
│   │           └── report.json   # 自动测试报告
│   ├── {YYYYMMDD}-brainstorm-{slug}/   # 头脑风暴产物
│   │   ├── guidance-specification.md    # 引导规格
│   │   ├── design-research.md          # 设计研究
│   │   ├── feature-index.json          # 功能索引
│   │   ├── synthesis-changelog.md      # 综合变更日志
│   │   ├── .brainstorming/
│   │   │   ├── {role}/           # 各角色分析
│   │   │   │   └── analysis.md
│   │   │   ├── feature-specs/    # 功能规格
│   │   │   ├── html-prototypes/  # HTML 原型
│   │   │   └── ascii-mockups/    # ASCII 线框图
│   │   └── per-tool/             # collab 单工具原始输出
│   ├── {YYYYMMDD}-collab-{slug}/       # 协作产物
│   │   ├── collab-report.md      # 合并报告
│   │   ├── context.md            # Locked/Free/Deferred 决策
│   │   ├── conclusions.json      # 结构化结论
│   │   └── per-tool/
│   │       └── {tool}-output.md  # 各工具原始输出
│   ├── {YYYYMMDD}-ui-design-{slug}/    # UI 设计产物
│   │   ├── MASTER.md             # 设计系统主文件
│   │   ├── design-tokens.json    # 设计 token（OKLCH 颜色）
│   │   ├── animation-tokens.json # 动画 token
│   │   └── selection.json        # 用户选择记录
│   └── {YYYYMMDD}-auto-test-P{N}-{slug}/ # 自动测试产物
│
├── issues/                       # 问题追踪
│   ├── issues.jsonl              # 活跃问题（每行一个 JSON）
│   ├── issue-history.jsonl       # 已关闭/归档问题
│   └── discoveries/
│       └── {SESSION_ID}/         # 发现会话产物
│
├── milestones/                   # 里程碑归档
│   └── {M}/
│       ├── artifacts/            # 归档的 scratch 产物
│       ├── audit-report.md       # 审计报告
│       ├── summary.md            # 里程碑摘要
│       └── roadmap-snapshot.md   # 路线图快照
│
├── codebase/                     # 代码库文档（由 mapper agent 生成）
│   ├── doc-index.json            # 文档索引（带时间戳）
│   ├── tech-stack.md             # 技术栈
│   ├── architecture.md           # 架构文档
│   ├── features.md               # 功能清单
│   └── concerns.md               # 横切关注点
│
├── .spec/                        # 规范包（maestro-roadmap --mode full 生成）
│   ├── spec-config.json          # 规范配置
│   ├── product-brief.md          # 产品简报
│   ├── glossary.json             # 术语表（5+ 核心术语）
│   ├── requirements/
│   │   ├── _index.md
│   │   ├── REQ-*.md              # 功能需求
│   │   └── NFR-*.md              # 非功能需求
│   ├── architecture/
│   │   ├── _index.md
│   │   └── ADR-*.md              # 架构决策记录
│   ├── epics/
│   │   ├── _index.md
│   │   └── EPIC-*.md             # 史诗
│   ├── readiness-report.md       # 就绪报告（4 维度评分）
│   └── spec-summary.md           # 一页执行摘要
│
├── collab/                       # 人类团队协作空间
│   ├── specs/                    # 团队级规范
│   └── specs/{uid}/              # 个人级规范
│
├── .maestro/                     # 会话状态（Agent 内部，用户一般不直接操作）
│   ├── maestro-{YYYYMMDD-HHmmss}/
│   │   └── status.json           # maestro 主会话状态
│   ├── ralph-{YYYYMMDD-HHmmss}/
│   │   └── status.json           # ralph 自适应会话状态
│   ├── player-{YYYYMMDD-HHmmss}/
│   │   └── status.json           # player 模板播放会话状态
│   └── coord-{timestamp}/        # 协调器会话
│       └── walker-state.json     # 步进器状态
│
├── .team/                        # Agent 团队消息总线
│   └── {session-id}/
│       └── .msg/
│           └── messages.jsonl    # 团队消息日志
│
├── templates/                    # 工作流模板设计草稿
│   └── design-drafts/            # composer 设计过程文件
│       ├── intent.json           # 解析意图
│       ├── nodes.json            # 节点映射
│       └── dag.json              # DAG 构建
│
├── reference_style/              # UI 设计系统参考（ui-codify 默认输出）
│
├── impeccable/                   # Impeccable UI 设计上下文
│   ├── PRODUCT.md                # 产品定义（用户、品牌、调性、策略原则）
│   ├── DESIGN.md                 # 设计系统（颜色、字体、组件 token）
│   ├── design.json               # 设计系统扩展 sidecar（ Stitch 面板用）
│   ├── critique/                 # 审查报告快照（critique 命令产物）
│   └── live/                     # Live 模式配置与会话
│       ├── config.json           # Live 模式配置（inject 目标、CSP 状态）
│       └── sessions/             # 会话日志（append-only journal）
│
├── worktrees.json                # Worktree 注册表（主工作空间）
├── worktree-scope.json           # Worktree 作用域标记（fork 的工作空间内）
├── harvest-log.jsonl             # 收获日志（manage-harvest 去重用）
└── harvest-report-{date}.md      # 收获报告
```

---

## 三、核心文件详解

### 3.1 状态管理

#### state.json — 项目状态机与 Artifact Registry

`state.json` 是整个 `.workflow/` 的核心，记录项目状态和全部已注册产物。

```json
{
  "version": "3.0",
  "status": "idle|active",
  "project_name": "项目名称",
  "current_milestone": "M1",
  "current_phase": 1,
  "last_release_version": "0.1.0",
  "last_release_at": "ISO-8601",
  "codebase_last_rebuilt": "ISO-8601",
  "codebase_last_refreshed": "ISO-8601",
  "milestones": [
    {
      "id": "M1",
      "name": "里程碑名称",
      "status": "active|completed|forked",
      "phases": [1, 2, 3]
    }
  ],
  "milestone_history": [
    {
      "milestone_id": "M1",
      "completed_at": "ISO-8601",
      "artifact_count": 5
    }
  ],
  "artifacts": [
    {
      "id": "ANL-001",
      "type": "analyze",
      "milestone": "M1",
      "phase": 1,
      "scope": "phase",
      "path": "scratch/20260513-analyze-P1-auth",
      "status": "completed",
      "depends_on": null,
      "harvested": false,
      "created_at": "ISO-8601",
      "completed_at": "ISO-8601"
    }
  ]
}
```

**关键字段说明**：

| 字段 | 说明 |
|------|------|
| `version` | Schema 版本，用于 `maestro-update` 迁移 |
| `current_milestone` | 当前活跃里程碑 ID |
| `current_phase` | 当前活跃阶段号 |
| `artifacts[]` | 产物注册表，所有命令的输出都在此注册 |
| `milestones[]` | 里程碑列表，`status` 可为 `active`/`completed`/`forked` |
| `milestone_history[]` | 已完成里程碑的归档记录 |

#### config.json — 用户配置

```json
{
  "granularity": "phase|milestone|task",
  "workflow_agents": true,
  "gate_preferences": {
    "review_level": "standard",
    "test_coverage": 80
  }
}
```

由 `maestro-init` 创建，记录用户在初始化时选择的工作流偏好。

#### project.md — 项目定义

由 `maestro-init` 创建，包含：

- **Core Value** — 项目核心价值
- **Requirements** — 需求列表（Validated / Active / Out of Scope）
- **Key Decisions** — 关键决策记录
- **Context** — 里程碑完成后更新的上下文摘要

---

### 3.2 规划与路线

#### roadmap.md — 里程碑/阶段结构

由 `maestro-roadmap` 创建（light 或 full 模式均生成）。包含：

- 里程碑列表与阶段划分
- 每个阶段的 success criteria、依赖关系、需求映射
- 阶段进度表（Phase Progress Table）

#### scratch/ — 执行产物目录

所有命令的输出都写入 `scratch/` 下的子目录。

**命名规则**：`{YYYYMMDD}-{type}[-P{N}|-M{N}]-{slug}`

| 部分 | 说明 | 示例 |
|------|------|------|
| `{YYYYMMDD}` | 创建日期 | `20260513` |
| `{type}` | 产物类型 | `analyze`, `plan`, `review`, `debug`, `test` 等 |
| `P{N}` | Phase 作用域前缀 | `P1`, `P2`（阶段级产物） |
| `M{N}` | Milestone 作用域前缀 | `M1`（里程碑级验证） |
| `{slug}` | 内容摘要 | `auth-system` |

日期优先排列，便于按时间排序。作用域前缀用于目录级别的快速识别。

**各类产物子目录**：

| 产物类型 | 目录名模式 | 主要文件 | 生成命令 |
|----------|-----------|----------|----------|
| 分析 | `*analyze*` | discussion.md, analysis.md, conclusions.json, context.md | maestro-analyze |
| 规划 | `*plan*` | plan.json, .task/TASK-*.json | maestro-plan |
| 执行 | （在 plan 目录内） | .summaries/TASK-{NNN}-summary.md | maestro-execute |
| 验证 | `*verify*` | verification.json | maestro-verify |
| 审查 | `*review*` | review.json | quality-review |
| 调试 | `*debug*` | understanding.md, evidence.ndjson | quality-debug |
| 测试 | `*test*` | uat.md, test-results.json, coverage-report.json | quality-test |
| 自动测试 | `*auto-test*` | report.json, scenarios.csv, reflection-log.md | quality-auto-test |
| 头脑风暴 | `*brainstorm*` | guidance-specification.md, .brainstorming/ | maestro-brainstorm |
| 协作 | `*collab*` | collab-report.md, context.md, conclusions.json | maestro-collab |
| UI 设计 | `*ui-design*` | MASTER.md, design-tokens.json, animation-tokens.json | maestro-ui-craft --chain build |
| Impeccable 上下文 | `impeccable/` | PRODUCT.md, DESIGN.md | maestro-impeccable (teach/document) |
| 复盘 | （写入 retrospective.json/md + specs/learnings.md） | | quality-retrospective |

---

### 3.3 知识系统

#### specs/ — 6 类规范文件

规范文件使用 `<spec-entry>` 闭合标签格式存储，由 WikiIndexer 自动索引到 `wiki-index.json`。

| 文件 | Category | 核心文件 | 说明 |
|------|----------|---------|------|
| `coding-conventions.md` | coding | 是 | 编码规范，始终创建 |
| `architecture-constraints.md` | arch | 是 | 架构约束，始终创建 |
| `knowhow.md` | — | 是 | 知识索引，始终创建 |
| `quality-rules.md` | review | 否 | 质量规则，检测到 linter/CI 时创建 |
| `test-conventions.md` | test | 否 | 测试规范，检测到测试框架时创建 |
| `debug-notes.md` | debug | 否 | 调试笔记，按需创建 |
| `review-standards.md` | review | 否 | 审查标准，按需创建 |
| `learnings.md` | learning | 否 | 学习记录，跨阶段查询 |

**Spec 作用域与目录映射**：

| Scope | 目录 | ID 前缀 |
|-------|------|---------|
| project | `.workflow/specs/` | `spec:project:` |
| global | `~/.maestro/specs/` | `spec:global:` |
| team | `.workflow/collab/specs/` | `spec:team:` |
| personal | `.workflow/collab/specs/{uid}/` | `spec:personal:{uid}:` |

**`<spec-entry>` 格式**：

```xml
<spec-entry category="coding" keywords="exports,naming" date="2026-05-13" source="spec-add" roles="implement">
  规范内容...
</spec-entry>
```

#### knowhow/ — 9 种知识文档前缀

所有知识文档存储在 `.workflow/knowhow/` 目录，文件名格式为 `{PREFIX}-{YYYYMMDD}-{HHMM}.md`。

| 前缀 | 类型 | Token | 说明 |
|------|------|-------|------|
| KNW- | session（compact） | compact/session/压缩/保存 | 会话状态压缩 |
| TIP- | tip | tip/note/记录/快速 | 快速提示 |
| TPL- | template | template/tpl/模板 | 代码/配置模板 |
| RCP- | recipe | recipe/rcp/配方/步骤 | 分步操作指南 |
| REF- | reference | reference/ref/参考/引用 | 外部文档摘要 |
| DCS- | decision | decision/dcs/决策/adr | 架构决策记录（proposed/accepted/superseded） |
| AST- | asset | asset/ast/资产/契约 | 可复用资产（api-contract/data-model/prompt/config） |
| BLP- | blueprint | blueprint/blp/蓝图 | 架构蓝图 |
| DOC- | document | document/doc/文档 | 通用文档（fallback） |

每种文档使用 YAML frontmatter，包含 `title`、`type`、`category`、`created`、`tags`、`source` 等字段。工具类文档（`tool: true`）可被 `spec load` 自动发现并被下游 agent 消费。

#### wiki-index.json — 统一索引

由 `WikiIndexer` 自动生成和维护，索引以下内容源：

- **单文件**：`project.md`（type=project）、`roadmap.md`（type=roadmap）
- **specs/**：所有 scope 目录下的 `.md` 文件（type=spec），含子节点 `<spec-entry>`
- **knowhow/**：所有 `.md` 文件（type=knowhow），按前缀推断 category
- **issues/**：`issues.jsonl` 中的条目（type=issue）
- **scratch/ 下的 roadmap**：单文件解析

索引为轻量格式（strip body/raw/ext），用于 BM25 搜索、反向链接、健康评分等。

#### learning/ — 学习数据

学习相关数据存储在两个位置：

- `specs/learnings.md` — 以 `<spec-entry>` 块存储的学习洞察和提示
- `knowhow/.maestro-learn/` — `maestro-learn` 会话状态目录

---

### 3.4 问题追踪

#### issues/issues.jsonl — Issue 存储

每行一个 JSON 对象，遵循 `issue.json` schema：

```json
{
  "id": "ISS-XXXXXXXX-NNN",
  "title": "问题描述",
  "severity": "blocker|critical|major|minor|cosmetic",
  "status": "open|registered|planned|in_progress|resolved|closed",
  "source": "discover|review|verify|retrospective|harvest",
  "phase": 1,
  "tags": ["workflow"],
  "description": "详细描述",
  "context": {},
  "related_files": [],
  "task_refs": ["TASK-001"],
  "task_plan_dir": "scratch/20260513-plan-P1-...",
  "analysis": {
    "root_cause": "...",
    "affected_files": [],
    "impact_scope": "...",
    "fix_direction": "...",
    "confidence": "high|medium|low",
    "analyzed_at": "ISO-8601",
    "tool": "maestro-analyze",
    "depth": "standard"
  },
  "history": [
    {
      "action": "created|analyzed|planned|executed|closed",
      "at": "ISO-8601",
      "by": "command-name",
      "summary": "操作描述"
    }
  ],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

#### issues/discoveries/ — 发现记录

`manage-issue-discover` 的会话产物，包含多视角或 prompt-driven 的探索结果。

#### issues/issue-history.jsonl — 归档问题

已关闭的问题从 `issues.jsonl` 移动到此文件。

---

### 3.5 里程碑管理

#### milestones/{M}/ — 归档结构

里程碑完成后由 `maestro-milestone-complete` 创建归档：

```
milestones/
└── M1/
    ├── artifacts/            # 从 scratch/ 移入的归档产物
    │   └── (原 scratch 子目录完整迁移)
    ├── audit-report.md       # 里程碑审计报告（PASS/FAIL）
    ├── summary.md            # 里程碑摘要
    └── roadmap-snapshot.md   # 路线图快照
```

**归档流程**：
1. `maestro-milestone-audit` 验证完整性 → 生成 `audit-report.md`
2. `maestro-milestone-complete` 将 scratch 产物移入 `milestones/{M}/artifacts/`
3. `state.json.artifacts[]` 中的条目移入 `milestone_history[]`
4. 提取最终 knowhow，推进到下一个里程碑

---

### 3.6 协作与会话

#### collab/ — 人类团队协作

`.workflow/collab/` 用于人类团队协作空间，**与 `.workflow/.team/`（Agent 消息总线）严格隔离**。

```
collab/
├── specs/                  # 团队级规范
└── specs/{uid}/            # 个人级规范（按用户 ID 隔离）
```

WikiIndexer 会扫描 `collab/specs/` 及其子目录，为团队和个人规范创建索引条目。

#### .maestro/ — 会话状态

存储各类 Agent 的运行会话状态，用户一般不需要直接操作。

```
.maestro/
├── maestro-{YYYYMMDD-HHmmss}/
│   └── status.json         # maestro 主协调器会话
├── ralph-{YYYYMMDD-HHmmss}/
│   └── status.json         # ralph 自适应引擎会话
├── player-{YYYYMMDD-HHmmss}/
│   └── status.json         # player 模板播放会话
└── coord-{timestamp}/      # 协调器会话
    └── walker-state.json   # 步进器状态
```

**各会话 Schema 差异**：

| 会话 | source 字段 | 关键字段 |
|------|------------|---------|
| maestro | `"maestro"` | intent, task_type, chain_name, steps[], waves[] |
| ralph | `"ralph"` | lifecycle_position, passed_gates[], context{scratch_dir, plan_dir, ...} |
| player | — | template_id, template_path, last_checkpoint |

#### .team/ — Agent 团队消息总线

`.workflow/.team/{session-id}/.msg/messages.jsonl` 是 Agent 团队通信的持久化日志。由 `maestro-tools` 的 `team_msg` 工具管理，支持 `log`、`broadcast`、`read_mailbox` 等操作。

---

## 四、Artifact Registry

### artifacts[] 完整 Schema

```json
{
  "id": "ANL-001",
  "type": "analyze",
  "milestone": "M1",
  "phase": 1,
  "scope": "phase",
  "path": "scratch/20260513-analyze-P1-auth",
  "status": "completed",
  "depends_on": null,
  "harvested": false,
  "created_at": "2026-05-13T10:00:00Z",
  "completed_at": "2026-05-13T11:00:00Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 产物 ID，格式 `{TYPE_PREFIX}-{NNN}` |
| `type` | string | 产物类型标识 |
| `milestone` | string | 所属里程碑 |
| `phase` | number/null | 所属阶段号（null 表示跨阶段/独立） |
| `scope` | string | 作用域：`phase`、`milestone`、`adhoc`、`standalone` |
| `path` | string | 相对于 `.workflow/` 的路径 |
| `status` | string | `created` / `completed` / `failed` |
| `depends_on` | string/null | 依赖的上游产物 ID |
| `harvested` | boolean | 是否已被 harvest 提取知识 |
| `created_at` | string | 创建时间（ISO-8601） |
| `completed_at` | string/null | 完成时间（ISO-8601） |

### 类型 ID 命名规则

| Type | ID 前缀 | 生成命令 |
|------|---------|----------|
| analyze | ANL-{NNN} | maestro-analyze |
| plan | PLN-{NNN} | maestro-plan |
| execute | EXC-{NNN} | maestro-execute |
| verify | VRF-{NNN} | maestro-verify |
| review | REV-{NNN} | quality-review |
| debug | DBG-{NNN} | quality-debug |
| test | TST-{NNN} | quality-test |
| brainstorm | BRN-{NNN} | maestro-brainstorm |
| collab | CLB-{NNN} | maestro-collab |
| brainstorm (alias) | BSY-{NNN} | maestro-brainstorm（session） |
| wiki-digest | WBR-{NNN} | wiki-digest |

编号由 `nextArtifactId(artifacts, type)` 自动递增生成。

### 产物生命周期

```
created → completed → harvested → archived
                     ↘ failed
```

| 阶段 | 触发条件 | 操作 |
|------|----------|------|
| created | 命令开始执行 | 写入 artifacts[]，status="created" |
| completed | 命令成功完成 | 更新 status="completed"，记录 completed_at |
| failed | 命令执行失败 | 更新 status="failed" |
| harvested | manage-harvest 提取 | 更新 harvested=true |
| archived | maestro-milestone-complete | 移入 milestone_history[]，scratch 移至 milestones/{M}/artifacts/ |

---

## 五、全局路径（~/.maestro/）

`~/.maestro/` 是 Maestro 的全局配置目录，跨项目共享。

```
~/.maestro/
├── cli-tools.json              # CLI 工具配置（delegate 路由）
├── workflows/                  # 工作流定义文件
│   ├── maestro.md              # maestro 主流程（意图分析 + chain 选择）
│   ├── maestro-super.md        # --super 模式流程
│   ├── init.md                 # maestro-init 工作流
│   ├── roadmap.md              # roadmap light 模式工作流
│   ├── roadmap-common.md       # roadmap 公共逻辑
│   ├── spec-generate.md        # roadmap full 模式工作流
│   ├── analyze.md              # maestro-analyze 工作流
│   ├── plan.md                 # maestro-plan 工作流
│   ├── execute.md              # maestro-execute 工作流
│   ├── verify.md               # maestro-verify 工作流
│   ├── brainstorm.md           # maestro-brainstorm 工作流
│   ├── brainstorm-visualize.md # brainstorm 原型可视化
│   ├── quick.md                # maestro-quick 工作流
│   ├── review.md               # quality-review 工作流
│   ├── test.md                 # quality-test 工作流
│   ├── auto-test.md            # quality-auto-test 工作流
│   ├── debug.md                # quality-debug 工作流
│   ├── refactor.md             # quality-refactor 工作流
│   ├── retrospective.md        # quality-retrospective 工作流
│   ├── sync.md                 # quality-sync 工作流
│   ├── milestone-audit.md      # maestro-milestone-audit 工作流
│   ├── milestone-complete.md   # maestro-milestone-complete 工作流
│   ├── release.md              # maestro-milestone-release 工作流
│   ├── fork.md                 # maestro-fork 工作流
│   ├── merge.md                # maestro-merge 工作流
│   ├── overlays.md             # overlay 系统
│   ├── issue.md                # issue 管理 schema
│   ├── issue-gaps-analyze.md   # issue root cause 分析
│   ├── issue-discover.md       # issue 发现工作流
│   ├── harvest.md              # manage-harvest 工作流
│   ├── specs-setup.md          # spec-setup 工作流
│   ├── specs-add.md            # spec-add 工作流
│   ├── specs-load.md           # spec-load 工作流
│   ├── specs-remove.md         # spec-remove 工作流
│   ├── knowhow.md              # knowhow 管理
│   ├── learn.md                # manage-learn 工作流
│   ├── wiki-manage.md          # wiki 管理
│   ├── wiki-connect.md         # wiki 连接发现
│   ├── wiki-digest.md          # wiki 知识综合
│   ├── tools-spec.md           # tool 规范注册/执行
│   ├── status.md               # manage-status 工作流
│   ├── codebase-rebuild.md     # codebase 全量重建
│   ├── codebase-refresh.md     # codebase 增量刷新
│   ├── ui-design.md            # UI 设计（完整 4 层管线）
│   ├── ui-style.md             # UI 设计（轻量委托路径）
│   ├── ui-codify.md            # UI 设计系统提取
│   └── ...                     # 其他工作流文件
│
├── templates/                  # 模板系统
│   ├── project.md              # 项目定义模板
│   ├── state.json              # 状态模板
│   ├── config.json             # 配置模板
│   ├── roadmap.md              # 路线图模板
│   ├── plan.json               # 计划模板
│   ├── task.json               # 任务模板
│   ├── verification.json       # 验证模板
│   ├── validation.json         # 验证模板（测试）
│   ├── issue.json              # Issue 模板
│   ├── index.json              # Phase 索引模板
│   ├── scratch-index.json      # Scratch 索引模板
│   ├── spec-config.json        # Spec 配置模板
│   ├── worktrees.json          # Worktree 注册表模板
│   ├── worktree-scope.json     # Worktree 作用域模板
│   ├── search-tools.md         # 搜索工具优先级
│   └── workflows/
│       ├── index.json          # 工作流模板索引
│       ├── specs/
│       │   ├── node-catalog.md  # 节点类型目录
│       │   └── template-schema.md # 模板 Schema
│       └── *.json              # 各工作流模板（由 maestro-composer 生成）
│
├── overlays/                   # 命令扩展（overlay 系统）
│   ├── *.json                  # Overlay 定义文件
│   ├── docs/                   # Overlay 引用文档
│   │   ├── amend-*.md          # amend 生成的参考文档
│   │   └── *.md                # 其他参考文档
│   └── _shipped/               # 内置示例（只读）
│
└── specs/                      # 全局规范
    └── *.md                    # 跨项目的全局规范文件
```

---

## 六、命名规则速查

### Scratch 目录命名

**格式**：`{YYYYMMDD}-{type}[-P{N}|-M{N}]-{slug}`

| 组成部分 | 可选值 | 说明 |
|----------|--------|------|
| `{YYYYMMDD}` | 日期 | 创建日期，保证按时间排序 |
| `{type}` | analyze, plan, verify, review, debug, test, auto-test, brainstorm, collab, ui-design | 产物类型 |
| `P{N}` | P1, P2, ... | Phase 作用域（阶段级产物） |
| `M{N}` | M1, M2, ... | Milestone 作用域（里程碑级验证） |
| `{slug}` | kebab-case | 内容描述摘要 |

**特殊规则**：
- `adhoc`/`standalone` 产物无 scope 前缀
- `execute` 产物在 plan 目录内生成（`.summaries/`），不创建独立目录

### Knowhow 文件前缀

| 前缀 | 类型 | Category |
|------|------|----------|
| KNW- | session | session |
| TIP- | tip | tip |
| TPL- | template | template |
| RCP- | recipe | recipe |
| REF- | reference | reference |
| DCS- | decision | decision |
| AST- | asset | asset |
| BLP- | blueprint | blueprint |
| DOC- | document | document |

**文件名格式**：`{PREFIX}-{YYYYMMDD}-{HHMM}.md`（例：`KNW-20260513-1430.md`）

**特殊前缀**（learn 命令产出）：
- `KNW-follow-{slug}-{date}.md` — learn-follow
- `KNW-decompose-{slug}-{date}.md` — learn-decompose
- `KNW-retro-{date}.md` / `.json` — learn-retro
- `KNW-opinion-{slug}-{date}.md` — learn-second-opinion
- `KNW-investigate-{slug}/` — learn-investigate（目录形式）
- `KNW-digest-{slug}-{date}.md` — wiki-digest

### Spec Category 映射

| Category | 主文件 | 附加文件 |
|----------|--------|----------|
| coding | coding-conventions.md | — |
| arch | architecture-constraints.md | — |
| test | test-conventions.md | — |
| review | review-standards.md, quality-rules.md | — |
| debug | debug-notes.md | — |
| learning | learnings.md | — |
| ui | ui-conventions.md | — |
| tools | knowhow/*.md（tool: true） | — |

### Session ID 格式

| 会话类型 | 格式 | 示例 |
|----------|------|------|
| maestro 主会话 | `maestro-{YYYYMMDD-HHmmss}` | `maestro-20260513-143022` |
| ralph 会话 | `ralph-{YYYYMMDD-HHmmss}` | `ralph-20260513-143022` |
| player 会话 | `player-{YYYYMMDD-HHmmss}` | `player-20260513-143022` |
| delegate 执行 ID | `{prefix}-{HHmmss}-{rand4}` | `gem-143022-a7f2` |
| 工作流模板 ID | `wft-<slug>-<YYYYMMDD>` | `wft-auth-flow-20260513` |
| Issue ID | `ISS-XXXXXXXX-NNN` | `ISS-a1b2c3d4-001` |
| Insight ID | `INS-{8hex}` | `INS-f3a1b2c4` |
| Entry ID | `spec-{file-stem}-{NNN}` | `spec-coding-conventions-001` |

### Artifact 类型与命令对应

| 类型 | ID 前缀 | scope 选项 | 生成命令 |
|------|---------|-----------|----------|
| analyze | ANL | phase, adhoc, standalone | maestro-analyze |
| plan | PLN | phase, adhoc | maestro-plan |
| execute | EXC | phase | maestro-execute |
| verify | VRF | phase, milestone | maestro-verify |
| review | REV | phase | quality-review |
| debug | DBG | phase, standalone | quality-debug |
| test | TST | phase | quality-test, quality-auto-test |
| brainstorm | BRN | adhoc | maestro-brainstorm |
| collab | CLB | adhoc | maestro-collab |
| ui-design | — | phase, scratch | maestro-ui-craft --chain build |
| impeccable | — | standalone | maestro-impeccable (teach/document) |
