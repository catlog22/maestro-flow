---
title: "Delegate Async Execution Guide"
---

Async task delegation via detached worker processes, with broker-managed lifecycle, message injection, and MCP notifications.

---

## Quick Start

### Launch via Claude Code MCP

```bash
claude --dangerously-load-development-channels server:maestro --dangerously-skip-permissions
```

The MCP `delegate` tool can spawn, follow up, inspect, and cancel jobs from Grok / Claude / Cursor and any other maestro-tools host. Default `mode` is `analysis` (read-only); set `mode=write` only when files must change.

### Launch via CLI

```bash
# Async (background) — returns immediately with execId
maestro delegate "analyze auth module for vulnerabilities" --to gemini --async

# Foreground — blocks until completion
maestro delegate "say hello" --to claude
```

---

## Command Reference

### Main Command

```bash
maestro delegate "<PROMPT>" [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--to <tool>` | Agent: gemini, qwen, codex, claude, opencode, agy, pi, grok | First enabled in config |
| `--role <role>` | Capability role (analyze, explore, review, implement, plan, brainstorm, research) | — |
| `--mode <mode>` | `analysis` (read-only) or `write` (create/modify/delete) | `analysis` |
| `--effort <level>` | Reasoning effort (low, medium, high, max) | — |
| `--model <model>` | Model override | Tool's `primaryModel` |
| `--cd <dir>` | Working directory | Current directory |
| `--rule <template>` | Load protocol + prompt template | — |
| `--id <id>` | Execution ID | Auto: `{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | Resume previous session | — |
| `--includeDirs <dirs>` | Additional directories (comma-separated) | — |
| `--session <id>` | MCP session ID for notifications | Auto-detected |
| `--backend <type>` | `direct` or `terminal` | `direct` |
| `--async` | Run in background, return immediately | foreground |

### Subcommands

```bash
maestro delegate show                              # Recent 20 executions
maestro delegate show --all                        # Up to 100
maestro delegate status <id>                       # Broker + history state
maestro delegate status <id> --events 10           # With more broker events
maestro delegate output <id>                       # Assistant output
maestro delegate output <id> --verbose             # With timestamps
maestro delegate output <id> --all                 # Include thinking/reasoning entries
maestro delegate output <id> --offset <n>          # Character offset
maestro delegate output <id> --limit <n>           # Max characters
maestro delegate tail <id>                         # Recent events + history
maestro delegate tail <id> --events 20 --history 20
maestro delegate cancel <id>                       # Request cancellation
maestro delegate message <id> "text"               # Inject follow-up message
maestro delegate message <id> "text" --delivery after_complete
maestro delegate messages <id>                     # List queued messages
```

### MCP tool `delegate`

One tool, selected by `operation`: `run` / `message` / `status` / `output` / `cancel`. `tail` / `messages` / `show` remain CLI-only. Existing installs with an `MAESTRO_ENABLED_TOOLS` allowlist must reinstall and include `delegate`.

---

## Job Lifecycle

```
queued → running → completed
                 → failed
                 → cancelled
              ↗
         input_required
```

**Execution ID**: `{prefix}-{HHmmss}-{rand4}` (e.g. `gem-143022-a7f2`)
Prefix: gemini→`gem`, qwen→`qwn`, codex→`cdx`, claude→`cld`, opencode→`opc`, agy→`agy`, pi→`pi`, grok→`grk`

> Grok: prompt is passed via `--prompt-file`. `maestro delegate message` inject stops the current headless turn and respawns with `grok --continue`. Default model is `grok-4.6`. Requires `XAI_API_KEY` or prior `grok login`.

<details>
<summary>Delegate vs CLI: Feature Comparison</summary>

| Feature | `maestro cli` | `maestro delegate` |
|---------|:---:|:---:|
| Sync execution | ✅ | ✅ |
| Async execution | — | ✅ `--async` |
| Prompt input | `-p "..."` | positional `"..."` |
| Tool selection | `--tool` | `--to` |
| Mode (analysis/write) | ✅ | ✅ |
| Model override | ✅ | ✅ |
| Working directory | `--cd` | `--cd` |
| Rule templates | `--rule` | `--rule` |
| Custom exec ID | `--id` | `--id` |
| Session resume | `--resume` | `--resume` |
| Backend selection | — | `--backend` |
| MCP session binding | — | `--session` |
| show (list executions) | ✅ | ✅ |
| output (get result) | ✅ | ✅ |
| output --verbose | ✅ | ✅ |
| watch (real-time stream) | ✅ | — |
| status (broker + history) | — | ✅ |
| tail (recent events) | — | ✅ |
| cancel | — | ✅ |
| message inject | — | ✅ |
| message after_complete | — | ✅ |
| MCP tool equivalents | — | ✅ (`delegate` tool) |
| MCP channel notifications | — | ✅ |
| Snapshot (latest output preview) | — | ✅ |

**Delegate can fully replace CLI.** The only CLI-only features (`watch`, `output --tail`) are convenience shortcuts.

</details>

---

## Message Delivery

| Mode | Behavior | Use For |
|------|----------|---------|
| `inject` | Routes to running worker via stdin | Supplementary context, course correction |
| `after_complete` | Queues message; relaunches on completion | Chained tasks, post-processing |

```bash
# Inject context into running delegate
maestro delegate message gem-143022-a7f2 "Also check src/utils/sanitize.ts"

# Chain: analyze → auto-fix
maestro delegate "analyze auth vulnerabilities" --to gemini --async
maestro delegate message gem-143022-a7f2 "Fix all critical vulnerabilities" --delivery after_complete
```

---

## Prompt Construction

Assembly order: **Mode protocol** → **User prompt** → **Rule template** (if specified)

### Prompt Template (6 Fields)

```
PURPOSE: [goal] + [why] + [success criteria]
TASK: [step 1] | [step 2] | [step 3]
MODE: analysis|write
CONTEXT: @[file patterns] | Memory: [prior work context]
EXPECTED: [output format] + [quality criteria]
CONSTRAINTS: [scope limits] | [special requirements]
```

### Rule Templates

**Analysis**: `analysis-trace-code-execution`, `analysis-diagnose-bug-root-cause`, `analysis-analyze-code-patterns`, `analysis-review-architecture`, `analysis-review-code-quality`, `analysis-analyze-performance`, `analysis-assess-security-risks`

**Planning**: `planning-plan-architecture-design`, `planning-breakdown-task-steps`, `planning-design-component-spec`, `planning-plan-migration-strategy`

**Development**: `development-implement-feature`, `development-refactor-codebase`, `development-generate-tests`, `development-implement-component-ui`, `development-debug-runtime-issues`

---

## Notification System

Dual channels: **MCP channel** (primary, push) + **Hook fallback** (JSONL file)

Throttling: `status_update` at 10s, `snapshot` at 15s.

---

## Workflows

### Launch → Monitor → Retrieve

```bash
maestro delegate "analyze auth module" --to gemini --async
# → execId: gem-143022-a7f2

maestro delegate status gem-143022-a7f2
# → status: running

maestro delegate output gem-143022-a7f2
# → full analysis result
```

### Chain: Analyze → Auto-Fix

```bash
maestro delegate "find all SQL injection vulnerabilities" --to gemini --async
maestro delegate message gem-143022-a7f2 "Fix all critical vulnerabilities" --delivery after_complete
```

### Cancel → Redirect

```bash
maestro delegate cancel gem-143022-a7f2
maestro delegate "analyze only the payment module" --to gemini --async
```
