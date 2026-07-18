<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# KnowHow Workflow

## Dual Store Architecture

| Store | Path | Format | Index |
|-------|------|--------|-------|
| `workflow` | `.workflow/knowhow/` | `{PREFIX}-*.md` (6 prefixes) | `.workflow/wiki-index.json` (unified, WikiIndexer) |
| `system` | `~/.claude/projects/{project}/memory/` | `MEMORY.md` + topic `.md` files | None (flat files) |

**System memory path detection:**
```bash
# Derive from project root — replace path separators with '--', prefix drive letter
# e.g., D:\maestro2 → ~/.claude/projects/D--maestro2/memory/
```

---

## Content Type Matrix

Six types of knowhow, each with dedicated structure:

| Type | Prefix | Purpose | Trigger |
|------|--------|---------|---------|
| `session` | KNW- | Session state recovery | End of complex task, before context switch |
| `template` | TPL- | Reusable code/config templates | Extracting a pattern, saving boilerplate |
| `recipe` | RCP- | Step-by-step operational guide | Documenting a workflow, onboarding |
| `reference` | REF- | External doc / API quick-reference | Importing docs, saving URL summaries |
| `decision` | DCS- | Architecture Decision Record | Making non-trivial design choices |
| `tip` | TIP- | Quick note, snippet, reminder | Fleeting insight, debugging trick |

All types share `WikiNodeType = 'knowhow'`. The `type` field distinguishes subtypes in wiki queries.

---

## Part A: KnowHow Management (/maestro-manage knowledge knowhow)

Operations: list, search, view, edit, delete, prune across both stores.

### Step 1: Resolve Paths

- **Workflow**: `.workflow/knowhow/` (index: `.workflow/wiki-index.json`)
- **System**: `~/.claude/projects/{project-path}/memory/`

Verify stores exist. Neither → E001.

### Step 2: Parse Input

| Input | Route |
|-------|-------|
| No arguments, `list`, `列表`, `ls` | List mode |
| `search <query>`, `搜索`, `find` | Search mode |
| `view <id\|file>`, `查看`, `show` | View mode |
| `edit <file>`, `编辑` | Edit mode (system store only) |
| `delete <id\|file>`, `删除`, `rm` | Delete mode |
| `prune`, `清理`, `cleanup` | Prune mode |

**Store auto-detection:** Arguments matching `KNW-*`, `TIP-*`, `TPL-*`, `RCP-*`, `REF-*`, `DCS-*` → workflow store. Other filenames → system store.

### Step 3: List

Workflow: `maestro wiki list --type knowhow --json`, filter by `--keywords`, `--type`, `--role`.
System: Glob `*.md` files, extract titles.

Display: ID/File, Type, Category, Date, Tags, Summary with navigation hints.

### Step 4: Search

Full-text search across both stores. Rank: exact match > heading > content.

### Step 5-9: View, Edit, Delete, Prune, Integrity Check

MANDATORY: execute View/Edit/Delete/Prune/Integrity-Check logic per spec; REQUIRED produce: per-step result + final store-consistency report; BLOCKED if any step's produce missing.

- **View**: Workflow `maestro wiki get <slug>`, System Read file; BLOCKED if entry not found.
- **Edit**: System store only, direct file edit preserving frontmatter; BLOCKED if frontmatter schema invalid after edit.
- **Delete**: Workflow `maestro wiki delete <slug>`, System mv to `.workflow/.trash/`; REQUIRED produce backup; BLOCKED if backup missing.
- **Prune**: Scan `status=deprecated|superseded` entries, list candidates, delete after confirm; REQUIRED produce prune report; BLOCKED if delete without backup.
- **Integrity Check**: Workflow verify `wiki-index.json` matches disk, System verify MEMORY.md links; REQUIRED produce report {missing[], stale[]}; BLOCKED if missing>0.

---

## Part B: KnowHow Capture (/maestro-manage knowledge capture)

Capture reusable knowledge into `.workflow/knowhow/`.

### Step 1: Detect Type

