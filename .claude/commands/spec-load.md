---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--scope <scope>] [--category <category>] [--keyword <word>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Load relevant specs filtered by scope, category (file-level) and/or keyword (entry-level).
Category-based loading: loads the category's primary doc in full + matching entries from other files.
By default, loads from both global (~/.maestro/specs/) and project (.workflow/specs/) layers.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-load.md
</required_reading>

<context>
$ARGUMENTS -- optional flags and keyword

**Flags:**
- `--scope <scope>` — Load scope (default: global + project merged):
  - `project`: project baseline only (.workflow/specs/)
  - `global`: global + project merged (~/.maestro/specs/ + .workflow/specs/)
  - `team`: project + team shared (.workflow/collab/specs/)
  - `personal`: project + team + personal (requires uid)
- `--category <category>` — Load by category: primary category doc (full) + cross-file entries with matching category attr. Categories: coding, arch, quality, test, review, debug, learning, ui.
- `--keyword <word>` — Filter by keyword within entries

**File → Primary Category mapping:**
| File | Category |
|------|----------|
| coding-conventions.md | coding |
| architecture-constraints.md | arch |
| test-conventions.md | test |
| review-standards.md | review |
| debug-notes.md | debug |
| ui-conventions.md | ui |
| quality-rules.md | review |
| learnings.md | learning |

**Examples:**
```
/spec-load --category coding            # coding全文 + 跨文件coding条目 (global + project)
/spec-load --scope global --category arch  # 明确包含全局 arch 规范
/spec-load --category review            # review-standards + quality-rules + 跨文件review条目
/spec-load --category coding --keyword auth
/spec-load --keyword auth
```

**Ref entries:**
When loading entries with `ref` attribute, only the summary is shown with a load command:
  → Detail: maestro load --type knowhow --id <knowhow-id>
Use the load command to read the full referenced document.
</context>

<invariants>
1. **Read-only** — NEVER modify, create, or delete any spec files during load. This command is purely a read operation
2. **Output to context only** — loaded specs are injected into the conversation context; NEVER write loaded content to new files or modify existing files
3. **Scope layering** — global scope MUST merge both ~/.maestro/specs/ and .workflow/specs/; project scope loads .workflow/specs/ only; team adds .workflow/collab/specs/; personal adds .workflow/collab/{uid}/specs/
4. **Category primary doc** — when --category is specified, the primary category doc MUST be loaded in full before cross-file matching
5. **Entry-level filtering** — --keyword filtering operates at `<spec-entry>` level via keywords attribute, NOT at file level; unmatched entries in a matching file are excluded
6. **Output boundary** — this command produces NO file writes. All output is conversation-context injection only
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-load.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Discover**
- REQUIRED: Arguments parsed — at least one of --category or --keyword is provided, or empty args triggers full load.
- REQUIRED: Scope resolved (default: global+project merged).
- BLOCKED if: invalid scope value or invalid category value.

**GATE 2: Discover → Load**
- REQUIRED: At least one spec directory exists in the resolved scope chain.
- BLOCKED if: E001 — .workflow/specs/ not initialized AND no global specs available. Warn and abort.

**GATE 3: Load → Display**
- REQUIRED: Spec files read and entries parsed.
- REQUIRED: Keyword filtering applied if --keyword was provided.
- BLOCKED if: no readable spec files found in any scope layer.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | warning | `.workflow/specs/` not initialized -- run `/spec-setup` first (global specs still available) | detect_context |
| W001 | warning | No matching specs found for keyword -- showing all specs in category instead | load_specs |
</error_codes>

<success_criteria>
- [ ] Category and/or keyword parsed from arguments
- [ ] Spec files loaded per category mapping
- [ ] Keyword filtering applied at entry level (via `<spec-entry>` keywords attribute)
- [ ] Legacy entries filtered by text grep fallback
- [ ] Results displayed with file:category references
</success_criteria>
