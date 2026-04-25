# Memory Workflow

Session memory capture, retrieval, and management for cross-session recovery.

## Dual Store Architecture

Two memory stores with different purposes:

| Store | Path | Format | Index |
|-------|------|--------|-------|
| `workflow` | `.workflow/memory/` | `MEM-*.md`, `TIP-*.md` | `wiki-index.json` |
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

```bash
# Workflow memory
WF_MEMORY_DIR=".workflow/memory"
WF_INDEX_FILE="$WF_MEMORY_DIR/wiki-index.json"

# System memory — derive from project git root or cwd
PROJECT_ROOT=$(pwd)
# Convert to ~/.claude/projects/ path format:
# D:\maestro2 → D--maestro2
SYS_MEMORY_DIR="$HOME/.claude/projects/$(echo "$PROJECT_ROOT" | sed 's|[/\\:]|-|g; s|^-*||')/memory"
```

Verify which stores exist:
- Workflow: check `$WF_INDEX_FILE` exists
- System: check `$SYS_MEMORY_DIR/MEMORY.md` exists

If neither exists, report E001.

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

**Workflow store** (if exists):
1. Read `wiki-index.json`
2. Apply filters (--tag, --type, --before, --after)
3. Sort by timestamp descending

**System store** (if exists):
1. Glob `$SYS_MEMORY_DIR/*.md`
2. For each file: read first 5 lines to extract title/purpose
3. Show file size and modification date

Display combined:

```
=== WORKFLOW MEMORY (.workflow/memory/) — {count} entries ===

  ID                    Type     Date        Tags              Summary
  ───────────────────── ──────── ────────── ───────────────── ─────────────────────────
  MEM-20260315-143022   compact  2026-03-15  —                 Implement auth module...
  TIP-20260314-091500   tip      2026-03-14  config, redis     Redis config pattern...

=== SYSTEM MEMORY (~/.claude/projects/.../memory/) — {count} files ===

  File                          Lines   Modified     Description
  ───────────────────────────── ─────── ──────────── ────────────────────────────
  MEMORY.md                     38      2026-03-15   Project Memory (auto-loaded)
  claude-code-skills-guide.md   120     2026-03-10   Claude Code Skills 构建指南

Hints:
  View:    /manage-memory view <ID|filename>
  Edit:    /manage-memory edit <filename>
  Search:  /manage-memory search <query>
  Capture: /manage-memory-capture compact
  Tips:    /manage-learn tip <text>
```

### Step 4: Execute Search (search mode)

Full-text search across both stores.

**Workflow store:**
1. Search `wiki-index.json` fields: `summary`, `tags`, `id`
2. For deeper matches, read individual `.md` files and search content

**System store:**
1. Read each `.md` file in `$SYS_MEMORY_DIR/`
2. Search content for query string (case-insensitive)

Rank results: exact match > heading match > content match. Display with store label:

```
=== SEARCH RESULTS for "{query}" ({count} matches) ===

  [workflow] MEM-20260315-143022  compact  2026-03-15
      Summary: Implement auth module with JWT tokens
      Match:   ...configured JWT refresh token rotation for **auth** module...

  [system]  MEMORY.md:22
      Match:   ...`manage-*` (4) — status, **memory**, codebase-rebuild...

  [system]  claude-code-skills-guide.md:9
      Match:   ...旧 commands 文件继续兼容，推荐使用 **Skills**...

View: /manage-memory view <ID|filename>
```

### Step 5: Execute View (view mode)

Display full content of a memory entry.

**Workflow entry** (ID matches `MEM-*` or `TIP-*`):
1. Validate ID exists in `wiki-index.json`
2. Read the corresponding `.md` file
3. Display with metadata header

**System file** (filename):
1. Validate file exists in `$SYS_MEMORY_DIR/`
2. Read full content

```
=== MEMORY: {ID or filename} ===
Store:     {workflow | system}
File:      {full path}
Modified:  {date}
Lines:     {count}
─────────────────────────────────

{full content}
```

If not found, suggest similar entries/files.

### Step 6: Execute Edit (edit mode)

Edit a system memory file interactively. Only for system store files (`MEMORY.md`, topic files).

1. Validate file exists in `$SYS_MEMORY_DIR/`
2. Read current content, display to user
3. Use AskUserQuestion to gather edit instructions:
   - "What changes to make? (add/update/remove sections, or provide new content)"
4. Apply edits using Edit tool
5. Display diff summary

```
=== MEMORY UPDATED ===
File:    {filename}
Path:    {full path}
Changes: {summary of edits}
```

**Rules for MEMORY.md edits:**
- Keep under 200 lines (content after line 200 is truncated at load)
- Maintain semantic organization by topic
- For detailed notes, create/update separate topic files and link from MEMORY.md
- Do not duplicate information already in CLAUDE.md

### Step 7: Execute Delete (delete mode)

Remove a memory entry or file.

**Workflow entry:**
1. Validate ID in `wiki-index.json`
2. Show summary, confirm with AskUserQuestion (unless --confirm)
3. Remove `.md` file + index entry

**System file:**
1. Validate file exists (NEVER allow deleting MEMORY.md — only topic files)
2. Show content preview, confirm
3. Remove file
4. If MEMORY.md references the deleted file, warn user to update links

```
=== ENTRY DELETED ===
Store:   {workflow | system}
ID/File: {id or filename}
Path:    {full path} (removed)
```

**Safety:** MEMORY.md cannot be deleted, only edited. Use `edit` subcommand instead.

### Step 8: Execute Prune (prune mode)

Bulk cleanup — workflow store only.

At least one filter required: --tag, --type, --before, --after.

1. Read `wiki-index.json`, apply filters
2. Display candidates table
3. If `--dry-run`, stop after display
4. Confirm with AskUserQuestion
5. Remove files + update index

