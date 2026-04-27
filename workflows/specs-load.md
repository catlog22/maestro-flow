# Workflow: specs-load

Load spec files from `.workflow/specs/`, filtered by category.

## Arguments

```
$ARGUMENTS: "[--category <type>] [keyword]"

--category  -- filter by category (1:1 mapping to file):
               coding | arch | quality | debug | test | review | learning | all
keyword     -- optional, grep within loaded specs for matching sections
```

## Category → File Mapping (1:1)

Each category loads exactly one file. Same mapping as spec-add.

| Category | File loaded |
|----------|------------|
| `coding` | `coding-conventions.md` |
| `arch` | `architecture-constraints.md` |
| `quality` | `quality-rules.md` |
| `debug` | `debug-notes.md` |
| `test` | `test-conventions.md` |
| `review` | `review-standards.md` |
| `learning` | `learnings.md` |
| `all` (default) | All `.md` files in specs/ |

## Execution Steps

### Step 1: Parse Arguments

Extract `--category <type>` (filter) and remaining text (keyword for grep).

### Step 2: Load Specs via CLI

```bash
maestro spec load --category <category>
```

If `maestro spec load` CLI is unavailable, read files directly:
```bash
cat .workflow/specs/<matched-file>
```

### Step 3: Keyword Filter (optional)

If keyword provided, grep within loaded content:
```bash
grep -n -i -C 3 "$KEYWORD" <loaded content>
```

### Step 4: Display Results

Output loaded specs content. If no specs found, show:
```
(No specs found. Run "maestro spec init" or "/spec-setup" to initialize.)
```
