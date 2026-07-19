---
title: "Maestro Hooks 系统指南"
---

Maestro Hook 系统为 Claude Code、Codex 和 Agy (Antigravity) 提供自动化的上下文管理、规范注入和工作流感知能力。Hook 以子进程方式运行，通过 stdin/stdout JSON 协议与宿主环境交互。

## 目录

- [概览](#概览)
- [Hook 清单](#hook-清单)
- [安装级别](#安装级别)
- [核心 Hook 详解](#核心-hook-详解)
- [配置](#配置)
- [命令参考](#命令参考)

---

## 概览

### 架构

| 层 | 注册方式 | 运行方式 |
|----|---------|---------|
| Claude Code Hooks | `settings.json` | 子进程 `maestro hooks run <name>` |
| Codex Hooks | `hooks.json` | 子进程 `maestro hooks run <name>` |
| Agy (Antigravity) Hooks | `~/.gemini/config/hooks.json` | 子进程 `maestro hooks run <name>` |
| Coordinator Hooks | `WorkflowHookRegistry` | 进程内插件 |

### 协议

| 退出码 | 含义 |
|--------|------|
| `0` | 允许操作继续 |
| `2` | 阻止操作 |

| 事件类型 | 可返回 |
|---------|--------|
| `PreToolUse` | `updatedInput`（重写工具参数）/ `additionalContext` |
| `PostToolUse` | `additionalContext` |
| `Stop` | `decision: "block"`（无 `additionalContext`） |

### 工作空间感知

标记 `requiresWorkspace` 的 Hook 仅在检测到有效 Maestro 工作空间时激活（向上遍历查找含 `version` + `phases_summary` 指纹的 `.workflow/state.json`），否则 `exit(0)` 静默退出，零开销。

---

## Hook 清单

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `spec-injector` | PreToolUse | Agent | minimal | 必需 | 按 agent 类型自动注入项目规范 |
| `delegate-monitor` | PostToolUse | Bash\|Agent | standard | — | 监控异步委托任务完成状态 |
| `team-monitor` | Stop | — | standard | — | 团队协作心跳记录 |
| `telemetry` | Stop | — | standard | — | 执行遥测数据采集（每轮一次） |
| `session-context` | Notification | — | standard | — | 会话启动时注入工作流状态 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用时注入工作流状态和产物树 |
| `coordinator-tracker` | Stop | — | standard | 必需 | 协调器链执行进度追踪 |
| `preflight-guard` | PreToolUse | Bash\|Write\|Edit\|Agent | standard | — | 命令执行前预检守卫 |
| `spec-validator` | PreToolUse | Write | standard | — | 完整规范写入验证 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | — | 单次注入 keyword/spec/wiki/domain/KG 上下文 |
| `kg-sync` | UserPromptSubmit | — | standard | 必需 | 知识图谱增量同步（CooldownGuard 30s 去抖） |
| `kg-auto-init` | UserPromptSubmit | — | standard | 必需 | 知识图谱自动初始化（CooldownGuard 5min 去抖） |
| `workflow-guard` | PreToolUse | Bash\|Write\|Edit | full | 必需 | 保护关键文件和操作 |
| `prompt-guard` | UserPromptSubmit | — | full | — | 用户 prompt 安全检查 |

> **性能优化**：Stop 事件 Hook 每轮仅触发 1 次；`delegate-monitor` 通过 Bash\|Agent matcher 过滤。相比无 matcher 的 PostToolUse，每轮子进程 spawn 减少约 72%。

### Codex Hook 清单

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `session-context` | SessionStart | startup\|resume | minimal | 必需 | 会话启动注入工作流状态 |
| `spec-injector` | SessionStart | startup | standard | 必需 | 会话启动注入规范 |
| `skill-context` | UserPromptSubmit | — | standard | 必需 | Skill 调用注入上下文 |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | 必需 | 单次注入 keyword/spec/wiki/domain/KG 上下文 |
| `kg-sync` | UserPromptSubmit | — | standard | 必需 | 知识图谱增量同步 |
| `kg-auto-init` | SessionStart | startup | standard | 必需 | 知识图谱自动初始化 |
| `delegate-monitor` | PostToolUse | Bash | standard | — | 监控异步委托 |
| `coordinator-tracker` | Stop | — | standard | 必需 | 协调器进度追踪 |
| `team-monitor` | Stop | — | standard | — | 团队心跳记录 |
| `telemetry` | Stop | — | standard | — | 遥测采集 |
| `workflow-guard` | PreToolUse | Bash | full | 必需 | 保护文件（仅 Bash） |
| `prompt-guard` | UserPromptSubmit | — | full | — | 用户 prompt 安全检查 |

> **与 Claude Code 差异**：Codex `spec-injector` 用 SessionStart（无法拦截 Agent）；`workflow-guard` 仅防护 Bash；并发执行；正则 matcher。

### Agy (Antigravity) Hook 清单（v0.4.19+）

Agy 通过 `hooks.json` 注册 Hook（前缀 `maestro-`），使用 `PreInvocation` / `PreToolUse` / `PostToolUse` / `Stop` 事件类型：

| Hook | 事件类型 | Matcher | 级别 | Workspace | 用途 |
|------|---------|---------|------|-----------|------|
| `spec-injector` | PreToolUse | invoke_subagent | minimal | 必需 | 按 agent 类型自动注入项目规范 |
| `session-context` | PreInvocation | — | standard | 必需 | 会话启动注入工作流状态 |
| `skill-context` | PreInvocation | — | standard | 必需 | Skill 调用注入上下文 |
| `keyword-spec-injector` | PreInvocation | — | standard | 必需 | 单次注入 keyword/spec/wiki/domain/KG 上下文 |
| `kg-sync` | PreInvocation | — | standard | 必需 | 知识图谱增量同步 |
| `kg-auto-init` | PreInvocation | — | standard | 必需 | 知识图谱自动初始化 |
| `delegate-monitor` | PostToolUse | run_command\|invoke_subagent | standard | — | 监控异步委托 |
| `team-monitor` | Stop | — | standard | — | 团队心跳记录 |
| `telemetry` | Stop | — | standard | — | 遥测采集 |
| `coordinator-tracker` | Stop | — | standard | 必需 | 协调器进度追踪 |
| `preflight-guard` | PreToolUse | run_command\|write_to_file\|replace_file_content\|multi_replace_file_content\|invoke_subagent | standard | 必需 | 命令执行前预检守卫 |
| `spec-validator` | PreToolUse | write_to_file | standard | 必需 | 完整规范写入验证 |
| `workflow-guard` | PreToolUse | run_command\|write_to_file\|replace_file_content\|multi_replace_file_content | full | 必需 | 保护文件和操作 |
| `prompt-guard` | PreInvocation | — | full | — | 用户 prompt 安全检查 |

**安装路径**：
- 全局 → `~/.gemini/config/hooks.json`
- 项目级 → `<project>/.agents/hooks.json`

> **与 Claude/Codex 差异**：Agy 使用 `PreInvocation`（对应 Claude 的 `UserPromptSubmit`）做上下文注入；matcher 使用 Agy 工具名（如 `invoke_subagent`、`run_command`、`write_to_file`）；所有 Hook 以 `maestro-` 前缀注册到 `hooks.json` 顶层。

---

## 安装级别

Hook 按**累积级别**安装，高级别包含所有低级别：

| 级别 | 包含内容 | 适用场景 |
|------|---------|---------|
| `none` | 无 Hook | 完全手动控制 |
| `minimal` | Statusline + spec-injector | 日常开发 |
| `standard` | + delegate-monitor + kg-sync + kg-auto-init + keyword/spec/wiki/domain/KG prompt context + team/telemetry/coordinator(Stop) + session-context + skill-context + preflight/spec guards | 团队协作 |
| `full` | + workflow-guard | 严格工作流 |

### 安装命令

```bash
# Claude Code
maestro hooks install --level <minimal|standard|full>
maestro hooks install --level standard --project       # 项目级

# Codex（需 ~/.codex/config.toml 启用 codex_hooks）
maestro hooks install --target codex --level <level>
maestro hooks install --target codex --level standard --project

# Agy (Antigravity)
maestro hooks install --target agy --level <level>

# 查看
maestro hooks status    # 安装状态
maestro hooks list      # 可用 Hook 列表
```

---

## 核心 Hook 详解

### spec-injector — 规范自动注入

**事件**: `PreToolUse` (Agent) | **级别**: `minimal`

根据 `subagent_type` 自动注入对应规范，使用 `updatedInput` 重写 prompt。

| Agent 类型 | 注入分类 |
|-----------|---------|
| `code-developer` / `workflow-executor` / `universal-executor` | coding |
| `tdd-developer` / `test-fix-agent` | coding, test |
| `cli-lite-planning-agent` / `action-planning-agent` / `workflow-planner` | arch |
| `workflow-reviewer` | review |
| `debug-explore-agent` / `workflow-debugger` | debug |

### context-budget — 上下文预算

> spec-injector 内部模块，非独立 Hook。

| 剩余上下文 | 动作 | 策略 |
|-----------|------|------|
| > 50% | `full` | 注入全部内容 |
| 35-50% | `reduced` | 保留标题 + 每节首段（max 4096 字符） |
| 25-35% | `minimal` | 仅标题列表 + learnings |
| < 25% | `skip` | 不注入 |

### session-context — 会话上下文

**事件**: `Notification` | **级别**: `standard`

会话启动时注入轻量概览：工作流状态 + 规范文件列表 + Git 分支/最近提交。不注入完整规范（由 spec-injector 按需注入）。

### delegate-monitor — 委托监控

**事件**: `PostToolUse` (Bash\|Agent) | **级别**: `standard`

读取 `/tmp/maestro-notify-{session_id}.jsonl` 注入异步委托完成/失败状态。Bash\|Agent matcher 避免只读操作触发。

### team-monitor — 团队监控

**事件**: `Stop` | **级别**: `standard`

每轮向 `.workflow/collab/activity.jsonl` 写入心跳，Stop 事件每轮仅 1 次。

### skill-context — Skill 感知上下文

**事件**: `UserPromptSubmit` | **级别**: `standard`

匹配 Skill 调用时注入工作流状态 + 阶段产物树 + 前序成果（`additionalContext`，不重写 prompt）。支持模式：`/maestro-execute {N}`、`/maestro-plan {N}`、`/maestro-analyze {N}`、`/maestro-milestone-audit`、`/quality-review {N}`、`/quality-test {N}`、`/maestro`、`/maestro-coordinate`、`/maestro-link-coordinate`

协调器 Skill 额外注入 coordinator-tracker bridge 的 next-step 提示：`Chain: full-lifecycle [3/6] | Status: paused | Next: quality-review 2 | Resume: /maestro -c`

### coordinator-tracker — 协调器进度追踪

**事件**: `Stop` | **级别**: `standard` | **Workspace**: 必需

每轮结束时更新 bridge 文件供 Statusline 和 skill-context 消费。纯 I/O 操作，不产生 `additionalContext`。

<details>
<summary>Bridge 文件示例</summary>

```json
{
  "session_id": "cc-session-abc123",
  "maestro_session_id": "maestro-20260412-103500",
  "chain_name": "full-lifecycle",
  "intent": "implement OAuth2 authentication",
  "phase": 2,
  "steps_total": 6,
  "steps_completed": 3,
  "current_step": { "index": 3, "skill": "quality-review", "args": "2" },
  "next_step": { "index": 4, "skill": "quality-test", "args": "2" },
  "status": "paused",
  "updated_at": 1744668285953
}
```

</details>

**Statusline**：`claude-sonnet-4-6 | P2 | [3/6]quality-review`（暂停态 `[P]quality-review`）

### workflow-guard — 工作流守卫

**事件**: `PreToolUse` (Bash\|Write\|Edit) | **级别**: `full`

检查受保护文件和工作流阶段约束。退出码 `2` 阻止操作。

### CooldownGuard — 跨进程抖动抑制

> `src/utils/cooldown-guard.ts` — 非独立 Hook，供 kg-sync / kg-auto-init 内部使用。

通过 tmpdir bridge 文件实现跨子进程调用的时序节流。每次执行后写入 JSON bridge 文件，冷却期内的后续调用被跳过（`shouldRun()` 返回 `false`）。

| 预设实例 | 冷却时间 | 用途 |
|---------|---------|------|
| `kgSyncGuard` | 30 秒 | `kg-sync` 增量同步去抖 |
| `kgInitGuard` | 5 分钟 | `kg-auto-init` 初始化去抖 |

**API**：

```typescript
import { CooldownGuard, kgSyncGuard, kgInitGuard } from '../utils/cooldown-guard.js';

// 自定义 guard
const guard = new CooldownGuard({ prefix: 'my-guard-', cooldownMs: 60_000 });

// 使用
if (guard.shouldRun(sessionId)) {
  // 执行操作
  guard.markDone(sessionId, { extra: 'data' });
}

// 查询距上次执行的时间
const elapsed = guard.timeSinceLastMs(sessionId); // number | null
```

**Bridge 文件**：`{tmpdir}/{prefix}{sessionId}.json`，格式为 `{ last_trigger: number, session_id?: string, extra?: Record<string, unknown> }`。

### Coordinator 插件

`SpecInjectionPlugin`（进程内）通过关键词推断规范分类：

| 关键词 | 推断分类 |
|-------|---------|
| review, audit, check quality | review |
| test, spec, coverage, assert | test |
| debug, diagnose, fix, error, bug | debug |
| plan, design, architect, decompose, explore, analyze | arch |
| 其他（默认） | coding |

---

## 配置

### Hook 开关

`maestro hooks toggle <name> <on|off>` — 单独开关 Hook。

### 自定义 Agent-Spec 映射

<details>
<summary>配置示例</summary>

```json
{
  "specInjection": {
    "mapping": {
      "my-custom-agent": {
        "categories": ["coding", "test"],
        "extras": []
      }
    },
    "maxContentLength": 8192
  }
}
```

| 字段 | 说明 |
|------|------|
| `mapping` | 覆盖/扩展 agent -> category 映射 |
| `always` | 始终注入的额外文件路径列表 |
| `maxContentLength` | 截断前最大字符数 |

自定义映射与默认映射**合并**，不替换。

</details>

### 项目规范文件

<details>
<summary>规范文件示例</summary>

```markdown
---
title: Coding Conventions
category: coding
---

# Coding Conventions

- Use camelCase for variables
- Use PascalCase for classes
```

**可用分类**: `coding`, `arch`, `quality`, `review`, `test`, `debug`, `learning`

初始化：`maestro spec init`

</details>

### 状态转换记录

转换自动写入 `state.json` 的 `transition_history[]`。API：

```typescript
import { buildTransitionEntry, appendTransition } from '../tools/transition-recorder.js';
appendTransition('.workflow/state.json', buildTransitionEntry({ type: 'phase', fromPhase: 1, toPhase: 2, milestone: 'MVP' }));
```

---

## 命令参考

```bash
# 安装 / 卸载
maestro hooks install --level <level>                          # 安装
maestro hooks install --level standard --project               # 项目级
maestro hooks uninstall --global                               # 卸载全局
maestro hooks uninstall --project                              # 卸载项目级

# Codex
maestro hooks install --target codex --level <level>
maestro hooks uninstall --target codex

# 查看
maestro hooks status          # 安装状态
maestro hooks list            # 可用 Hook
maestro hooks config          # 当前配置

# 开关
maestro hooks toggle <name> <on|off>

# 手动运行（调试）
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"code-developer","prompt":"test"}}' \
  | maestro hooks run spec-injector
```
