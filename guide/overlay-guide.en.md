---
title: "Overlay System Guide"
---

Maestro's Overlay system provides non-intrusive command extensions — injecting custom steps, reading requirements, quality gates, etc., without modifying the original `.claude/commands/*.md` files. Overlays are automatically re-applied during every `maestro install`.

---

## Core Concepts

Overlay = JSON file, declaring "what content to inject into which section of which command". Patcher wraps the injected content with HTML comment tags to achieve:
- **Idempotency** — Repeated apply does not produce duplicate content
- **Traceability** — Tags denote which overlay each piece of content comes from
- **Reversibility** — `remove` accurately strips the tagged content

### File Layout

```
~/.maestro/overlays/
├── cli-verify.json              # User overlay
├── quality-gate.json            # User overlay
├── docs/                        # Documents referenced by overlays
│   └── verify-protocol.md
└── _shipped/                    # Read-only overlays shipped with maestro (do not edit)
```

---

## Overlay File Format

```json
{
  "name": "cli-verify",
  "description": "Add CLI verification after execution",
  "targets": ["maestro-execute", "maestro-plan"],
  "priority": 50,
  "enabled": true,
  "patches": [
    {
      "section": "required_reading",
      "mode": "append",
      "content": "## CLI Verification Protocol (overlay)\n\n@~/.maestro/overlays/docs/verify-protocol.md"
    },
    {
      "section": "execution",
      "mode": "append",
      "content": "## CLI Verification (overlay)\n\nAfter execution, run:\n```bash\nmaestro delegate \"PURPOSE: Verify...\" --mode analysis\n```"
    }
  ]
}
```

### Field Description

| Field | Type | Required | Description |
|------|------|------|------|
| `name` | string | Yes | Unique identifier, kebab-case |
| `targets` | string[] | Yes | Target command names (excluding `.md`) |
| `priority` | number | No | Application priority, smaller values are applied first (default 50) |
| `enabled` | boolean | No | Set to `false` to temporarily disable |
| `scope` | string | No | `"global"` / `"project"` / `"any"` |
| `patches` | Patch[] | Yes | List of patches |

### Patch Fields

| Field | Description |
|------|------|
| `section` | Target XML section name |
| `mode` | `"append"` / `"prepend"` / `"replace"` / `"new-section"` |
| `content` | The Markdown content to inject |
| `afterSection` | Only for `new-section` mode: New section is inserted after this section |

### Available Sections

`purpose` · `required_reading` · `deferred_reading` · `context` · `execution` · `error_codes` · `success_criteria`

### Mode Behavior

| Mode | Behavior |
|------|------|
| `append` | Append before the closing tag of the section |
| `prepend` | Insert after the opening tag of the section |
| `replace` | Replace the entire content of the section |
| `new-section` | Create a new XML section (position controlled by `afterSection`) |

---

## Injection Mechanism

Patcher wraps the injected content with HTML comment tags:

```markdown
<!-- maestro-overlay:cli-verify#1 hash=a3f8b2c1 -->
## CLI Verification (overlay)
...
<!-- /maestro-overlay:cli-verify#1 -->
```

- `cli-verify` — overlay name, `#1` — patch index, `hash` — SHA-256 short hash of the content (used for change detection)

**Idempotency**: During apply, it checks whether the tags exist. If the hash matches, it skips; if the hash differs, it strips first and then re-injects.

---

## Command Reference

```bash
# View overlays (interactive TUI)
maestro overlay list

# Apply all overlays (idempotent)
maestro overlay apply

# Add and apply
maestro overlay add <file.json>

# Export/Remove
maestro overlay export <name>
maestro overlay remove <name>

# Bundle and Import
maestro overlay bundle -o team-overlays.json
maestro overlay import-bundle team-overlays.json
```

### Bundle Format

```json
{
  "version": "1.0",
  "overlays": [
    { "name": "cli-verify", "targets": [...], "patches": [...] }
  ],
  "docs": {
    "verify-protocol.md": "# Verify Protocol\n\n..."
  }
}
```

