# maestro Codex Skills 开发规划

基于 `fusion-design.md` 架构设计，参照 `D:\Claude_dms3\.codex\skills` 现有 ccw codex 命令设计风格，规划 Codex 版本 skill 实现。

与 Claude Code 版本开发计划 (`.workflow/.lite-plan/workflow-commands-full-impl-2026-03-14/`) 对齐，确保两个平台的命令体系一一对应。

---

## 一、双平台架构映射

### 1.1 Claude Code vs Codex 结构对应

| Claude Code | Codex | 说明 |
|-------------|-------|------|
| `.claude/commands/workflow/*.md`（薄壳命令） | `.codex/skills/*/SKILL.md` | Codex 中 SKILL.md 自包含，不需要薄壳+工作流分离 |
| `workflows/*.md`（执行逻辑） | SKILL.md 主体 + `phases/*.md` | 执行逻辑内联或拆分到 phases/ |
| `.claude/agents/workflow-*.md`（Agent 定义） | `shared/agent-instructions/*.md` | Codex agent 指令模板，由 SKILL.md 中 `spawn_agent` 引用 |
| `templates/*.json`/`*.md`（模板） | `shared/templates/*.json`/`*.md` | 共享模板目录 |
| YAML frontmatter: `name`, `description`, `argument-hint`, `allowed-tools` | 同 | 格式一致 |
| `Agent({ subagent_type })` 调用 | `spawn_agent` / `spawn_agents_on_csv` | Codex 有 CSV 并行原语 |

### 1.2 CCW Codex Skill 设计范式

从现有 ccw skills 提取的核心设计模式：

| 模式 | 说明 | 参考 skill |
|------|------|-----------|
| **SKILL.md frontmatter** | `name`, `description`, `argument-hint`, `allowed-tools` | 所有 skill |
| **Phase 子目录** | 复杂 skill 将各阶段逻辑拆分到 `phases/*.md` | spec-generator |
| **Specs 子目录** | 规范/约束文档独立于 SKILL.md | spec-generator |
| **Templates 子目录** | 产物模板文件 | spec-generator |
| **spawn_agents_on_csv** | CSV 驱动 Wave 并行执行 | workflow-execute, brainstorm, lite-planex |
| **spawn_agent** | 单 agent 委派（重活卸载到 subagent） | workflow-plan, spec-generator |
| **Auto Mode (-y)** | 跳过所有确认，使用默认值 | 所有 skill |
| **ASCII 管线图** | Overview 用 ASCII art 展示完整管线 | 所有 skill |
| **CSV Schema 定义** | 明确定义 CSV 列及来源 | workflow-execute, lite-planex |
| **Data Flow 图** | 展示数据在各 Phase 间的流转 | workflow-plan, lite-planex |
| **README.md** | 复杂 skill 配套说明文档 | spec-generator |

### 1.3 Codex 工具映射

| Codex 工具 | Claude Code 等价 | 用途 |
|-----------|-----------------|------|
| `spawn_agent` | `Agent({ subagent_type })` | 单 agent 委派 |
| `spawn_agents_on_csv` | 无直接等价（需循环 Agent） | CSV 驱动 Wave 并行 |
| `wait` / `send_input` / `close_agent` | Agent 自动管理 | agent 生命周期 |
| `AskUserQuestion` | `AskUserQuestion` | 交互 |
| `Read/Write/Edit/Bash/Glob/Grep` | 同名 | 文件操作 |

### 1.4 产物目录（运行时输出）

产物目录结构直接复用 fusion-design.md 定义的 `.workflow/`，不属于 skill 目录：

```
.workflow/                    # 运行时产物（fusion-design.md 定义）
├── project.md
├── roadmap.md
├── state.json
├── config.json
├── project-tech.json
├── specs/
├── task-specs/
├── codebase/
├── research/
├── phases/
├── scratch/
└── milestones/
```

---

## 二、Skill 目录规划

### 2.1 目录总览

