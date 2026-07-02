---
name: spec-add
description: Add spec entry by category with role tagging
argument-hint: "[--scope project|global|team|personal] [-y] <category> <content>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Add `<spec-entry>` to specs by category. 4 scopes: project (default), global, team, personal.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-add.md
</required_reading>

<context>
$ARGUMENTS -- expects `[--scope <scope>] [--uid <uid>] <category> <content>`

**Options:**
- `--description <desc>` — One-line description for search results (falls back to content[:240])
- `--ref <path>` — Create as index entry referencing a knowhow document. If the path exists, only creates the spec index entry. If path doesn't exist, also creates the knowhow file.
- `--knowhow-type <type>` — Knowhow document type when creating with --ref (asset, blueprint, document, template, recipe, reference, decision)

Scope-to-directory mapping, category-to-file mapping, and entry format defined in workflow specs-add.md.

**Examples:**
```bash
# English content → English keywords
/spec-add coding "Named exports" "Always use named exports" --keywords "exports,naming"

# With description for search results
/spec-add coding "OAuth PKCE Flow" "完整 PKCE 集成流程" --keywords "oauth,pkce" --description "OAuth 2.0 PKCE 认证流程规范"

# Chinese content → Chinese keywords
/spec-add coding "命名导出规范" "始终使用命名导出" --keywords "导出,命名,模块"

# Ref mode
/spec-add arch "OAuth PKCE 集成" "完整流程设计" --ref knowhow/AST-oauth-flow.md
```
</context>

<invariants>
1. **Idempotent append** — duplicate entry ID MUST be rejected (E003-level check on title + category match before write)
2. **Category validation** — category MUST be one of: coding, arch, quality, debug, test, review, learning, ui. Invalid category → E003
3. **Scope isolation** — writes target ONLY the scope-resolved directory; project scope NEVER writes to global (~/.maestro/specs/), global scope NEVER writes to project (.workflow/specs/)
4. **Confirmation gate** — MUST AskUserQuestion before appending entry (unless -y flag); NEVER write without user confirmation in interactive mode
5. **Entry format invariance** — all entries MUST use `<spec-entry>` closed-tag format with id, keywords, and category attributes
6. **Output boundary** — ALL file writes MUST target the scope-resolved specs directory (.workflow/specs/, ~/.maestro/specs/, .workflow/collab/specs/, or .workflow/collab/{uid}/specs/) and optionally .workflow/knowhow/ for --ref mode. NEVER modify source code or files outside these paths
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-add.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Validate**
- REQUIRED: Category and content both parsed from arguments.
- REQUIRED: Category is a valid value (coding, arch, quality, debug, test, review, learning, ui).
- REQUIRED: Scope resolved to a valid directory path.
- BLOCKED if: E001 (missing args), E003 (invalid category), E004 (invalid scope), E005 (personal scope without uid).

**GATE 2: Validate → Format**
- REQUIRED: Specs directory exists for the resolved scope.
- REQUIRED: No duplicate entry with identical title + category already present in target file.
- BLOCKED if: E002 (specs not initialized).

**GATE 3: Format → Write**
- REQUIRED: `<spec-entry>` block formatted with id, keywords, category attributes.
- REQUIRED: User confirmation via AskUserQuestion (unless -y flag).
- BLOCKED if: user declines confirmation — abort without writing.

**Confirmation gate**: Unless -y flag is passed, after formatting the `<spec-entry>` block but before appending to the target file, AskUserQuestion showing the formatted entry, target file path, and scope. Proceed only on user confirm.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Category and content are both required | parse_input |
| E002 | fatal | Specs directory not initialized -- run `maestro spec init --scope <scope>` | validate_entry |
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning, ui | parse_input |
| E004 | fatal | Invalid scope -- must be one of: project, global, team, personal | parse_input |
| E005 | fatal | Personal scope requires uid -- use `--uid` or run `maestro collab join` first | parse_input |
</error_codes>

<success_criteria>
- [ ] Scope and category parsed and validated
- [ ] Keywords auto-extracted from content (3-5 relevant terms)
- [ ] Entry written in `<spec-entry>` closed-tag format
- [ ] Entry appended to correct target file for scope
- [ ] Confirmation report displayed with scope, path, keywords
- [ ] Next step routed
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verify entry added | `maestro load --type spec --scope <scope> --keyword {keyword}` |
| Add more entries | `/spec-add <category>` |
| View all specs | `/spec-load --category <category>` |
</completion>
