# Maestro2 融合架构设计 v3

以 GSD 为骨架，融入 Workflow 交互协作 + 规划执行管线 + DDD 文档追溯，统一产物体系。

---

## 一、融合来源总览

| 系统 | 核心贡献 | 关键移植项 |
|------|---------|-----------|
| **GSD** | 阶段生命周期 + Agent 调度 | phase 管线、Wave 并行、原子 commit、Goal-Backward 验证 |
| **Workflow 规划/执行** | 结构化规划+执行管线 | two-layer plan（plan.json + .task/）、探索→澄清→规划→执行、executionContext 交接 |
| **Workflow 交互** | 协作探索 + 反思迭代 | brainstorm、analyze、debug 假设驱动、reflection-log、决策记录协议 |
| **CCW Specs** | 系统级规范管理 | specs/ 系统（coding-conventions, architecture-constraints, learnings） |
| **Spec-Generator** | 任务级规范生成 | 6 阶段文档链（product-brief → requirements → architecture → epics） |
| **DDD** | 文档追溯 + 变更同步 | doc-index 双向链接、sync 影响追踪、codebase 文档系统 |

---

## 二、`.workflow/` 目录结构

### 2.1 完整目录树

```
.workflow/
├── project.md                       # 项目愿景、目标、约束（人工维护）
├── roadmap.md                       # 路线图（阶段结构、依赖、成功标准）
├── state.json                       # 项目级状态机（JSON）
├── config.json                      # 工作流配置（模式、开关、执行策略）
├── project-tech.json                # 自动生成的技术栈分析
│
├── specs/                           # 系统级规范（/workflow:specs 管理）
│   ├── coding-conventions.md
│   ├── architecture-constraints.md
│   ├── learnings.md
│   └── quality-rules.md
│
├── task-specs/                      # 任务级规范（spec-generator 产物）
│   └── SPEC-{slug}-{date}/
│       ├── spec-config.json
│       ├── glossary.json
│       ├── product-brief.md
│       ├── requirements/
│       │   ├── _index.md
│       │   ├── REQ-NNN-{slug}.md
│       │   └── NFR-{type}-NNN.md
│       ├── architecture/
│       │   ├── _index.md
│       │   └── ADR-NNN-{slug}.md
│       ├── epics/
│       │   ├── _index.md
│       │   └── EPIC-NNN-{slug}.md
│       ├── readiness-report.md
│       └── spec-summary.md
│
├── codebase/                        # 系统维护的代码文档（自动生成+同步）
│   ├── doc-index.json               # 单一事实源
│   ├── tech-registry/
│   │   ├── _index.md
│   │   └── {component-slug}.md
│   ├── feature-maps/
│   │   ├── _index.md
│   │   └── {feature-slug}.md
│   └── action-logs/
│       └── {action-hash}.md
│
├── research/                        # 项目级研究（init 阶段产出）
│   ├── STACK.md
│   ├── FEATURES.md
│   ├── ARCHITECTURE.md
│   ├── PITFALLS.md
│   └── SUMMARY.md
│
├── phases/                          # ★ 阶段执行产物（核心）
│   └── {NN}-{slug}/                # → 见 2.2 阶段目录详细结构
│
├── scratch/                         # 非阶段任务（quick/独立 debug/brainstorm/analyze/refactor）
│   └── {type}-{slug}-{date}/
│       ├── index.json               # 任务索引（状态、类型、进度）
│       ├── plan.json                # quick 任务计划
│       ├── .task/
│       ├── .summaries/
│       ├── reflection-log.md        # refactor 类型
│       ├── brainstorm.md            # brainstorm 类型
│       ├── discussion.md            # analyze 类型
│       └── understanding.md         # debug 类型
│
├── issues/                          # 问题追踪（跨阶段 + 独立发现）
│   ├── issues.jsonl                 # 活跃问题（每行一个 JSON）
│   ├── issue-history.jsonl          # 归档/关闭问题
│   └── discoveries/                 # 发现会话产物
│       └── {DBP-YYYYMMDD-HHmmss}/
│           ├── discovery-state.json
│           └── discovery-issues.jsonl
│
└── milestones/                      # 里程碑归档
    └── v{X.Y}/
        ├── roadmap-snapshot.md
        └── phases/                  # 归档的阶段目录
```

### 2.2 阶段目录完整结构

每个 `phases/{NN}-{slug}/` 是一个自包含的阶段容器，涵盖该阶段的全部生命周期产物：

