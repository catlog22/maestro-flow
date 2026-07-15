---
name: spec
description: Manage project specs — add, load, remove entries, or initialize the spec system
argument-hint: "add|load|remove|setup [args...]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
session-mode: brief
---

<purpose>
Spec management toolkit. Four subcommands:
- `add` — add a `<spec-entry>` by category, with role tagging and 4-scope routing
- `load` — load specs filtered by scope, category, and/or keyword into context
- `remove` — remove a `<spec-entry>` by ID (symmetric with `add`)
- `setup` — initialize `.workflow/specs/` by scanning the codebase for conventions
</purpose>

<dispatch>
Parse the first token of $ARGUMENTS. Run `maestro run skill <step>` to load the matched workflow, then follow it completely.

| Subcommand | Step | Description |
|------------|------|-------------|
| `add` | `specs-add` | Add spec entry by category with 4-scope routing |
| `load` | `specs-load` | Load specs filtered by scope, category, keyword |
| `remove` | `specs-remove` | Remove spec entry by ID |
| `setup` | `specs-setup` | Initialize specs by scanning codebase |

### Routing rules

- No subcommand → display this dispatch table and prompt for selection.
- Unrecognized token → display this table with usage hints.
- Remaining tokens after routing become the workflow's own arguments.
</dispatch>
