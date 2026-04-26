---
name: spec-load
description: Load relevant specs and lessons for current context (used by agents before execution)
argument-hint: "[--category <type>] [--keyword <word>] [--with-lessons]"
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

**Examples:**
```
/spec-load --keyword auth
/spec-load --category coding --keyword naming
/spec-load --category arch
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