```
phases/{NN}-{slug}/
│
│── index.json                      # ★ 阶段索引（状态、进度、所有元数据）
│
│── # ─── 前置探索 ───
│── context.md                      # 用户决策（锁定/自由/延迟 + 决策记录协议）
│── research.md                     # 阶段实现研究
│── brainstorm.md                   # (可选) 脑暴产物
│── analysis.md                     # (可选) 分析产物
│
│── # ─── 规划 ───
│── plan.json                       # 计划概览（two-layer: task_ids[] 引用）
│── plan-note.md                    # (可选) 协作规划文档（--collab 模式）
│── .task/                          # 任务定义
│   └── TASK-{NNN}.json
│
│── # ─── 探索过程 ───
│── .process/                       # 规划过程中的探索产物
│   ├── context-package.json        # 聚合探索结果
│   ├── exploration-{angle}.json    # 各维度探索结果
│   └── explorations-manifest.json  # 探索索引
│
│── # ─── 执行 ───
│── .summaries/                     # 任务执行结果
│   └── TASK-{NNN}-summary.md
│── reflection-log.md               # 反思记录（策略调整）
│
│── # ─── 验证 ───
│── verification.json               # Goal-Backward 验证结果
│── validation.json                 # Nyquist 测试覆盖验证
│── uat.md                          # UAT 用户验收测试记录（持久化，跨 context reset）
│
│── # ─── 测试 ───
│── .tests/                         # 测试过程产物
│   ├── test-plan.json              # 测试计划（分类：unit/e2e/integration）
│   ├── test-results.json           # 测试执行结果
│   └── coverage-report.json        # 覆盖率报告
│
│── # ─── 调试 ───
│── .debug/                         # 调试产物（缺口修复时产生）
│   └── {gap-slug}/
│       ├── understanding.md        # 假设驱动调试的理解演化
│       └── evidence.ndjson         # NDJSON 证据日志
```

---

## 三、核心 JSON Schema

### 3.1 state.json — 项目级状态

```json
{
  "version": "1.0",
  "project_name": "my-project",
  "current_milestone": "v1.0",
  "current_phase": 3,
  "status": "planning|executing|verifying|idle",
  "phases_summary": {
    "total": 5,
    "completed": 2,
    "in_progress": 1,
    "pending": 2
  },
  "last_updated": "2026-03-14T10:30:00+08:00",
  "accumulated_context": {
    "key_decisions": ["使用 PostgreSQL", "JWT 无状态认证"],
    "blockers": [],
    "deferred": ["国际化推迟到 v2"]
  }
}
```

### 3.2 index.json — 阶段索引

阶段的结构化元数据中心，替代散落在各文件中的 frontmatter：

```json
{
  "phase": 3,
  "slug": "authentication",
  "title": "用户认证系统",
  "status": "pending|exploring|planning|executing|verifying|testing|completed|blocked",
  "created_at": "2026-03-14T10:00:00+08:00",
  "updated_at": "2026-03-14T15:30:00+08:00",

  "goal": "实现完整的用户注册、登录、JWT 认证流程",
  "success_criteria": [
    "用户可通过邮箱注册和登录",
    "JWT 令牌正确签发和验证",
    "Refresh token 轮换机制工作"
  ],
  "requirements": ["REQ-001", "REQ-002", "REQ-005"],
  "spec_ref": "SPEC-auth-2026-03-12",

  "plan": {
    "task_ids": ["TASK-001", "TASK-002", "TASK-003", "TASK-004"],
    "task_count": 4,
    "complexity": "Medium",
    "waves": [
      { "wave": 1, "tasks": ["TASK-001", "TASK-002"], "parallel": true },
      { "wave": 2, "tasks": ["TASK-003"], "depends_on": ["TASK-001"] },
      { "wave": 3, "tasks": ["TASK-004"], "depends_on": ["TASK-002", "TASK-003"] }
    ]
  },

  "execution": {
    "method": "agent",
    "started_at": "2026-03-14T11:00:00+08:00",
    "completed_at": null,
    "tasks_completed": 2,
    "tasks_total": 4,
    "current_wave": 2,
    "commits": [
      { "hash": "abc1234", "task": "TASK-001", "message": "feat(auth): add user model and migration" },
      { "hash": "def5678", "task": "TASK-002", "message": "feat(auth): add registration endpoint" }
    ]
  },

  "verification": {
    "status": "pending|passed|gaps_found",
    "verified_at": null,
    "must_haves": [],
    "gaps": []
  },

  "validation": {
    "status": "pending|passed|gaps_found",
    "test_coverage": null,
    "gaps": []
  },

  "uat": {
    "status": "pending|in_progress|passed|gaps_found",
    "test_count": 0,
    "passed": 0,
    "gaps": []
  },

  "reflection": {
    "rounds": 1,
    "strategy_adjustments": ["middleware 注册顺序改为显式声明"]
  }
}
```