```
.codex/skills/maestro/                    # 或安装到 ~/.codex/skills/
│
├── # ─── 项目生命周期 (5 skills) ───
├── workflow-init/
│   ├── SKILL.md                           # 项目初始化（自动状态检测）
│   └── phases/
│       ├── 01-detect-state.md             # 空目录/有代码/有索引 三路分支
│       ├── 02-research.md                 # 4 并行研究 agent (spawn_agents_on_csv)
│       ├── 03-roadmap.md                  # 路线图生成 (spawn_agent)
│       └── 04-specs-setup.md              # 自动 specs 初始化
│
├── workflow-map/
│   └── SKILL.md                           # 代码库扫描 → research/ docs
│
├── workflow-status/
│   └── SKILL.md                           # 状态仪表盘 + 路由下一步
│
├── milestone-audit/
│   └── SKILL.md                           # 审计里程碑（spawn_agent: integration-checker）
│
├── milestone-complete/
│   └── SKILL.md                           # 归档里程碑
│
├── # ─── 规范管理 (4 skills) ───
├── specs-setup/
│   └── SKILL.md                           # 系统 specs 初始化 → project-tech.json + specs/*.md
│
├── specs-add/
│   └── SKILL.md                           # 添加规范条目（bug/pattern/decision/rule）
│
├── specs-load/
│   └── SKILL.md                           # 按关键词加载相关规范
│
├── spec-generate/                         # ★ 复杂 skill（参照 ccw spec-generator）
│   ├── SKILL.md                           # 入口：6 阶段文档链 + readiness check
│   ├── README.md
│   ├── phases/
│   │   ├── 01-discovery.md
│   │   ├── 02-clarify.md
│   │   ├── 03-product-brief.md
│   │   ├── 04-requirements.md
│   │   ├── 05-architecture.md
│   │   ├── 06-epics-stories.md
│   │   └── 07-readiness-check.md
│   ├── specs/
│   │   ├── document-standards.md
│   │   ├── quality-gates.md
│   │   └── glossary-template.json
│   └── templates/
│       ├── product-brief.md
│       ├── requirements-prd.md
│       ├── architecture-doc.md
│       └── epics-template.md
│
├── # ─── 阶段执行 (10 skills) ───
├── workflow-brainstorm/
│   └── SKILL.md                           # 发散→收敛（spawn_agent: brainstormer）
│
├── workflow-analyze/
│   └── SKILL.md                           # 多维度分析（spawn_agent: analyzer）
│
├── workflow-discuss/
│   └── SKILL.md                           # 决策记录协议 → context.md
│
├── workflow-plan/                         # ★ 核心 skill
│   ├── SKILL.md                           # 探索→澄清→规划→检查→确认
│   └── phases/
│       ├── 01-context-gather.md           # 上下文收集（spawn_agents_on_csv 1-4 探索）
│       ├── 02-clarify.md                  # 澄清（多轮 AskUserQuestion）
│       ├── 03-plan.md                     # 规划（标准: spawn_agent / --collab: spawn_agents_on_csv）
│       └── 04-check.md                    # 检查（workflow-plan-checker，3 轮修订）
│
├── workflow-execute/                      # ★ 核心 skill
│   ├── SKILL.md                           # Wave 并行 + 原子 commit
│   └── phases/
│       ├── 01-load-plan.md                # 加载计划 + executionContext 交接
│       ├── 02-wave-execute.md             # CSV wave 并行（spawn_agents_on_csv）
│       ├── 03-sync.md                     # 自动触发 workflow-sync
│       └── 04-reflect.md                  # 反思记录
│
├── workflow-verify/
│   ├── SKILL.md                           # Goal-Backward + 测试覆盖
│   └── phases/
│       ├── 01-goal-backward.md            # verification.json（spawn_agent: verifier）
│       ├── 02-nyquist-audit.md            # validation.json + .tests/（spawn_agent: nyquist-auditor）
│       └── 03-summarize.md                # 汇总更新 index.json
│
├── workflow-test/
│   └── SKILL.md                           # UAT 用户验收测试（会话式，逐项测试）
│
├── workflow-debug/
│   └── SKILL.md                           # 假设驱动调试（spawn_agent: debugger）
│
├── workflow-refactor/
│   └── SKILL.md                           # 技术债反思迭代
│
├── workflow-quick/
│   └── SKILL.md                           # 快速任务（scratch/ 产物，支持 --full/--discuss）
│
├── # ─── 代码文档 (3 skills) ───
├── workflow-sync/
│   └── SKILL.md                           # git diff → 影响链 → doc-index 更新
│
├── codebase-rebuild/
│   └── SKILL.md                           # 全量扫描 → doc-index.json 重建
│
├── codebase-refresh/
│   └── SKILL.md                           # 指定组件/功能增量刷新
│
├── # ─── 阶段管理 (2 skills) ───
├── phase-transition/
│   └── SKILL.md                           # 标记阶段完成，推进状态
│
├── phase-add/
│   └── SKILL.md                           # 添加/插入阶段到 roadmap
│
├── # ─── 共享资源 ───
├── shared/
│   ├── schemas/                           # JSON 模板（即 Claude 版 templates/）
│   │   ├── state.json                     # state.json 模板（fusion-design 3.1）
│   │   ├── config.json                    # config.json 模板（fusion-design 10）
│   │   ├── index.json                     # phase index.json 模板（fusion-design 3.2）
│   │   ├── task.json                      # TASK-*.json 模板（fusion-design 3.3）
│   │   ├── plan.json                      # plan.json 模板（two-layer）
│   │   ├── verification.json              # verification.json 模板（fusion-design 3.4）
│   │   ├── validation.json                # validation.json 模板（fusion-design 3.5）
│   │   ├── scratch-index.json             # scratch index.json 模板（fusion-design 3.6）
│   │   └── doc-index.json                 # doc-index.json 模板（fusion-design 3.7）
│   ├── csv-schemas/                       # CSV 列定义
│   │   ├── execute-tasks.csv.md           # execute wave CSV schema（21 列）
│   │   ├── explore-angles.csv.md          # explore wave CSV schema
│   │   └── research-topics.csv.md         # research wave CSV schema
│   ├── agent-instructions/               # Agent 指令模板（即 Claude 版 agents/）
│   │   ├── workflow-project-researcher.md
│   │   ├── workflow-research-synthesizer.md
│   │   ├── workflow-roadmapper.md
│   │   ├── workflow-codebase-mapper.md
│   │   ├── workflow-phase-researcher.md
│   │   ├── workflow-planner.md
│   │   ├── workflow-collab-planner.md
│   │   ├── workflow-plan-checker.md
│   │   ├── workflow-executor.md
│   │   ├── workflow-verifier.md
│   │   ├── workflow-integration-checker.md
│   │   ├── workflow-nyquist-auditor.md
│   │   ├── workflow-debugger.md
│   │   ├── workflow-brainstormer.md
│   │   └── workflow-analyzer.md
│   └── templates/                         # MD 模板
│       ├── project.md                     # 项目愿景/目标/约束
│       ├── roadmap.md                     # 路线图模板
│       ├── context.md                     # 决策记录（Context/Options/Chosen/Reason）
│       ├── uat.md                         # UAT 测试跟踪表
│       ├── task-summary.md                # 任务执行摘要
│       └── reflection-log.md              # 反思记录
│
└── README.md                             # 整体说明文档
```

