---
title: ".workflow/ 产物目录体系"
icon: "📁"
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
│   ├── .maestro-learn/           # /learn 会话状态
│   ├── KNW-*.md                  # session
│   ├── TIP-*.md                  # tip
│   ├── TPL-*.md                  # template
│   ├── RCP-*.md                  # recipe
│   ├── REF-*.md                  # reference
│   ├── DCS-*.md                  # decision
│   ├── AST-*.md                  # asset
│   ├── BLP-*.md                  # blueprint
│   ├── DOC-*.md                  # document
│   ├── KNW-follow-*.md           # /learn follow
│   ├── KNW-decompose-*.md        # /learn decompose
│   ├── KNW-retro-*.md/json       # /learn consult
│   ├── KNW-opinion-*.md          # /learn consult
│   ├── KNW-investigate-*/        # /learn investigate
│   ├── KNW-digest-*.md           # /manage knowledge wiki digest
│   └── wiki-connections-*.md     # /manage knowledge wiki connect
│
├── scratch/                      # 执行产物（{YYYYMMDD}-{type}[-P{N}]-{slug}）
│   ├── *-analyze-*/              # 分析：discussion.md, analysis.md, conclusions.json, context.md
│   ├── *-plan-*/                 # 规划：plan.json, .task/TASK-*.json
│   │   └── .summaries/           # 执行：TASK-{NNN}-summary.md
│   ├── *-verify-*/               # 验证：verification.json
│   ├── *-review-*/               # 审查：review.json
│   ├── *-debug-*/                # 调试：understanding.md, evidence.ndjson
│   ├── *-test-*/                 # 测试：uat.md, test-results.json, coverage-report.json
│   ├── *-auto-test-*/            # 自动测试：report.json
│   ├── *-brainstorm-*/           # 头脑风暴：guidance-specification.md, .brainstorming/
│   ├── *-collab-*/               # 协作：collab-report.md, context.md, per-tool/
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
├── .spec/                        # 规范包（/maestro-ralph --roadmap --mode full）
│   ├── spec-config.json
│   ├── product-brief.md
│   ├── glossary.json
│   ├── requirements/REQ-*.md, NFR-*.md
│   ├── architecture/ADR-*.md
│   ├── epics/EPIC-*.md
│   ├── readiness-report.md
│   └── spec-summary.md
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
| `config.json` | 用户工作流配置（`maestro-init` 创建） | `granularity`, `workflow_agents`, `gate_preferences` |
| `project.md` | 项目定义（`maestro-init` 创建） | Core Value, Requirements, Key Decisions, Context |
| `roadmap.md` | 里程碑/阶段路线图（`/maestro-ralph --roadmap` 创建） | 里程碑列表、success criteria、依赖关系、Phase Progress Table |
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
  "artifacts": [{ "id": "ANL-001", "type": "analyze", "path": "scratch/...", "status": "completed" }]
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
  "created_at": "ISO-8601",
  "completed_at": "ISO-8601"
}
```

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
<spec-entry category="coding" keywords="exports,naming" date="2026-05-13" source="spec add" roles="implement">
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
- `issues/discoveries/` — `/manage issue discover` 会话产物

---

## 六、Session/Run 模型（v0.5.50+）

### 产物输出路径

Run 产物统一写入 `outputs/` 目录，`evidence/` 降级为非正式 traces：

| 目录 | 定位 | 权威性 |
|------|------|--------|
| `outputs/` | 产物输出（report.md、plan.json 等） | 权威，下游消费 |
| `evidence/` | 调试/诊断痕迹 | 非正式，仅供回溯 |

### Session 命名

`maestro run create` 支持 `--session <name>` 显式命名（v0.5.50+）：
- 合法字符：`a-z`、`0-9`、`-`
- 不合法输入自动转为 ASCII slug 回退
- 未指定时使用自动生成的时间戳 ID

### chains 数据层移除

v0.5.50+ 移除了 coordinate 图执行子系统（chains 数据层）。原 `--chain` 参数不再需要，工作流协调转向 session-based 模型。

---

## 七、里程碑归档

里程碑完成时 `/maestro-session-seal` 创建归档：

1. `/maestro-session-seal` 验证完整性 → `audit-report.md`
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
| analyze | ANL-{NNN} | phase, adhoc, standalone | `/maestro-ralph --engine swarm --script wf-analyze` |
| plan | PLN-{NNN} | phase, adhoc | `/maestro-next` |
| execute | EXC-{NNN} | phase | `/maestro-ralph continue` |
| verify | VRF-{NNN} | phase, milestone | （已退役；集成进 `/maestro-ralph` decision gate） |
| review | REV-{NNN} | phase | `/maestro-ralph --engine swarm --script wf-review` |
| debug | DBG-{NNN} | phase, standalone | `/odyssey --mode debug` |
| test | TST-{NNN} | phase | `/maestro "<test intent>"` 或 `/security-audit` |
| brainstorm | BRN-{NNN} | adhoc | `/maestro-ralph --engine swarm --script wf-brainstorm` |
| collab | CLB-{NNN} | adhoc | `/maestro-ralph --engine swarm` |
| ui-design | — | phase, scratch | `/maestro-impeccable --codify` |

### Session ID 格式

| 类型 | 格式 | 示例 |
|------|------|------|
| maestro 主会话 | `maestro-{YYYYMMDD-HHmmss}` | `maestro-20260513-143022` |
| ralph 会话 | `ralph-{YYYYMMDD-HHmmss}` | `ralph-20260513-143022` |
| player 会话 | `player-{YYYYMMDD-HHmmss}` | `player-20260513-143022` |
| delegate ID | `{prefix}-{HHmmss}-{rand4}` | `gem-143022-a7f2` |
| Issue ID | `ISS-XXXXXXXX-NNN` | `ISS-a1b2c3d4-001` |