### 3.3 TASK-{NNN}.json — 统一任务格式

```json
{
  "id": "TASK-001",
  "title": "创建用户模型和数据库迁移",
  "status": "pending|in_progress|completed|failed",
  "type": "feature|fix|refactor|test|docs",

  "description": "创建 User 模型，包含 email/password_hash/created_at 字段",
  "files": {
    "create": ["src/models/user.ts", "prisma/migrations/001_users.sql"],
    "modify": ["prisma/schema.prisma"],
    "reference": ["src/models/index.ts"]
  },
  "action": "详细的实现步骤描述",
  "verify": "运行 prisma migrate dev，确认表创建成功",
  "done_when": "User 表存在于数据库，模型可正常 import",

  "depends_on": [],
  "wave": 1,
  "execution_group": "database-setup",
  "executor": "agent|cli-gemini|cli-codex|auto",

  "doc_context": {
    "affected_features": ["FT-001"],
    "affected_components": ["TC-003"],
    "affected_requirements": ["REQ-001"],
    "adr_ids": ["ADR-002"]
  },

  "meta": {
    "estimated_time": "15 minutes",
    "risk": "low",
    "autonomous": true,
    "checkpoint": false
  }
}
```

### 3.4 verification.json — 验证结果

```json
{
  "phase": 3,
  "status": "passed|gaps_found",
  "verified_at": "2026-03-14T16:00:00+08:00",
  "verifier": "workflow-verifier",
  "must_haves": {
    "truths": [
      { "claim": "用户可通过邮箱注册", "status": "verified", "evidence": "POST /api/auth/register 返回 201" },
      { "claim": "JWT 令牌正确签发", "status": "verified", "evidence": "登录后返回 accessToken + refreshToken" }
    ],
    "artifacts": [
      { "path": "src/auth/auth.service.ts", "status": "exists", "substantive": true },
      { "path": "src/auth/jwt.strategy.ts", "status": "exists", "substantive": true }
    ],
    "key_links": [
      { "from": "auth.controller → auth.service → user.model", "status": "wired" }
    ]
  },
  "gaps": [
    {
      "id": "GAP-001",
      "type": "missing_feature",
      "severity": "medium",
      "description": "Refresh token 轮换未实现",
      "fix_direction": "在 auth.service 中添加 rotateRefreshToken 方法"
    }
  ]
}
```

### 3.5 validation.json — 测试覆盖验证

```json
{
  "phase": 3,
  "status": "passed|gaps_found",
  "validated_at": "2026-03-14T17:00:00+08:00",
  "test_framework": "jest",
  "coverage": {
    "statements": 78.5,
    "branches": 65.2,
    "functions": 82.0,
    "lines": 79.1
  },
  "requirement_coverage": [
    { "requirement": "REQ-001", "tests": ["auth.register.spec.ts"], "status": "covered" },
    { "requirement": "REQ-002", "tests": [], "status": "uncovered" }
  ],
  "gaps": [
    {
      "requirement": "REQ-002",
      "description": "登录端点无测试",
      "suggested_test": "auth.login.spec.ts"
    }
  ]
}
```

### 3.6 scratch index.json — 非阶段任务索引

```json
{
  "id": "quick-fix-navbar-2026-03-14",
  "type": "quick|debug|brainstorm|analyze|refactor",
  "title": "修复导航栏响应式问题",
  "status": "active|paused|completed",
  "created_at": "2026-03-14T10:00:00+08:00",
  "updated_at": "2026-03-14T11:00:00+08:00",

  "plan": {
    "task_ids": ["TASK-001"],
    "task_count": 1
  },

  "execution": {
    "method": "agent",
    "tasks_completed": 0,
    "tasks_total": 1
  }
}
```

### 3.7 issue.jsonl — 问题追踪

每行一个 JSON 对象，存储于 `.workflow/issues/issues.jsonl`。

**ID 格式**: `ISS-YYYYMMDD-NNN`（NNN 为当日自增序号，从 001 开始）

**生成规则**:
- 提取当前日期为 `YYYYMMDD` 部分
- 扫描 `issues.jsonl` + `issue-history.jsonl` 中同日已有 ID，取 max(NNN)+1
- 零填充到 3 位（001, 002, ...）

