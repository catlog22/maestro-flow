---
name: maestro-help
description: "Maestro Flow command help system — search, browse, recommend commands, skills, agents, CLI tools, and workflows"
argument-hint: "[search <keyword>|workflow|skills|agents|cli|新手|下一步|<command-name>]"
allowed-tools: Read, Grep, Glob, request_user_input
---

<purpose>
Maestro Flow 帮助系统。根据用户查询提供命令搜索、技能浏览、工作流推荐、CLI 参考和新手引导。

支持 7 种操作模式：
1. **Command Search** — 搜索命令名、描述、分类
2. **Command Documentation** — 读取命令源文件，提供详细用法
3. **Smart Recommendations** — 根据项目状态推荐下一步命令
4. **Workflow Guide** — 根据任务类型推荐工作流和命令序列
5. **Beginner Onboarding** — 展示核心命令和入门路径
6. **Skill & Agent Browsing** — 浏览 Skill 和 Agent 目录
7. **CLI Reference** — 终端命令参考
</purpose>

<context>

## Mode Routing

$ARGUMENTS 为空 → Mode 5 (Beginner Onboarding)
$ARGUMENTS 匹配关键词 → 路由到对应模式：

| 关键词 | Mode | 说明 |
|--------|------|------|
| "search", "搜索", "查找" | 1 | Command Search |
| 命令名 (如 "analyze", "plan") | 2 | Documentation |
| "下一步", "next", "推荐", "继续" | 3 | Smart Recommendations |
| "工作流", "workflow", "流程", "管线" | 4 | Workflow Guide |
| "新手", "入门", "getting started" | 5 | Beginner Onboarding |
| "skill", "agent", "技能" | 6 | Skill & Agent Browsing |
| "cli", "终端", "terminal" | 7 | CLI Reference |
| 其他自由文本 | 1 | Fuzzy Search |

**Output boundary**: This skill is read-only — it MUST NOT write any files. All output is displayed directly to the user via text response.

## Data Source

读取同目录下的 `catalog.json` 作为唯一数据源：

| 字段 | 内容 |
|------|------|
| `commands[]` | 56 个 slash 命令（name, command, category, description, source） |
| `skills[]` | 10 个 Skill（name, category, description, source） |
| `agents[]` | 22 个 Agent（name, category, description） |
| `cli_commands[]` | 21 个终端命令（command, description, category） |
| `guide_files[]` | 17 个 Guide 文档索引 |
| `essential_commands[]` | 10 个核心命令 |
| `workflows` | 拓扑 + 6 条合法路径 (Path A-F) + 3 个辅助流程 |

## Project State Detection

Mode 3 (Smart Recommendations) 需要检测项目状态：
1. 检查 `.workflow/state.json` 是否存在
2. 读取 currentMilestone, currentPhase, phaseStatus
3. 根据状态映射到推荐命令

</context>

<invariants>
1. **Catalog First** — 先查 catalog.json，再按需读 source 文件
2. **Guide 链接** — 深层问题引用 guide/ 文档，告知用户具体文件名
3. **不执行命令** — 本 skill 只提供信息和推荐，不执行 maestro 命令
4. **精确匹配** — 搜索支持命令名（不含前缀）、分类名、关键词模糊匹配
5. **上下文感知** — 检查 .workflow/ 状态调整推荐
</invariants>

<execution>

### Mode 1: Command Search

1. 读取 `catalog.json` 的 `commands[]` + `cli_commands[]`
2. 按 name、description、category 过滤，匹配 $ARGUMENTS 中的搜索词
3. 按 relevance 排序：exact match > starts with > contains
4. 展示 top 5 结果：

```
找到 N 个匹配命令：

$maestro-analyze — 多维度分析
  分类: pipeline | 查看详情 →

$maestro-plan — 任务规划
  分类: pipeline | 查看详情 →
...
```

### Mode 2: Command Documentation

1. 在 `catalog.json` commands[] 中定位命令
2. 通过 `source` 路径读取命令源文件（如 `../../commands$maestro-analyze.md`）
3. 提取 `<purpose>`、`argument-hint`、`<context>` 中的用法示例
4. 如有对应 guide 文档，读取相关段落

Guide 映射：
- analyze/plan/execute → `guide/command-usage-guide.md`
- init/roadmap/blueprint → `guide/quick-start-guide.md`
- ralph → `guide/maestro-ralph-guide.md`
- maestro (协调器) → `guide/maestro-coordinator-guide.md`
- delegate → `guide/delegate-async-guide.md`
- overlay/amend → `guide/overlay-guide.md`

### Mode 3: Smart Recommendations

检测项目状态 → 推荐下一步命令：

| 当前状态 | 推荐命令 | 原因 |
|---------|---------|------|
| 无 .workflow/ | `$maestro-init` | 项目未初始化 |
| init 完成，无上游 context | `$maestro-brainstorm` 或 `$maestro-analyze "topic"` | 先探索再规划；brainstorm 发散，analyze 宏观探索影响面 |
| analyze 完成，scope_verdict=large | `$maestro-roadmap --from analyze:ANL-xxx` | 大范围需求，需要 Milestone > Phase 分解 |
| analyze 完成，scope_verdict=medium/small | `$maestro-plan --from analyze:ANL-xxx` | 跳过 roadmap 直达规划（Path C） |
| roadmap 完成，phase=pending | `$maestro-analyze 1` | 微观分析：Phase 级深入探索 |
| analyze (微观) 完成 | `$maestro-plan 1` | Phase 级规划 |
| plan 完成 | `$maestro-execute` | 开始执行 |
| execute 完成 | `$quality-review` | 进入质量管线 |
| quality 全通过 | `$maestro-milestone-audit` | 里程碑审计 |
| 所有 Phase 完成 | `$maestro-milestone-complete` | 关闭里程碑 |

