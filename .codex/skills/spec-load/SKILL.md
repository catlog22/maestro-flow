---
name: spec-load
description: Load specs and lessons for current context
argument-hint: "[--category <category>] [--keyword <word>]"
allowed-tools: Read, Bash, Glob, Grep
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
| `quality-rules.md` | review |
| `learnings.md` | coding |

**--category loading**: Loads category's primary doc in full + matching entries from other files.

**Keyword filtering**: When `--keyword` is provided, only entries with matching keyword in their `<spec-entry keywords="...">` attribute are returned.
</context>

<execution>

### Step 1: Validate Specs Directory

Verify `.workflow/specs/` exists (E001).

### Step 2: Parse Arguments

Extract optional `--category` and `--keyword` flags.

### Step 3: Load via CLI

Run `maestro spec load [--category <category>] [--keyword <word>]`. If CLI unavailable, read files directly and apply keyword/category filter.

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