```json
{
  "id": "ISS-20260315-001",
  "title": "Refresh token rotation not implemented",
  "status": "registered",
  "priority": 2,
  "severity": "high",
  "source": "verification",

  "phase_ref": 3,
  "gap_ref": "GAP-001",

  "description": "Auth service lacks refresh token rotation, allowing token reuse attacks",
  "fix_direction": "Add rotateRefreshToken method in auth.service with one-time-use enforcement",

  "context": {
    "location": "src/auth/auth.service.ts:42",
    "suggested_fix": "Implement token family tracking and rotation on each refresh",
    "notes": ""
  },

  "tags": ["security", "auth"],
  "affected_components": ["src/auth/auth.service.ts", "src/auth/jwt.strategy.ts"],

  "feedback": [],

  "issue_history": [
    {
      "timestamp": "2026-03-15T10:00:00+08:00",
      "from_status": null,
      "to_status": "registered",
      "actor": "workflow-verifier",
      "note": "Created from verification gap GAP-001"
    }
  ],

  "created_at": "2026-03-15T10:00:00+08:00",
  "updated_at": "2026-03-15T10:00:00+08:00",
  "resolved_at": null,
  "resolution": null
}
```

**Status 生命周期（8 状态）**:

```
registered → diagnosed → planning → planned → executing → completed
                                                        → failed
                                           → deferred
```

| 状态 | 含义 | 触发 |
|------|------|------|
| `registered` | 已登记，待分析 | 问题创建时 |
| `diagnosed` | 已诊断根因 | debug/analyze 完成后 |
| `planning` | 规划中 | plan --gaps 处理时 |
| `planned` | 已生成修复任务 | plan 输出 TASK 后 |
| `executing` | 修复执行中 | execute 处理对应 TASK 时 |
| `completed` | 修复完成并验证 | verify 确认修复 |
| `failed` | 修复失败 | execute 失败或 verify 未通过 |
| `deferred` | 延期处理 | 用户/自动决策推迟 |

**Source 来源枚举**:

| 来源 | 说明 | 典型触发命令 |
|------|------|-------------|
| `verification` | Goal-Backward 验证发现的缺口 | `/workflow:verify` |
| `uat` | 用户验收测试失败 | `/workflow:test` |
| `antipattern` | 反模式扫描发现 | `/workflow:verify` |
| `discuss` | 讨论/分析中识别的问题 | `/workflow:discuss`, `/workflow:analyze` |
| `discovery` | 独立发现会话 | `/workflow:discover` |
| `manual` | 用户手动提交 | `/workflow:issue add` |

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 问题 ID，格式 ISS-YYYYMMDD-NNN |
| `title` | string | 简短描述 |
| `status` | enum | 8 状态之一 |
| `priority` | integer(1-5) | 1=critical, 2=high, 3=medium, 4=low, 5=trivial |
| `severity` | enum | critical, high, medium, low |
| `source` | enum | 问题来源（6 种） |
| `phase_ref` | integer/null | 关联阶段号，null 表示跨阶段 |
| `gap_ref` | string/null | 关联验证缺口 ID（如 GAP-001） |
| `description` | string | 详细问题描述 |
| `fix_direction` | string | 建议修复方向（来自 GSD gap 格式） |
| `context` | object | 扩展上下文：location（文件位置）、suggested_fix、notes |
| `tags` | string[] | 标签 |
| `affected_components` | string[] | 受影响的文件/模块 |
| `feedback` | array | 反馈历史：{timestamp, type, content} |
| `issue_history` | array | 状态变更历史：{timestamp, from_status, to_status, actor, note} |
| `created_at` | string | 创建时间（ISO 8601） |
| `updated_at` | string | 最后更新时间 |
| `resolved_at` | string/null | 解决时间 |
| `resolution` | string/null | 解决方案摘要 |

**feedback 条目格式**:

```json
{
  "timestamp": "2026-03-15T11:00:00+08:00",
  "type": "failure",
  "content": "Fix attempt in TASK-005 caused regression in auth.login.spec.ts"
}
```

`type` 枚举: `failure`（执行失败）, `clarification`（需澄清）, `rejection`（方案被拒）

**JSONL 存储规则**:
- `issues.jsonl`: 所有 status 非 completed/failed/deferred 的活跃问题
- `issue-history.jsonl`: 已关闭问题（completed/failed/deferred），从 issues.jsonl 移出
- 每行一个完整 JSON 对象，便于 append-only 写入和流式读取

### 3.8 doc-index.json — 代码文档索引

