---
name: manage-knowhow
description: Manage memory entries — workflow memory (.workflow/knowhow/) and system memory (~/.claude/projects/*/memory/)
argument-hint: "[list|search|view|edit|delete|prune] [query|id|file] [--store workflow|system|all] [--tag tag] [--type compact|tip]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Unified memory management across two stores:
1. **Workflow memory** (`.workflow/knowhow/`) — Session compacts and tips with JSON index, created by `manage-knowhow-capture`
2. **System memory** (`~/.claude/projects/{project}/memory/`) — Claude Code auto-memory (MEMORY.md + topic files), persists across conversations

Provides list/search/view/edit/delete/prune operations. Default store is `all` (show both).
</purpose>

<required_reading>
@~/.maestro/workflows/knowhow.md
</required_reading>

<context>
Arguments: $ARGUMENTS

Dual store architecture (paths, formats, index) defined in workflow memory.md.

**Subcommands:**
- `list` — List entries from both stores (default if no arguments)
- `search <query>` — Full-text search across both stores
- `view <id|file>` — Display a workflow entry by ID or system file by name
- `edit <file>` — Edit a system memory file (MEMORY.md or topic file)
- `delete <id|file>` — Remove an entry/file (with confirmation)
- `prune` — Bulk cleanup by criteria

**Flags:**
- `--store <workflow|system|all>` — Target store (default: `all` for list/search, inferred for other ops)
- `--tag <tag>` — Filter by tag (workflow store)
- `--type <compact|tip>` — Filter by entry type (workflow store)
- `--before <YYYY-MM-DD>` — Entries before date
- `--after <YYYY-MM-DD>` — Entries after date
- `--dry-run` — Preview destructive ops without executing
- `--confirm` — Skip confirmation prompt
</context>

<execution>
Follow '~/.maestro/workflows/knowhow.md' Part A (KnowHow Management) completely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | No memory stores found — run `/manage-knowhow-capture` or create MEMORY.md | resolve_paths |
| E002 | error | Entry ID or filename not found | execute_view, execute_delete |
| E003 | error | Prune requires at least one filter (--tag, --type, --before, --after) | execute_prune |
| E004 | error | Cannot delete MEMORY.md — use `edit` subcommand instead | execute_delete |
| W001 | warning | Workflow index has orphaned files or dangling references | integrity_check |
| W002 | warning | MEMORY.md references non-existent topic file | integrity_check |
| W003 | warning | MEMORY.md exceeds 200 lines — content will be truncated at load | execute_edit |
</error_codes>

<success_criteria>
- [ ] Both store paths correctly resolved
- [ ] Subcommand correctly detected from arguments
- [ ] Store auto-detected from argument format (KNW-*/TIP-* vs filename)
- [ ] List: both stores displayed with appropriate formatting
- [ ] Search: results from both stores, ranked by relevance
- [ ] View: correct store selected, full content displayed
- [ ] Edit: system memory files editable, MEMORY.md kept under 200 lines
- [ ] Delete: MEMORY.md protected, confirmation required, references checked
- [ ] Prune: workflow-only, filters validated, index updated
- [ ] Integrity check catches orphans and broken links
- [ ] Next step: `/manage-knowhow-capture compact` to save new memory, or `/manage-status` to continue workflow
</success_criteria>
