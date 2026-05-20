---
title: "Maestro Codex Hooks 集成设计"
---

> **状态**: v0.4.2 已实现基础集成 | Windows 暂不支持 Codex hooks

为 OpenAI Codex CLI 实现与 Maestro hooks 系统对等的集成方案。

## 目录

- [概览](#概览)
- [Hook 映射表](#hook-映射表)
- [Hook 详细设计](#hook-详细设计)
- [hooks.json 配置](#hooksjson-配置)
- [安装命令](#安装命令)
- [实现路线图](#实现路线图)

---

## 概览

### 架构对比

| 维度 | Claude Code | Codex |
|------|------------|-------|
| 配置 | `~/.claude/settings.json` | `~/.codex/hooks.json` |
| 特性开关 | 无需 | `config.toml` → `codex_hooks = true` |
| 事件 | Pre/PostToolUse, UserPromptSubmit, Notification | SessionStart, Pre/PostToolUse, UserPromptSubmit, **Stop** |
| PreToolUse 范围 | 任意工具 | **仅 Bash** |
| PreToolUse 能力 | `updatedInput` + `additionalContext` | `systemMessage` + `permissionDecision: deny` |
| SessionStart | 无（用 Notification） | 原生 |
| Stop（续行） | 无 | 原生 `decision: "block"` |
| matcher | 精确字符串 | 正则 |
| 多 hook | 串行 | **并发** |
| Windows | 支持 | **不支持** |

### 核心限制

PreToolUse/PostToolUse **仅 Bash** | 无 `updatedInput` | Hooks 并发执行 | Windows 不可用

### 可复用 Evaluator

| evaluator | 复用方式 |
|-----------|---------|
| `evaluateSessionContext()` | 直接调用，适配 stdin |
| `evaluateSkillContext()` | 已兼容 `prompt` 字段 |
| `evaluateContext()` | 直接调用 |
| `evaluateWorkflowGuard()` | 直接调用 |
| `evaluateSpecInjection()` | 改为 SessionStart |
| `resolveWorkspace()` | 直接复用 |

---

## Hook 映射表

| Maestro Hook | Claude 事件 | Codex 事件 | 状态 | 说明 |
|---|---|---|---|---|
| session-context | Notification | **SessionStart** | ✅ | 原生会话启动 |
| skill-context | UserPromptSubmit | **UserPromptSubmit** | ✅ | 字段已兼容 |
| spec-injector | PreToolUse(Agent) | **SessionStart** | ⚠️ | additionalContext 注入 |
| context-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | 仅 Bash |
| workflow-guard | PreToolUse(Bash\|Write\|Edit) | PreToolUse(Bash) | ⚠️ | 仅 Bash |
| delegate/team-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | 仅 Bash |
| *(新增)* task-continue | — | **Stop** | ✅ | Codex 独有 |
| telemetry | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | 仅 Bash |

---

## Hook 详细设计

### SessionStart — 会话上下文

**matcher**: `startup|resume` | 复用 `evaluateSessionContext()`

<details>
<summary>stdin/stdout 示例</summary>

**stdin**:
```json
{ "session_id": "abc123", "source": "startup", "cwd": "/path/to/project",
  "hook_event_name": "SessionStart", "model": "gpt-5.1-codex", "transcript_path": null }
```

**stdout**:
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart",
  "additionalContext": "## Maestro Workflow State | Phase: 2.1 | Status: in_progress\n..." } }
```
</details>

```
SessionStart → resolveWorkspace({ cwd }) → null → exit(0)
                   ▼
             evaluateSessionContext({ cwd, source }) → additionalContext
```

**差异**: Claude Code 用 `Notification` 触发，Codex 用 `SessionStart`；新增 `source` 区分首次/恢复。

---

### SessionStart — 规范注入

**matcher**: `startup` | spec-injector 替代方案（Codex 无 `updatedInput`）

```
SessionStart(source=startup)
    ├─ resolveWorkspace(cwd) → null → 跳过
    ├─ loadSpecs(projectPath, category='learning')
    ├─ evaluateContextBudget(): >50%→full | 35-50%→reduced | 25-35%→minimal | <25%→skip
    └─ additionalContext: 规范内容
```

| 维度 | Claude Code spec-injector | Codex SessionStart |
|------|--------------------------|-------------------|
| 注入方式 | `updatedInput` 重写 prompt | `additionalContext` 追加 |
| 精细度 | 按 agent 类型 | 全量 |
| 时机 | 每次 Agent 调用前 | 仅会话启动 |
| 可靠性 | 命令式 | 建议式 |

不用 AGENTS.md（文件副作用）；`source=resume` 跳过（避免重复）；无精细分类（Codex 不暴露 agent 类型）。

---

### UserPromptSubmit — Skill 感知上下文

**matcher**: 无（匹配所有）

<details>
<summary>stdin/stdout 示例</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-001", "prompt": "/maestro-execute 2",
  "cwd": "/path/to/project", "hook_event_name": "UserPromptSubmit", "model": "gpt-5.1-codex" }
```

**stdout**:
```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
  "additionalContext": "## Workflow Context for maestro-execute\nMilestone: MVP | Phase: 2 (1/4 completed)\n..." } }
```
</details>

已兼容 — `data.user_prompt ?? data.prompt`。需扩展 `parseSkillInvocation()` 同时匹配 `/maestro-*` 和 `maestro-*`。

---

### PreToolUse — Bash 防护

**matcher**: `Bash` | 复用 `evaluateWorkflowGuard()`

<details>
<summary>stdin/stdout 示例</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-001", "tool_name": "Bash",
  "tool_use_id": "call-001", "tool_input": { "command": "rm -rf node_modules" },
  "cwd": "/path/to/project" }
```

**stdout（阻止）**:
```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "Blocked by workflow guard: destructive command" } }
```
或旧格式: `{ "decision": "block", "reason": "..." }`
</details>

| 维度 | Claude Code | Codex |
|------|------------|-------|
| 范围 | Bash + Write + Edit | **仅 Bash** |
| 阻止 | exit(2) | `permissionDecision: "deny"` |

---

### PostToolUse — 上下文监控

**matcher**: `Bash` | 复用 `evaluateContext()`

<details>
<summary>stdin 示例</summary>

```json
{ "session_id": "abc123", "turn_id": "turn-001", "tool_name": "Bash",
  "tool_use_id": "call-001", "tool_input": { "command": "npm test" },
  "tool_response": "{\"exit_code\":0,\"output\":\"...\"}", "cwd": "/path/to/project" }
```
</details>

与 Claude Code 版相同。覆盖率: 高 → 低（仅 Bash）。

---

### Stop — 任务续行（Codex 独有）

**matcher**: 无 | Codex 准备停止时检查未完成任务

<details>
<summary>stdin/stdout 示例</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-005", "stop_hook_active": false,
  "last_assistant_message": "I've completed implementing the user authentication module.",
  "cwd": "/path/to/project", "hook_event_name": "Stop", "model": "gpt-5.1-codex" }
```

**stdout（续行）**:
```json
{ "decision": "block",
  "reason": "Workflow Phase 2 has 3 pending tasks (TASK-004, TASK-005, TASK-006). Continue with next task: implement-login-page." }
```
</details>

```
Stop → resolveWorkspace → null → 正常停止
           ▼
       state.json → phases/{NN}/index.json
           ├─ 无未完成 → 正常停止
           ├─ pending 任务 + stop_hook_active=false → decision: "block"
           └─ Phase 完成 → phase transition 建议
```

**防无限续行**: (1) `stop_hook_active` 检查 (2) 计数器上限 5 次 (3) 指向具体下一个任务

---

## hooks.json 配置

### minimal

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume",
        "hooks": [{ "type": "command", "command": "maestro hooks run session-context", "statusMessage": "Loading workflow context" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "maestro hooks run context-monitor" }] }
    ]
  }
}
```

### standard（minimal + 以下）

```json
{
  "SessionStart": [
    { "matcher": "startup",
      "hooks": [{ "type": "command", "command": "maestro hooks run spec-injector", "statusMessage": "Loading project specs" }] }
  ],
  "UserPromptSubmit": [
    { "hooks": [{ "type": "command", "command": "maestro hooks run skill-context" }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "maestro hooks run task-continue", "timeout": 10 }] }
  ]
}
```

### full（standard + 以下）

```json
{
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "maestro hooks run workflow-guard", "statusMessage": "Checking command safety" }] }
  ]
}
```

**注意**: spec-injector matcher 为 `startup`（不含 resume）；session-context matcher 为 `startup|resume`；Stop timeout 10s；全局 + 项目级 hooks.json 并发执行。

---

## 安装命令

```bash
maestro hooks install --target codex --level standard          # 全局
maestro hooks install --target codex --level standard --project # 项目级
maestro hooks status                                           # 状态
maestro hooks uninstall --target codex                         # 卸载
```

| `--target` | 安装位置 |
|-----------|---------|
| `claude` | `~/.claude/settings.json` |
| `codex` | `~/.codex/hooks.json` |

安装流程: 检测 OS → 检测 config.toml → 生成 hooks.json（去重/写入）→ 输出结果。通过 `maestro hooks run` 命令字符串标识 maestro 条目。

---

## 实现路线图

### 前置条件

1. ~~Windows 支持~~ — 待 Codex 支持
2. PreToolUse 更多工具类型 — 影响 workflow-guard
3. PreToolUse `updatedInput` — 影响 spec-injector

### 已完成

**Phase 1 ✅ (v0.4.2)** — `CODEX_HOOK_DEFS` + `installCodexHooksByLevel()` + `--target codex` + 幂等安装 + config.toml 检测 + Windows 警告

已安装: session-context, spec-injector, skill-context, keyword-spec-injector, delegate-monitor, coordinator-tracker, team-monitor, telemetry, workflow-guard

**Phase 2 ✅ (v0.4.2)** — TOML 读写 + MCP 注册/注销 + `--codex-hooks` / `--codex-mcp` 批量安装

### 待实现

**Phase 3** — `src/hooks/task-continue.ts`（Stop 续行逻辑）
**Phase 4** — 端到端测试 init → plan → execute → verify
