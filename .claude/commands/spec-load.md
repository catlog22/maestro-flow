---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--role <role>] [--keyword <word>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Load relevant specs filtered by role (primary), category (file-level), and/or keyword (entry-level).
Role-based loading: loads the role's primary doc in full + matching entries from other files.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-load.md
</required_reading>

<context>
$ARGUMENTS -- optional flags and keyword

**Flags:**
- `--role <role>` — Load by role: primary role doc (full) + cross-file entries with matching roles attr. Roles: implement, plan, test, review, analyze, explore, brainstorm, research.
- `--keyword <word>` — Filter by keyword within entries

**File → Primary Role mapping:**
| File | Role |
|------|------|
| coding-conventions.md | implement |
| architecture-constraints.md | plan |
| test-conventions.md | test |
| review-standards.md | review |
| debug-notes.md | analyze |
| quality-rules.md | review |
| learnings.md | implement |
| tools.md | _(per-entry roles)_ |

**Examples:**
```
/spec-load --role implement             # coding全文 + 跨文件implement条目
/spec-load --role review                # review-standards + quality-rules + 跨文件review条目
/spec-load --role implement --keyword auth
/spec-load --keyword auth
```

**Ref entries:**
When loading entries with `ref` attribute, only the summary is shown with a load command:
  → Detail: maestro wiki load <knowhow-id>
Use the load command to read the full referenced document.
</context>

<execution>
Follow '~/.maestro/workflows/specs-load.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/specs/` not initialized -- run `/spec-setup` first | detect_context |
| W001 | warning | No matching specs found for keyword -- showing all specs in category instead | load_specs |
</error_codes>

<success_criteria>
- [ ] Category and/or keyword parsed from arguments
- [ ] Spec files loaded per category mapping
- [ ] Keyword filtering applied at entry level (via `<spec-entry>` keywords attribute)
- [ ] Legacy entries filtered by text grep fallback
- [ ] Results displayed with file:category references
</success_criteria>
</output>
