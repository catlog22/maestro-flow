# Delegate Execution Specification

<purpose>
Unified reference for `maestro delegate` — synchronous task delegation with broker-managed lifecycle, message injection, and MCP notifications.
</purpose>

**References**: `~/.maestro/cli-tools.json` (tool config), `~/.maestro/templates/cli/` (protocol + prompt templates)

---

## 1. Quick Reference

<context>

### Command Syntax

```bash
maestro delegate "<PROMPT>" [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--to <tool>` | Explicit tool: gemini, qwen, codex, claude, opencode | First enabled in config |
| `--role <role>` | Capability role: analyze, explore, review, implement, plan, brainstorm, research | — (resolves via config) |
| `--mode <mode>` | `analysis` (read-only) or `write` (create/modify/delete) | `analysis` |
| `--model <model>` | Model override | Tool's `primaryModel` |
| `--cd <dir>` | Working directory | Current directory |
| `--rule <template>` | Load protocol + prompt template | — (optional) |
| `--id <id>` | Execution ID | Auto: `{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | Resume previous session (last if no id) | — |
| `--includeDirs <dirs>` | Additional directories (comma-separated) | — |
| `--backend <type>` | Adapter backend: `direct` or `terminal` (tmux/wezterm) | `direct` |

### Tool Resolution Priority

1. `--to <tool>` — explicit tool selection (backward compat, highest priority)
2. `--role <role>` — capability-based auto-selection via config
3. No flag — first enabled tool in config

### Role-Based Tool Selection

Roles map to tools via `cli-tools.json` configuration:
- User-defined roles in `roles` section override built-in defaults
- Workspace `.maestro/cli-tools.json` overrides global `~/.maestro/cli-tools.json`
- Built-in roles: `analyze`, `explore`, `review`, `implement`, `plan`, `brainstorm`, `research`

### Mode Definition (Authoritative)

| Mode | Permission | Auto-Invoke Safe | Use For |
|------|-----------|------------------|---------|
| `analysis` | Read-only | Yes | Review, exploration, diagnosis, architecture analysis |
| `write` | Create/Modify/Delete | No — requires explicit intent | Implementation, bug fixes, refactoring |

> `--mode` is the **authoritative** permission control. The `MODE:` field inside prompt text is a hint for the agent — both should be consistent, but `--mode` governs actual behavior.
</context>

---

## 2. Configuration

<context>

### Config File: `~/.maestro/cli-tools.json`

| Field | Description |
|-------|-------------|
| `enabled` | Tool availability |
| `primaryModel` | Default model |
| `secondaryModel` | Fallback model |
| `tags` | Capability tags (for caller-side routing) |
| `type` | `builtin` / `cli-wrapper` / `api-endpoint` |

> `api-endpoint` tools support **analysis only** — no file write capability.

### Tool Selection

1. Explicit `--to` specified → use it (validate enabled)
2. No `--to` → first enabled tool in config order

### Fallback Chain

Primary model fails → `secondaryModel` → next enabled tool → first enabled (default).

### MCP Server Startup

```bash
# Claude Code — load Maestro as development MCP server
claude --dangerously-load-development-channels server:maestro --dangerously-skip-permissions
```

With MCP connected, all delegate tools are available programmatically.
</context>

---

## 3. Prompt Construction

<context>

### Assembly Order

`maestro delegate` builds the final prompt as:

1. **Mode protocol** — `~/.maestro/templates/cli/protocols/{mode}-protocol.md`
2. **User prompt** — the positional `"<PROMPT>"` value
3. **Rule template** — `~/.maestro/templates/cli/prompts/{rule}.txt` (if `--rule` specified)

### Prompt Template (6 Fields)

```
PURPOSE: [goal] + [why] + [success criteria]
TASK: [step 1] | [step 2] | [step 3]
MODE: analysis|write
CONTEXT: @[file patterns] | Memory: [prior work context]
EXPECTED: [output format] + [quality criteria]
CONSTRAINTS: [scope limits] | [special requirements]
```

- **PURPOSE**: What + Why + Success. Not "Analyze code" but "Identify auth vulnerabilities; success = OWASP Top 10 covered"
- **TASK**: Specific verbs. Not "Review code" but "Scan for SQL injection | Check XSS | Verify CSRF"
- **MODE**: Must match `--mode` flag
- **CONTEXT**: File scope + memory from prior work
- **EXPECTED**: Deliverable format, not just "Report"
- **CONSTRAINTS**: Task-specific limits (vs `--rule` which loads generic templates)

### CONTEXT: File Patterns + Directory

- `@**/*` — all files in working directory (default)
- `@src/**/*.ts` — scoped pattern
- `@../shared/**/*` — sibling directory (**requires `--includeDirs`**)

**Rule**: If CONTEXT uses `@../dir/**/*`, must add `--includeDirs ../dir`.

```bash
maestro delegate "CONTEXT: @**/* @../shared/**/*" --to gemini --mode analysis \
  --cd "src/auth" --includeDirs "../shared"