| Token | Type |
|-------|------|
| `compact`, `session`, `压缩` | session |
| `template`, `tpl`, `模板` | template |
| `recipe`, `rcp`, `配方`, `步骤` | recipe |
| `reference`, `ref`, `参考` | reference |
| `decision`, `dcs`, `决策`, `adr` | decision |
| `tip`, `note`, `记录` | tip |
| No arguments | AskUserQuestion (6 options) |

### Step 2: Generate Content by Type

#### session (KNW-{YYYYMMDD}-{slug}.md)

Extract from current conversation. Sections:

1. **Session ID** — WFS-* or `manual-{date}`
2. **Project Root** — Absolute path
3. **Objective** — High-level goal
4. **Execution Plan** — Source type + complete verbatim content
5. **Working Files** — 3-8 modified files with roles, absolute paths
6. **Reference Files** — Key context files (CLAUDE.md, types, configs)
7. **Last Action** — Final action + result
8. **Decisions** — `| Decision | Reasoning |` table
9. **Constraints** — User-specified limitations
10. **Dependencies** — Added/changed packages
11. **Known Issues** — Deferred bugs
12. **Changes Made** — Completed modifications
13. **Pending** — Next steps
14. **Notes** — Unstructured

Plan detection priority: IMPL_PLAN.md > TodoWrite > user-stated > inferred.
Rules: VERBATIM plan, ABSOLUTE paths, decisions include reasoning.

#### template (TPL-{YYYYMMDD}-{slug}.md)

Reusable code or configuration pattern. Sections:

```markdown
---
title: {descriptive name}
description: {one-line summary for search results}
type: template
lang: {typescript|python|bash|yaml|...}
tags: [{comma-separated}]
created: {ISO timestamp}
---

# {title}

## Usage
When and how to use this template.

## Parameters
| Placeholder | Description | Default |
|-------------|-------------|---------|
| `{{name}}` | ... | ... |

## Dependencies
- package-list

## Code
```{lang}
{copy-paste ready code}
```

## Notes
Additional context.
```

#### recipe (RCP-{YYYYMMDD}-{slug}.md)

Step-by-step operational guide. Sections:

```markdown
---
title: {goal summary}
description: {one-line summary for search results}
type: recipe
tags: [{comma-separated}]
created: {ISO timestamp}
---

# {title}

## Goal
What this recipe accomplishes.

## Prerequisites
- Tool/access/config requirements

## Steps
1. First step
2. Second step
...

## Expected Outcome
What success looks like.

## Common Pitfalls
- Gotcha 1
- Gotcha 2

## Related
- [[recipe-xxx]] — Related recipes
- [[template-xxx]] — Templates used
```

#### reference (REF-{YYYYMMDD}-{slug}.md)

External documentation digest. Sections:

```markdown
---
title: {reference title}
description: {one-line summary for search results}
type: reference
source: {original URL}
tags: [{comma-separated}]
created: {ISO timestamp}
last_verified: {ISO date}
---

# {title}

## Source
{URL or document reference}

## Key Points
- Essential info point 1
- Essential info point 2

## Applicable Scenarios
- When to consult this reference

## Quick Examples
```lang
{copy-paste examples}
```

## Notes
Additional context.
```

#### decision (DCS-{YYYYMMDD}-{slug}.md)

Architecture Decision Record. Sections:

```markdown
---
title: {decision summary}
description: {one-line summary for search results}
type: decision
status: {proposed|accepted|superseded}
tags: [{comma-separated}]
created: {ISO timestamp}
---

# {title}

## Context
Background and problem statement.

## Decision
What was decided.

## Alternatives Considered
| Alternative | Pros | Cons | Rejected Because |
|-------------|------|------|------------------|
| Option A | ... | ... | ... |
| Option B | ... | ... | ... |

## Rationale
Why this choice over alternatives.

## Consequences
### Positive
- Benefit 1

### Negative
- Trade-off 1

## Related
- [[spec-xxx]] — Affected spec
- [[recipe-xxx]] — Implementation recipe
```

#### tip (TIP-{YYYYMMDD}-{slug}.md)

Quick note. Minimal structure:

```markdown
---
title: {tip summary}
description: {one-line summary for search results}
type: tip
tags: [{comma-separated}]
created: {ISO timestamp}
---

# {title}

{content}

## Context
{Auto-detected files/modules}
```

