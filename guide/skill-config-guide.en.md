---
title: "Skill Parameter Configuration Guide"
---

Set default parameters for 51 commands/skills, auto-injected via Hook — no manual input needed each time.

---

## Overview

Maestro Skill Config solves a common pain point: manually typing `--auto-commit --method auto -y` every time you call `/maestro-execute`.

```
User calls /maestro-execute 3
       ↓
skill-context hook (UserPromptSubmit)
       ↓ Match skill → Load config → Compare existing params
       ↓
additionalContext injects defaults
       ↓
Equivalent to /maestro-execute 3 --auto-commit --method auto -y
```

---

## Prerequisites

Ensure `standard` level or above hooks are installed:

```bash
maestro hooks status              # Check status
maestro hooks install --level standard  # Install
```

---

## Configuration File

### Path and Priority

| Priority | Path | Description |
|----------|------|-------------|
| 1 (highest) | `{project}/.maestro/skill-config.json` | Project-level override |
| 2 | `~/.maestro/skill-config.json` | Global configuration |

<details>
<summary>File structure example</summary>

```json
{
  "version": "1.0.0",
  "skills": {
    "maestro-execute": {
      "params": {
        "--auto-commit": true,
        "--method": "auto",
        "-y": true
      },
      "updated": "2026-05-01T12:00:00Z"
    },
    "maestro-plan": {
      "params": {
        "--auto": true
      }
    }
  }
}
```

Merge strategy: Project-level overrides global, deep-merged at skill granularity (project takes priority).

</details>

---

## CLI Usage

```bash
maestro config list                        # List all configurable skills
maestro config set <skill> <param> <value> [-g]  # Set (-g for global)
maestro config show [skill]                # View configuration
maestro config show --json                 # JSON format
maestro config unset <skill> <param> [-g]  # Remove single parameter
maestro config reset [skill] [-g]          # Reset configuration
```

> Parameter names don't need the `--` prefix; CLI auto-completes.

---

## TUI Interactive Interface

```bash
maestro config                    # Launch dashboard
maestro config edit <skill>       # Edit specific skill
```

### Dashboard

```
╭─────────────────────────────────────╮
│ MAESTRO SKILL CONFIG                │
│ Commands discovered:    51          │
│ Skills with defaults:   3           │
│ Hook (skill-context):   installed   │
│                                     │
│ [1] Skills  [2] Config Sources      │
│   [q] Quit                          │
╰─────────────────────────────────────╯
```

### Parameter Editor

```
▸ --auto-commit    [x] true       (boolean)
  --method         auto           (agent|codex|gemini|cli|auto)
  --executor       <not set>      (string)
  -y               [ ] false      (boolean)

[↑↓] Navigate  [Space] Toggle/Cycle  [Enter] Edit  [d] Delete  [Esc] Back
```

Operations: Boolean → `Space` toggle / Enum → `Space` cycle / String → `Enter` edit / Save: `[g]` Global or `[p]` Project

---

## Hook Injection Mechanism

The `skill-context` hook triggers on `UserPromptSubmit`:

1. Match skill name (hardcoded patterns + generic regex fallback)
2. Load global + project-level config, deep-merge
3. Conflict detection: skip explicitly specified parameters
4. Inject via `additionalContext` (does not modify original input)

---

## Common Configuration Examples

```bash
# Development mode (auto-commit + skip confirmation)
maestro config set maestro-execute auto-commit true -g
maestro config set maestro-execute y true -g
maestro config set maestro-execute method auto -g

# Review mode (deep review)
maestro config set quality-review level deep -g

# Planning mode (auto + collaborative)
maestro config set maestro-plan auto true -g
maestro config set maestro-plan collab true

# Analysis mode (silent)
maestro config set maestro-analyze y true -g
maestro config set maestro-analyze c true -g
```

---

## Important Notes

1. **Hook must be installed** — Injection depends on `skill-context` hook
2. **Parameter name matching** — Must match `argument-hint`
3. **Positional parameters not configurable** — `[phase]`, `<path>` must be manually specified
4. **Project-level config not tracked** — `.maestro/skill-config.json` typically in `.gitignore`

---

## Command Reference

| Command | Description |
|---------|-------------|
| `maestro config` | TUI dashboard |
| `maestro config list` | List all configurable skills |
| `maestro config show [skill]` | View configuration |
| `maestro config set <skill> <param> <value> [-g]` | Set parameter default |
| `maestro config unset <skill> <param> [-g]` | Remove parameter default |
| `maestro config reset [skill] [-g]` | Reset configuration |
| `maestro config edit <skill>` | TUI edit specific skill |
| `maestro cfg ...` | Alias for `config` |
