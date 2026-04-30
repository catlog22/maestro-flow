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
| `--includeDirs <dirs>` | Additional directories (comma-separated) | — |
| `--rule <template>` | Load protocol + prompt template | — (optional) |
| `--id <id>` | Execution ID | Auto: `{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | Resume session (last if no id, comma-separated for merge) | — |
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

### Supported Tools

| Tool | Agent Type | Adapter |
|------|-----------|---------|
| `gemini` | gemini | StreamJsonAdapter |
| `qwen` | qwen | StreamJsonAdapter |
| `codex` | codex | CodexCliAdapter |
| `claude` | claude-code | ClaudeCodeAdapter |
| `opencode` | opencode | OpenCodeAdapter |

### Tool Selection

1. Explicit `--to` specified → use it (validate enabled)
2. No `--to` → first enabled tool in config order

### Fallback Chain

Primary model fails → `secondaryModel` → next enabled tool → first enabled (default).
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
# Cross-directory example
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

Output to stderr: `[MAESTRO_EXEC_ID=<id>]`

```bash
maestro delegate "<PROMPT>" --to gemini --mode analysis    # auto-ID: gem-143022-a7f2
maestro delegate "<PROMPT>" --to gemini --mode write --id my-task-1  # custom ID
```

### Session Resume

```bash
maestro delegate "<PROMPT>" --to gemini --resume              # last session
maestro delegate "<PROMPT>" --to gemini --mode write --resume <id>  # specific
maestro delegate "<PROMPT>" --to gemini --resume <id1>,<id2>     # merge multiple
```

Resume auto-assembles previous conversation context. Warning emitted when context exceeds 32KB.

### Subcommands

```bash
maestro delegate show                     # recent 20 executions
maestro delegate show --all               # up to 100
maestro delegate output <id>              # assistant output
maestro delegate output <id> --verbose    # include start/end timestamps
maestro delegate status <id>              # broker + history + snapshot preview
maestro delegate tail <id>                # recent events + history
maestro delegate cancel <id>              # request cancellation
```
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
- Wait for results before next action
- Use `--role` for capability-based tool selection; fallback chain is config-driven
- Rule suggestions are guidelines — choose the best fit
</execution>
