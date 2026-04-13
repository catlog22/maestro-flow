# CLI Tools Execution Specification

<purpose>
Unified reference for `maestro cli` — runs agent tools (gemini, qwen, codex, claude, opencode) with a shared interface for prompt, mode, model, directory, templates, and session resume.
</purpose>

**References**: `~/.maestro/cli-tools.json` (tool config), `~/.maestro/templates/cli/` (protocol + prompt templates)

---

## 1. Quick Reference

<context>

### Command Syntax

```bash
maestro cli -p "<PROMPT>" [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --prompt` | **Required**. Prompt text | — |
| `--tool <name>` | Tool: gemini, qwen, codex, claude, opencode | First enabled in config |
| `--mode <mode>` | `analysis` (read-only) or `write` (create/modify/delete) | `analysis` |
| `--model <model>` | Model override | Tool's `primaryModel` |
| `--cd <dir>` | Working directory | Current directory |
| `--includeDirs <dirs>` | Additional directories (comma-separated) | — |
| `--rule <template>` | Load protocol + prompt template | — (optional) |
| `--id <id>` | Execution ID | Auto: `{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | Resume session (last if no id, comma-separated for merge) | — |

### Mode Definition (Authoritative)

| Mode | Permission | Auto-Invoke Safe | Use For |
|------|-----------|------------------|---------|
| `analysis` | Read-only | Yes | Review, exploration, diagnosis, architecture analysis |
| `write` | Create/Modify/Delete | No — requires explicit intent | Implementation, bug fixes, refactoring |

> `--mode` is the **authoritative** permission control for maestro cli. The `MODE:` field inside prompt text is a hint for the agent — both should be consistent, but `--mode` governs actual behavior.
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

1. Explicit `--tool` specified → use it (validate enabled)
2. No `--tool` → first enabled tool in config order

### Fallback Chain

Primary model fails → `secondaryModel` → next enabled tool → first enabled (default).
</context>

---

## 3. Prompt Construction

<context>

### Assembly Order

`maestro cli` builds the final prompt as:

1. **Mode protocol** — `~/.maestro/templates/cli/protocols/{mode}-protocol.md`
2. **User prompt** — the `-p` value
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
maestro cli -p "CONTEXT: @**/* @../shared/**/*" --tool gemini --mode analysis \
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
maestro cli -p "PURPOSE: Identify OWASP Top 10 vulnerabilities in auth module; success = all critical/high documented with remediation
TASK: Scan for injection flaws | Check auth bypass vectors | Evaluate session management | Assess data exposure
MODE: analysis
CONTEXT: @src/auth/**/* @src/middleware/auth.ts | Memory: Using bcrypt + JWT
EXPECTED: Severity matrix, file:line references, remediation snippets, priority ranking
CONSTRAINTS: Focus on authentication | Ignore test files
" --tool gemini --mode analysis --rule analysis-assess-security-risks --cd "src/auth"
```
</context>

---

## 4. Execution

<execution>

### Execution ID

ID prefix: gemini→`gem`, qwen→`qwn`, codex→`cdx`, claude→`cld`, opencode→`opc`

Output to stderr: `[MAESTRO_EXEC_ID=<id>]`

```bash
maestro cli -p "<PROMPT>" --tool gemini --mode analysis    # auto-ID: gem-143022-a7f2
maestro cli -p "<PROMPT>" --tool gemini --mode write --id my-task-1  # custom ID
```

### Session Resume

```bash
maestro cli -p "<PROMPT>" --tool gemini --resume              # last session
maestro cli -p "<PROMPT>" --tool gemini --mode write --resume <id>  # specific
maestro cli -p "<PROMPT>" --tool gemini --resume <id1>,<id2>     # merge multiple
```

Resume auto-assembles previous conversation context. Warning emitted when context exceeds 32KB.

### Subcommands

```bash
maestro cli show                     # recent 20 executions
maestro cli show --all               # up to 100
maestro cli output <id>              # assistant output (always shows status header)
maestro cli output <id> --verbose    # include start/end timestamps
maestro cli output <id> --tail 20    # last 20 lines of output
maestro cli output <id> --lines 10   # alias for --tail
maestro cli watch <id>               # stream output in real-time until completion
maestro cli watch <id> --timeout 60000  # auto-exit after 60s
```
</execution>

---

## 5. Auto-Invoke Triggers

<execution>

Proactively invoke `maestro cli` when these conditions are met — no user confirmation needed for `analysis` mode:

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
- Tool fallback: `gemini` → `qwen` → `codex`
- Rule suggestions are guidelines — choose the best fit
</execution>
