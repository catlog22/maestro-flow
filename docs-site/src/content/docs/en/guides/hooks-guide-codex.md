---
title: "Maestro Codex Hooks Integration Design"
---

> **Status**: v0.4.2 basic integration implemented | Codex hooks not yet supported on Windows

Implement an integration for OpenAI Codex CLI that is on par with the Maestro hooks system.

## Table of Contents

- [Overview](#overview)
- [Hook Mapping Table](#hook-mapping-table)
- [Hook Detailed Design](#hook-detailed-design)
- [hooks.json Configuration](#hooksjson-configuration)
- [Install Commands](#install-commands)
- [Implementation Roadmap](#implementation-roadmap)

---

## Overview

### Architecture Comparison

| Dimension | Claude Code | Codex |
|-----------|------------|-------|
| Config | `~/.claude/settings.json` | `~/.codex/hooks.json` |
| Feature toggle | Not required | `config.toml` → `codex_hooks = true` |
| Events | Pre/PostToolUse, UserPromptSubmit, Notification | SessionStart, Pre/PostToolUse, UserPromptSubmit, **Stop** |
| PreToolUse scope | Any tool | **Bash only** |
| PreToolUse capabilities | `updatedInput` + `additionalContext` | `systemMessage` + `permissionDecision: deny` |
| SessionStart | None (uses Notification) | Native |
| Stop (continuation) | None | Native `decision: "block"` |
| matcher | Exact string | Regex |
| Multi-hook | Serial | **Concurrent** |
| Windows | Supported | **Not supported** |

### Core Limitations

PreToolUse/PostToolUse **Bash only** | No `updatedInput` | Hooks execute concurrently | Windows unavailable

### Reusable Evaluators

| evaluator | Reuse approach |
|-----------|----------------|
| `evaluateSessionContext()` | Direct call, adapt stdin |
| `evaluateSkillContext()` | Already compatible with `prompt` |
| `evaluateContext()` | Direct call |
| `evaluateWorkflowGuard()` | Direct call |
| `evaluateSpecInjection()` | Change to SessionStart |
| `resolveWorkspace()` | Direct reuse |

---

## Hook Mapping Table

| Maestro Hook | Claude Event | Codex Event | Status | Notes |
|---|---|---|---|---|
| session-context | Notification | **SessionStart** | ✅ | Native session start |
| skill-context | UserPromptSubmit | **UserPromptSubmit** | ✅ | Fields compatible |
| spec-injector | PreToolUse(Agent) | **SessionStart** | ⚠️ | additionalContext inject |
| context-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | Bash only |
| workflow-guard | PreToolUse(Bash\|Write\|Edit) | PreToolUse(Bash) | ⚠️ | Bash only |
| delegate/team-monitor | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | Bash only |
| *(new)* task-continue | — | **Stop** | ✅ | Codex exclusive |
| telemetry | PostToolUse(all) | PostToolUse(Bash) | ⚠️ | Bash only |

---

## Hook Detailed Design

### SessionStart — Session Context

**matcher**: `startup|resume` | Reuses `evaluateSessionContext()`

<details>
<summary>stdin/stdout Example</summary>

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

**Difference**: Claude Code uses `Notification`, Codex uses `SessionStart`; added `source` for startup/resume distinction.

---

### SessionStart — Spec Injection

**matcher**: `startup` | Alternative to spec-injector (Codex has no `updatedInput`)

```
SessionStart(source=startup)
    ├─ resolveWorkspace(cwd) → null → skip
    ├─ loadSpecs(projectPath, category='learning')
    ├─ evaluateContextBudget(): >50%→full | 35-50%→reduced | 25-35%→minimal | <25%→skip
    └─ additionalContext: spec content
```

| Dimension | Claude Code spec-injector | Codex SessionStart |
|-----------|--------------------------|-------------------|
| Injection | `updatedInput` rewrites prompt | `additionalContext` appends |
| Granularity | Per agent type | Full |
| Timing | Before every Agent call | Session start only |
| Reliability | Imperative | Advisory |

No AGENTS.md (file side effects); skip on `source=resume` (avoid duplicate); no fine-grained categories (Codex hides agent types).

---

### UserPromptSubmit — Skill-Aware Context

**matcher**: None (matches all)

<details>
<summary>stdin/stdout Example</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-001", "prompt": "/maestro-ralph continue",
  "cwd": "/path/to/project", "hook_event_name": "UserPromptSubmit", "model": "gpt-5.1-codex" }
```

**stdout**:
```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
  "additionalContext": "## Workflow Context for maestro-ralph\nMilestone: MVP | Phase: 2 (1/4 completed)\n..." } }
```
</details>

Already compatible — `data.user_prompt ?? data.prompt`. Extend `parseSkillInvocation()` to match both `/maestro-*` and `maestro-*`.

---

### PreToolUse — Bash Guard

**matcher**: `Bash` | Reuses `evaluateWorkflowGuard()`

<details>
<summary>stdin/stdout Example</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-001", "tool_name": "Bash",
  "tool_use_id": "call-001", "tool_input": { "command": "rm -rf node_modules" },
  "cwd": "/path/to/project" }
```

**stdout (block)**:
```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
  "permissionDecisionReason": "Blocked by workflow guard: destructive command" } }
```
Or legacy: `{ "decision": "block", "reason": "..." }`
</details>

| Dimension | Claude Code | Codex |
|-----------|------------|-------|
| Scope | Bash + Write + Edit | **Bash only** |
| Blocking | exit(2) | `permissionDecision: "deny"` |

---

### PostToolUse — Context Monitoring

**matcher**: `Bash` | Reuses `evaluateContext()`

<details>
<summary>stdin Example</summary>

```json
{ "session_id": "abc123", "turn_id": "turn-001", "tool_name": "Bash",
  "tool_use_id": "call-001", "tool_input": { "command": "npm test" },
  "tool_response": "{\"exit_code\":0,\"output\":\"...\"}", "cwd": "/path/to/project" }
```
</details>

Same as Claude Code version. Coverage: high → low (Bash only).

---

### Stop — Task Continuation (Codex Exclusive)

**matcher**: None | Checks for incomplete tasks when Codex prepares to stop

<details>
<summary>stdin/stdout Example</summary>

**stdin**:
```json
{ "session_id": "abc123", "turn_id": "turn-005", "stop_hook_active": false,
  "last_assistant_message": "I've completed implementing the user authentication module.",
  "cwd": "/path/to/project", "hook_event_name": "Stop", "model": "gpt-5.1-codex" }
```

**stdout (continue)**:
```json
{ "decision": "block",
  "reason": "Workflow Phase 2 has 3 pending tasks (TASK-004, TASK-005, TASK-006). Continue with next task: implement-login-page." }
```
</details>

```
Stop → resolveWorkspace → null → normal stop
           ▼
       state.json → phases/{NN}/index.json
           ├─ No incomplete → normal stop
           ├─ pending tasks + stop_hook_active=false → decision: "block"
           └─ Phase completed → phase transition suggestion
```

**Preventing infinite loops**: (1) `stop_hook_active` check (2) counter with 5x limit (3) points to specific next task

---

## hooks.json Configuration

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

### standard (minimal + below)

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

### full (standard + below)

```json
{
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "maestro hooks run workflow-guard", "statusMessage": "Checking command safety" }] }
  ]
}
```

**Notes**: spec-injector matcher is `startup` (no resume); session-context matcher is `startup|resume`; Stop timeout 10s; global + project hooks.json execute concurrently.

---

## Install Commands

```bash
maestro hooks install --target codex --level standard          # global
maestro hooks install --target codex --level standard --project # project-level
maestro hooks status                                           # status
maestro hooks uninstall --target codex                         # uninstall
```

| `--target` | Install location |
|-----------|-----------------|
| `claude` | `~/.claude/settings.json` |
| `codex` | `~/.codex/hooks.json` |

Flow: detect OS → detect config.toml → generate hooks.json (dedup/write) → output result. Maestro entries identified by `maestro hooks run` command string.

---

## Implementation Roadmap

### Prerequisites

1. ~~Windows support~~ — pending Codex support
2. PreToolUse more tool types — affects workflow-guard
3. PreToolUse `updatedInput` — affects spec-injector

### Completed

**Phase 1 ✅ (v0.4.2)** — `CODEX_HOOK_DEFS` + `installCodexHooksByLevel()` + `--target codex` + idempotent install + config.toml detection + Windows warning

Installed: session-context, spec-injector, skill-context, keyword-spec-injector, delegate-monitor, coordinator-tracker, team-monitor, telemetry, workflow-guard

**Phase 2 ✅ (v0.4.2)** — TOML read/write + MCP register/unregister + `--codex-hooks` / `--codex-mcp` batch install

### Pending

**Phase 3** — `src/hooks/task-continue.ts` (Stop continuation logic)
**Phase 4** — E2E testing init → plan → execute → verify