### 2.2 Skill 总数

| 分类 | 数量 | Skills |
|------|------|--------|
| 项目生命周期 | 5 | init, map, status, milestone-audit, milestone-complete |
| 规范管理 | 4 | specs-setup, specs-add, specs-load, spec-generate |
| 阶段执行 | 10 | brainstorm, analyze, discuss, plan, execute, verify, test, debug, refactor, quick |
| 代码文档 | 3 | sync, codebase-rebuild, codebase-refresh |
| 阶段管理 | 2 | phase-transition, phase-add |
| **合计** | **24** | — |

---

## 三、开发任务分解（对齐 Claude 版 TASK 结构）

与 Claude 版计划采用相同的 8 TASK 分组 + 2 Wave 并行策略：

```
Wave 1: TASK-001（共享基础设施）— 所有后续 TASK 依赖
Wave 2: TASK-002 ~ TASK-008（7 组并行）— 互不依赖
```

### TASK-001: 共享基础设施（shared/ 全部内容）

**对应 Claude 版**: TASK-001（templates/ + 目录结构）
**Wave**: 1（前置依赖，必须先完成）

| Codex 文件 | Claude 版对应 | 来源 |
|-----------|-------------|------|
| `shared/schemas/state.json` | `templates/state.json` | fusion-design 3.1 |
| `shared/schemas/config.json` | `templates/config.json` | fusion-design 10 |
| `shared/schemas/index.json` | `templates/index.json` | fusion-design 3.2 |
| `shared/schemas/task.json` | `templates/task.json` | fusion-design 3.3 |
| `shared/schemas/plan.json` | `templates/plan.json` | two-layer 格式 |
| `shared/schemas/verification.json` | `templates/verification.json` | fusion-design 3.4 |
| `shared/schemas/validation.json` | `templates/validation.json` | fusion-design 3.5 |
| `shared/schemas/scratch-index.json` | `templates/scratch-index.json` | fusion-design 3.6 |
| `shared/schemas/doc-index.json` | `templates/doc-index.json` | fusion-design 3.7 |
| `shared/templates/project.md` | `templates/project.md` | 愿景/目标/约束 |
| `shared/templates/roadmap.md` | `templates/roadmap.md` | 阶段结构 |
| `shared/templates/context.md` | `templates/context.md` | 决策记录协议 |
| `shared/templates/uat.md` | `templates/uat.md` | 测试跟踪表 |
| `shared/csv-schemas/*.md` | （Claude 版无，Codex 独有） | CSV 列定义 |

