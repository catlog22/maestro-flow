<!-- session-mode: none -->
# Delegate Usage

```bash
maestro delegate "<PROMPT>" [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--to <tool>` | gemini, qwen, codex, claude, opencode | First enabled |
| `--role <role>` | analyze, explore, review, implement, plan, brainstorm, research | — |
| `--mode <mode>` | `analysis` (read-only) / `write` (modify) | `analysis` |
| `--model <model>` | Model override | Tool's `primaryModel` |
| `--cd <dir>` | Working directory | Current |
| `--rule <template>` | Protocol + prompt template | — |
| `--id <id>` | Execution ID | Auto: `{prefix}-{HHmmss}-{rand4}` |
| `--resume [id]` | Resume previous session | — |
| `--includeDirs <dirs>` | Additional directories (comma-separated) | — |

Tool resolution: `--to` > `--role` > first enabled in config.

**`--mode` is authoritative** — `MODE:` in prompt text is a hint only.

## Prompt Template

```
PURPOSE: [goal] + [success criteria]
TASK: [step 1] | [step 2] | [step 3]
MODE: analysis|write
CONTEXT: @[file patterns] | Memory: [prior work]
EXPECTED: [output format]
CONSTRAINTS: [scope limits]
```

### CONTEXT Patterns

- `@**/*` — all files (default)
- `@src/**/*.ts` — scoped
- `@../shared/**/*` — sibling dir (**requires `--includeDirs ../shared`**)

### --rule Templates

**Universal**: `universal-rigorous-style`, `universal-creative-style`

**Analysis**: `analysis-trace-code-execution`, `analysis-diagnose-bug-root-cause`, `analysis-analyze-code-patterns`, `analysis-analyze-technical-document`, `analysis-review-architecture`, `analysis-review-code-quality`, `analysis-analyze-performance`, `analysis-assess-security-risks`

**Planning**: `planning-plan-architecture-design`, `planning-breakdown-task-steps`, `planning-design-component-spec`, `planning-plan-migration-strategy`

**Development**: `development-implement-feature`, `development-refactor-codebase`, `development-generate-tests`, `development-implement-component-ui`, `development-debug-runtime-issues`

## Execution Rules

**ALWAYS** use `run_in_background: true`, then **stop immediately**:

```
Bash({ command: "maestro delegate \"...\" --to gemini --mode analysis", run_in_background: true })
```

- NEVER use foreground Bash for delegate calls
- NEVER output text or tool calls after the background Bash call
- Callback includes status + output — use it directly

### Execution ID Prefix

gemini→`gem`, qwen→`qwn`, codex→`cdx`, claude→`cld`, opencode→`opc`

### Resume

```bash
maestro delegate "<PROMPT>" --to gemini --resume           # last session
maestro delegate "<PROMPT>" --to gemini --resume <id>      # specific
```

### Message Delivery

| Mode | Use For |
|------|---------|
| `inject` | Supplementary context to running worker |
| `after_complete` | Chained tasks after completion |

```bash
maestro delegate message <exec-id> "additional context"
maestro delegate message <exec-id> "next task" --delivery after_complete
```

## Auto-Invoke Triggers

Proactively invoke for `analysis` mode — no user confirmation needed:

| Trigger | Suggested Rule |
|---------|---------------|
| Self-repair fails (1+ attempts) | `analysis-diagnose-bug-root-cause` |
| Ambiguous requirements | `planning-breakdown-task-steps` |
| Architecture decisions needed | `planning-plan-architecture-design` |
| Pattern uncertainty | `analysis-analyze-code-patterns` |
| Critical/security code paths | `analysis-assess-security-risks` |

**Always** `run_in_background: true`, default `--mode analysis`.
