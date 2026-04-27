# Memory Workflow

Session memory capture, retrieval, and management for cross-session recovery.

## Dual Store Architecture

Two memory stores with different purposes:

| Store | Path | Format | Index |
|-------|------|--------|-------|
| `workflow` | `.workflow/memory/` | `MEM-*.md`, `TIP-*.md` | `.workflow/wiki-index.json` (unified, auto-managed by WikiIndexer) |
| `system` | `~/.claude/projects/{project}/memory/` | `MEMORY.md` + topic `.md` files | None (flat files) |

**System memory path detection:**
```bash
# Derive from project root — replace path separators with '--', prefix drive letter
# e.g., D:\maestro2 → ~/.claude/projects/D--maestro2/memory/
```

---

## Part A: Memory Management (manage-memory)

Operations: list, search, view, edit, delete, prune across both stores.

### Step 1: Resolve Paths

Detect both memory store paths:
- **Workflow**: `.workflow/memory/` (index: `.workflow/wiki-index.json`, auto-managed by WikiIndexer)
- **System**: `~/.claude/projects/{project-path}/memory/` where project-path derives from project root (e.g., `D:\maestro2` → `D--maestro2`)

Verify which stores exist (workflow: directory exists; system: `MEMORY.md` exists). Neither → E001.

### Step 2: Parse Input

Parse arguments and detect subcommand:

| Input | Route |
|-------|-------|
| No arguments, `list`, `列表`, `ls` | List mode |
| `search <query>`, `搜索`, `find` | Search mode |
| `view <id\|file>`, `查看`, `show` | View mode |
| `edit <file>`, `编辑` | Edit mode (system store only) |
| `delete <id\|file>`, `删除`, `rm` | Delete mode |
| `prune`, `清理`, `cleanup` | Prune mode |
| Ambiguous | AskUserQuestion |

**Store auto-detection for view/edit/delete:**
- Argument matches `MEM-*` or `TIP-*` pattern → workflow store
- Argument matches `MEMORY.md` or `*.md` filename → system store
- Explicit `--store` flag overrides

### Step 3: Execute List (list mode)

List entries from targeted stores.

**Workflow store**: `maestro wiki list --type memory --json`, apply filters (`--tag`, `--type`, `--before`, `--after`), sort by timestamp descending.

**System store**: Glob `*.md` files, extract title from first 5 lines, show size and modification date.

Display combined table per store (ID/File, Type, Date, Tags/Lines, Summary/Description) with navigation hints for view/edit/search/capture.

### Step 4: Execute Search (search mode)

Full-text case-insensitive search across both stores.

**Workflow**: Search via `maestro wiki search` or filter `wiki-index.json` fields (`summary`, `tags`, `id`); for deeper matches, read individual `.md` files.

**System**: Read each `.md` file and search content.

Rank: exact match > heading match > content match. Display each result with store label (`[workflow]`/`[system]`), ID/file, and matching context snippet.

### Step 5: Execute View (view mode)

Display full content of a memory entry with metadata header (store, file path, modified date, line count).

- **Workflow** (`MEM-*`/`TIP-*`): validate via `maestro wiki get <id>` or `wiki-index.json`, read `.md` file
- **System** (filename): validate exists in system memory dir, read full content

If not found, suggest similar entries/files.

### Step 6: Execute Edit (edit mode)

Edit a system memory file interactively. Only for system store files (`MEMORY.md`, topic files).

Validate file exists → display current content → AskUserQuestion for edit instructions → apply via Edit tool → display diff summary.

**Rules for MEMORY.md edits:**
- Keep under 200 lines (content after line 200 is truncated at load)
- Maintain semantic organization by topic
- For detailed notes, create/update separate topic files and link from MEMORY.md
- Do not duplicate information already in CLAUDE.md

### Step 7: Execute Delete (delete mode)

Remove a memory entry or file. Confirm via AskUserQuestion (unless `--confirm`).

- **Workflow**: validate ID, show summary, remove `.md` file (WikiIndexer auto-updates index)
- **System**: validate file exists, show preview, remove file. Warn if `MEMORY.md` references deleted file.

**Safety:** `MEMORY.md` cannot be deleted, only edited.

### Step 8: Execute Prune (prune mode)

Bulk cleanup — workflow store only. At least one filter required (`--tag`, `--type`, `--before`, `--after`).

Read `wiki-index.json` → apply filters → display candidates → `--dry-run` stops here → confirm → remove files (index auto-updates). Report removed/remaining counts.

### Step 9: Integrity Check (after delete/prune only)

Post-operation integrity check:
- **Workflow**: compare `.workflow/memory/*.md` files against `wiki-index.json` entries (type=memory). Report orphans/dangling refs. WikiIndexer re-indexes on next write.
- **System**: check `MEMORY.md` links to topic files, report broken links.

---

