---
name: manage-knowhow
description: Manage knowhow entries (workflow and system)
argument-hint: "[list|search|view|edit|delete|prune] [query|id|file] [--store
  workflow|system|all] [--tag tag] [--type type]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
---

<purpose>
Manage knowhow entries across workflow and system stores. Provides list, search, view, edit, delete, and prune operations over `.workflow/knowhow/` (workflow store) and `~/.claude/projects/{project}/memory/` (system store).
</purpose>

<context>
$ARGUMENTS — subcommand followed by options. Defaults to `list` if no arguments.

```bash
$manage-knowhow
$manage-knowhow "list --store workflow"
$manage-knowhow "search authentication"
$manage-knowhow "view KNW-20260318-001"
$manage-knowhow "edit MEMORY.md"
$manage-knowhow "delete TIP-20260318-001 --confirm"
$manage-knowhow "prune --before 2026-01-01 --type tip --dry-run"
```

**Subcommands**: `list`, `search`, `view`, `edit`, `delete`, `prune`.

**Flags**:
- `--store workflow|system|all` — Target store (default: all)
- `--tag <tag>` — Filter by tag
- `--type <session|tip|template|recipe|reference|decision>` — Filter by knowhow type
- `--confirm` — Skip delete confirmation prompt
- `--before <date>` / `--after <date>` — Date filters for prune
- `--dry-run` — Preview prune without deleting (default for prune — use `--execute` to actually delete)
- `--execute` — Required to actually perform prune deletions (prune defaults to dry-run)

**Output boundary**: Workflow store writes MUST target `.workflow/knowhow/` only. System store writes MUST target `~/.claude/projects/*/memory/` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **MEMORY.md protected** — NEVER delete MEMORY.md; only editable via `edit` subcommand
2. **MEMORY.md line limit** — MUST warn (W003) when MEMORY.md exceeds 200 lines; content beyond 200 lines will be truncated at load
3. **Confirmation on destructive ops** — `delete` and `prune` MUST require user confirmation unless `--confirm` flag is set
4. **Store isolation** — `prune` operates on workflow store only; NEVER prune system memory files
5. **Reference integrity** — `delete` MUST check for references from other entries before removing; warn if orphaned references would result
6. **Dry-run safety** — `--dry-run` MUST NOT write any files; preview destructive operations only
7. **Index consistency** — after delete/prune, workflow index MUST be updated to reflect removals
</invariants>

<execution>

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

### Step 1: Resolve Store Paths

- **Workflow store**: `.workflow/knowhow/` (entries: `KNW-*.md`, `TIP-*.md`, `TPL-*.md`, `RCP-*.md`, `REF-*.md`, `DCS-*.md`, indexed in `.workflow/wiki-index.json`)
- **System store**: `~/.claude/projects/{project}/memory/` (files: `MEMORY.md` + topic `.md` files)

Derive system path from project root (replace path separators with `--`, prefix drive letter).

### Step 2: Parse Subcommand

Default to `list` if no arguments. Parse first token as subcommand.

### Step 3: Execute Subcommand

**list**: Show entries from both stores (or filtered by `--store`, `--tag`, `--type`).
- Workflow: use `maestro search --type knowhow --json` or read `.workflow/wiki-index.json`, display ID, type, category, date, tags, title
- System: list `.md` files in system memory directory

**search `<query>`**: Full-text grep across both stores. Rank by match count.

**view `<id|file>`**: Auto-detect store from format (`KNW-*/TIP-*/TPL-*/RCP-*/REF-*/DCS-*` = workflow, else system). Display full content.

**edit `<file>`**: Edit a system memory file. Read current content, apply changes. Warn if MEMORY.md exceeds 200 lines (W003).

**delete `<id|file>`**: Require confirmation (or `--confirm` flag). MEMORY.md cannot be deleted (E004). Remove entry file (WikiIndexer auto-updates `.workflow/wiki-index.json` on next access).

**prune**: Requires at least one filter (`--tag`, `--type`, `--before`, `--after`). Workflow store only. Prune defaults to dry-run (preview only) — always display the list of entries that would be deleted first. To actually delete, user must pass `--execute`. When `--execute` is used, prompt for confirmation via `request_user_input` before proceeding (unless `--confirm` is also passed).

### Step 4: Integrity Check

After write operations, verify:
- No orphaned files without index entries (W001)
- No dangling index references to missing files (W001)
- System MEMORY.md references valid topic files (W002)
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | No stores found — for workflow store run `$manage-knowhow-capture`; for system store run `$manage-memory-capture` or create MEMORY.md |
| E002 | error | Entry ID or filename not found |
| E003 | error | Prune requires at least one filter flag |
| E004 | error | Cannot delete MEMORY.md — use `edit` subcommand instead |
| W001 | warning | Index has orphaned files or dangling references |
| W002 | warning | MEMORY.md references non-existent topic file |
| W003 | warning | MEMORY.md exceeds 200 lines — content truncated at load |
</error_codes>

<success_criteria>
- [ ] Store paths resolved correctly for both workflow and system stores
- [ ] Subcommand parsed and validated (defaults to list)
- [ ] list: displays entries from selected stores with filtering
- [ ] search: full-text grep across stores, ranked by match count
- [ ] view: auto-detects store, displays full content
- [ ] edit: reads and applies changes to system memory files
- [ ] delete: requires confirmation, prevents MEMORY.md deletion
- [ ] prune: requires filter, supports --dry-run, workflow store only
- [ ] Integrity check after write operations (orphans, dangling refs)
</success_criteria>