```

### CONTEXT: Memory

Include when building on previous work:

```
Memory: Building on auth refactoring (commit abc123), implementing refresh tokens
Memory: Integration with auth module, using shared error patterns
```

### --rule Templates

**Universal**: `universal-rigorous-style`, `universal-creative-style`

**Analysis**: `analysis-trace-code-execution`, `analysis-diagnose-bug-root-cause`, `analysis-analyze-code-patterns`, `analysis-analyze-technical-document`, `analysis-review-architecture`, `analysis-review-code-quality`, `analysis-analyze-performance`, `analysis-assess-security-risks`

**Planning**: `planning-plan-architecture-design`, `planning-breakdown-task-steps`, `planning-design-component-spec`, `planning-plan-migration-strategy`

**Development**: `development-implement-feature`, `development-refactor-codebase`, `development-generate-tests`, `development-implement-component-ui`, `development-debug-runtime-issues`

### Complete Example

```bash
maestro delegate "PURPOSE: Identify OWASP Top 10 vulnerabilities in auth module; success = all critical/high documented with remediation
TASK: Scan for injection flaws | Check auth bypass vectors | Evaluate session management | Assess data exposure
MODE: analysis
CONTEXT: @src/auth/**/* @src/middleware/auth.ts | Memory: Using bcrypt + JWT
EXPECTED: Severity matrix, file:line references, remediation snippets, priority ranking
CONSTRAINTS: Focus on authentication | Ignore test files
" --to gemini --mode analysis --rule analysis-assess-security-risks --cd "src/auth"
```
</context>

---

## 4. Execution

<execution>

### Calling Convention

`maestro delegate` runs synchronously — it blocks until the delegate completes. To avoid blocking the conversation, **always** use `run_in_background: true` on the Bash tool call, then stop output immediately and wait for the background completion callback.

```
Bash({
  command: "maestro delegate \"<PROMPT>\" --to gemini --mode analysis",
  run_in_background: true
})
// STOP — do not output anything further
// Wait for Bash background completion callback to receive results
```

**Rules:**
- **Never** use foreground Bash for delegate calls — it blocks the conversation for the entire execution duration
- After the `Bash(run_in_background: true)` call, **stop immediately** — no follow-up text, no polling, no `delegate status` checks
- When the background callback arrives, retrieve output with `maestro delegate output <id>`

### Execution ID

ID prefix: gemini→`gem`, qwen→`qwn`, codex→`cdx`, claude→`cld`, opencode→`opc`

Format: `{prefix}-{HHmmss}-{rand4}` (e.g. `gem-143022-a7f2`)

Output to stderr: `[MAESTRO_EXEC_ID=<id>]`

```bash
maestro delegate "analyze code" --to gemini                        # auto-ID: gem-143022-a7f2
maestro delegate "fix bug" --to gemini --mode write --id my-task-1  # custom ID
```

### Session Resume

```bash
maestro delegate "continue" --to gemini --resume             # last session
maestro delegate "continue" --to gemini --resume <id>        # specific session
```

Resume auto-assembles previous conversation context. Warning emitted when context exceeds 32KB.

### Subcommands

```bash
# List executions
maestro delegate show                              # recent 20
maestro delegate show --all                        # up to 100