```json
{
  "version": "1.0",
  "schema_version": "1.0",
  "project": "my-project",
  "last_updated": "2026-03-14T15:30:00+08:00",
  "features": [
    {
      "id": "FT-001",
      "name": "用户认证",
      "status": "in_progress",
      "requirement_ids": ["REQ-001", "REQ-002"],
      "component_ids": ["TC-001", "TC-003"],
      "phase": 3
    }
  ],
  "components": [
    {
      "id": "TC-001",
      "name": "UserModel",
      "type": "model",
      "code_locations": ["src/models/user.ts"],
      "feature_ids": ["FT-001"],
      "symbols": ["User", "UserCreateInput", "findByEmail"]
    }
  ],
  "requirements": [
    {
      "id": "REQ-001",
      "title": "用户注册",
      "priority": "must",
      "feature_id": "FT-001",
      "status": "in_progress",
      "acceptance_criteria": ["邮箱唯一性校验", "密码强度验证"]
    }
  ],
  "architecture_decisions": [
    {
      "id": "ADR-002",
      "title": "JWT 无状态认证",
      "component_ids": ["TC-001", "TC-005"],
      "decision": "使用 JWT + refresh token 轮换",
      "rationale": "无状态水平扩展"
    }
  ],
  "actions": []
}
```

### 3.9 状态转换矩阵

**index.json status transitions:**

```
pending → exploring → planning → executing → verifying → completed
                                                ↓
                                            planning (gaps found, plan --gaps)
```

| From | To | Trigger |
|------|----|---------|
| `pending` | `exploring` | maestro-analyze starts |
| `exploring` | `planning` | maestro-plan starts |
| `planning` | `executing` | maestro-execute starts |
| `executing` | `verifying` | maestro-verify starts |
| `verifying` | `completed` | verification passes |
| `verifying` | `planning` | gaps found → plan --gaps |

**state.json status:**

```
idle → active (first phase executing) → idle (all complete)
```

### 3.10 config.json 枚举定义

| Field | Values | Description |
|-------|--------|-------------|
| `mode` | `interactive` \| `auto` | Interactive prompts vs auto-defaults |
| `model_profile` | `quality` \| `balanced` \| `budget` | Token budget / model selection strategy |
| `execution.method` | `agent` \| `cli-gemini` \| `cli-codex` \| `auto` | Task execution backend |
| `git.branching` | `none` \| `phase` \| `milestone` | Git branch strategy |

### 3.11 convergence.criteria 解析规范

Task convergence criteria use grep-verifiable string patterns:

| Pattern | Verification Command |
|---------|---------------------|
| `"FILE contains 'STRING'"` | `grep -qF 'STRING' FILE` |
| `"COMMAND exits 0"` | `COMMAND; echo $?` |
| `"FILE exists"` | `test -f FILE` |
| `"DIR contains N files matching GLOB"` | `find DIR -name 'GLOB' \| wc -l` |

All criteria MUST be machine-verifiable — no subjective language (e.g., "clean", "well-structured").

---

## 四、Specs 双轨制

### 4.1 系统 Specs（`/workflow:specs` 管理）

项目级规范，跨会话积累，人工+自动维护。