**验收标准**:
- 所有 JSON 模板可正常解析，schema 与 fusion-design.md 3.1-3.7 + 10 完全匹配
- MD 模板包含正确的 section 结构
- CSV schema 文档定义完整的列名、来源、类型

---

### TASK-002: 项目生命周期 Skills (5 skills)

**对应 Claude 版**: TASK-002（init, map, status, milestone-audit, milestone-complete）
**Wave**: 2（与 TASK-003~008 并行）

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `workflow-init/SKILL.md` + phases/ | `init.md` + `workflows/init.md` | 三路状态检测 → 研究(4并行) → roadmap → specs-setup |
| `workflow-map/SKILL.md` | `map.md` + `workflows/map.md` | spawn 4× codebase-mapper → research/ docs |
| `workflow-status/SKILL.md` | `status.md` + `workflows/status.md` | 读 state.json + 所有 index.json → 仪表盘 + 路由 |
| `milestone-audit/SKILL.md` | `milestone-audit.md` + `workflows/milestone-audit.md` | spawn integration-checker → 跨阶段验证 |
| `milestone-complete/SKILL.md` | `milestone-complete.md` + `workflows/milestone-complete.md` | 归档 → milestones/v{X.Y}/ + learnings 提取 |

**验收标准**:
- init: 自动检测空目录 vs 有代码 vs 有索引，spawn 4 并行 researcher，创建 roadmap.md，自动触发 specs-setup
- map: spawn 4 并行 codebase-mapper（tech/arch/quality/concerns），产出 research/ docs
- status: 读取 state.json + 所有 phases/\*/index.json，显示进度仪表盘，路由到下一步
- milestone-audit: spawn integration-checker，跨阶段集成验证
- milestone-complete: 归档到 milestones/v{X.Y}/，提取 learnings → specs/learnings.md

---

### TASK-003: 规范管理 Skills (4 skills)

