# Maestro Codex Hooks 集成设计

> **状态**: 设计文档（未实现）| Codex hooks 当前不支持 Windows，等官方支持后实施

为 OpenAI Codex CLI 设计与 Maestro hooks 系统对等的集成方案，使上下文管理、规范注入和工作流感知能力在 Codex 环境中运行。

## 目录

- [概览](#概览)
- [架构对比](#架构对比)
- [Hook 映射表](#hook-映射表)
- [Codex Hook 详细设计](#codex-hook-详细设计)
  - [SessionStart — 会话上下文](#sessionstart--会话上下文)
  - [SessionStart — 规范注入](#sessionstart--规范注入)
  - [UserPromptSubmit — Skill 感知上下文](#userpromptsubmit--skill-感知上下文)
  - [PreToolUse — Bash 防护](#pretooluse--bash-防护)
  - [PostToolUse — 上下文监控](#posttooluse--上下文监控)
  - [Stop — 任务续行（Codex 独有）](#stop--任务续行codex-独有)
- [hooks.json 配置模板](#hooksjson-配置模板)
- [安装命令设计](#安装命令设计)
- [实现路线图](#实现路线图)

---

## 概览

### 两个系统的架构差异

| 维度 | Claude Code | Codex |
|------|------------|-------|
| 配置文件 | `~/.claude/settings.json` | `~/.codex/hooks.json` |
| 特性开关 | 无需 | `config.toml` → `codex_hooks = true` |
| Hook 事件 | PreToolUse, PostToolUse, UserPromptSubmit, Notification | SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, **Stop** |
| PreToolUse 拦截范围 | 任意工具（Agent, Bash, Write, Edit...） | **仅 Bash** |
| PreToolUse 能力 | `updatedInput`（重写参数）+ `additionalContext` | 仅 `systemMessage` + `permissionDecision: deny` |
| PostToolUse 拦截范围 | 任意工具 | **仅 Bash** |
| SessionStart | 无（用 Notification 替代） | 原生支持 |
| Stop（续行） | 无 | 原生支持 — `decision: "block"` 续行 |
| matcher | 精确字符串 | 正则表达式 |
| 多 hook 执行 | 串行 | **并发**（一个 hook 不能阻止另一个执行） |
| Windows 支持 | 支持 | **暂不支持** |
| stdin 超时 | 无（阻塞读取） | 默认 600s，可配置 `timeout` |

### 核心限制

1. **PreToolUse/PostToolUse 仅拦截 Bash** — 无法拦截 Agent、Write、Edit 工具调用
2. **无 `updatedInput`** — 不能像 Claude Code 的 spec-injector 那样重写 Agent prompt
3. **Hooks 并发执行** — 不能通过一个 hook 阻止另一个
4. **Windows 不可用** — 官方标注 "temporarily disabled"

### 可复用基础

所有现有的 Maestro hook evaluator **纯函数可直接复用**：

| evaluator | 文件 | 复用方式 |
|-----------|------|---------|
| `evaluateSessionContext()` | `src/hooks/session-context.ts` | 直接调用，适配 stdin 字段 |
| `evaluateSkillContext()` | `src/hooks/skill-context.ts` | 直接调用，已兼容 `prompt` 字段 |
| `evaluateContext()` | `src/hooks/context-monitor.ts` | 直接调用 |
| `evaluateWorkflowGuard()` | `src/hooks/guards/workflow-guard.ts` | 直接调用 |
| `evaluateSpecInjection()` | `src/hooks/spec-injector.ts` | 改为 SessionStart 调用 |
| `resolveWorkspace()` | `src/hooks/workspace.ts` | 直接复用 |

---

## Hook 映射表

| Maestro Hook | Claude 事件 | Codex 事件 | 可行性 | 说明 |
|---|---|---|---|---|
| session-context | Notification | **SessionStart** | ✅ 完全支持 | 原生会话启动事件，比 Notification 更精准 |
| skill-context | UserPromptSubmit | **UserPromptSubmit** | ✅ 完全支持 | 字段名已兼容（`prompt` vs `user_prompt`） |
| spec-injector | PreToolUse(Agent) | **SessionStart** | ⚠️ 替代方案 | 通过 additionalContext 注入规范摘要 |
| context-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ 部分支持 | 仅 Bash 命令后触发 |
| workflow-guard | PreToolUse(Bash\|Write\|Edit) | PreToolUse(Bash) | ⚠️ 部分支持 | 仅防护 Bash 命令 |
| delegate-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ 部分支持 | — |
| team-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ 部分支持 | — |
| *(新增)* task-continue | — | **Stop** | ✅ Codex 独有 | 检测未完成任务自动续行 |
| telemetry | PostToolUse(all) | PostToolUse(Bash) | ⚠️ 部分支持 | — |

---

## Codex Hook 详细设计

### SessionStart — 会话上下文

**Codex 事件**: `SessionStart` | **matcher**: `startup|resume`

复用现有 `evaluateSessionContext()`，注入轻量级工作流状态概览。

#### stdin 协议

```json
{
  "session_id": "abc123",
  "source": "startup",
  "cwd": "/path/to/project",
  "hook_event_name": "SessionStart",
  "model": "gpt-5.1-codex",
  "transcript_path": null
}
```

#### stdout 输出

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## Maestro Workflow State | Phase: 2.1 | Status: in_progress\n..."
  }
}
```

#### 实现要点

```
SessionStart 事件
    │
    ▼
resolveWorkspace({ cwd }) ──→ null → exit(0) 静默
    │
    ▼
evaluateSessionContext({ cwd, source })
    │  读取 .workflow/state.json
    │  读取 .workflow/specs/ 目录
    │  读取 git 分支信息
    ▼
输出 additionalContext
```

#### 与 Claude Code 版差异

| 项 | Claude Code | Codex |
|----|------------|-------|
| 触发时机 | `Notification` 事件 | `SessionStart` 事件 |
| matcher | 无 | `startup\|resume` |
| source 字段 | 无 | 有（区分首次启动/恢复会话） |
| 输出字段 | `additionalContext` | `additionalContext`（相同） |

#### 代码改动

- `SessionContextInput` 接口增加 `source?: string`
- `evaluateSessionContext()` 内部使用 `source` 区分首次/恢复行为
- Codex 恢复会话时可跳过已注入的内容

---

### SessionStart — 规范注入

**Codex 事件**: `SessionStart` | **matcher**: `startup`

这是 spec-injector 的替代方案。在 Claude Code 中，spec-injector 通过 PreToolUse(Agent) 的 `updatedInput` 重写 Agent prompt。Codex 不支持此能力，改为 SessionStart 时注入规范摘要。

#### 注入策略

```
SessionStart(source=startup)
    │
    ├─ resolveWorkspace(cwd)
    │     │  null → 跳过
    │     ▼
    ├─ loadSpecs(projectPath, category='general')
    │     │  读取 .workflow/specs/*.md
    │     ▼
    ├─ evaluateContextBudget(content, sessionId)
    │     │  > 50% → full
    │     │  35-50% → reduced（Markdown 截断）
    │     │  25-35% → minimal（标题列表）
    │     │  < 25% → skip
    │     ▼
    └─ additionalContext: 规范内容
```

#### 输出示例

**full 模式**:
```
## Maestro Project Specs

### Coding Conventions
- Use camelCase for variables
- Use PascalCase for classes
- ...

### Architecture Constraints
- Follow hexagonal architecture
- ...

(Auto-loaded at session start. Per-category specs available in .workflow/specs/)
```

**minimal 模式**:
```
## Maestro Project Specs (headings only — context limited)
- Coding Conventions
- Architecture Constraints
- Quality Rules
- Learnings
(Specs available in .workflow/specs/ for manual review)
```

#### 与 Claude Code spec-injector 差异

| 维度 | Claude Code spec-injector | Codex SessionStart spec |
|------|--------------------------|------------------------|
| 注入方式 | `updatedInput` 重写 Agent prompt | `additionalContext` 追加到 developer context |
| 精细度 | 按 agent 类型选择 spec category | 全量注入（不区分 agent） |
| 注入时机 | 每次 Agent 工具调用前 | 仅会话启动时 |
| 可靠性 | 命令式（必定出现） | 建议式（Codex 可忽略） |
| 上下文开销 | 每次调用评估 budget | 一次性评估 |

#### 设计决策

- **为何不用 AGENTS.md 注入**: 避免文件副作用。SessionStart additionalContext 是无状态的，不修改项目文件。
- **为何不做精细分类**: Codex 不暴露 agent 类型信息，无法像 Claude Code 那样按 subagent_type 选择 spec category。统一注入 `general` 类别。
- **恢复会话时**: `source=resume` 时跳过（已在上次启动时注入，Codex 会话历史中已有）。

---

### UserPromptSubmit — Skill 感知上下文

**Codex 事件**: `UserPromptSubmit` | **matcher**: 无（匹配所有）

#### stdin 协议

```json
{
  "session_id": "abc123",
  "turn_id": "turn-001",
  "prompt": "/maestro-execute 2",
  "cwd": "/path/to/project",
  "hook_event_name": "UserPromptSubmit",
  "model": "gpt-5.1-codex"
}
```

#### stdout 输出

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Workflow Context for maestro-execute\nMilestone: MVP | Phase: 2 (1/4 completed)\n..."
  }
}
```

#### 兼容性

**现有代码已兼容** — `skill-context.ts` 中：
```typescript
const prompt: string = data.user_prompt ?? data.prompt ?? '';
```
Codex 使用 `prompt` 字段，Claude Code 使用 `user_prompt`，fallback 已处理。

#### 需要适配的 Codex Skill 模式

Codex skill 调用格式与 Claude Code 不同。需要扩展 `parseSkillInvocation()`:

```typescript
// Claude Code 格式
/maestro-execute 2
/maestro-plan 1

// Codex 格式（skill 名称相同，调用方式不同）
maestro-execute 2
maestro-plan 1
```

扩展正则以同时匹配两种前缀格式（`/maestro-*` 和 `maestro-*`）。

---

### PreToolUse — Bash 防护

**Codex 事件**: `PreToolUse` | **matcher**: `Bash`

复用现有 `evaluateWorkflowGuard()`，仅拦截 Bash 命令。

#### stdin 协议

```json
{
  "session_id": "abc123",
  "turn_id": "turn-001",
  "tool_name": "Bash",
  "tool_use_id": "call-001",
  "tool_input": {
    "command": "rm -rf node_modules"
  },
  "cwd": "/path/to/project"
}
```

#### stdout 输出（阻止命令）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by workflow guard: destructive command"
  }
}
```

或使用旧格式（Codex 兼容）：
```json
{
  "decision": "block",
  "reason": "Blocked by workflow guard: destructive command"
}
```

#### 与 Claude Code 版差异

| 维度 | Claude Code | Codex |
|------|------------|-------|
| 拦截范围 | Bash + Write + Edit | **仅 Bash** |
| 阻止方式 | exit(2) | `permissionDecision: "deny"` 或 `decision: "block"` |
| 文件保护 | 可拦截 Write/Edit | **无法保护** — Codex 不暴露文件操作工具 |

#### 已有代码兼容性

`src/commands/hooks.ts` 中 workflow-guard runner：
```typescript
const toolInput: string = typeof data.tool_input === 'string'
  ? data.tool_input
  : typeof data.tool_input?.command === 'string'
    ? data.tool_input.command
    : JSON.stringify(data.tool_input ?? '');
```
Codex 的 `tool_input.command` 格式已被正确处理。

---

### PostToolUse — 上下文监控

**Codex 事件**: `PostToolUse` | **matcher**: `Bash`

复用现有 `evaluateContext()`。由于 Codex 仅在 Bash 命令后触发，监控覆盖率低于 Claude Code 版。

#### stdin 协议

```json
{
  "session_id": "abc123",
  "turn_id": "turn-001",
  "tool_name": "Bash",
  "tool_use_id": "call-001",
  "tool_input": {
    "command": "npm test"
  },
  "tool_response": "{\"exit_code\":0,\"output\":\"...\"}",
  "cwd": "/path/to/project"
}
```

#### 输出

与 Claude Code 版相同 — 读取 bridge 文件，高使用率时注入警告。

#### 差异

| 维度 | Claude Code | Codex |
|------|------------|-------|
| 触发频率 | 每次工具调用后 | 仅 Bash 命令后 |
| 覆盖率 | 高（Agent, Write, Edit, Bash...） | 低（仅 Bash） |

---

### Stop — 任务续行（Codex 独有）

**Codex 事件**: `Stop` | **matcher**: 无

这是 Claude Code 没有的独有能力。当 Codex 认为任务完成准备停止时，检查是否有未完成的工作流任务，如有则自动续行。

#### stdin 协议

```json
{
  "session_id": "abc123",
  "turn_id": "turn-005",
  "stop_hook_active": false,
  "last_assistant_message": "I've completed implementing the user authentication module.",
  "cwd": "/path/to/project",
  "hook_event_name": "Stop",
  "model": "gpt-5.1-codex"
}
```

#### stdout 输出（续行）

```json
{
  "decision": "block",
  "reason": "Workflow Phase 2 has 3 pending tasks (TASK-004, TASK-005, TASK-006). Continue with next task: implement-login-page."
}
```

#### 设计逻辑

```
Stop 事件
    │
    ▼
resolveWorkspace({ cwd }) ──→ null → 不输出（正常停止）
    │
    ▼
读取 state.json → 当前 phase
    │
    ▼
读取 phases/{NN}-{slug}/index.json
    │
    ├─ 无未完成任务 → 不输出（正常停止）
    │
    ├─ 有 pending/in_progress 任务
    │     ├─ stop_hook_active=true → 不输出（防止无限续行）
    │     └─ 构建续行原因 → decision: "block"
    │
    └─ Phase 已完成但下一个 Phase pending
          └─ 构建 phase transition 建议 → decision: "block"
```

#### 防止无限续行

1. **`stop_hook_active` 检查**: Codex 标记是否已由 Stop hook 续行过
2. **最大续行次数**: 维护 `/tmp/maestro-continue-{session_id}.json` 计数器，超过 5 次停止续行
3. **任务粒度**: 每次续行指向具体下一个任务，避免模糊的"继续"

#### 续行原因模板

```
// 有待执行任务
"Workflow Phase {N} has {count} pending tasks. Continue with next task: {task_title}."

// 有进行中任务
"Task {task_id} ({task_title}) is still in_progress. Continue to complete it."

// 阶段转换
"Phase {N} completed. Phase {N+1} has {count} tasks pending. Run /maestro-phase-transition first."
```

---

## hooks.json 配置模板

### minimal 级别

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run session-context",
            "statusMessage": "Loading workflow context"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run context-monitor"
          }
        ]
      }
    ]
  }
}
```

### standard 级别

在 minimal 基础上增加：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run spec-injector",
            "statusMessage": "Loading project specs"
          }
        ]
      },
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run session-context",
            "statusMessage": "Loading workflow context"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run context-monitor"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run skill-context"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "maestro hooks run task-continue",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### full 级别

在 standard 基础上增加：

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "maestro hooks run workflow-guard",
          "statusMessage": "Checking command safety"
        }
      ]
    }
  ]
}
```

### 注意事项

- **SessionStart spec-injector 的 matcher 是 `startup`（不含 `resume`）** — 恢复会话时跳过规范注入
- **SessionStart session-context 的 matcher 是 `startup|resume`** — 两种场景都注入工作流状态
- **Stop 的 timeout 设为 10s** — 任务续行决策应该是轻量级操作
- **多个 hooks.json 文件** — 全局 `~/.codex/hooks.json` + 项目 `.codex/hooks.json` 并存，所有匹配 hook 并发执行

---

## 安装命令设计

### 命令扩展

```bash
# 安装到 Codex（全局）
maestro hooks install --target codex --level standard

# 安装到 Codex（项目级）
maestro hooks install --target codex --level standard --project

# 查看状态（含 Codex）
maestro hooks status

# 卸载 Codex hooks
maestro hooks uninstall --target codex

# 列出所有 hook（含 Codex 支持）
maestro hooks list
```

### `--target` 参数

| 值 | 安装位置 | 说明 |
|----|---------|------|
| `claude`（默认） | `~/.claude/settings.json` | 现有行为 |
| `codex` | `~/.codex/hooks.json` | Codex hook 集成 |

### 安装流程

```
maestro hooks install --target codex --level standard
    │
    ├─ 1. 检测操作系统
    │     └─ Windows → 打印警告 "Codex hooks 当前不支持 Windows"
    │
    ├─ 2. 检测 config.toml
    │     └─ 无 codex_hooks=true → 打印提示
    │        "请在 ~/.codex/config.toml 中添加:"
    │        "[features]"
    │        "codex_hooks = true"
    │
    ├─ 3. 生成 hooks.json
    │     ├─ 读取现有 hooks.json（如存在）
    │     ├─ 移除已有 maestro 标记的 hook
    │     ├─ 按 level 注册新 hook
    │     └─ 写入 hooks.json
    │
    └─ 4. 输出安装结果
          "Maestro hooks installed for Codex (level: standard):"
          "  SessionStart: session-context, spec-injector"
          "  PostToolUse[Bash]: context-monitor"
          "  UserPromptSubmit: skill-context"
          "  Stop: task-continue"
          "  Config: ~/.codex/hooks.json"
```

### hooks.json 中的 maestro 标记

Codex hooks.json 不支持元数据字段，通过命令字符串中的 `maestro hooks run` 标识 maestro hook 条目。与 Claude Code 版的 `HOOK_MARKER = 'maestro'` 方式一致。

---

## 实现路线图

### 前置条件

1. **Codex hooks 支持 Windows** — 跟踪 [openai/codex](https://github.com/openai/codex) 进展
2. **PreToolUse 支持更多工具类型** — 当前仅 Bash，影响 workflow-guard 覆盖率
3. **PreToolUse 支持 `updatedInput`** — 目前仅支持 `permissionDecision`，影响 spec-injector 精细注入

### 实施步骤

#### Phase 1: 基础集成（无新代码，仅复用）

**改动文件**:
- `src/commands/hooks.ts` — 增加 `--target codex` 安装逻辑
- `bin/maestro-hook-runner.js` — 注册 Codex 适配的 hook runner

**复用**:
- `evaluateSessionContext()` — 直接调用
- `evaluateSkillContext()` — 直接调用（已兼容 prompt 字段）
- `evaluateContext()` — 直接调用
- `evaluateWorkflowGuard()` — 直接调用

**工作量**: ~200 行代码（主要是 hooks.json 生成器 + 安装/卸载逻辑）

#### Phase 2: Spec 注入适配

**改动文件**:
- `src/hooks/session-context.ts` — 扩展 SessionStart 时的规范注入

**改动**:
- `evaluateSessionContext()` 增加 `source` 参数
- `source=startup` 时注入规范摘要（调用 `evaluateSpecInjection` 的底层 spec-loader）
- `source=resume` 时仅注入工作流状态（跳过规范）

**工作量**: ~100 行代码

#### Phase 3: task-continue Hook

**新文件**:
- `src/hooks/task-continue.ts` — Stop 事件续行逻辑

**依赖**:
- `resolveWorkspace()`
- `state.json` + `index.json` 读取逻辑

**工作量**: ~150 行代码

#### Phase 4: 测试 + 文档

- 端到端测试：init → plan → execute → verify，验证 hook 注入正确
- 更新 `guide/hooks-guide.md` 添加 Codex 章节
- 更新 README 添加 Codex 集成说明

---

## 设计决策记录

1. **SessionStart additionalContext 而非 AGENTS.md** — 无状态注入，不修改项目文件。AGENTS.md 方案有文件副作用，且与用户手写内容可能冲突。

2. **spec-injector 在 SessionStart 而非 PreToolUse** — Codex PreToolUse 仅支持 Bash，不支持 Agent 工具拦截。SessionStart 是唯一的规范注入时机。

3. **source=startup 注入规范，source=resume 跳过** — 恢复会话时上下文中已有上次注入的规范内容，重复注入浪费 context。

4. **task-continue 使用 `stop_hook_active` 防无限循环** — Codex 原生提供此字段，当 hook 已触发续行后标记为 true，是天然的防护机制。

5. **所有 evaluator 纯函数直接复用** — 避免为 Codex 维护一套独立的 evaluator。stdin 字段差异在 hook runner 层适配。

6. **hooks.json 生成而非手动维护** — 与 Claude Code 版的 `installHooksByLevel()` 对齐，确保配置一致且可升级。
