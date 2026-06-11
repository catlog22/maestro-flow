---
name: manage-knowhow
description: Manage knowhow entries (workflow and system)
argument-hint: "[list|search|view|edit|delete|prune] [query|id|file] [--store workflow|system|all] [--tag tag] [--type type]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
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
- `--dry-run` — Preview prune without deleting
</context>

<execution>

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

**prune**: Requires at least one filter (`--tag`, `--type`, `--before`, `--after`). Workflow store only. `--dry-run` previews without deleting.

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
