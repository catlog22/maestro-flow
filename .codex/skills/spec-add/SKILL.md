---
name: spec-add
description: Add a spec entry to the appropriate specs file by category
argument-hint: "<category> <content>"
allowed-tools: Read, Write, Bash, Glob, Grep
---

<purpose>
Add a spec entry to the appropriate specs file. Each category maps 1:1 to a single target file — no dual-write.

```bash
$spec-add "coding Always use named exports for utility functions"
$spec-add "learning Off-by-one in pagination when page=0"
$spec-add "arch Use Zod for runtime validation over io-ts"
$spec-add "quality All API endpoints must return structured error objects"
```

**Valid categories**: coding, arch, quality, debug, test, review, learning.
</purpose>

<context>
$ARGUMENTS — `<category> <content>` where category selects the target file and content is the spec text.

**Category-to-file mapping (1:1, same as spec-load):**
| Category | Target file |
|----------|------------|
| `coding` | `coding-conventions.md` |
| `arch` | `architecture-constraints.md` |
| `quality` | `quality-rules.md` |
| `debug` | `debug-notes.md` |
| `test` | `test-conventions.md` |
| `review` | `review-standards.md` |
| `learning` | `learnings.md` |
</context>

<execution>

### Step 1: Parse Input

Extract category (first token) and content (remainder) from arguments.
- Validate category is one of: coding, arch, quality, debug, test, review, learning (E003 if invalid)
- Validate content is non-empty (E001 if missing)

### Step 2: Validate Specs Directory

```bash
test -d .workflow/specs || exit 1  # E002: not initialized
```

### Step 3: Route to File

Resolve target file from category-to-file mapping table. If the target file does not exist, create it with a basic header.

### Step 4: Append Entry

Append timestamped entry to the target file:

```markdown
### [{category}] [{YYYY-MM-DD}] {first line of content}

{content}
```

Example: `### [learning] [2026-03-21] Off-by-one in pagination when page=0`

### Step 5: Confirm

```
Added [{category}] to {target_file}
```
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Category and content are both required |
| E002 | fatal | `.workflow/specs/` not initialized -- run `Skill({ skill: "spec-setup" })` first |
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning |
</error_codes>

<success_criteria>
- [ ] Category and content parsed and validated
- [ ] `.workflow/specs/` directory exists
- [ ] Entry appended to target file with `[category] [date]` format
- [ ] Confirmation displayed with category and affected file
</success_criteria>
