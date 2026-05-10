---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--category <type>] [--keyword <word>] [--with-lessons] [--role <role>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<purpose>
Load and display relevant spec files for the current working context.
Supports filtering by category (file-level) and keyword (entry-level via `<spec-entry>` tags).
</purpose>

<required_reading>
@~/.maestro/workflows/specs-load.md
</required_reading>

<context>
$ARGUMENTS -- optional flags and keyword

Category-to-file mapping (1:1) and flag details defined in workflow specs-load.md.

**Flags:**
- `--category <type>` — Filter by spec category
- `--keyword <word>` — Filter by keyword within entries
- `--with-lessons` — Include lessons alongside specs
- `--role <role>` — Also load wiki role knowledge (browse `maestro wiki list --role <role>`, load relevant entries via `maestro wiki load <id1> [id2...]`)

**Examples:**
```
/spec-load --keyword auth
/spec-load --category coding --keyword naming
/spec-load --category arch
/spec-load --role implement --keyword auth
```
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
