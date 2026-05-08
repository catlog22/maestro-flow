---
name: manage-knowhow-capture
description: Capture reusable knowledge as templates, recipes, or tips
argument-hint: "[type] [description] [--lang <lang>] [--source <url>] [--tag tag1,tag2]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Capture reusable knowledge into `.workflow/knowhow/` with type-specific structured fields.
Six content types, each optimized for a different reuse pattern. All entries are automatically
indexed by WikiIndexer (type=knowhow) and searchable via `maestro knowhow search`.
</purpose>

<required_reading>
@~/.maestro/workflows/knowhow.md
</required_reading>

<context>
Arguments: $ARGUMENTS

**Types:**

| Type | Prefix | Use Case | Key Fields |
|------|--------|----------|------------|
| `compact` | KNW- | Session state recovery | objective, files, decisions, plan, pending |
| `template` | TPL- | Code/config templates | language, code block, usage context |
| `recipe` | RCP- | Step-by-step how-to | prerequisites, steps, expected outcome |
| `reference` | REF- | External doc / API quick-ref | source URL, key points, scenarios |
| `decision` | DCS- | Design decision record | context, alternatives, rationale, consequences |
| `tip` | TIP- | Quick note / reminder | content, tags |

No arguments: auto-detect type or ask user via AskUserQuestion.

**Flags:**
- `--lang <lang>` — Language for templates (typescript, python, bash, yaml, etc.)
- `--source <url>` — Source URL for references
- `--tag tag1,tag2` — Categorization tags
- `--title <title>` — Explicit title (auto-generated if omitted)
</context>

<execution>

### Step 1: Detect Type

Parse first token as type. If ambiguous, AskUserQuestion with options:

| Token Match | Type |
|-------------|------|
| `compact`, `session`, `压缩`, `保存` | compact |
| `template`, `tpl`, `模板` | template |
| `recipe`, `rcp`, `配方`, `步骤` | recipe |
| `reference`, `ref`, `参考`, `引用` | reference |
| `decision`, `dcs`, `决策`, `adr` | decision |
| `tip`, `note`, `记录`, `快速` | tip |
| No match, short text, `--tag` present | tip |
| No arguments | AskUserQuestion (6 options) |

### Step 2: Generate Content by Type

#### compact (KNW-{YYYYMMDD}-{HHMM}.md)

Extract from conversation history:
- **Session ID** — WFS-* if workflow session active, else `manual-{date}`
- **Project Root** — Absolute path
- **Objective** — High-level goal
- **Execution Plan** — Source + complete verbatim content (never summarize)
- **Working Files** — Modified files with roles (absolute paths, 3-8 files)
- **Reference Files** — Read-only context files
- **Last Action** — Final action + result
- **Decisions** — Table: decision | reasoning
- **Constraints** — User-specified limitations
- **Dependencies** — Added/changed packages
- **Known Issues** — Deferred bugs
- **Changes Made** — Completed modifications
- **Pending** — Next steps
- **Notes** — Unstructured thoughts

Plan detection priority: workflow session IMPL_PLAN.md > TodoWrite items > user-stated > inferred.

#### template (TPL-{YYYYMMDD}-{HHMM}.md)

Ask for or extract:
- **Language / Tech** — `--lang` flag or inferred from context
- **Usage** — When/how to use this template
- **Code** — The template content (ask user to provide or select from conversation)
- **Parameters** — Placeholders to replace (e.g. `{{name}}`, `{{port}}`)
- **Dependencies** — Required packages/config
- **Tags** — From `--tag` flag

If code not provided explicitly, prompt user: "Paste the template code:"

#### recipe (RCP-{YYYYMMDD}-{HHMM}.md)

Ask for or extract:
- **Goal** — What this recipe accomplishes
- **Prerequisites** — Tools, access, config needed
- **Steps** — Numbered step-by-step instructions
- **Expected Outcome** — What success looks like
- **Common Pitfalls** — Known issues / gotchas
- **Related** — Links to templates, references, decisions used
- **Tags** — From `--tag` flag

If steps not clear, prompt user: "Describe the steps (numbered list):"

#### reference (REF-{YYYYMMDD}-{HHMM}.md)

Ask for or extract:
- **Source** — `--source` flag (URL, doc title, API endpoint)
- **Key Points** — Bullet list of essential info
- **Applicable Scenarios** — When to consult this reference
- **Quick Examples** — Copy-paste ready code snippets
- **Last Verified** — Date (today)
- **Tags** — From `--tag` flag

If `--source` provided, offer to fetch and summarize via WebFetch.

#### decision (DCS-{YYYYMMDD}-{HHMM}.md)

Ask for or extract:
- **Context** — Background and problem statement
- **Decision** — What was decided
- **Alternatives Considered** — Table: alternative | pros | cons | rejected because
- **Rationale** — Why this choice over alternatives
- **Consequences** — Positive and negative impact
- **Related** — Links to affected specs, recipes, templates
- **Date** — Decision date
- **Status** — proposed | accepted | superseded

#### tip (TIP-{YYYYMMDD}-{HHMM}.md)

Simple note:
- **Content** — Everything after type token (or full $ARGUMENTS)
- **Context** — Auto-detected from recent conversation files
- **Tags** — From `--tag` flag
- **Timestamp** — ISO format

### Step 3: Write File

Write to `.workflow/knowhow/{PREFIX}-{YYYYMMDD}-{HHMM}.md` with YAML frontmatter:

```yaml
---
title: {auto or --title}
type: {type}
category: {type}
created: {ISO timestamp}
tags: [{tags}]
source: {url if reference}
lang: {language if template}
status: {status if decision}
---
{markdown body}
```

### Step 4: Confirm

```
=== KNOWHOW CAPTURED ===
Type: {type}
ID:   knowhow-{slug}
File: .workflow/knowhow/{filename}

{type-specific summary line}
```
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `/maestro-init` first | validate |
| E002 | error | Template: no code provided after prompt | template |
| E003 | error | Recipe: no steps provided after prompt | recipe |
| W001 | warning | No active workflow session — compact captures conversation only | compact |
| W002 | warning | Plan detection found no explicit plan — using inferred plan | compact |
| W003 | warning | `--source` URL could not be fetched — proceeding with manual entry | reference |
</error_codes>

<success_criteria>
- [ ] Type correctly detected or selected
- [ ] All type-specific fields populated (not empty)
- [ ] YAML frontmatter written with correct fields
- [ ] Markdown body follows type structure
- [ ] File written to `.workflow/knowhow/` with correct prefix
- [ ] Auto-indexed by WikiIndexer (type=knowhow)
- [ ] Confirmation displayed with ID, type, file path
- [ ] Next step hint appropriate to type shown
</success_criteria>
