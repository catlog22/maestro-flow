---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--category <category>] [--keyword <word>]"
allowed-tools: Read, Bash, Glob, Grep
session-mode: none
version: 0.5.50
---

<purpose>
Load relevant specs filtered by category (primary) and/or keyword (entry-level).
Category-based loading: loads category's primary doc in full + matching entries from other files.
</purpose>

<context>
$ARGUMENTS — optional category filter and keyword.

```bash
$spec-load
$spec-load "--category coding"
$spec-load "--keyword auth"
$spec-load "--category coding --keyword auth"
$spec-load "--category review"
```

**File → Primary Category mapping:**
| File | Primary Category |
|------|-----------------|
| `coding-conventions.md` | coding |
| `architecture-constraints.md` | arch |
| `test-conventions.md` | test |
| `review-standards.md` | review |
| `debug-notes.md` | debug |
| `quality-rules.md` | quality |
| `learnings.md` | learning |
| `tools.md` | tools |

**--category loading**: Loads category's primary doc in full + matching entries from other files.

**Keyword filtering**: When `--keyword` is provided, only entries with matching keyword in their `<spec-entry keywords="...">` attribute are returned.

**Output boundary**: This command produces NO file writes. All output is conversation-context injection only.
</context>

<invariants>
1. **Read-only** — NEVER modify, create, or delete any spec files during load. This command is purely a read operation
2. **Output to context only** — loaded specs are injected into the conversation context; NEVER write loaded content to new files or modify existing files
3. **Category primary doc** — when --category is specified, the primary category doc MUST be loaded in full before cross-file matching
4. **Entry-level filtering** — --keyword filtering operates at `<spec-entry>` level via keywords attribute, NOT at file level; unmatched entries in a matching file are excluded
5. **Graceful degradation** — if `.workflow/specs/` is missing but CLI search is available, fallback to CLI; only fail when both paths are exhausted
6. **Output boundary** — this command produces NO file writes. All output is conversation-context injection only
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Discover**
- REQUIRED: Arguments parsed — at least one of --category or --keyword provided, or empty args triggers full load.
- BLOCKED if: invalid category value.

**GATE 2: Discover → Load**
- REQUIRED: At least one spec directory exists.
- BLOCKED if: E001 — `.workflow/specs/` not initialized and no CLI fallback available.

**GATE 3: Load → Display**
- REQUIRED: Spec files read and entries parsed.
- REQUIRED: Keyword filtering applied if --keyword was provided.
- BLOCKED if: no readable spec files found.

### Step 1: Validate Specs Directory

Verify `.workflow/specs/` exists (E001).

### Step 2: Parse Arguments

Extract optional `--category` and `--keyword` flags.

### Step 3: Load via CLI

Run `maestro load --type spec [--category <category>] [--keyword <word>]`. If CLI unavailable, read files directly and apply keyword/category filter.

### Step 4: Display Results

Show matched entries grouped by filename and category, with `<spec-entry>` tags stripped.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` not initialized -- run `$spec-setup` first |
| W001 | warning | No matching specs for keyword -- showing all in category |
</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory validated
- [ ] Category and keyword parsed from arguments
- [ ] Files loaded per category mapping
- [ ] Keyword filtering applied at entry level (via `<spec-entry>` keywords)
- [ ] Tools auto-discovered from knowhow/ by category + tool flag
- [ ] Results displayed with file references and stripped tags
</success_criteria>
