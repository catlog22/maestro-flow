---
name: manage-knowhow
description: Manage knowhow entries (workflow and system)
argument-hint: "<subcommand: list|search|view|edit|delete|prune> [query|id] [--store workflow|system|all] [--tag <tag>] [--type compact|tip]"
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
Manage knowhow across two stores: workflow (`.workflow/knowhow/`) and system memory (`~/.claude/projects/*/memory/`). Operations: list, search, view, edit, delete, prune.
</purpose>

<required_reading>
@~/.maestro/workflows/knowhow.md
</required_reading>

<context>
Arguments: $ARGUMENTS

Dual store architecture (paths, formats, index) defined in workflow knowhow.md.

**Output boundary**: Workflow store writes MUST target `.workflow/knowhow/` only. System store writes MUST target `~/.claude/projects/*/memory/` only. NEVER modify source code or files outside these paths.

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

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Execute** (Subcommand routing)
- REQUIRED: Subcommand parsed from first token (list/search/view/edit/delete/prune).
- REQUIRED: Both store paths resolved (workflow + system).
- BLOCKED if E001 (no memory stores found) or invalid subcommand.

**GATE 2: Execute → Mutate** (For destructive subcommands: delete/prune/edit)
- REQUIRED: Target entry/file resolved and exists (E002 if not found).
- REQUIRED: MEMORY.md protected from deletion (E004 — use `edit` instead).
- REQUIRED: For `prune`: at least one filter provided (E003).
- REQUIRED: User confirmation before delete/prune unless `--confirm` flag set.
- BLOCKED if target unresolvable or confirmation denied.
</execution>

<invariants>
1. **MEMORY.md protected** — NEVER delete MEMORY.md; only editable via `edit` subcommand
2. **MEMORY.md line limit** — MUST warn (W003) when MEMORY.md exceeds 200 lines; content beyond 200 lines will be truncated at load
3. **Confirmation on destructive ops** — `delete` and `prune` MUST require user confirmation unless `--confirm` flag is set
4. **Store isolation** — `prune` operates on workflow store only; NEVER prune system memory files
5. **Reference integrity** — `delete` MUST check for references from other entries before removing; warn if orphaned references would result
6. **Dry-run safety** — `--dry-run` MUST NOT write any files; preview destructive operations only
7. **Index consistency** — after delete/prune, workflow index MUST be updated to reflect removals
</invariants>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | No memory stores found — for workflow store run `/manage-knowhow-capture`; for system store create `~/.claude/projects/{project}/memory/MEMORY.md` manually | resolve_paths |
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
- [ ] Next step routed
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Want to capture new knowhow | `/manage-knowhow-capture` |
| View project state | `/manage-status` |
| Prune stale entries | `/manage-knowledge-audit --scope knowhow` |
</completion>
