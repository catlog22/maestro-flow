---
name: spec-add
description: Add a spec entry to the appropriate specs file by category
argument-hint: "<category> <content>"
allowed-tools: Read, Write, Bash, Glob, Grep
---

<purpose>
Add a spec entry using `<spec-entry>` closed-tag format. Each category maps 1:1 to a single target file.

```bash
$spec-add "coding Always use named exports for utility functions"
$spec-add "learning Off-by-one in pagination when page=0"
$spec-add "arch Use Zod for runtime validation over io-ts"
$spec-add "quality All API endpoints must return structured error objects"
```

**Valid categories**: coding, arch, quality, debug, test, review, learning, bug, pattern, decision, rule, validation.
</purpose>

<context>
$ARGUMENTS — `<category> <content>` where category selects the target file.

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
| `bug` | `learnings.md` |
| `pattern` | `coding-conventions.md` |
| `decision` | `architecture-constraints.md` |
| `rule` | `quality-rules.md` |
| `validation` | `quality-rules.md` |

Extended types (`bug`, `pattern`, `decision`, `rule`, `validation`) are stored in the file of their closest core category but retain their specific category in the `<spec-entry>` tag.
</context>

<execution>

### Step 1: Parse Input

Extract category (first token) and content (remainder) from arguments.
- Validate category is one of: coding, arch, quality, debug, test, review, learning, bug, pattern, decision, rule, validation (E003 if invalid)
- Validate content is non-empty (E001 if missing)

### Step 2: Validate Specs Directory

```bash
test -d .workflow/specs || exit 1  # E002: not initialized
```

### Step 3: Route to File

Resolve target file from category-to-file mapping table. If the target file does not exist, create it with a basic header.

### Step 4: Extract Keywords

Auto-extract 3-5 relevant keywords from the content. Keywords should be:
- Lowercase, no spaces (use hyphens for multi-word)
- Domain-specific terms that would help future lookup
- Avoid generic words (code, file, function, etc.)

### Step 5: Write Entry

Append `<spec-entry>` closed-tag block to target file:

```markdown
<spec-entry category="{category}" keywords="{kw1},{kw2},{kw3}" date="{YYYY-MM-DD}">

### {title extracted from content}

{content}

</spec-entry>
```

### Step 6: Confirm

```
Added [{category}] to {target_file}
Keywords: {kw1}, {kw2}, {kw3}
Verify: /spec-load --keyword {kw1}
```
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Category and content are both required |
| E002 | fatal | `.workflow/specs/` not initialized -- run `Skill({ skill: "spec-setup" })` first |
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning, bug, pattern, decision, rule, validation |
</error_codes>

<success_criteria>
- [ ] Category and content parsed and validated
- [ ] Keywords auto-extracted from content (3-5 terms)
- [ ] Entry written in `<spec-entry>` closed-tag format with keywords attribute
- [ ] Entry appended to correct target file
- [ ] Confirmation displayed with keywords and verify command
</success_criteria>