# Inspect state
maestro delegate status <id>                       # broker + history + snapshot preview
maestro delegate status <id> --events 10           # with more broker events
maestro delegate tail <id>                         # recent events + history
maestro delegate tail <id> --events 20 --history 20

# Get result
maestro delegate output <id>                       # assistant output
maestro delegate output <id> --verbose             # include timestamps

# Lifecycle control
maestro delegate cancel <id>                       # request cancellation

# Message delivery
maestro delegate message <id> "text"               # inject into running worker
maestro delegate message <id> "text" --delivery after_complete  # chain after done
maestro delegate messages <id>                     # list queued messages
```

### MCP Tools

All subcommands are also available as MCP tools for programmatic access:

| CLI Subcommand | MCP Tool | Extra Params |
|---------------|----------|-------------|
| `message <id> "text"` | `delegate_message` | `delivery` (inject/after_complete) |
| `messages <id>` | `delegate_messages` | — |
| `status <id>` | `delegate_status` | `eventLimit` |
| `output <id>` | `delegate_output` | — |
| `tail <id>` | `delegate_tail` | `limit` |
| `cancel <id>` | `delegate_cancel` | — |

### Snapshot & Preview

`delegate status` includes a `Preview:` field showing the agent's latest output — built from `assistant_message`, `tool_use` completions, and `file_change` events.

### Job Lifecycle

```
queued → running → completed
                 → failed
                 → cancelled
              ↗
         input_required
```

### Message Delivery

| Mode | Behavior | Use For |
|------|----------|---------|
| `inject` | Routes to running worker stdin; non-interactive adapters auto cancel + relaunch | Supplementary context, course correction |
| `after_complete` | Queues message; relaunches delegate with queued message on completion | Chained tasks, post-processing |

</execution>

---

## 5. Auto-Invoke Triggers

<execution>

Proactively invoke `maestro delegate` when these conditions are met — no user confirmation needed for `analysis` mode:

| Trigger | Suggested Rule |
|---------|---------------|
| Self-repair fails (1+ attempts) | `analysis-diagnose-bug-root-cause` |
| Ambiguous requirements | `planning-breakdown-task-steps` |
| Architecture decisions needed | `planning-plan-architecture-design` |
| Pattern uncertainty | `analysis-analyze-code-patterns` |
| Critical/security code paths | `analysis-assess-security-risks` |

### Principles

- Default `--mode analysis` (safe, read-only)
- Always `Bash(run_in_background: true)` — stop immediately, wait for callback
- Use `--role` for capability-based tool selection; fallback chain is config-driven
- Rule suggestions are guidelines — choose the best fit
- Use `inject` for supplementary context mid-execution; `after_complete` for chained multi-step tasks
</execution>

---

## 6. Workflows

<execution>

### Basic Usage

```
Bash({
  command: 'maestro delegate "analyze auth module" --to gemini',
  run_in_background: true
})
// → STOP, wait for callback
// → on callback: maestro delegate output <id>
```

### Inject Supplementary Context

```bash
maestro delegate message gem-143022-a7f2 "Also check src/utils/sanitize.ts"
# → accepted: true, delivery: inject
```

### Chain: Analyze → Fix

```
Bash({
  command: 'maestro delegate "find SQL injection vulnerabilities" --to gemini',
  run_in_background: true
})
// → STOP, wait for callback
// → on callback: chain next step
maestro delegate message gem-143022-a7f2 "Fix all critical vulnerabilities" --delivery after_complete
// → queued, relaunches after analysis completes
```
</execution>
