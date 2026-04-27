# Workflow: specs-add

Add a `<spec-entry>` closed-tag entry to a single target spec file by category.

## Arguments

```
$ARGUMENTS: "<category> <content>"

category -- one of: coding, arch, quality, debug, test, review, learning
content  -- free-text description of the entry
```

## Category-to-File Mapping (1:1)

| Category | Target file |
|----------|------------|
| `coding` | `.workflow/specs/coding-conventions.md` |
| `arch` | `.workflow/specs/architecture-constraints.md` |
| `quality` | `.workflow/specs/quality-rules.md` |
| `debug` | `.workflow/specs/debug-notes.md` |
| `test` | `.workflow/specs/test-conventions.md` |
| `review` | `.workflow/specs/review-standards.md` |
| `learning` | `.workflow/specs/learnings.md` |

## Prerequisites

- `.workflow/specs/` directory must exist (run `/spec-setup` first if missing)

## Execution Steps

### Step 1: Parse Arguments

```
Parse: category = first word, content = remaining text
Validate: category ∈ {coding, arch, quality, debug, test, review, learning}, content non-empty
On failure: show usage `/spec-add <category> <content>` with valid categories, exit
```

### Step 2: Resolve Target File

Map category to file path. If file does not exist, create it with a basic header.

Check for near-duplicate entries:
```bash
grep -i "<content_first_10_words>" .workflow/specs/<target_file> | tail -5
```

### Step 3: Extract Keywords

Auto-extract 3-5 relevant keywords from the content:
- Domain-specific terms (not generic words like "code", "file", "function")
- Lowercase, no spaces (use hyphens for multi-word terms)
- Terms that would help future keyword-based lookup

### Step 4: Format Entry

```
Entry format (closed-tag), date = YYYY-MM-DD, title = first meaningful phrase:

<spec-entry category="{category}" keywords="{kw1},{kw2},{kw3}" date="{YYYY-MM-DD}">
### {title}
{content}
</spec-entry>
```

### Step 5: Append to Target File

Read target file. Append the formatted `<spec-entry>` block at the end. Write file back.

### Step 6: Confirm

Display: category, target file, keywords, and verify command (`/spec-load --keyword <kw1>`).

## Output

One `<spec-entry>` block appended to the target file.