When bundling, it automatically collects documents referenced via `@~/.maestro/overlays/docs/<name>` in the patch content.

---

## Interactive Management TUI

Run `maestro overlay list` to enter the terminal UI, supporting `[d] Delete` and `[q] Quit` operations. The section map is grouped by target command files, and patches are aggregated and displayed by overlay name.

---

## Create Overlay

```bash
# Create using natural language
/maestro-overlay "Add CLI code quality verification after maestro-execute finishes"

# Create manually
# 1. Write the overlay JSON file
# 2. maestro overlay add <file.json>
# 3. maestro overlay list to verify
```

---

## Best Practices

**Naming**: Descriptive kebab-case (`cli-verify-after-execute`), reflecting "what to do" rather than "where to change"

**Content**: Injected headings should have the `(overlay)` suffix, keep it concise, and reference external documents using `@~/.maestro/overlays/docs/`

**Priority**: `10-30` Infrastructure, `40-60` Standard steps, `70-90` Post-checks

**Team Collaboration**: Use `bundle` / `import-bundle` to share, put project-level overlays under version control

---

## Workflow Composer & Player

Composer + Player translates natural language descriptions into reusable workflow templates for repeated execution.

### Composer: Design Templates

```bash
/maestro-composer "First analyze code architecture, then formulate a plan, implement features, and finally test and review"
/maestro-composer --resume                              # Resume interrupted design
/maestro-composer -- edit ~/.maestro/templates/workflows/feature-plan-test.json  # Edit
```

5-stage interaction: Parse → Resolve → Enrich → Confirm → Persist

<details>
<summary>Mapping Steps to Executors</summary>

| User Expression | Mapped Executor |
|----------|-----------|
| "Analyze", "Review", "Explore" | `maestro delegate` |
| "Plan", "Design" | `maestro-plan` |
| "Implement", "Develop" | `maestro-execute` |
| "Test", "Verify" | `quality-test` |
| "Code review" | `quality-review` |

</details>

<details>
<summary>Checkpoint Auto-Injection Rules</summary>

- After producing artifacts (plan, spec, analysis, etc.)
- Before execution-type nodes
- Before Agent-type nodes
- Before long-running nodes
- After testing completes
- Pause points explicitly specified by the user

</details>

### Player: Execute Templates

```bash
/maestro-player --list                                  # List available templates
/maestro-player feature-plan-test --context goal="Implement user authentication"  # Execute
/maestro-player feature-plan-test --context goal="..." --dry-run  # Preview
/maestro-player -c                                      # Resume interrupted execution
```

| Node Type | Execution Method |
|---------|---------|
| skill | `Skill(skill=..., args=...)` |
| cli | `maestro delegate` (background) |
| agent | `Agent(subagent_type=...)` |
| checkpoint | Inline state saving + Optional pause |

**Variable Binding**: `--context goal="..." scope="..."`, missing required variables will be interactively prompted

**Runtime References**: `{goal}` User variable, `{N-001.session_id}` Upstream node output, `{prev_session_id}` Previous node

<details>
<summary>Session Tracking and Error Handling</summary>

**Session Directory**: `.workflow/.maestro/player-<YYYYMMDD>-<HHmmss>/` (status.json, checkpoints/, artifacts/)

**Codex Version**: Uses the `spawn_agents_on_csv` wave model, barrier nodes are executed individually, non-barrier nodes are executed in parallel

**Error Handling**:
| on_fail | Behavior |
|---------|------|
| `abort` | Ask the user: Retry/Skip/Abort |
| `skip` | Mark as skipped, continue |
| `retry` | Retry once, if still fails then abort |

</details>

### Example

```bash
# 1. Create template
/maestro-composer "Analyze architecture → Formulate plan → Execute development → Test → Review"

# 2. Reuse across different projects
/maestro-player feature-full-lifecycle --context goal="Implement payment module"
/maestro-player feature-full-lifecycle --context goal="Add notification system"

# 3. Iterative optimization
/maestro-composer --edit ~/.maestro/templates/workflows/feature-full-lifecycle.json
```