## Part B: Memory Capture (manage-memory-capture)

Capture session working memory into `.workflow/memory/` for cross-session recovery. Two modes: compact (full session compression) and tip (quick note-taking).

### Step 1: Parse Input

Parse arguments and detect execution mode:

| Input | Route |
|-------|-------|
| `compact`, `session`, `压缩`, `保存会话` | Compact mode |
| `tip`, `note`, `记录`, `快速` | Tips mode |
| `--tag` flag present | Tips mode |
| Short text (<100 chars) + no session keywords | Tips mode |
| No arguments or ambiguous | AskUserQuestion |

Bootstrap: `mkdir -p .workflow/memory` (wiki-index.json is auto-managed by WikiIndexer).

When ambiguous, AskUserQuestion with two options: Compact (full session compression) or Tip (quick note).

### Step 2: Analyze Session (compact mode only)

Extract session state from conversation history. Skip if tip mode.

Extract session state into `sessionAnalysis` with fields: `projectRoot` (absolute), `objective`, `executionPlan` (source + complete content), `workingFiles` [{absolutePath, role}], `referenceFiles`, `lastAction`, `decisions` [{decision, reasoning}], `constraints`, `dependencies`, `knownIssues`, `changesMade`, `pending`, `notes`.

**Plan Detection Priority:** workflow session (IMPL_PLAN.md) > TodoWrite items > user-stated > inferred.

**Core Rules:** preserve plan VERBATIM, absolute paths only, last action captures final state, decisions include reasoning.

### Step 3: Generate Content

Generate structured markdown content.

**Compact mode**: Generate `MEM-{YYYYMMDD-HHMMSS}.md` with all `sessionAnalysis` fields as markdown sections (Session ID, Project Root, Objective, Execution Plan in details block, Working/Reference Files, Last Action, Decisions, Constraints, Dependencies, Known Issues, Changes Made, Pending, Notes).

**Tip mode**: Generate `TIP-{YYYYMMDD-HHMMSS}.md` with sections: Tip ID, Timestamp, Content, Tags (from `--tag`), Context (auto-detected from recent conversation files).

### Step 4: Wiki Index (Auto-managed)

Memory files are automatically indexed by WikiIndexer into the unified `.workflow/wiki-index.json`. No manual index update is needed — the persistent index is regenerated on next `maestro wiki` access or any write operation.

For immediate visibility after capture:
```bash
maestro wiki get memory-{slug}         # verify entry exists in wiki
maestro wiki list --type memory        # list all memory entries
```

### Step 5: Report

Display confirmation: entry ID, file path, type. Compact adds plan source and line count preserved. Tip adds tags. Both include retrieval hints (`Read` path, `maestro wiki list --type memory`).

---

## Index

Memory entries are indexed in the unified `.workflow/wiki-index.json` by WikiIndexer. Each memory file becomes a wiki entry of type `memory` with fields derived from frontmatter (id, title, tags, summary). Use `maestro wiki list --type memory --json` to query the index programmatically.

## Compact Entry Structure

Full session memory for recovery. Sections:

1. **Session ID** — WFS-* if workflow session active
2. **Project Root** — Absolute path
3. **Objective** — High-level goal
4. **Execution Plan** — Source type + complete verbatim content
5. **Working Files** — Modified files with roles
6. **Reference Files** — Read-only context files
7. **Last Action** — Final action + result
8. **Decisions** — Choices with reasoning
9. **Constraints** — User-specified limitations
10. **Dependencies** — Added/changed packages
11. **Known Issues** — Deferred bugs
12. **Changes Made** — Completed modifications
13. **Pending** — Next steps
14. **Notes** — Unstructured thoughts

### Plan Detection Priority

1. Workflow session (`.workflow/active/WFS-*/IMPL_PLAN.md`)
2. TodoWrite items in conversation
3. User-stated plan (explicit numbered steps)
4. Inferred from actions and discussion

### Rules

- Preserve complete plan VERBATIM — never summarize or abbreviate
- All file paths must be ABSOLUTE
- Working files: 3-8 modified files with roles
- Reference files: key context (CLAUDE.md, types, configs)

## Tip Entry Structure

Quick note for ideas, snippets, reminders.

1. **Tip ID** — TIP-YYYYMMDD-HHMMSS
2. **Timestamp** — ISO format
3. **Content** — The note text
4. **Tags** — Categorization tags
5. **Context** — Related files/modules (auto-detected or specified)

### Suggested Tag Categories

| Category | Tags |
|----------|------|
| Technical | architecture, performance, security, bug, config, api |
| Development | testing, debugging, refactoring, documentation |
| Domain | auth, database, frontend, backend, devops |
| Organizational | reminder, research, idea, review |

## Retrieval

Use `maestro wiki list --type memory` to find entries by type, tags, or date.
Use `maestro wiki get <id>` or read individual `.md` files for full content.
