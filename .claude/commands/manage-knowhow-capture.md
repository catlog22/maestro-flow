---
name: manage-knowhow-capture
description: Capture reusable knowledge as templates, recipes, or tips
argument-hint: "[<type>] [<description>] [--lang <lang>] [--source <url>] [--tag t1,t2]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebFetch
  - AskUserQuestion
session-mode: none
---
<purpose>
Capture reusable knowledge into `.workflow/knowhow/` with type-specific structured fields.
Auto-indexed by WikiIndexer (type=knowhow), searchable via `maestro search --type knowhow`.
</purpose>

<required_reading>
@~/.maestro/workflows/knowhow.md
</required_reading>

<context>
$ARGUMENTS — type token + description + optional flags.

**Flags**: `--lang <lang>`, `--source <url>`, `--tag tag1,tag2`, `--title <title>`, `--description <desc>`, `--asset-type <type>`, `--code-paths <paths>`, `--category <cat>`

**Type routing** (first token match):

| Token | Type | Prefix | Key fields |
|-------|------|--------|------------|
| `compact`/`session`/`压缩`/`保存` | compact | KNW- | objective, files, decisions, plan, pending |
| `template`/`tpl`/`模板` | template | TPL- | language, code block, usage, parameters |
| `recipe`/`rcp`/`配方`/`步骤` | recipe | RCP- | prerequisites, steps, expected outcome, pitfalls |
| `reference`/`ref`/`参考`/`引用` | reference | REF- | source URL, key points, scenarios, examples |
| `decision`/`dcs`/`决策`/`adr` | decision | DCS- | context, alternatives table, rationale, consequences |
| `tip`/`note`/`记录`/`快速` | tip | TIP- | content, tags |
| `asset`/`ast`/`资产`/`契约` | asset | AST- | assetType, codePaths, category |
| `blueprint`/`blp`/`蓝图` | blueprint | BLP- | codePaths, category |
| `document`/`doc`/`文档` | document | DOC- | (general fallback) |
| `insight`/`ins`/`洞察`/`经验` | insight | INS- | content, tags, phase (replaces former manage-learn) |
| Short text + `--tag` | tip | TIP- | — |
| No args | — | — | AskUserQuestion (10 options) |

**Output**: `.workflow/knowhow/{PREFIX}-{YYYYMMDD}-{slug}.md` with YAML frontmatter (title, description, type, category, created, tags, source, lang, status)

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/` only. NEVER modify source code or files outside this path.
</context>

<invariants>
1. **Description required** — every entry MUST have a `description` field in frontmatter (under 120 chars) for search indexing
2. **Tags language match** — tags MUST match content language (Chinese content → Chinese tags, English → English)
3. **ID uniqueness** — generated file names ({PREFIX}-{YYYYMMDD}-{slug}.md) MUST be unique; NEVER overwrite existing entries
4. **Frontmatter completeness** — YAML frontmatter MUST include: title, description, type, category, created, tags, status
5. **Type-specific validation** — each type MUST populate all its required fields before writing (template needs code block, recipe needs steps, etc.)
6. **Idempotent naming** — same content captured twice MUST produce same slug, enabling dedup detection
</invariants>

<execution>
Follow '~/.maestro/workflows/knowhow.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Type Detection → Content Collection** (Type routing → Content extraction)
- REQUIRED: Type detected from first token or selected via AskUserQuestion.
- REQUIRED: Type maps to a valid prefix (KNW-/TPL-/RCP-/REF-/DCS-/TIP-/AST-/BLP-/DOC-/INS-).
- BLOCKED if type unresolvable after interactive prompt.

**GATE 2: Content Collection → Write** (Content extraction → File write)
- REQUIRED: All type-specific required fields populated (e.g., template needs code block, recipe needs steps).
- REQUIRED: `description` field generated or provided (under 120 chars).
- REQUIRED: Tags generated in correct language matching content.
- BLOCKED if required fields missing after user prompt (E002/E003).

**Description rule**: Every entry MUST have a `description` field in frontmatter — a one-line summary (under 120 chars) for search results. WikiIndexer uses priority chain: `description > content[:240]`. Use `--description` flag value if provided; otherwise auto-generate from content.

**Tags language rule**: Tags must match content language. Chinese content → Chinese tags (如 `认证,令牌,刷新`). English content → English tags. Mixed → bilingual.

**Type-specific content rules**:

| Type | Content extraction |
|------|-------------------|
| compact | Extract from conversation: session ID, objective, execution plan (verbatim), working files (3-8), decisions, constraints, pending. Plan priority: workflow IMPL_PLAN.md > TodoWrite > user-stated > inferred. |
| template | Ask for: language, code block, parameters (placeholders), usage context, dependencies |
| recipe | Ask for: goal, prerequisites, numbered steps, expected outcome, common pitfalls |
| reference | From --source URL or ask. Key points, applicable scenarios, quick examples. Offer WebFetch if URL provided. |
| decision | Context, alternatives (table: alt/pros/cons/rejected-because), rationale, consequences. Status: proposed/accepted/superseded. |
| tip | Content = everything after type token. Auto-detect context from recent files. |
| asset | assetType (api-contract/data-model/prompt/config), codePaths, category for agent discovery |
| blueprint | Architecture design with codePaths and category |
</execution>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E002 | Template: no code provided after prompt | Ask again or cancel |
| E003 | Recipe: no steps provided after prompt | Ask again or cancel |
| W001 | No active workflow session (compact) | Captures conversation only |
| W002 | Plan detection found no explicit plan (compact) | Uses inferred plan |
</error_codes>

<success_criteria>
- [ ] Type detected or selected, all type-specific fields populated
- [ ] File written to .workflow/knowhow/ with correct prefix and YAML frontmatter
- [ ] Confirmation displayed with ID, type, path
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Entry captured | `/manage-knowhow list` to view library |
| Want to connect entries | `/manage-wiki connect` |
| Want to bridge to specs | `/spec-add <category>` with `--spec-category` |
</completion>