| 命令 | 用途 |
|------|------|
| `/workflow:specs setup` | 首次项目分析 → project-tech.json + specs/*.md |
| `/workflow:specs add` | 添加条目（bug/pattern/decision/rule） |
| `/workflow:specs load` | 按关键词加载相关规范 |

**触发时机：**
- 项目首次 init → 自动 `specs setup`
- 阶段 complete → 自动提取 learnings
- 执行中发现 pattern → 手动 `specs add`

### 4.2 任务 Specs（Spec-Generator 产物）

任务级规范文档链，每个大型功能/里程碑生成一套。

| 命令 | 用途 |
|------|------|
| `/workflow:spec-generate` | 启动 6 阶段文档链生成 |
| `/workflow:spec-generate -c` | 恢复上次生成 |

**与阶段的关系：**
- spec-generate 产物 → 被 plan 消费（index.json 中 `spec_ref` 指向）
- plan 命令接受 `--spec SPEC-xxx` 直接引用
- requirements/ 中的 REQ-* 映射到 doc-index.json 的 requirements[]

---

## 五、Codebase 文档系统

系统维护的活文档，替代 GSD 的静态 `.planning/codebase/`。

| 触发 | 操作 | 影响 |
|------|------|------|
| `/workflow:init` or `/workflow:map` | 扫描代码 → 构建 doc-index.json | 初始化全量 |
| `/workflow:execute` 完成后 | 自动 `/workflow:sync` | 变更→影响追踪→增量刷新 |
| `/workflow:codebase rebuild` | 全量重建 | 重新扫描 |
| `/workflow:codebase refresh` | 增量刷新指定组件/功能 | 最小化更新 |

**sync 流程（execute 后自动触发）：**

```
git diff → 变更文件列表
  → 文件 → component (code_locations 匹配)
    → component → feature (feature_ids 链接)
      → feature → requirement (requirement_ids 链接)
  → 更新 doc-index.json 受影响条目
  → 刷新 tech-registry/{affected}.md
  → 刷新 feature-maps/{affected}.md
  → 生成 action-logs/{hash}.md
```

---

## 六、阶段执行管线

### 6.1 管线概览

```
/workflow:init ──────────────────────────────────────────────────────
  │  自动状态检测:
  │  ├─ 空目录 → 提问→研究(4并行)→project.md（不含roadmap，roadmap由spec-generate或roadmap命令创建）
  │  ├─ 有代码 → /workflow:map → /workflow:codebase rebuild
  │  └─ 有索引 → 跳过
  │  首次自动 → /workflow:specs setup
  ▼
╔═══════════════════════════════════════════════════════════════╗
║                 阶段循环（per phase）                         ║
║                                                               ║
║  /workflow:brainstorm ─┐  (可选) → brainstorm.md                   ║
║                  ▼                                            ║
║  /workflow:analyze ────┐  → analysis.md + context.md               ║
║                  ▼                                            ║
║  /workflow:plan ───────┐  → plan.json + .task/ + .process/         ║
║                  ▼                                            ║
║  /workflow:execute ────┐  → .summaries/ + commits                  ║
║  │               │  → 自动 /workflow:sync                           ║
║  │               ▼                                            ║
║  /workflow:verify ─────┐  → verification.json + validation.json    ║
║  │               ▼                                            ║
║  /workflow:test ───────┐  → uat.md + .tests/                       ║
║  │               ▼                                            ║
║  缺口? ──yes──→ /workflow:debug → .debug/{gap}/                   ║
║  │              → /workflow:plan --gaps                             ║
║  no                                                           ║
║  ▼                                                            ║
║  /workflow:phase-transition → 更新 index.json + state.json         ║
╚═══════════════════════════════════════════════════════════════╝
  ▼
/workflow:milestone-audit → /workflow:milestone-complete
```

### 6.2 阶段产物生命周期

每个命令在 phase 目录中写入/更新的文件：

| 命令 | 写入文件 | 更新 index.json 字段 |
|------|---------|---------------------|
| brainstorm | `brainstorm.md` | status→"exploring" |
| analyze | `analysis.md`, `context.md` | status→"exploring" |
| plan | `plan.json`, `.task/TASK-*.json`, `.process/exploration-*.json` | status→"planning", plan.* |
| execute | `.summaries/TASK-*-summary.md`, `reflection-log.md` | status→"executing", execution.* |
| sync | (更新 codebase/) | — |
| verify | `verification.json`, `validation.json` | status→"verifying", verification.*, validation.* |
| test | `uat.md`, `.tests/*` | status→"testing", uat.* |
| debug | `.debug/{gap}/understanding.md`, `.debug/{gap}/evidence.ndjson` | — |
| phase-transition | — | status→"completed" |

### 6.3 plan 命令

```
/workflow:plan <phase> [--collab] [--spec SPEC-xxx] [--auto]

P1: 上下文收集
  ├─ 加载 context.md（用户决策）
  ├─ 加载 spec-ref（如有）
  ├─ 加载 codebase/doc-index.json
  └─ 1-4 个 cli-explore-agent 并行探索
      输出: .process/exploration-*.json

P2: 澄清（可交互）
  ├─ 聚合 clarification_needs
  ├─ 多轮 AskUserQuestion
  └─ 输出: clarificationContext（内存）

P3: 规划
  ├─ 标准: workflow-planner Agent
  ├─ --collab: 多个 workflow-collab-planner 并行
  │   预分配 TASK ID 范围，plan-note.md 无锁协作
  └─ 输出: plan.json + .task/TASK-*.json

P4: 检查
  ├─ workflow-plan-checker（最多 3 轮修订）
  └─ 更新 index.json plan 字段

P5: 确认
  └─ 用户选择: 开始执行 | 验证质量 | 仅查看
```

### 6.4 execute 命令

```
/workflow:execute <phase> [--auto-commit] [--method agent|cli]

E1: 加载计划
  ├─ 读取 index.json → plan.waves
  ├─ 惰性加载 .task/TASK-*.json（按需）
  └─ 构建 executionContext（或接收内存交接）

E2: Wave 并行执行
  ├─ 每 Agent 全新 200k context
  ├─ 每任务原子 commit
  ├─ 偏差规则: 3 条自动修复
  └─ 每任务完成后:
      ├── 更新 .task/TASK-*.json status
      ├── 生成 .summaries/TASK-*-summary.md
      └── 更新 index.json execution

E3: 同步
  ├─ 自动触发 /workflow:sync
  └─ 更新 codebase/doc-index.json

E4: 反思（可选）
  └─ 记录 reflection-log.md
```

### 6.5 verify 命令

合并 GSD 的 verify-work + validate-phase：

```
/workflow:verify <phase> [--skip-tests]

V1: Goal-Backward 验证（workflow-verifier）
  ├─ 验证层级: 存在 → 实质 → 连接
  └─ 输出: verification.json

V2: Nyquist 测试覆盖（workflow-nyquist-auditor）
  ├─ 检测测试框架
  ├─ 映射需求→测试
  ├─ 生成缺失测试
  └─ 输出: validation.json + .tests/

V3: 汇总
  └─ 更新 index.json verification + validation
```

### 6.6 executionContext 内存交接

plan → execute 之间支持免磁盘序列化交接：

```
planCommand 构建 executionContext = {
  planObject: { plan.json + 已加载 task 文件 },
  explorations: [ exploration-*.json ],
  clarifications: [ 用户澄清 ],
  executionMethod: "agent|cli-gemini|cli-codex",
  phaseIndex: index.json,
  specRef: task-spec 引用
}
  ↓
executeCommand 接收 → 跳过磁盘重新加载
```

---

## 七、非阶段任务

Phase 之外的独立任务统一放入 `scratch/`：

| 类型 | 命令 | 产物 |
|------|------|------|
| quick | `/workflow:quick [desc]` | index.json + plan.json + .task/ + .summaries/ |
| debug | `/workflow:debug [desc]` | index.json + understanding.md + evidence.ndjson |
| brainstorm | `/workflow:brainstorm [topic]` | index.json + brainstorm.md + synthesis.json |
| analyze | `/workflow:analyze [topic]` | index.json + discussion.md + conclusions.json |
| refactor | `/workflow:refactor [scope]` | index.json + reflection-log.md + .task/ + .summaries/ |

当 brainstorm/analyze/debug 命令在阶段上下文中执行时（如 `/workflow:brainstorm 3`），产物写入 `phases/{NN}-{slug}/` 而非 scratch/。

---

## 八、命令体系（24 个命令）

```
commands/workflow/
├── 项目生命周期 (5)
│   ├── init.md              — 项目初始化（自动状态检测）
│   ├── map.md               — 代码库扫描
│   ├── milestone-audit.md   — 审计里程碑
│   ├── milestone-complete.md — 归档里程碑
│   └── status.md            — 状态仪表盘 + 路由下一步
│
├── 规范管理 (4)
│   ├── specs-setup.md       — 系统 specs 初始化
│   ├── specs-add.md         — 添加规范条目
│   ├── specs-load.md        — 加载规范
│   └── spec-generate.md     — 任务级 spec 生成（6 阶段）
│
├── 阶段执行 (9)
│   ├── brainstorm.md        — 发散→收敛探索
│   ├── analyze.md           — 多维度分析 + 决策提取 → context.md
│   ├── plan.md              — 探索→澄清→规划→检查
│   ├── execute.md           — Wave 并行 + 原子 commit
│   ├── verify.md            — Goal-Backward + 测试覆盖
│   ├── test.md              — UAT 用户验收测试
│   ├── debug.md             — 假设驱动调试
│   ├── refactor.md          — 技术债反思迭代
│   └── quick.md             — 快速任务
│
├── 代码文档 (3)
│   ├── sync.md              — 变更→影响→同步
│   ├── codebase-rebuild.md  — 全量重建 doc-index
│   └── codebase-refresh.md  — 增量刷新
│
├── 阶段管理 (2)
│   ├── phase-transition.md  — 标记阶段完成，推进
│   └── phase-add.md         — 添加/插入阶段到 roadmap
```

**关于阶段暂停/恢复：**
不再需要独立的 session 命令。阶段通过 index.json status 字段管理：
- 中断时自动保存进度到 index.json（execution.tasks_completed 等）
- 恢复时 `/workflow:execute <phase>` 自动检测已完成任务，从断点继续
- `/workflow:status` 显示所有阶段状态，支持路由到任意阶段

---

## 九、Agent 体系（15 个 Agent）

| Agent | 职责 | 触发 | 并行 |
|-------|------|------|------|
| workflow-project-researcher | 项目域研究 | init | ×4 |
| workflow-research-synthesizer | 合成研究输出 | init | ×1 |
| workflow-roadmapper | 创建路线图 | init | ×1 |
| workflow-codebase-mapper | 代码库分析 | map | ×4 |
| workflow-phase-researcher | 阶段实现研究 | plan | ×1 |
| workflow-planner | 创建执行计划 | plan | ×1 |
| workflow-collab-planner | 协作规划 | plan --collab | ×2-5 |
| workflow-plan-checker | 验证计划 | plan | ×1 (3轮) |
| workflow-executor | 原子执行任务 | execute | ×N (wave) |
| workflow-verifier | Goal-Backward 验证 | verify | ×1 |
| workflow-integration-checker | 跨阶段集成 | milestone-audit | ×1 |
| workflow-nyquist-auditor | 测试覆盖审计 | verify | ×1 |
| workflow-debugger | 假设驱动调试 | debug | ×N (per gap) |
| workflow-brainstormer | 发散→收敛脑暴 | brainstorm | ×1 |
| workflow-analyzer | 多维度分析 | analyze | ×1 |

---

## 十、配置系统

`.workflow/config.json`：

```json
{
  "mode": "interactive|auto",
  "model_profile": "quality|balanced|budget",

  "workflow": {
    "research": true,
    "plan_check": true,
    "verify_after_execute": true,
    "nyquist_validation": true,
    "auto_sync": true,
    "reflection": true,
    "decision_protocol": true
  },

  "execution": {
    "method": "agent|cli-gemini|cli-codex|auto",
    "parallel": true,
    "max_concurrent": 3,
    "auto_commit": true,
    "lazy_loading": true
  },

  "git": {
    "branching": "none|phase|milestone",
    "commit_docs": true
  },

  "specs": {
    "auto_setup_on_init": true,
    "extract_learnings_on_complete": true
  },

  "codebase": {
    "doc_index": true,
    "auto_sync_after_execute": true,
    "action_log": true
  }
}
```

---

## 十一、架构原则（15 条）

### 核心（GSD 继承）
1. **全新上下文隔离** — 每个子 Agent 200k 全新 context
2. **原子提交纪律** — 每任务一次 commit
3. **Goal-Backward 验证** — 从期望结果出发
4. **Wave 并行化** — wave 内并行 / wave 间顺序
5. **用户决策忠实度** — context.md 锁定不可违背
6. **100% 需求映射** — 无孤立需求
7. **可配置工作流** — config.json 开关

### 产物统一（新增）
8. **JSON 优先状态** — state.json / index.json 替代 md 状态文件
9. **Two-Layer 计划** — plan.json（概览 + task_ids[]） + .task/TASK-*.json（独立任务）
10. **惰性加载** — 按需读取任务文件，非全量预加载
11. **内存交接** — plan→execute 通过 executionContext 全局变量
12. **Phase 即容器** — 阶段目录自包含全部生命周期产物，无需外部 session 层

### 协作增强（Workflow 融合）
13. **决策即时捕获** — Context/Options/Chosen/Reason 格式
14. **反思驱动迭代** — reflection-log.md 调整策略
15. **Specs 双轨制** — 系统 specs（跨会话积累）+ 任务 specs（per-feature 文档链）

### 文档追溯（DDD 融合）
16. **双向可追溯 + 自动同步** — doc-index.json 双向链接，execute 后自动 sync

---

## 十二、实施路线图

### Phase 1: 骨架 + 统一产物
- [ ] 实现 `.workflow/` 目录结构（含 phases/ 和 scratch/）
- [ ] 实现 state.json / index.json schema
- [ ] 实现 TASK-*.json 统一任务格式
- [ ] 实现 plan.json two-layer 格式
- [ ] 移植 GSD 核心 Agent（planner/executor/verifier）
- [ ] 实现 plan → execute 管线（含 executionContext 交接）
- [ ] 实现 verify 管线（verification.json + validation.json）

### Phase 2: 规范系统
- [ ] 实现系统 specs 管理（specs-setup/add/load）
- [ ] 实现任务 spec-generate（6 阶段文档链）
- [ ] 实现 plan 命令消费 spec-ref

### Phase 3: 代码文档系统
- [ ] 实现 doc-index.json 构建（scan/index-build）
- [ ] 实现 sync 命令（变更→影响→同步）
- [ ] 实现 codebase rebuild/refresh
- [ ] 集成到 execute 后自动触发

### Phase 4: 协作增强
- [ ] 实现 brainstorm/analyze 工作流
- [ ] 实现决策记录协议（discuss 升级）
- [ ] 实现反思迭代（reflection-log）
- [ ] 实现协作规划（plan --collab）
- [ ] 实现假设驱动调试（debug 升级）
- [ ] 实现重构循环（refactor）
- [ ] 实现 UAT 测试流程（test + .tests/）

### Phase 5: 生命周期完善
- [ ] 实现 init 自动状态检测
- [ ] 实现 status 仪表盘 + 路由
- [ ] 实现 phase-transition + phase-add
- [ ] 实现 milestone 审计/归档
- [ ] 实现 execute 断点恢复（基于 index.json 进度）
- [ ] 实现 complete 时经验提取 → specs/learnings.md
