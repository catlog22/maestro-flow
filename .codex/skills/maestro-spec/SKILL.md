---
name: maestro-spec
disable-model-invocation: true
description: Manage project specs — add, load, remove entries, or initialize the
  spec system. Spec = 项目约束规则（编码规范、架构约束、质量标准）；可复用知识文档走 /maestro-manage knowledge
  capture。Triggers on "maestro-spec add", "记录规范", "添加约束", "添加规则", "加载规范",
  "maestro-spec setup", "初始化规范".
argument-hint: add|load|remove|setup [args...]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: none
version: 0.5.53
---

<purpose>
Spec management toolkit. Four subcommands:
- `add` — add a `<spec-entry>` by category, with role tagging and 4-scope routing
- `load` — load specs filtered by scope, category, and/or keyword into context
- `remove` — remove a `<spec-entry>` by ID (symmetric with `add`)
- `setup` — initialize `.workflow/specs/` by scanning the codebase for conventions
</purpose>

<dispatch>
Parse the first token of $ARGUMENTS. Run `maestro run skill --platform codex <step>` to load the matched workflow, then follow it completely.

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
