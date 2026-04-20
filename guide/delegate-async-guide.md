# Delegate Async Execution Guide

Async task delegation via detached worker processes, with broker-managed lifecycle, message injection, and MCP notifications.

---

## Quick Start

### Launch via Claude Code MCP

```bash
# Start Claude Code with Maestro MCP server
claude --dangerously-load-development-channels server:maestro --dangerously-skip-permissions
```

Once connected, delegate tools (`delegate_message`, `delegate_status`, `delegate_output`, `delegate_tail`, `delegate_cancel`) are available as MCP tools automatically.

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
| `--to <tool>` | Agent: gemini, qwen, codex, claude, opencode | First enabled in config |
| `--mode <mode>` | `analysis` (read-only) or `write` (create/modify/delete) | `analysis` |
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
maestro delegate tail <id>                         # Recent events + history
maestro delegate tail <id> --events 20 --history 20
maestro delegate cancel <id>                       # Request cancellation
maestro delegate message <id> "text"               # Inject follow-up message
maestro delegate message <id> "text" --delivery after_complete
maestro delegate messages <id>                     # List queued messages
```

### MCP Tools

All subcommands are also available as MCP tools:

| CLI Subcommand | MCP Tool | Extra Params |
|---------------|----------|-------------|
| `message <id> "text"` | `delegate_message` | `delivery` (inject/after_complete) |
| `messages <id>` | `delegate_messages` | — |
| `status <id>` | `delegate_status` | `eventLimit` |
| `output <id>` | `delegate_output` | — |
| `tail <id>` | `delegate_tail` | `limit` |
| `cancel <id>` | `delegate_cancel` | — |

---

## Job Lifecycle

```
queued → running → completed
                 → failed
                 → cancelled
              ↗
         input_required
```

**Execution ID** format: `{prefix}-{HHmmss}-{rand4}` (e.g. `gem-143022-a7f2`)

Prefix mapping: gemini→`gem`, qwen→`qwn`, codex→`cdx`, claude→`cld`, opencode→`opc`

---

## Delegate vs CLI: Feature Comparison

| Feature | `maestro cli` | `maestro delegate` |
|---------|:---:|:---:|
| **Sync execution** (foreground, block until done) | ✅ | ✅ |
| **Async execution** (background, return immediately) | — | ✅ `--async` |
| **Prompt input** | `-p "..."` | positional `"..."` |
| **Tool selection** | `--tool` | `--to` |
| **Mode** (analysis/write) | ✅ | ✅ |
| **Model override** | ✅ | ✅ |
| **Working directory** | `--cd` | `--cd` |
| **Rule templates** | `--rule` | `--rule` |
| **Custom exec ID** | `--id` | `--id` |
| **Session resume** | `--resume` | `--resume` |
| **Include dirs** | `--includeDirs` | `--includeDirs` |
| **Backend selection** | — | `--backend` (direct/terminal) |
| **MCP session binding** | — | `--session` |
| **show** (list executions) | ✅ | ✅ |
| **output** (get result) | ✅ | ✅ |
| **output --verbose** | ✅ | ✅ |
| **output --tail/--lines** | ✅ | — |
| **watch** (real-time stream) | ✅ | — |
| **status** (broker + history) | — | ✅ |
| **tail** (recent events) | — | ✅ |
| **cancel** | — | ✅ |
| **message inject** | — | ✅ |
| **message after_complete** | — | ✅ |
| **messages** (list queue) | — | ✅ |
| **MCP tool equivalents** | — | ✅ (6 tools) |
| **MCP channel notifications** | — | ✅ |
| **Hook fallback notifications** | — | ✅ |
| **Broker event tracking** | — | ✅ |
| **Snapshot** (agent latest output preview) | — | ✅ (`status` Preview field) |

### Summary

**CLI-only (not needed in normal workflows):**
- `watch` — real-time output streaming (debug/development use only)
- `output --tail/--lines` — tail last N lines (convenience shortcut)

**Delegate-only:**
- Async execution with `--async`
- Broker lifecycle management (status, tail, cancel)
- Message injection and chaining (inject, after_complete)
- MCP tools for programmatic access
- MCP channel push notifications
- Backend selection (direct/terminal)
- **Snapshot** — `status` shows `Preview:` with the agent's latest output

### Can delegate fully replace CLI?

**Yes.** The two CLI-only features (`watch` and `output --tail`) are convenience shortcuts, not essential capabilities. In normal usage, delegate's `status` (with `Preview:` snapshot) and `output` cover the same needs. Delegate is the recommended interface — it adds async execution, message injection, cancellation, and MCP integration on top of everything CLI offers.

---

## Message Delivery

### Delivery Modes

| Mode | Behavior | Use For |
|------|----------|---------|
| `inject` | Routes to running worker via stdin; non-interactive adapters auto cancel + relaunch | Supplementary context, course correction |
| `after_complete` | Queues message; relaunches delegate with queued message on completion | Chained tasks, post-processing |

### Examples

```bash
# Inject supplementary context into a running delegate
maestro delegate message gem-143022-a7f2 "Also check src/utils/sanitize.ts"

# Chain: analyze then auto-fix
maestro delegate "analyze auth vulnerabilities" --to gemini --async
maestro delegate message gem-143022-a7f2 "Fix all critical vulnerabilities" --delivery after_complete
```

---

## Prompt Construction

Prompt assembly order:

1. **Mode protocol** — `~/.maestro/templates/cli/protocols/{mode}-protocol.md`
2. **User prompt** — the prompt text
3. **Rule template** — `~/.maestro/templates/cli/prompts/{rule}.txt` (if specified)

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

Delegate completion notifies the caller through dual channels:

1. **MCP channel** (primary) — push notification with structured `meta` (exec_id, event_type, status)
2. **Hook fallback** — JSONL file read by `delegate-monitor` PostToolUse hook

Notification format:
```
[DELEGATE DONE] gem-143022-a7f2 gemini/analysis completed
```

Throttling: `status_update` events at 10s, `snapshot` at 15s.

---

## Workflows

### Launch → Monitor → Retrieve

```bash
maestro delegate "analyze auth module" --to gemini --async
# → execId: gem-143022-a7f2

maestro delegate status gem-143022-a7f2
# → status: running

# Wait for MCP notification or hook callback...

maestro delegate output gem-143022-a7f2
# → full analysis result
```

### Chain: Analyze → Auto-Fix

```bash
maestro delegate "find all SQL injection vulnerabilities" --to gemini --async
maestro delegate message gem-143022-a7f2 "Fix all critical vulnerabilities" --delivery after_complete
# → message queues, auto-relaunches after analysis completes
```

### Cancel → Redirect

```bash
maestro delegate cancel gem-143022-a7f2
maestro delegate status gem-143022-a7f2
# → status: cancelled

# Launch new delegate with adjusted scope
maestro delegate "analyze only the payment module" --to gemini --async
```
