<!-- session-mode: inherited -->
---
name: spec-load
alias: spec-load
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Workflow: spec-load

Load spec files filtered by category. Supports project, global, team, and personal scopes.

## Arguments

```
$ARGUMENTS: "[--scope <scope>] [--uid <uid>] [--category <category>] [keyword]"

--scope     -- load scope: project (default) | global | team | personal
--uid       -- user id for personal scope (auto-detected from git if omitted)
--category  -- filter by category: coding | arch | test | review | debug | quality | learning | ui
               Loads category's primary doc in full + cross-file entries with matching category attr
keyword     -- optional, grep within loaded specs for matching sections
```

## Category -> File Mapping (1:1)

Each category loads exactly one file per layer. Same mapping as spec-add.

## File → Primary Category Mapping

| File | Category |
|------|----------|
| `coding-conventions.md` | coding |
| `architecture-constraints.md` | arch |
| `test-conventions.md` | test |
| `review-standards.md` | review |
| `debug-notes.md` | debug |
| `quality-rules.md` | quality |
| `learnings.md` | learning |
| `ui-conventions.md` | ui |

## Layer Order by Scope

| Scope | Layers loaded (lowest -> highest priority) |
|-------|-------------------------------------------|
| `project` | baseline only |
| `global` | global + baseline |
| `team` | baseline + team shared |
| `personal` | baseline + team shared + personal (requires uid) |

Each layer is prefixed with a section header when multi-layer.

## Execution Steps

### Step 1: Parse Arguments

Extract `--scope`, `--uid`, `--category <category>` and remaining text (keyword for grep).

### Step 2: Load Specs via CLI

```bash
maestro spec load --scope <scope> [--uid <uid>] [--category <category>] [--keyword <word>]
```

If `maestro spec load` CLI is unavailable, read files directly from the resolved directory; flag loaded specs as [LOW CONFIDENCE] (CLI unavailable, direct file read).

### Step 3: Keyword Filter (optional)

If keyword provided, grep within loaded content:
```bash
grep -n -i -C 3 "$KEYWORD" <loaded content>
```

### Step 4: Display Results

Output loaded specs content. If no specs found, show:
```
(No specs found. Run "maestro spec init --scope <scope>" to initialize.)
```
