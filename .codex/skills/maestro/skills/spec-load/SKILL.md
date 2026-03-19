---
name: maestro-spec-load
description: Load relevant specs for current context, optionally filtered by category or keyword
argument-hint: "[--category <type>] [keyword]"
allowed-tools: Read, Bash, Glob, Grep
---

# Spec Load

## Usage

```bash
$maestro-spec-load
$maestro-spec-load "--category execution"
$maestro-spec-load "authentication"
$maestro-spec-load "--category debug error handling"
```

**Flags**: `--category <type>` filters by spec category. Optional keyword searches within loaded files.

---

## Implementation

### Step 1: Validate Specs Directory

```bash
test -d .workflow/specs || exit 1  # E001: not initialized
```

### Step 2: Parse Arguments

Extract optional `--category` flag and keyword from arguments.

**Category-to-file mapping:**

| Category | Files Loaded |
|----------|-------------|
| `general` | `learnings.md` |
| `planning` | `architecture-constraints.md` |
| `execution` | `coding-conventions.md`, `quality-rules.md` |
| `debug` | `debug-notes.md` |
| `test` | `test-conventions.md` |
| `review` | `review-standards.md` |
| `validation` | `validation-rules.md` |
| `all` (default) | All spec files |

### Step 3: Load Files

Read the spec files matching the category filter.
If no files exist for the category, fall back to loading all specs.

### Step 4: Apply Keyword Filter

If a keyword is provided, search within loaded files for matching sections using grep.
Return only matching sections with file:line references.
If no matches found, show all content in the category (W001).

### Step 5: Display Results

```
=== SPECS: {category} ===
{For each file}
--- {filename} ---
{content or matching sections}
```

---

## Error Handling

| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` not initialized -- run `Skill({ skill: "spec-setup" })` first |
| W001 | warning | No matching specs for keyword -- showing all in category |
