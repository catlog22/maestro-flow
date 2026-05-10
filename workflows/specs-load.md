# Workflow: specs-load

Load spec files filtered by category. Supports project, global, team, and personal scopes.

## Arguments

```
$ARGUMENTS: "[--scope <scope>] [--uid <uid>] [--role <role>] [keyword]"

--scope     -- load scope: project (default) | global | team | personal
--uid       -- user id for personal scope (auto-detected from git if omitted)
--role      -- filter by role: implement | plan | test | review | analyze | explore
               Loads primary role doc in full + cross-file entries with matching roles attr
keyword     -- optional, grep within loaded specs for matching sections
```

## Category -> File Mapping (1:1)

Each category loads exactly one file per layer. Same mapping as spec-add.

## File → Primary Role Mapping

| File | Role |
|------|------|
| `coding-conventions.md` | implement |
| `architecture-constraints.md` | plan |
| `test-conventions.md` | test |
| `review-standards.md` | review |
| `debug-notes.md` | analyze |
| `quality-rules.md` | review |
| `learnings.md` | implement |
| `tools.md` | _(per-entry roles)_ |

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

Extract `--scope`, `--uid`, `--role <role>` and remaining text (keyword for grep).

### Step 2: Load Specs via CLI

```bash
maestro spec load --scope <scope> [--uid <uid>] [--role <role>] [--keyword <word>]
```

If `maestro spec load` CLI is unavailable, read files directly from the resolved directory.

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
