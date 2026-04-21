---
name: spec-load
description: Load relevant specs for current context, optionally filtered by category or keyword
argument-hint: "[--category <type>] [keyword]"
allowed-tools: Read, Bash, Glob, Grep
---

<purpose>
Load relevant specs for the current context, optionally filtered by category or keyword. Reads from `.workflow/specs/` and displays matching content with file references.
</purpose>

<context>
$ARGUMENTS — optional category filter and keyword.

```bash
$spec-load
$spec-load "--category coding"
$spec-load "authentication"
$spec-load "--category debug error handling"
```

**Flags**: `--category <type>` filters by spec category. Optional keyword searches within loaded files.

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
| `all` (default) | All spec files |
</context>

<execution>

### Step 1: Validate Specs Directory

```bash
test -d .workflow/specs || exit 1  # E001: not initialized
```

### Step 2: Parse Arguments

Extract optional `--category` flag and keyword from arguments.

### Step 3: Load Files

Read the spec file matching the category (1:1 mapping).
If `all` or no category, read all `.md` files in specs/.
If target file doesn't exist, show warning (W001).

### Step 4: Apply Keyword Filter

If a keyword is provided, search within loaded files for matching sections using grep.
Return only matching sections with file:line references.
If no matches found, show all content in the category (W001).

### Step 5: Display Results

```
=== SPECS: {category} ===
--- {filename} ---
{content or matching sections}
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
- [ ] Correct file loaded per 1:1 category mapping (falls back to all if empty)
- [ ] Keyword filter applied with file:line references when matches found
- [ ] Results displayed with category header and per-file sections
</success_criteria>
