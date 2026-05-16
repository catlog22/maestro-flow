---
name: spec-add
description: Add spec entry by category with role tagging
argument-hint: "[--scope project|global|team|personal] <category> <content>"
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
Entries use `category` attribute to declare which category they belong to.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-add.md
</required_reading>

<context>
$ARGUMENTS -- expects `[--scope <scope>] [--uid <uid>] <category> <content>`

**Options:**
- `--ref <path>` — Create as index entry referencing a knowhow document. If the path exists, only creates the spec index entry. If path doesn't exist, also creates the knowhow file.
- `--knowhow-type <type>` — Knowhow document type when creating with --ref (asset, blueprint, document, template, recipe, reference, decision)

Scope-to-directory mapping, category-to-file mapping, and entry format defined in workflow specs-add.md.

**Examples:**
```bash
# English content → English keywords
/spec-add coding "Named exports" "Always use named exports" --keywords "exports,naming"

# Chinese content → Chinese keywords (匹配中文 prompt)
/spec-add coding "命名导出规范" "始终使用命名导出" --keywords "导出,命名,模块"

# Mixed → bilingual keywords
/spec-add coding "OAuth PKCE Flow" "完整 PKCE 集成流程" --ref knowhow/RCP-oauth-pkce.md --keywords "oauth,pkce,认证,授权"

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
| E003 | fatal | Invalid category -- must be one of: coding, arch, quality, debug, test, review, learning, tools, ui | parse_input |
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