### Step 3: Generate Tags (Language-Aware)

Auto-generate 3-5 tags matching the **content language**:

- **Chinese content** → Chinese tags (2-4 字词语，如 `认证`, `路由`, `状态管理`)
- **English content** → English tags (lowercase, hyphenated, e.g. `auth`, `routing`, `state-mgmt`)
- **Mixed content** → Bilingual tags (中英各半，如 `认证,auth,令牌,token`)

Tag quality rules:
- Domain-specific terms users would naturally search for
- Avoid generic words (代码/code, 文件/file, 函数/function)
- Chinese tags: 2-4 characters, no punctuation
- English tags: lowercase, hyphens for multi-word

### Step 4: Write File

Write to `.workflow/knowhow/{PREFIX}-{YYYYMMDD}-{slug}.md`.

Frontmatter keys by type:

| Field | session | template | recipe | reference | decision | tip |
|-------|:-------:|:--------:|:------:|:---------:|:--------:|:---:|
| title | Y | Y | Y | Y | Y | Y |
| description | Y | Y | Y | Y | Y | Y |
| type | Y | Y | Y | Y | Y | Y |
| tags | Y | Y | Y | Y | Y | Y |
| created | Y | Y | Y | Y | Y | Y |
| lang | | Y | | | | |
| source | | | | Y | | |
| status | | | | | Y | |
| last_verified | | | | Y | | |

### Step 4: Report

Display confirmation with ID, type, file path, and type-specific summary line.

---

## Part C: Retrieval

### CLI

```bash
maestro knowhow list                    # all entries
maestro knowhow list --type template    # by type
maestro knowhow search "deploy auth"    # full-text
maestro knowhow get knowhow-{slug}      # view one

maestro wiki list --type knowhow --json # programmatic
maestro wiki list --type knowhow --role plan  # decisions only
```

### MCP

```
store_knowhow { operation: "search", query: "deploy" }
store_knowhow { operation: "add", type: "template", title: "...", description: "...", body: "..." }
```

### Type Label Reference

| Wiki type | Type | Prefix | Label |
|-----------|------|--------|-------|
| knowhow | session | KNW- | Session |
| knowhow | tip | TIP- | Tip |
| knowhow | template | TPL- | Template |
| knowhow | recipe | RCP- | Recipe |
| knowhow | reference | REF- | Reference |
| knowhow | decision | DCS- | Decision |
| spec | learning | — | Learning Insight (in `specs/learnings.md`) |

---

## Part D: Learning Insights Container (specs/learnings.md)

### Container Format

```markdown
---
title: "Learning Insights"
type: spec
roles: [implement]
tags: [insights, learning]
created: {ISO timestamp}
---
# Learning Insights

Atomic insights captured during active work.

## Entries

<spec-entry category="coding" keywords="pattern,auth,jwt" date="2026-05-10" id="INS-abc123" source="manual">

### JWT refresh tokens must rotate on every use

Refresh-on-use prevents replay attacks.

- **Phase**: 1 (01-auth)
- **Confidence**: high
- **Tags**: auth, jwt, security

</spec-entry>

<spec-entry category="debug" keywords="gotcha,redis,cache" date="2026-05-11" id="INS-def456" source="retrospective">

### Redis MULTI is not truly transactional

MULTI/EXEC guarantees atomicity but not isolation...

- **Phase**: 2 (02-cache)
- **Lens**: technical
- **Confidence**: medium

</spec-entry>
```

### Producers

Multiple workflows append `<spec-entry>` blocks to this container:

| Workflow | Source value | When |
|----------|-------------|------|
| `/maestro-manage knowledge capture` | `manual` or `tip` | Manual capture during active work |
| `retrospective` | `retrospective` | Phase retrospective insight distillation |
| `learn-retro` | `retro-git` or `retro-decision` | Retrospective from git activity or decisions |
| `wiki-connect` | `wiki-connect` | Graph connectivity insights |
| `wiki-digest` | `wiki-digest` | Knowledge synthesis meta-insights |

### Retrieval

```bash
maestro wiki list --type knowhow --role implement    # list all insights
maestro wiki search "<query>"                           # full-text search
```
