---
title: "Maestro Hooks System Guide"
---

Maestro's Hook system provides Claude Code and Codex with automated context management, spec injection, and workflow awareness. Hooks run as subprocesses, interacting with the host via a stdin/stdout JSON protocol.

## Table of Contents

- [Overview](#overview)
- [Hook Inventory](#hook-inventory)
- [Installation Levels](#installation-levels)
- [Core Hook Details](#core-hook-details)
- [Configuration](#configuration)
- [Command Reference](#command-reference)

---

## Overview

### Architecture

| Layer | Registration | Runtime |
|-------|-------------|---------|
| Claude Code Hooks | `settings.json` | Subprocess `maestro hooks run <name>` |
| Codex Hooks | `hooks.json` | Subprocess `maestro hooks run <name>` |
| Coordinator Hooks | `WorkflowHookRegistry` | In-process plugin |

### Protocol

| Exit Code | Meaning |
|-----------|---------|
| `0` | Allow operation |
| `2` | Block operation |

| Event Type | Can Return |
|-----------|------------|
| `PreToolUse` | `updatedInput` (rewrite params) / `additionalContext` |
| `PostToolUse` | `additionalContext` |
| `Stop` | `decision: "block"` (no `additionalContext`) |

### Workspace Awareness

Hooks marked `requiresWorkspace` only activate when a valid Maestro workspace is detected (traverses up to find `.workflow/state.json` with `version` + `phases_summary` fingerprint), otherwise `exit(0)` with zero overhead.

---

## Hook Inventory

| Hook | Event Type | Matcher | Level | Workspace | Purpose |
|------|-----------|---------|-------|-----------|---------|
| `context-monitor` | PostToolUse | — | minimal | — | Monitor context usage, inject warnings |
| `spec-injector` | PreToolUse | Agent | minimal | Required | Auto-inject specs by agent type |
| `delegate-monitor` | PostToolUse | Bash\|Agent | standard | — | Monitor async delegate completion |
| `team-monitor` | Stop | — | standard | — | Team collaboration heartbeat |
| `telemetry` | Stop | — | standard | — | Execution telemetry (once per turn) |
| `session-context` | Notification | — | standard | — | Inject workflow state at startup |
| `skill-context` | UserPromptSubmit | — | standard | Required | Inject workflow state for Skill calls |
| `coordinator-tracker` | Stop | — | standard | Required | Coordinator chain progress tracking |
| `kg-sync` | UserPromptSubmit | — | standard | Required | Silently sync Knowledge Graph on user input |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | Required | Compose keyword/spec/wiki/domain/KG context once per prompt |
| `workflow-guard` | PreToolUse | Bash\|Write\|Edit | full | Required | Protect critical files and operations |

> **Performance**: Stop event Hooks trigger once per turn; `delegate-monitor` filters via Bash\|Agent matcher. Subprocess spawns reduced ~72% per turn vs matcher-less PostToolUse.

### Codex Hook Inventory

| Hook | Event | Matcher | Level | Workspace | Purpose |
|------|-------|---------|-------|-----------|---------|
| `session-context` | SessionStart | startup\|resume | minimal | Required | Inject workflow state on start |
| `spec-injector` | SessionStart | startup | standard | Required | Inject specs on start |
| `skill-context` | UserPromptSubmit | — | standard | Required | Inject context for Skill calls |
| `keyword-spec-injector` | UserPromptSubmit | — | standard | Required | Compose keyword/spec/wiki/domain/KG context once per prompt |
| `kg-sync` | UserPromptSubmit | — | standard | Required | Silently sync Knowledge Graph |
| `delegate-monitor` | PostToolUse | Bash | standard | — | Monitor async delegate |
| `coordinator-tracker` | Stop | — | standard | Required | Coordinator progress |
| `team-monitor` | Stop | — | standard | — | Team heartbeat |
| `telemetry` | Stop | — | standard | — | Telemetry collection |
| `workflow-guard` | PreToolUse | Bash | full | Required | Protect files (Bash only) |

> **Differences from Claude Code**: Codex `spec-injector` uses SessionStart (cannot intercept Agent); `workflow-guard` guards Bash only; concurrent execution; regex matchers.

---

## Installation Levels

Hooks are installed at **cumulative levels**, higher levels include all lower:

| Level | Includes | Use Case |
|-------|----------|----------|
| `none` | No Hooks | Full manual control |
| `minimal` | Statusline + context-monitor + spec-injector | Daily development |
| `standard` | + delegate-monitor + team/telemetry/coordinator(Stop) + session-context + skill-context + kg-sync + composed prompt context | Team collaboration |
| `full` | + workflow-guard | Strict workflow |

### Installation Commands

```bash
# Claude Code
maestro hooks install --level <minimal|standard|full>
maestro hooks install --level standard --project       # Project-level

# Codex (requires codex_hooks = true in ~/.codex/config.toml)
maestro hooks install --target codex --level <level>
maestro hooks install --target codex --level standard --project

# View
maestro hooks status    # Installation status
maestro hooks list      # Available Hooks
```

---

## Core Hook Details

### spec-injector — Automatic Spec Injection

**Event**: `PreToolUse` (Agent) | **Level**: `minimal`

Injects project specs based on `subagent_type` using `updatedInput` to rewrite the prompt.

| Agent Type | Categories |
|-----------|-----------|
| `code-developer` / `workflow-executor` / `universal-executor` | coding, learning, ui |
| `tdd-developer` / `test-fix-agent` | coding, test |
| `impeccable-agent` / `ui-design-agent` | coding, ui |
| `cli-lite-planning-agent` / `action-planning-agent` / `workflow-planner` | arch, coding |
| `workflow-reviewer` / `workflow-verifier` | review, coding |
| `team-supervisor` / `workflow-roadmapper` | arch |
| `team-worker` / `general-purpose` | coding, learning |
| `debug-explore-agent` / `workflow-debugger` | debug |

### context-budget — Context Budget

> Internal module of spec-injector, not a standalone Hook.

| Remaining Context | Action | Strategy |
|-------------------|--------|----------|
| > 50% | `full` | Inject all content |
| 35-50% | `reduced` | Keep headings + first paragraph per section (max 4096 chars) |
| 25-35% | `minimal` | Headings list only + learnings |
| < 25% | `skip` | No injection |

### session-context — Session Context

**Event**: `Notification` | **Level**: `standard`

Injects lightweight overview at session startup: workflow state + spec file list + Git branch/latest commit. Full specs injected on-demand by spec-injector.

### delegate-monitor — Delegate Monitoring

**Event**: `PostToolUse` (Bash\|Agent) | **Level**: `standard`

Reads `/tmp/maestro-notify-{session_id}.jsonl` to inject async delegate status. Bash\|Agent matcher avoids read-only operations.

### team-monitor — Team Monitoring

**Event**: `Stop` | **Level**: `standard`

Writes heartbeat to `.workflow/collab/activity.jsonl` once per turn.

### skill-context — Skill-Aware Context

**Event**: `UserPromptSubmit` | **Level**: `standard`

Matches Skill invocations and injects workflow state + phase artifact tree + prior results via `additionalContext` (does not rewrite prompt). Supported patterns: `/maestro-ralph continue`, `/maestro-next {N}`, `/maestro-ralph --engine swarm --script wf-analyze`, `/maestro-ralph --engine swarm --script wf-review`, `/maestro "<test intent>"`, `/maestro`, `/maestro-ralph`

Coordinator Skills additionally inject coordinator-tracker bridge next-step prompt: `Chain: full-lifecycle [3/6] | Status: paused | Next: /maestro-ralph --engine swarm --script wf-review 2 | Resume: /maestro -c`

### coordinator-tracker — Coordinator Progress Tracking

**Event**: `Stop` | **Level**: `standard` | **Workspace**: Required

Updates bridge file at end of each turn for Statusline and skill-context consumption. Pure I/O, no `additionalContext` output.

<details>
<summary>Bridge File Example</summary>

```json
{
  "session_id": "cc-session-abc123",
  "maestro_session_id": "maestro-20260412-103500",
  "chain_name": "full-lifecycle",
  "intent": "implement OAuth2 authentication",
  "phase": 2,
  "steps_total": 6,
  "steps_completed": 3,
  "current_step": { "index": 3, "skill": "maestro-ralph", "args": "--engine swarm --script wf-review 2" },
  "next_step": { "index": 4, "skill": "maestro-ralph", "args": "<test intent> 2" },
  "status": "paused",
  "updated_at": 1744668285953
}
```

</details>

**Statusline**: `claude-sonnet-4-6 | P2 | [3/6]maestro-ralph --engine swarm --script wf-review` (paused shows `[P]maestro-ralph --engine swarm --script wf-review`)

### kg-sync — Knowledge Graph Sync

**Event**: `UserPromptSubmit` | **Level**: `standard` | **Workspace**: Required

Silently detects source file changes on each user input and triggers incremental CodeGraph sync. 30-second cooldown prevents excessive syncs. Only processes source file extensions (`.ts`/`.tsx`/`.js`/`.jsx`/`.py`/`.go`/`.rs`/`.java`). Gracefully degrades when CodeGraph is unavailable.

### keyword-spec-injector — Composed Prompt Context

**Event**: `UserPromptSubmit` | **Level**: `standard` | **Workspace**: Required

Composes keyword-matched specs, wiki hits, domain terms, and KG code structure into one budgeted `<maestro-context>` block. KG lookup includes camelCase, snake_case, backticked symbols, referenced files, call relationships, and exports; unavailable sources degrade independently.

### workflow-guard — Workflow Guard

**Event**: `PreToolUse` (Bash\|Write\|Edit) | **Level**: `full`

Checks protected files and workflow stage constraints. Exit code `2` blocks operations.

### Coordinator Plugins

`SpecInjectionPlugin` (in-process) uses keyword heuristics for spec category inference:

| Keywords | Category |
|----------|----------|
| review, audit, check quality | review |
| test, spec, coverage, assert | test |
| debug, diagnose, fix, error, bug | debug |
| plan, design, architect, decompose, explore, analyze | arch |
| Other (default) | coding |

---

## Configuration

### Hook Toggle

`maestro hooks toggle <name> <on|off>` — Toggle individual Hooks.

### Custom Agent-Spec Mapping

<details>
<summary>Config Example</summary>

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

| Field | Description |
|-------|-------------|
| `mapping` | Override/extend agent -> category mapping |
| `always` | Additional file paths to always inject |
| `maxContentLength` | Max chars before truncation |

Custom mappings are **merged** with defaults, not replaced.

</details>

### Project Spec Files

<details>
<summary>Spec File Example</summary>

```markdown
---
title: Coding Conventions
category: coding
---

# Coding Conventions

- Use camelCase for variables
- Use PascalCase for classes
```

**Available categories**: `coding`, `arch`, `quality`, `review`, `test`, `debug`, `learning`

Initialize: `maestro spec init`

</details>

### Transition History

Transitions recorded to `state.json`'s `transition_history[]`. API:

```typescript
import { buildTransitionEntry, appendTransition } from '../tools/transition-recorder.js';
appendTransition('.workflow/state.json', buildTransitionEntry({ type: 'phase', fromPhase: 1, toPhase: 2, milestone: 'MVP' }));
```

---

## Command Reference

```bash
# Install / Uninstall
maestro hooks install --level <level>                          # Install
maestro hooks install --level standard --project               # Project-level
maestro hooks uninstall --global                               # Remove global
maestro hooks uninstall --project                              # Remove project-level

# Codex
maestro hooks install --target codex --level <level>
maestro hooks uninstall --target codex

# View
maestro hooks status          # Installation status
maestro hooks list            # Available Hooks
maestro hooks config          # Current configuration

# Toggle
maestro hooks toggle <name> <on|off>

# Manual run (debugging)
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"code-developer","prompt":"test"}}' \
  | maestro hooks run spec-injector
```
