# Maestro Hooks 系统指南

Maestro 的 Hook 系统为 Claude Code 提供自动化的上下文管理、规范注入和工作流感知能力。Hook 以子进程方式运行，通过 stdin/stdout JSON 协议与 Claude Code 交互。

## 目录

- [概览](#概览)
  - [工作空间感知](#工作空间感知)
- [Hook 清单](#hook-清单)
- [安装级别](#安装级别)
- [核心 Hook 详解](#核心-hook-详解)
  - [context-monitor — 上下文监控](#context-monitor--上下文监控)
  - [spec-injector — 规范自动注入](#spec-injector--规范自动注入)
  - [context-budget — 上下文预算](#context-budget--上下文预算)
  - [session-context — 会话上下文](#session-context--会话上下文)
  - [delegate-monitor — 委托监控](#delegate-monitor--委托监控)
  - [team-monitor — 团队监控](#team-monitor--团队监控)
  - [skill-context — Skill 感知上下文](#skill-context--skill-感知上下文)
  - [workflow-guard — 工作流守卫](#workflow-guard--工作流守卫)
- [状态转换记录](#状态转换记录transition-history)
- [Coordinator 插件](#coordinator-插件)
- [配置](#配置)
- [命令参考](#命令参考)
- [设计决策](#设计决策)

---

## 概览

### 架构

Maestro 的 Hook 分为两层：

1. **Claude Code Hooks**（子进程）：通过 `settings.json` 注册，Claude Code 在特定事件时调用 `maestro hooks run <name>`
2. **Coordinator Hooks**（进程内）：`maestro coordinate` 运行时的插件系统，通过 `WorkflowHookRegistry` 的事件钩子实现

### 工作原理

```
Claude Code 事件触发
        │
        ▼
maestro hooks run <name>
        │
        ├─ requiresWorkspace? ──→ resolveWorkspace(cwd)
        │     │                       │
        │     │  null (无 workspace)   │  found
        │     ▼                       ▼
        │  exit(0) 静默退出      继续执行
        │
        ▼
stdin → 读取 JSON → evaluator → stdout
        │                           │
        │  JSON { tool_name,        │  JSON { hookSpecificOutput: {
        │    tool_input, ... }      │    updatedInput / additionalContext } }
        │                           │
        ▼                           ▼
     读取上下文               返回处理结果
```

**协议**：
- 退出码 `0` = 允许操作继续
- 退出码 `2` = 阻止操作
- `PreToolUse` 可返回 `updatedInput`（重写工具参数）或 `additionalContext`（附加上下文）
- `PostToolUse` 可返回 `additionalContext`（附加上下文）

### 工作空间感知

Hook 系统具有**工作空间感知**能力。标记 `requiresWorkspace` 的 Hook 仅在检测到有效的 Maestro 工作空间时激活，否则静默退出（零开销）。

**工作空间检测**（`src/hooks/workspace.ts`）：

1. 从 `cwd` 向上遍历目录树（最多 10 层）
2. 查找 `.workflow/state.json` 文件
3. 验证 Maestro 指纹：`state.json` 必须包含 `version` 和 `phases_summary` 字段
4. 优先选择同时包含 `.git/` 的目录（项目根目录启发式）

**指纹验证防止误报**：其他工具也可能使用 `.workflow/` 目录名。只有包含 Maestro 特有字段的 `state.json` 才被识别为有效工作空间。

---

## Hook 清单

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `context-monitor` | PostToolUse | — | minimal | — | 监控上下文使用率，高使用率时注入警告 |
| `spec-injector` | PreToolUse | Agent | minimal | 必需 | 按 agent 类型自动注入项目规范 |
| `delegate-monitor` | PostToolUse | — | standard | — | 监控异步委托任务的完成状态 |
| `team-monitor` | PostToolUse | — | standard | — | 团队协作消息监控 |
| `telemetry` | PostToolUse | — | standard | — | 执行遥测数据采集 |
| `session-context` | Notification | — | standard | — | 会话启动时注入工作流状态 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用时注入工作流状态和产物树 |
| `workflow-guard` | PreToolUse | Bash\|Write\|Edit | full | 必需 | 保护关键文件和操作 |

> **Workspace 列**：标记「必需」的 Hook 在无 Maestro 工作空间时静默退出（`exit(0)`），不读取 stdin，零开销。其余 Hook 始终运行（不依赖工作流产物）。

---

## 安装级别

Hook 按**累积级别**安装，高级别包含所有低级别的 Hook：

| 级别 | 包含内容 | 适用场景 |
|------|---------|---------|
| `none` | 无 Hook | 完全手动控制 |
| `minimal` | Statusline + context-monitor + spec-injector | 日常开发，轻量监控 + 自动规范注入 |
| `standard` | + delegate/team/telemetry + session-context + skill-context | 团队协作，完整监控 + Skill 感知 |
| `full` | + workflow-guard | 严格工作流，文件保护 |

### 安装命令

```bash
# 安装指定级别
maestro hooks install --level minimal
maestro hooks install --level standard
maestro hooks install --level full

# 项目级安装（写入 .claude/settings.json）
maestro hooks install --level standard --project

# 查看当前状态
maestro hooks status

# 列出所有可用 Hook
maestro hooks list
```

---

## 核心 Hook 详解

### context-monitor — 上下文监控

**事件**: `PostToolUse` | **级别**: `minimal`

每次工具调用后，读取 statusline 写入的 bridge 文件（`/tmp/maestro-ctx-{session_id}.json`），当上下文使用率过高时注入警告。

**阈值**：

| 剩余上下文 | 级别 | 行为 |
|-----------|------|------|
| > 35% | 正常 | 不注入 |
| 25–35% | WARNING | 提示收尾当前任务 |
| < 25% | CRITICAL | 提示停止并通知用户 |

**防抖**：连续 5 次工具调用内不重复警告，严重度升级时立即触发。

**Bridge 文件格式**：
```json
{
  "session_id": "abc123",
  "remaining_percentage": 42,
  "used_pct": 58,
  "timestamp": 1712900000
}
```

---

### spec-injector — 规范自动注入

**事件**: `PreToolUse` (Agent) | **级别**: `minimal`

当 Claude Code 生成 `Agent` 工具调用时，根据 `subagent_type` 自动将对应的项目规范注入到 agent 的 prompt 中。使用 `updatedInput` 模式直接重写 prompt，确保 agent 必定看到规范内容。

**Agent 类型 → 规范分类映射**：

| Agent 类型 | 注入的规范分类 |
|-----------|--------------|
| `code-developer` | execution |
| `tdd-developer` | execution, test |
| `workflow-executor` | execution |
| `universal-executor` | execution |
| `test-fix-agent` | execution, test |
| `cli-lite-planning-agent` | planning |
| `action-planning-agent` | planning |
| `workflow-planner` | planning |
| `workflow-reviewer` | review |
| `debug-explore-agent` | debug |
| `workflow-debugger` | debug |
| `Explore` | exploration |

**工作流程**：

```
Agent 工具调用
    │
    ▼
读取 tool_input.subagent_type
    │
    ▼
查找 AGENT_SPEC_MAP[agentType]
    │  ↓ 无匹配 → 直接放行
    ▼
loadSpecs(projectPath, category)
    │
    ▼
evaluateContextBudget(content, sessionId)
    │  ↓ action=skip → 放行，不注入
    ▼
返回 updatedInput: { ...toolInput, prompt: specs + "\n\n---\n\n" + originalPrompt }
```

**关键设计**：
- 使用 `updatedInput`（命令式）而非 `additionalContext`（建议式）——确保规范内容出现在 agent prompt 最前面
- `learnings.md` 通过 spec-loader 自动包含（category=general 始终加载）
- 通过 context-budget 动态调整注入量，避免浪费上下文

**示例输出**：
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": {
      "subagent_type": "code-developer",
      "prompt": "# Coding Conventions\n...\n\n---\n\n<原始 prompt>"
    }
  }
}
```

---

### context-budget — 上下文预算

> 注意：context-budget 不是独立的 Hook，而是 spec-injector 内部集成的预算管理模块。

**4 级预算策略**：

| 剩余上下文 | 动作 | 策略 |
|-----------|------|------|
| > 50% | `full` | 注入全部规范内容 |
| 35–50% | `reduced` | Markdown 感知截断：保留标题 + 每节第一段 |
| 25–35% | `minimal` | 仅标题列表 + learnings |
| < 25% | `skip` | 不注入（上下文已紧张） |

**Markdown 截断算法**（`reduced` 级别）：

1. 保留所有标题行（`#` 至 `######`）
2. 保留每个标题后的第一段
3. 省略后续段落，插入 `[... N lines omitted]`
4. 保持 YAML frontmatter 完整
5. 默认最大 4096 字符

**headings-only 提取**（`minimal` 级别）：

仅提取所有标题行，输出 `# Project Specs (headings only — context limited)` 开头的精简内容。

---

### session-context — 会话上下文

**事件**: `Notification` | **级别**: `standard`

会话启动时注入轻量级工作流状态概览。**不注入完整规范内容**——完整规范由 spec-injector 按 agent 类型按需注入。

**注入内容（3 个部分）**：

1. **工作流状态**：读取 `.workflow/state.json`，展示当前 Phase、Step、Task、Status
2. **可用规范列表**：扫描 `.workflow/specs/` 目录，列出文件名（仅标题，不含内容）
3. **Git 上下文**：当前分支 + 最近一次提交

**示例输出**：
```
## Maestro Workflow State | Phase: 3.2 | Task: implement-auth | Status: in_progress

## Available Specs
- coding-conventions
- architecture-constraints
- quality-rules
(Auto-injected per agent type via spec-injector hook)

## Git | Branch: feat/auth | Last: abc1234 add login endpoint
```

---

### delegate-monitor — 委托监控

**事件**: `PostToolUse` | **级别**: `standard`

监控异步委托任务（通过 MCP 的 `delegate_message` 发起的后台任务）。读取 `/tmp/maestro-notify-{session_id}.json` 通知文件，将完成/失败状态注入到主会话上下文。

---

### team-monitor — 团队监控

**事件**: `PostToolUse` | **级别**: `standard`

团队协作模式下的消息监控。检查 activity log 中的新消息和同步状态。

---

### skill-context — Skill 感知上下文

**事件**: `UserPromptSubmit` | **级别**: `standard`

当用户输入工作流 Skill 调用（如 `/maestro-execute 2`、`/maestro-plan 1`）时，自动注入当前工作流状态、阶段产物文件树和前序阶段成果。

**支持的 Skill 模式**：

| 模式 | 示例 |
|------|------|
| `/maestro-execute {N}` | `/maestro-execute 2` |
| `/maestro-plan {N}` | `/maestro-plan 1` |
| `/maestro-verify {N}` | `/maestro-verify 3` |
| `/maestro-analyze {N}` | `/maestro-analyze 2` |
| `/maestro-phase-transition [N]` | `/maestro-phase-transition` |
| `/quality-review {N}` | `/quality-review 2` |
| `/quality-test {N}` | `/quality-test 1` |

**注入内容（3 部分）**：

**Section 1: 工作流状态摘要**
```
## Workflow Context for maestro-execute
Milestone: MVP | Phase: 2 (1/4 completed) | Status: phase_2_pending
Key decisions: 9 | Deferred items: 4
Last transition: phase MVP (2026-04-10T00:00:00Z)
```

**Section 2: 阶段产物文件树**
```
## Phase 2 Artifacts (.workflow/phases/02-kanban-gantt/)
index.json | plan.json | analysis.md
.task/ (9 tasks: 5 completed, 1 in_progress, 3 pending)
  TASK-001 ✓ | TASK-002 ✓ | TASK-003 → | TASK-004 … | ...
.summaries/ (5 files)
```

**Section 3: 前序阶段成果**
```
## Deferred Items (4 total, showing high/critical)
- [high] Missing auth flow → Add OAuth

## Verification Gaps (Phase 1)
- OAuth not implemented

## Prior Phase Learnings (Phase 1)
- [pattern] Schema isolation works well
```

**关键设计**：
- 使用 `additionalContext`（非 `updatedInput`）——不能改写用户 prompt，否则干扰 Skill 展开
- 非 Skill prompt 零开销（regex 不匹配立即返回 null）
- 与 `prompt-guard`（同为 UserPromptSubmit）互不干扰，输出叠加

---

### workflow-guard — 工作流守卫

**事件**: `PreToolUse` (Bash|Write|Edit) | **级别**: `full`

在 `Bash`、`Write`、`Edit` 操作前检查：
- 是否操作了受保护的文件
- 是否违反工作流阶段约束
- 退出码 `2` 可阻止危险操作

---

## Coordinator 插件

除了 Claude Code 的子进程 Hook 外，`maestro coordinate`（图协调器）提供进程内插件系统。

### SpecInjectionPlugin

**文件**: `src/hooks/plugins/spec-injection-plugin.ts`

在 Coordinator 执行图节点命令时，通过 `transformPrompt` 钩子自动注入规范。与 Claude Code 的 spec-injector 使用相同的 spec-loader 基础设施，但因无法获取 agent-type 信息，采用**关键词启发式推断**：

| 关键词模式 | 推断分类 |
|-----------|---------|
| review, audit, check quality | review |
| test, spec, coverage, assert | test |
| debug, diagnose, fix, error, bug | debug |
| plan, design, architect, decompose | planning |
| explore, discover, search, analyze | exploration |
| 其他（默认） | execution |

**注册方式**（`coordinate.ts`）：
```typescript
hookManager.applyPlugin(new SpecInjectionPlugin(workflowRoot));
```

---

## 配置

### Hook 开关

通过 `maestro hooks toggle` 可单独开关特定 Hook：

```bash
maestro hooks toggle spec-injector off   # 关闭规范注入
maestro hooks toggle spec-injector on    # 开启规范注入
```

开关状态存储在 Maestro 配置文件中，Hook 运行时检查。

### 自定义 Agent-Spec 映射

在 Maestro 配置中可覆盖默认的 agent 类型 → 规范分类映射：

```json
{
  "specInjection": {
    "mapping": {
      "my-custom-agent": {
        "categories": ["execution", "test"],
        "extras": []
      }
    },
    "maxContentLength": 8192
  }
}
```

| 字段 | 说明 |
|------|------|
| `mapping` | 覆盖/扩展 agent → category 映射 |
| `always` | 始终注入的额外文件路径列表 |
| `maxContentLength` | 截断前的最大字符数 |

自定义映射与默认映射**合并**，不会替换默认值。

### 项目规范文件

规范文件存放在 `.workflow/specs/` 目录，每个文件包含 YAML frontmatter 声明分类：

```markdown
---
title: Coding Conventions
category: execution
---

# Coding Conventions

- Use camelCase for variables
- Use PascalCase for classes
```

**可用分类**: `execution`, `planning`, `review`, `test`, `debug`, `exploration`, `general`

初始化规范：`maestro spec init` → 交互式生成 `.workflow/specs/` 目录和规范文件。

---

## 命令参考

```bash
# 安装 / 卸载
maestro hooks install --level <level>     # 安装 Hook（none|minimal|standard|full）
maestro hooks install --level standard --project  # 项目级安装

# 查看状态
maestro hooks status                       # 显示所有 Hook 安装状态和级别
maestro hooks list                         # 列出可用 Hook 及定义

# 开关
maestro hooks toggle <name> <on|off>       # 单独开关

# 手动运行（调试用）
maestro hooks run <name>                   # 手动运行 Hook，从 stdin 读取 JSON

# 示例：测试 spec-injector
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"code-developer","prompt":"test"}}' | maestro hooks run spec-injector
```

---

## 状态转换记录（Transition History）

阶段和里程碑转换时自动记录审计轨迹，存储在 `state.json` 的 `transition_history[]` 数组中。

### Schema

```json
{
  "transition_history": [
    {
      "type": "phase",
      "from_phase": 1,
      "to_phase": 2,
      "milestone": "MVP",
      "transitioned_at": "2026-04-12T10:30:00Z",
      "trigger": "phase-transition",
      "force": false,
      "snapshot": {
        "phases_completed": 1,
        "phases_total": 4,
        "deferred_count": 4,
        "verification_status": "gaps_found",
        "learnings_count": 10
      }
    }
  ]
}
```

### 记录时机

| 触发点 | type | trigger |
|--------|------|---------|
| `/maestro-phase-transition` 完成 | `phase` | `phase-transition` |
| `/maestro-milestone-complete` 完成 | `milestone` | `milestone-complete` |

### 工具函数

`src/tools/transition-recorder.ts` 提供可复用的纯函数：

```typescript
import { buildTransitionEntry, appendTransition } from '../tools/transition-recorder.js';

const entry = buildTransitionEntry({
  type: 'phase',
  fromPhase: 1, toPhase: 2,
  milestone: 'MVP',
  trigger: 'phase-transition',
  force: false,
  phasesCompleted: 1, phasesTotal: 4,
  deferredCount: 4, verificationStatus: 'gaps_found', learningsCount: 10,
});

appendTransition('.workflow/state.json', entry);
```

---

## 设计决策

1. **`updatedInput` 而非 `additionalContext`**：spec-injector 使用 `updatedInput` 直接重写 agent prompt，确保规范内容一定出现在 agent 的上下文中，而非建议式附加。

2. **Budget 集成到 spec-injector**：context-budget 不是独立 Hook，而是 spec-injector 内部模块。避免两个 PreToolUse Hook 串行执行增加延迟。

3. **spec-injector 在 minimal 级别**：这是最高价值的 Hook——每次 Agent 调用都受益于自动规范注入，省去手动 `maestro spec load` 步骤。

4. **声明式映射 + 配置覆盖**：`AGENT_SPEC_MAP` 硬编码合理默认值，`specInjection.mapping` 允许项目级自定义。

5. **session-context 仅提供概览**：会话启动时只注入状态 + 规范列表，不注入完整内容。完整规范由 spec-injector 按 agent 类型按需注入。

6. **skill-context 使用 `additionalContext`**：UserPromptSubmit hook 不能用 `updatedInput` 改写用户 prompt，否则会干扰 Skill 展开（`/maestro-execute 2` 需要保持原样才能被 Claude Code 识别为 Skill 调用）。

7. **Transition History 在工作流内联记录**：不使用 PostToolUse Hook 检测转换完成（低频事件、检测不可靠），而是直接在 `phase-transition.md` 和 `milestone-complete.md` 工作流步骤中记录。零额外开销、确定性执行。

8. **声明式 Workspace Gate**：Hook 定义中的 `requiresWorkspace: true` 标志实现统一的工作空间检测。Dispatcher（`maestro hooks run <name>`）在读取 stdin 前即完成检测——无 Maestro 工作空间则 `exit(0)` 静默退出。这避免了每个 Hook 各自判断 workspace 的分散逻辑，也避免了非工作流项目中的无谓进程开销。工作空间通过 Maestro 指纹（`state.json` 含 `version` + `phases_summary`）识别，防止与其他工具的 `.workflow/` 目录混淆。