### Mode 4: Workflow Guide

根据任务类型推荐工作流和命令序列：

**Path A — 完整新项目**:
- `brainstorm` → `blueprint`(可选) → `analyze "topic"`(宏观) → `roadmap` → `analyze 1`(微观) → `plan 1` → `execute` → `quality-review`

**Path B — 旧项目大功能**:
- `analyze "feature X"`(宏观) → `roadmap` → `analyze 1`(微观) → `plan 1` → `execute` → `quality-review`

**Path C — 中等功能（跳过 roadmap）**:
- `analyze "feature X"` → `plan --from analyze:ANL-xxx` → `execute` → `quality-review`

**Path D — 小改动**:
- `plan "fix auth bug"` → `execute` → `quality-review`
- 快速: `$maestro-quick "功能描述"`
- 全自动: `/maestro -y "功能描述"`

**Path E/F — 纯文档/纯探索**:
- `blueprint "project idea"` → (供人阅读)
- `brainstorm "idea"` → (供人决策)

**Bug 修复**:
- 快速: `$maestro-quick "Bug 描述"`
- Issue 闭环: discover → create → analyze --gaps → plan --gaps → execute → close

**代码审查**:
- `$quality-review` → `$quality-auto-test` → `$quality-test`
- 失败循环: `$quality-debug` → `$maestro-plan --gaps` → `$maestro-execute`

### Mode 5: Beginner Onboarding

从 `catalog.json essential_commands[]` 读取核心命令：

| 命令 | 用途 | 何时使用 |
|------|------|---------|
| `$maestro` | 智能协调器 | 不确定用哪个命令时 |
| `$maestro-init` | 初始化项目 | 首次使用 |
| `$maestro-brainstorm` | 头脑风暴 | 新项目发散探索、多角色创意 |
| `$maestro-blueprint` | 规格文档化 | 正式 7-phase 收敛规格链 |
| `$maestro-analyze` | 双层分析 | 宏观: `"topic"` 探索影响面；微观: `1` Phase 级深入 |
| `$maestro-roadmap` | 路线图编排 | scope_verdict=large 时，Milestone > Phase 分解 |
| `$maestro-plan` | 规划 | 分析完成后，支持 `--from analyze:ANL-xxx` 直达 |
| `$maestro-execute` | 执行 | 计划完成后 |
| `$maestro-quick` | 快速任务 | 简单任务跳过管线 |

快速上手路径：
1. `maestro install --force`
2. `$maestro-init`
3. `$maestro "任务描述"` — 自动选择最佳工作流

### Mode 6: Skill & Agent Browsing

**Skills** — 从 `catalog.json` skills[] 读取，按分类展示：

- **Meta (2)**: workflow-skill-designer, skill-iter-tune
- **Team (6)**: team-coordinate, team-executor, team-lifecycle-v4, team-quality-assurance, team-review, team-tech-debt, team-testing
- **Knowledge (1)**: codify-to-knowhow

**Agents** — 从 `catalog.json` agents[] 读取，按分类展示：

- **Workflow (15)**: analyzer, planner, executor, verifier, reviewer, debugger, research-agent, roadmapper, plan-checker, phase-researcher, project-researcher, research-synthesizer, codebase-mapper, nyquist-auditor, integration-checker, external-researcher, collab-planner
- **Team (2)**: supervisor, worker
- **Brainstorm (2)**: role-design-author, cross-role-reviewer
- **CLI (1)**: cli-explore-agent
- **UI (1)**: ui-design-agent

### Mode 7: CLI Reference

从 `catalog.json` cli_commands[] 读取，按分类展示：

| 分类 | 命令 |
|------|------|
| Setup | install, uninstall, update, launcher |
| Dashboard | view, stop |
| Execution | delegate, coordinate (coord), cli, run, serve |
| Knowledge | spec, wiki, knowhow (kh) |
| Config | hooks, overlay, ext, tool |
| Team | collab (team), agent-msg (msg) |
| Visualization | brainstorm-visualize (bv) |

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | catalog.json 读取失败 | 回退到 Glob 扫描 .claude/commands/*.md |
| W001 | warning | 搜索无结果 | 模糊匹配最近命令，建议查看全部 |
| W002 | warning | Source 文件不存在 | 仅展示 catalog 描述 |
| W003 | warning | 项目未初始化 | 推荐先运行 $maestro-init |
</error_codes>

<success_criteria>
- [ ] 正确路由到对应操作模式
- [ ] 搜索结果包含命令名、描述、分类
- [ ] 文档模式展示了命令源文件的关键内容
- [ ] 推荐模式基于项目状态提供了合理的下一步建议
- [ ] 工作流推荐包含具体命令序列
</success_criteria>