```
=== PRUNE COMPLETE ===
Removed:   {count} entries
Remaining: {remaining} entries
Criteria:  {filters}
```

### Step 9: Integrity Check (after delete/prune only)

Post-operation integrity check.

**Workflow store:**
1. Scan `.workflow/memory/` for `.md` files
2. Compare with `wiki-index.json` entries
3. Report orphaned files or dangling references
4. Offer to fix inconsistencies

**System store:**
1. Check MEMORY.md links to topic files
2. Report broken links (referenced files that don't exist)

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

```bash
MEMORY_DIR=".workflow/memory"
INDEX_FILE="$MEMORY_DIR/wiki-index.json"
mkdir -p "$MEMORY_DIR"

# Initialize index if not exists
if [ ! -f "$INDEX_FILE" ]; then
  echo '{"entries":[],"_metadata":{"created":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","version":"1.0"}}' > "$INDEX_FILE"
fi
```

When ambiguous, use AskUserQuestion:
- Option 1: Compact — 压缩当前完整会话记忆（用于会话恢复）
- Option 2: Tip — 快速记录一条笔记/想法/提示

### Step 2: Analyze Session (compact mode only)

Extract session state from conversation history. Skip if tip mode.

Analyze conversation to extract:

```javascript
sessionAnalysis = {
  projectRoot: "",        // Absolute path to project root
  objective: "",          // High-level goal (1-2 sentences)
  executionPlan: {
    source: "workflow" | "todo" | "user-stated" | "inferred",
    content: ""           // COMPLETE plan — never summarize
  },
  workingFiles: [],       // [{absolutePath, role}] — modified files
  referenceFiles: [],     // [{absolutePath, role}] — read-only context
  lastAction: "",         // Last significant action + result
  decisions: [],          // [{decision, reasoning}]
  constraints: [],        // User-specified limitations
  dependencies: [],       // Added/changed packages
  knownIssues: [],        // Deferred bugs
  changesMade: [],        // Completed modifications
  pending: [],            // Next steps
  notes: ""               // Unstructured thoughts
}
```

**Plan Detection Priority:**

| Priority | Source | Detection |
|----------|--------|-----------|
| 1 | Workflow session | `.workflow/active/WFS-*/IMPL_PLAN.md` exists |
| 2 | TodoWrite | Todo items in current conversation |
| 3 | User-stated | Explicit plan statements in user messages |
| 4 | Inferred | Sequence of actions and outstanding work |

**Core Rules:**
- Preserve complete plan content VERBATIM — never abbreviate
- All file paths must be ABSOLUTE
- Last Action captures final state (success/failure)
- Decisions include reasoning, not just choices

### Step 3: Generate Content

Generate structured markdown content.

**Compact mode** — Full session memory:

```bash
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
ENTRY_ID="MEM-${TIMESTAMP}"
ENTRY_FILE="$MEMORY_DIR/${ENTRY_ID}.md"
```

Write entry file with sections:
- Session ID (WFS-* if active, none otherwise)
- Project Root (absolute path)
- Objective
- Execution Plan (source + full content in details block)
- Working Files (modified, with roles)
- Reference Files (read-only context)
- Last Action
- Decisions (with reasoning)
- Constraints, Dependencies, Known Issues
- Changes Made, Pending
- Notes

**Tip mode** — Quick note:

```bash
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
ENTRY_ID="TIP-${TIMESTAMP}"
ENTRY_FILE="$MEMORY_DIR/${ENTRY_ID}.md"
```

Write entry file with sections:
- Tip ID
- Timestamp
- Content (the note text)
- Tags (from --tag flag)
- Context (auto-detected from recent conversation files)

### Step 4: Update Index

Append entry metadata to wiki-index.json.

Read `wiki-index.json`, append new entry to `entries[]`:

```json
{
  "id": "MEM-20260315-143022",
  "type": "compact",
  "timestamp": "2026-03-15T14:30:22Z",
  "file": "MEM-20260315-143022.md",
  "summary": "Session objective in one line",
  "tags": [],
  "project_root": "/path/to/project",
  "session_id": "WFS-001"
}
```

For tips:
```json
{
  "id": "TIP-20260315-143022",
  "type": "tip",
  "timestamp": "2026-03-15T14:30:22Z",
  "file": "TIP-20260315-143022.md",
  "summary": "First 80 chars of note content",
  "tags": ["config", "redis"],
  "project_root": "/path/to/project"
}
```

### Step 5: Report

Display confirmation with entry ID and retrieval instructions.

**Compact mode:**
```
=== SESSION MEMORY SAVED ===
Entry:   {ENTRY_ID}
File:    .workflow/memory/{ENTRY_ID}.md
Type:    compact
Plan:    {plan_source} ({plan_line_count} lines preserved)

To restore: Read .workflow/memory/{ENTRY_ID}.md
To search:  Read .workflow/memory/wiki-index.json
```

**Tip mode:**
```
=== TIP SAVED ===
Entry:   {ENTRY_ID}
File:    .workflow/memory/{ENTRY_ID}.md
Tags:    {tags}

To search: Read .workflow/memory/wiki-index.json
```

---

## Index Schema

```json
{
  "entries": [
    {
      "id": "MEM-20260315-143022",
      "type": "compact | tip",
      "timestamp": "2026-03-15T14:30:22Z",
      "file": "MEM-20260315-143022.md",
      "summary": "One-line description",
      "tags": [],
      "project_root": "D:\\project",
      "session_id": "WFS-001 | null"
    }
  ],
  "_metadata": {
    "created": "2026-03-15T00:00:00Z",
    "version": "1.0"
  }
}
```

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

Read `.workflow/memory/wiki-index.json` to find entries by type, tags, or date.
Read individual `.md` files for full content.
