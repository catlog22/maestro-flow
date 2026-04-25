---
name: spec-load
description: Load relevant specs for current context, optionally filtered by category or keyword
argument-hint: "[--category <type>] [--keyword <word>]"
allowed-tools: Read, Bash, Glob, Grep
---

<purpose>
Load relevant specs filtered by category (file-level) and/or keyword (entry-level via `<spec-entry>` tags).
</purpose>

<context>
$ARGUMENTS — optional category filter and keyword.

```bash
$spec-load
$spec-load "--category coding"
$spec-load "--keyword auth"
$spec-load "--category coding --keyword naming"
```

**Category-to-file mapping (1:1, same as spec-add):**

| Category | File loaded |
|----------|------------|
| `coding` | `coding-conventions.md` |
| `arch` | `architecture-constraints.md` |
| `quality` | `quality-rules.md` |
| `debug` | `debug-notes.md` |
| `test` | `test-conventions.md` |
| `review` | `review-standards.md` |
| `learning` | `learnings.md` |
| `bug` | `learnings.md` |
| `pattern` | `coding-conventions.md` |
| `decision` | `architecture-constraints.md` |
| `rule` | `quality-rules.md` |
| `validation` | `quality-rules.md` |
| `all` (default) | All spec files |

Extended types (`bug`, `pattern`, `decision`, `rule`, `validation`) are stored in their closest core category's file but retain their specific category in the `<spec-entry>` tag.

**Keyword filtering**: When `--keyword` is provided, only entries with matching keyword in their `<spec-entry keywords="...">` attribute are returned. Legacy entries (heading format) are filtered by text grep.
</context>

<execution>

### Step 1: Validate Specs Directory

```bash
test -d .workflow/specs || exit 1  # E001: not initialized
```

### Step 2: Parse Arguments

Extract optional `--category` and `--keyword` flags from arguments.

### Step 3: Load via CLI

```bash
maestro spec load [--category <cat>] [--keyword <word>]
```

If CLI unavailable, read files directly and apply keyword filter.

### Step 4: Display Results

```
=== SPECS: {category} {keyword ? "keyword=" + keyword : ""} ===
--- {filename} ({category}) ---
{matched entry content (tags stripped)}
```
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