**对应 Claude 版**: TASK-003（specs-setup, specs-add, specs-load, spec-generate）
**Wave**: 2

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `specs-setup/SKILL.md` | `specs-setup.md` + `workflows/specs-setup.md` | 项目分析 → project-tech.json + specs/*.md |
| `specs-add/SKILL.md` | `specs-add.md` + `workflows/specs-add.md` | type→file 映射追加（bug→learnings, pattern→coding-conventions, decision→architecture-constraints, rule→quality-rules） |
| `specs-load/SKILL.md` | `specs-load.md` + `workflows/specs-load.md` | 关键词搜索 specs/*.md，返回相关段落 |
| `spec-generate/` (复杂) | `spec-generate.md` + `workflows/spec-generate.md` | 6 阶段文档链（参照 ccw spec-generator 1:1 复用） |

**验收标准**:
- specs-setup: 扫描项目结构 → 检测技术栈 → 生成 project-tech.json + 4 个 specs/*.md
- specs-add: 接受 type+content → 格式化带时间戳条目 → 追加到正确文件
- specs-load: 关键词搜索所有 specs/*.md → 返回匹配段落+file:line
- spec-generate: 6 阶段管线产出 task-specs/SPEC-{slug}-{date}/ 完整文档链，支持 -c 恢复

---

### TASK-004: 探索 Skills (3 skills)

**对应 Claude 版**: TASK-004（brainstorm, analyze, discuss）
**Wave**: 2

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `workflow-brainstorm/SKILL.md` | `brainstorm.md` + `workflows/brainstorm.md` | spawn brainstormer → 发散(10+想法) → 收敛(排序) → brainstorm.md |
| `workflow-analyze/SKILL.md` | `analyze.md` + `workflows/analyze.md` | spawn analyzer → 5 维度分析 → analysis.md |
| `workflow-discuss/SKILL.md` | `discuss.md` + `workflows/discuss.md` | 多轮 AskUserQuestion → 决策记录协议 → context.md |

**验收标准**:
- 支持双模式路由：数字参数 → 阶段模式（phases/{NN}-{slug}/），文本参数 → scratch 模式（scratch/{type}-{slug}-{date}/）
- scratch 模式创建 index.json（匹配 scratch-index.json 模板）
- 阶段模式更新 index.json status→"exploring"
- discuss: context.md 使用 Context/Options/Chosen/Reason 决策记录格式

---

### TASK-005: 核心管线 Skills (3 skills) ★

**对应 Claude 版**: TASK-005（plan, execute, verify）
**Wave**: 2（最高优先级，核心管线）

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `workflow-plan/` (复杂) | `plan.md` + `workflows/plan.md` | 5 阶段管线 → plan.json + .task/TASK-*.json |
| `workflow-execute/` (复杂) | `execute.md` + `workflows/execute.md` | CSV wave 并行 + 原子 commit |
| `workflow-verify/` (复杂) | `verify.md` + `workflows/verify.md` | Goal-Backward + Nyquist |

**plan 详细管线**:
```
P1: 上下文收集
    ├─ 加载 context.md + spec-ref + doc-index.json
    ├─ spawn_agents_on_csv 1-4 个 explore agent → .process/exploration-*.json
    └─ 输出: context-package.json

P2: 澄清（可交互）
    ├─ 聚合 clarification_needs
    ├─ 多轮 AskUserQuestion（批次 4）
    └─ 输出: clarificationContext（内存）

P3: 规划
    ├─ 标准模式: spawn_agent → workflow-planner
    ├─ --collab 模式: spawn_agents_on_csv → N 个 workflow-collab-planner（预分配 TASK ID 范围）
    └─ 输出: plan.json + .task/TASK-*.json

P4: 检查
    ├─ spawn_agent → workflow-plan-checker（最多 3 轮修订）
    └─ 输出: 更新的 plan.json

P5: 确认
    └─ AskUserQuestion: 开始执行 | 验证质量 | 仅查看
```

**execute 详细管线**:
```
E1: 加载计划
    ├─ 读取 index.json → plan.waves
    ├─ 惰性加载 .task/TASK-*.json
    └─ 接收 executionContext 内存交接 或 从磁盘重建

E2: Wave 并行执行（spawn_agents_on_csv）
    ├─ TASK-*.json → tasks.csv（Kahn's BFS 排序）
    ├─ 每 Wave: 构建 wave-{N}.csv + prev_context
    ├─ spawn_agents_on_csv → 每 agent 全新 context
    ├─ 每任务: 实现 → 原子 commit → 写 summary
    ├─ 偏差规则: 3 次自动修复
    └─ 输出: .summaries/TASK-*-summary.md

E3: 同步
    └─ 自动触发 workflow-sync

E4: 反思（可选）
    └─ 记录 reflection-log.md
```

**verify 详细管线**:
```
V1: Goal-Backward 验证（spawn_agent: verifier）
    ├─ 存在性 → 实质性 → 连接性 三层验证
    └─ 输出: verification.json

V2: Nyquist 测试覆盖（spawn_agent: nyquist-auditor）
    ├─ 检测测试框架 → 映射需求→测试 → 识别缺口 → 生成缺失测试
    └─ 输出: validation.json + .tests/

V3: 汇总
    └─ 更新 index.json verification + validation 字段
```

**验收标准**:
- plan: 支持 flags `--collab`, `--spec SPEC-xxx`, `--auto`, `--gaps`；输出 two-layer plan（plan.json + .task/TASK-*.json）
- execute: 实现 executionContext 内存交接（fusion-design 6.6）；CSV wave 并行；每任务原子 commit；断点恢复（从 index.json 已完成任务跳过）
- verify: verification.json 含 must_haves(truths/artifacts/key_links) + gaps；validation.json 含 coverage + requirement_coverage + gaps

---

### TASK-006: 测试/调试/工具 Skills (4 skills)

**对应 Claude 版**: TASK-006（test, debug, refactor, quick）
**Wave**: 2

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `workflow-test/SKILL.md` | `test.md` + `workflows/test.md` | 会话式 UAT（逐项测试） → uat.md + .tests/ |
| `workflow-debug/SKILL.md` | `debug.md` + `workflows/debug.md` | spawn debugger → 假设驱动 → evidence.ndjson → understanding.md |
| `workflow-refactor/SKILL.md` | `refactor.md` + `workflows/refactor.md` | 范围分析 → 重构任务 → 执行 + reflection-log → 回归验证 |
| `workflow-quick/SKILL.md` | `quick.md` + `workflows/quick.md` | scratch/ 快速任务，支持 --full/--discuss |

**验收标准**:
- test: 会话式逐项呈现测试→获取用户 pass/fail/skip→自动诊断失败→写入 uat.md + .tests/
- debug: 支持阶段内（.debug/ in phase dir，verify 发现 gaps 时触发）和 scratch/ 模式；NDJSON 证据格式 `{timestamp, hypothesis, action, result, interpretation}`；checkpoint 支持
- refactor: reflection-log.md 跟踪策略调整；执行后验证无回归
- quick: scratch/quick-{slug}-{date}/ 产物；`--full` 启用 plan-checker + verifier；`--discuss` 轻量讨论

---

### TASK-007: 代码文档 + 阶段管理 Skills (5 skills)

**对应 Claude 版**: TASK-007（sync, codebase-rebuild, codebase-refresh, phase-transition, phase-add）
**Wave**: 2

| Codex Skill | Claude 版 command + workflow | 关键逻辑 |
|------------|------------------------------|---------|
| `workflow-sync/SKILL.md` | `sync.md` + `workflows/sync.md` | git diff → 文件→组件→功能→需求 影响链 → 更新 doc-index |
| `codebase-rebuild/SKILL.md` | `codebase-rebuild.md` + `workflows/codebase-rebuild.md` | 全量扫描 → doc-index.json 重建 |
| `codebase-refresh/SKILL.md` | `codebase-refresh.md` + `workflows/codebase-refresh.md` | 指定 ID 增量刷新 |
| `phase-transition/SKILL.md` | `phase-transition.md` + `workflows/phase-transition.md` | 验证完成 → 更新 index.json + state.json → 提取 learnings |
| `phase-add/SKILL.md` | `phase-add.md` + `workflows/phase-add.md` | 位置插入 → 创建 phase dir → 更新 roadmap → 重编号 |

**sync 影响链追踪**:
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

**验收标准**:
- sync: 完整实现影响链追踪（文件→组件→功能→需求 4 层映射）
- codebase-rebuild: 全量扫描产出 doc-index.json + tech-registry/ + feature-maps/
- phase-transition: 验证所有任务完成 + verification passed 后才允许推进；自动提取 learnings → specs/learnings.md
- phase-add: 中间插入时自动重编号后续阶段

---

### TASK-008: Agent 指令模板 (15 agents)

**对应 Claude 版**: TASK-008（15 个 .claude/agents/workflow-*.md）
**Wave**: 2

Codex 版将 Claude 的 agent 定义文件转为 `shared/agent-instructions/` 下的指令模板，格式保持一致：

| Agent | 职责 | 触发 skill | 并行 | allowed-tools |
|-------|------|-----------|------|--------------|
| workflow-project-researcher | 项目域研究 | init | ×4 | Read,Bash,Glob,Grep,WebFetch,Write |
| workflow-research-synthesizer | 合成研究输出 | init | ×1 | Read,Write |
| workflow-roadmapper | 创建路线图 | init | ×1 | Read,Write |
| workflow-codebase-mapper | 代码库分析 | map | ×4 | Read,Bash,Glob,Grep,Write |
| workflow-phase-researcher | 阶段实现研究 | plan P1 | ×1-4 | Read,Bash,Glob,Grep,WebFetch |
| workflow-planner | 创建执行计划 | plan P3 | ×1 | Read,Bash,Glob,Grep,WebFetch,Write |
| workflow-collab-planner | 协作规划 | plan --collab P3 | ×2-5 | Read,Bash,Glob,Grep,Write |
| workflow-plan-checker | 验证计划 | plan P4 | ×1(3轮) | Read,Bash,Glob,Grep |
| workflow-executor | 原子执行任务 | execute E2 | ×N(wave) | Read,Bash,Glob,Grep,Write,LSP |
| workflow-verifier | Goal-Backward 验证 | verify V1 | ×1 | Read,Bash,Glob,Grep |
| workflow-integration-checker | 跨阶段集成 | milestone-audit | ×1 | Read,Bash,Glob,Grep |
| workflow-nyquist-auditor | 测试覆盖审计 | verify V2 | ×1 | Read,Bash,Glob,Grep,Write |
| workflow-debugger | 假设驱动调试 | debug | ×N(gap) | Read,Bash,Glob,Grep,WebFetch,Write |
| workflow-brainstormer | 发散→收敛脑暴 | brainstorm | ×1 | Read,Bash,Glob,Grep |
| workflow-analyzer | 多维度分析 | analyze | ×1 | Read,Bash,Glob,Grep |

**每个 agent 指令格式**:
```markdown
# Role
[角色定位]

## Process
[执行步骤]

## Input
[接收什么上下文]

## Output
[产出什么产物]

## Constraints
[范围限制]
```

**验收标准**:
- 15 个 agent 指令文件，每个包含 Role/Process/Input/Output/Constraints
- agent 指令中引用正确的 shared/schemas/ 模板路径
- 从 SKILL.md 中通过 spawn_agent 引用时，通过路径加载指令

---

## 四、关键设计决策

### 4.1 Architecture: 自包含 SKILL.md vs 薄壳+工作流

**决策**: Codex 使用自包含 SKILL.md（执行逻辑内联或拆到 phases/）
**理由**: Codex skill 系统天然支持 SKILL.md 自包含模式，不需要 Claude Code 的 command→workflow 分离。ccw 现有 skills（workflow-plan, workflow-execute, brainstorm）都是这种模式。
**Claude 版等价**: command wrapper + workflow.md = Codex 的 SKILL.md

### 4.2 Agent Instructions: 文件 vs 内联

**决策**: Agent 指令统一放 `shared/agent-instructions/`，SKILL.md 中通过路径引用
**理由**: 复用性（同一 agent 被多个 skill 引用，如 planner 被 plan 和 quick 复用），与 Claude 版 `.claude/agents/` 一一对应
**内联例外**: 仅被单一 phase 使用的简单指令可内联到 phase doc

### 4.3 Template/Schema: shared/ vs skill-local

**决策**: 全局共享的 JSON schema + MD 模板放 `shared/`，skill 专属模板放 skill 本地
**理由**: spec-generate 有自己的 templates/（product-brief.md 等），这些只有 spec-generate 使用；而 state.json/index.json 等被所有 skill 共享

### 4.4 命令命名空间

**决策**: Codex 前缀 `workflow-` 或功能名（与 Claude 版 `/workflow:xxx` 对齐）
**理由**: 已在 fusion-design.md 中统一为 workflow- 前缀

### 4.5 Wave 并行 vs 顺序

**决策**: 开发任务分 2 Wave（与 Claude 版一致）
- Wave 1: TASK-001（共享基础设施）
- Wave 2: TASK-002~008（7 组并行，互不依赖）

**理由**: 所有 skill 都依赖 shared/ 中的 schema 和模板，但 skill 之间无编译依赖

---

## 五、State 管理策略

### 5.1 三层状态模型

```
state.json (项目级) ← workflow-status / phase-transition / milestone-complete 更新
  ↕ 双向更新
index.json (阶段级) ← plan / execute / verify / brainstorm / analyze / discuss 更新
  ↕ 任务级状态
.task/TASK-*.json   ← execute wave agent 更新
```

### 5.2 状态更新时机

| 触发 skill | 更新的文件 | 更新的字段 |
|-----------|-----------|-----------|
| brainstorm/analyze/discuss | index.json | status→"exploring" |
| plan | index.json + plan.json + .task/ | status→"planning", plan.* |
| execute（每任务） | .task/TASK-*.json + index.json | task.status, execution.tasks_completed |
| execute（全部完成） | state.json | current_phase |
| verify | index.json | status→"verifying", verification.*, validation.* |
| test | index.json | status→"testing", uat.* |
| phase-transition | index.json + state.json | status→"completed", phases_summary |
| milestone-complete | state.json | current_milestone |

### 5.3 断点恢复机制

不使用独立 session 命令。通过 index.json 实现断点恢复：
- execute 中断 → index.json 记录 execution.tasks_completed + 每个 TASK-*.json status
- 重新调用 execute → 读取已完成任务列表 → 跳过 → 从断点继续

---

## 六、从 CCW 可直接复用的模式

| 模式 | 来源 ccw skill | 复用于 maestro skill | 复用方式 |
|------|---------------|---------------------|---------|
| CSV Wave 引擎 | workflow-execute | workflow-execute | 核心 spawn_agents_on_csv 管线直接复用 |
| CSV 探索 Wave | workflow-lite-planex | workflow-plan (P1) | explore.csv 格式 + spawn_agents_on_csv 模式 |
| brainstorm CSV 并行 | brainstorm | workflow-brainstorm | 角色选择 → roles.csv → spawn_agents_on_csv |
| spec-generator 7 阶段 | spec-generator | spec-generate | 几乎 1:1 复用，仅调整产物路径和 ID 命名 |
| review 多维并行 | review-cycle | workflow-verify (V2) | 7 维并行分析 → 聚合 → 深度分析循环 |
| Agent 指令模板格式 | workflow-execute executor instruction | shared/agent-instructions/ | Role/Process/Input/Output/Constraints 格式 |
| Auto Mode 模式 | 所有 ccw skill | 所有 maestro skill | `-y`/`--yes` 跳过确认 |

### 与 CCW 版本的核心差异

| 维度 | CCW Skills | maestro Skills |
|------|-----------|----------------|
| **会话管理** | `.workflow/active/WFS-{id}/` | `phases/{NN}-{slug}/index.json` |
| **计划格式** | `IMPL_PLAN.md` + `IMPL-*.json` | `plan.json` + `TASK-*.json` |
| **任务 ID** | `IMPL-001` | `TASK-001` |
| **状态追踪** | `workflow-session.json` | `state.json` + `index.json`（三层） |
| **文档追溯** | 无 | `doc-index.json` 双向链接 + sync |
| **specs 系统** | CCW specs（共享） | 内置双轨 specs（系统+任务） |
| **验证方式** | 无内置 | Goal-Backward + Nyquist |
| **阶段概念** | 扁平 session | Phase 层级（roadmap → phase → task） |
| **恢复机制** | session resume | index.json 断点恢复 |

---

## 七、实施路线

### 7.1 Wave 执行顺序

```
Wave 1: TASK-001 共享基础设施
├── shared/schemas/ (9 个 JSON 模板)
├── shared/templates/ (6 个 MD 模板)
├── shared/csv-schemas/ (3 个 CSV schema 文档)
└── README.md

Wave 2: TASK-002~008 并行（7 组无依赖）
├── TASK-002: 项目生命周期 5 skills (init+phases, map, status, milestone-audit, milestone-complete)
├── TASK-003: 规范管理 4 skills (specs-setup, specs-add, specs-load, spec-generate+phases+templates)
├── TASK-004: 探索 3 skills (brainstorm, analyze, discuss)
├── TASK-005: 核心管线 3 skills (plan+phases, execute+phases, verify+phases) ★
├── TASK-006: 测试/调试 4 skills (test, debug, refactor, quick)
├── TASK-007: 文档+阶段 5 skills (sync, codebase-rebuild, codebase-refresh, phase-transition, phase-add)
└── TASK-008: Agent 指令 15 个 shared/agent-instructions/workflow-*.md
```

### 7.2 每个 Skill 的开发 Checklist

```
[ ] SKILL.md frontmatter (name, description, argument-hint, allowed-tools)
[ ] Auto Mode 定义 (--yes/-y 行为)
[ ] Usage 示例 (带 $ 前缀)
[ ] ASCII 管线图 (Overview section)
[ ] Data Flow 图 (数据流转)
[ ] Phase docs (复杂 skill 拆分到 phases/)
[ ] CSV Schema (如使用 spawn_agents_on_csv)
[ ] Agent 指令引用 (Ref shared/agent-instructions/...)
[ ] 输出目录结构 (产物写入路径)
[ ] 状态更新逻辑 (index.json / state.json 哪些字段)
[ ] 与 Claude 版对齐验证 (command + workflow 逻辑覆盖)
```

---

## 八、文件量估算

| 类别 | 文件数 | 说明 |
|------|--------|------|
| SKILL.md | 24 | 每 skill 一个入口 |
| Phase docs | ~15 | init(4) + plan(4) + execute(4) + verify(3) |
| spec-generate phases | 7 | 独立的 spec 生成管线 |
| spec-generate specs + templates | 7 | 规范 + 模板文件 |
| shared/schemas/ | 9 | JSON 模板 |
| shared/templates/ | 6 | MD 模板 |
| shared/csv-schemas/ | 3 | CSV 列定义 |
| shared/agent-instructions/ | 15 | Agent 指令模板 |
| README | 2 | 顶层 + spec-generate |
| **合计** | **~88 文件** | — |

---

## 九、开发启动建议

1. **TASK-001 先行**: 所有 shared/ 内容是前置依赖，JSON schema 决定所有 skill 的产物格式
2. **TASK-005 + TASK-008 同时启动**: 核心管线(plan/execute/verify) 和 agent 指令相互关联，建议同一开发者或紧密协作
3. **spec-generate 直接 fork**: ccw spec-generator 结构几乎 1:1 复用，仅调整产物路径（.workflow/task-specs/ vs .workflow/.spec/）和 ID 格式（TASK-* vs IMPL-*）
4. **渐进式集成**: Wave 2 完成后立即做端到端测试: init → plan → execute → verify → phase-transition
5. **Claude 版交叉验证**: 每个 TASK 完成后与 Claude 版对应产物做功能对比，确保逻辑覆盖一致
