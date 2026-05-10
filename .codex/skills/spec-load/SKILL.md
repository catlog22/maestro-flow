---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--role <role>] [--keyword <word>]"
allowed-tools: Read, Bash, Glob, Grep
---

<purpose>
Load relevant specs filtered by role (primary), category (file-level), and/or keyword (entry-level).
Role-based loading: loads role's primary doc in full + matching entries from other files.
</purpose>

<context>
$ARGUMENTS — optional role, category filter, and keyword.

```bash
$spec-load
$spec-load "--role implement"
$spec-load "--keyword auth"
$spec-load "--role implement --keyword auth"
$spec-load "--role review"
```

**File → Primary Role mapping:**
| File | Primary Role |
|------|-------------|
| `coding-conventions.md` | implement |
| `architecture-constraints.md` | plan |
| `test-conventions.md` | test |
| `review-standards.md` | review |
| `debug-notes.md` | analyze |
| `quality-rules.md` | review |
| `learnings.md` | implement |
| `tools.md` | _(per-entry roles)_ |

**--role loading**: Loads primary role doc in full + entries from other files that have matching `roles` attr.

**Keyword filtering**: When `--keyword` is provided, only entries with matching keyword in their `<spec-entry keywords="...">` attribute are returned.
</context>

<execution>

### Step 1: Validate Specs Directory

Verify `.workflow/specs/` exists (E001).

### Step 2: Parse Arguments

Extract optional `--role` and `--keyword` flags.

### Step 3: Load via CLI

Run `maestro spec load [--role <role>] [--keyword <word>]`. If CLI unavailable, read files directly and apply keyword/role filter.

### Step 4: Display Results

Show matched entries grouped by filename and category, with `<spec-entry>` tags stripped.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` not initialized -- run `Skill({ skill: "spec-setup" })` first |
| W001 | warning | No matching specs for keyword -- showing all in category |
</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory validated
- [ ] Category and keyword parsed from arguments
- [ ] Files loaded per category mapping
- [ ] Keyword filtering applied at entry level (via `<spec-entry>` keywords)
- [ ] Results displayed with file references and stripped tags
</success_criteria>
