---
name: spec-add
description: Add spec entry by category with role tagging
argument-hint: <category> <title> <content>
allowed-tools: Read, Write, Bash, Glob, Grep
session-mode: none
---

<purpose>
Add a spec entry using `<spec-entry>` closed-tag format. Each category maps 1:1 to a single target file.

```bash
$spec-add "coding Always use named exports for utility functions"
$spec-add "learning Off-by-one in pagination when page=0"
$spec-add "arch Use Zod for runtime validation over io-ts"
$spec-add "quality All API endpoints must return structured error objects"
```

**Valid categories**: coding, arch, quality, debug, test, review, learning, tools, bug, pattern, decision, rule, validation, ui.

**Input format**: `<category> <title> <content>` — category is the first token, title is a short identifier (quoted if multi-word), content is the remainder.

**CLI alternative**: `maestro spec add <category> "<title>" "<content>" --keywords kw1,kw2 --description "<desc>" --source <src>`. Used by workflow agents (analyze, plan, execute) for programmatic spec enrichment.
</purpose>

<context>
$ARGUMENTS — `<category> <title> <content>` where category selects the target file, title is a short identifier, and content is the spec body.

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
| `tools` | `tools.md` |
| `bug` | `learnings.md` |
| `pattern` | `coding-conventions.md` |
| `decision` | `architecture-constraints.md` |
| `rule` | `quality-rules.md` |
| `validation` | `quality-rules.md` |
| `ui` | `ui-conventions.md` |

Extended types (`bug`, `pattern`, `decision`, `rule`, `validation`) are stored in the file of their closest core category but retain their specific category in the `<spec-entry>` tag.

Category is determined by the first positional argument.

**Output boundary**: ALL file writes MUST target `.workflow/specs/` only. NEVER modify source code or files outside this path.
</context>

<invariants>
1. **Idempotent append** — duplicate entry ID MUST be rejected (E003-level check on title + category match before write)
2. **Category validation** — category MUST be one of: coding, arch, quality, debug, test, review, learning, tools, bug, pattern, decision, rule, validation, ui. Invalid category → E003
3. **Confirmation gate** — MUST request_user_input before appending entry; NEVER write without user confirmation in interactive mode
4. **Entry format invariance** — all entries MUST use `<spec-entry>` closed-tag format with id, keywords, and category attributes
5. **Append-only** — MUST append to target file; NEVER overwrite or truncate existing spec content
6. **Output boundary** — ALL file writes MUST target `.workflow/specs/` only. NEVER modify source code or files outside this path
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Validate**
- REQUIRED: Category and content both parsed from arguments.
- REQUIRED: Category is a valid value.
- BLOCKED if: E001 (missing args), E003 (invalid category).

**GATE 2: Validate → Format**
- REQUIRED: `.workflow/specs/` directory exists.
- REQUIRED: No duplicate entry with identical title + category already present in target file.
- BLOCKED if: E002 (specs not initialized).

**GATE 3: Format → Write**
- REQUIRED: `<spec-entry>` block formatted with id, keywords, category attributes.
- REQUIRED: User confirmation via request_user_input.
- BLOCKED if: user declines confirmation — abort without writing.

### Step 1: Parse Input

Extract category (first token), title (second token or quoted string), and content (remainder) from arguments.
- Validate category is one of: coding, arch, quality, debug, test, review, learning, tools, bug, pattern, decision, rule, validation (E003 if invalid)
- Validate title and content are non-empty (E001 if missing)

### Step 2: Validate Specs Directory

Verify `.workflow/specs/` exists (E002).

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
<spec-entry category="{category}" keywords="{kw1},{kw2},{kw3}" date="{YYYY-MM-DD}" title="{title}" description="{one-line summary}">

### {title}

{content}

</spec-entry>
```

`title` and `description` attributes are written on the tag for search indexing. `description` is optional — falls back to content[:240].

### Step 6: Confirm

Display: category, target file, extracted keywords, and commands for verify (`$spec-load`) and remove (`$spec-remove`).
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Category, title, and content are all required |
| E002 | fatal | `.workflow/specs/` not initialized -- run `$spec-setup` first |
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning, tools, bug, pattern, decision, rule, validation |
</error_codes>

<success_criteria>
- [ ] Category and content parsed and validated
- [ ] Keywords auto-extracted from content (3-5 terms)
- [ ] Entry written in `<spec-entry>` closed-tag format with keywords attribute
- [ ] Entry appended to correct target file
- [ ] Confirmation displayed with keywords and verify command
</success_criteria>
