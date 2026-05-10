---
name: spec-add
description: Add spec entry by category with role tagging
argument-hint: "[--scope project|global|team|personal] [--roles <csv>] <category> <content>"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---
<purpose>
Add a knowledge entry to the specs system using `<spec-entry>` closed-tag format.
Each category maps 1:1 to a single target file — no dual-write.
Supports 4 scopes: project (default), global, team, personal.
Entries use `roles` attribute to declare which agent roles should load them.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-add.md
</required_reading>

<context>
$ARGUMENTS -- expects `[--scope <scope>] [--uid <uid>] [--roles <csv>] <category> <content>`

**Options:**
- `--roles <csv>` — Comma-separated roles (implement, plan, test, review, analyze, explore). Determines which agents load this entry via `spec load --role`.
- `--ref <path>` — Create as index entry referencing a knowhow document. If the path exists, only creates the spec index entry. If path doesn't exist, also creates the knowhow file.
- `--knowhow-type <type>` — Knowhow document type when creating with --ref (asset, blueprint, document, template, recipe, reference, decision)

Scope-to-directory mapping, category-to-file mapping, and entry format defined in workflow specs-add.md.

**Examples:**
```bash
# Tool spec with roles (stored in tools.md)
/spec-add tools "Integration Test Flow" "## Steps\n1. Setup\n2. Run" --roles "implement,test" --keywords "testing,api"

# Tool spec with ref to detailed knowhow
/spec-add tools "OAuth PKCE Flow" "完整 PKCE 集成流程" --roles "implement" --ref knowhow/RCP-oauth-pkce.md

# Standard spec with role
/spec-add coding "Named exports" "Always use named exports" --roles "implement"

# Legacy style (no --roles, backward compat)
/spec-add arch "OAuth PKCE 集成" "完整流程设计" --ref knowhow/AST-oauth-flow.md
```
</context>

<execution>
Follow '~/.maestro/workflows/specs-add.md' completely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Category and content are both required | parse_input |
| E002 | fatal | Specs directory not initialized -- run `maestro spec init --scope <scope>` | validate_entry |
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning, tools | parse_input |
| E004 | fatal | Invalid scope -- must be one of: project, global, team, personal | parse_input |
| E005 | fatal | Personal scope requires uid -- use `--uid` or run `maestro collab join` first | parse_input |
</error_codes>

<success_criteria>
- [ ] Scope and category parsed and validated
- [ ] Keywords auto-extracted from content (3-5 relevant terms)
- [ ] Entry written in `<spec-entry>` closed-tag format
- [ ] Entry appended to correct target file for scope
- [ ] Confirmation report displayed with scope, path, keywords
- [ ] Next step: `maestro spec load --scope <scope> --keyword {keyword}` to verify
</success_criteria>
