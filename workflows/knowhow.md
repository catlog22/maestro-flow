<!-- session-mode: none -->
# KnowHow Workflow

## Dual Store Architecture

| Store | Path | Format | Index |
|-------|------|--------|-------|
| `workflow` | `.workflow/knowhow/` | `{PREFIX}-*.md` (9 compatible prefixes/types) | `.workflow/wiki-index.json` (unified, WikiIndexer) |
| `system` | `~/.claude/projects/{project}/memory/` | `MEMORY.md` + topic `.md` files | None (flat files) |

**System memory path detection:**
```bash
# Derive from project root — replace path separators with '--', prefix drive letter
# e.g., D:\maestro2 → ~/.claude/projects/D--maestro2/memory/
```

---

## Content Type Matrix

Nine Knowhow types remain compatible:

| Type | Prefix | Purpose | Trigger |
|------|--------|---------|---------|
| `session` | KNW- | Session state recovery | End of complex task, before context switch |
| `tip` | TIP- | Quick note, snippet, reminder | Fleeting insight, debugging trick |
| `template` | TPL- | Reusable code/config templates | Extracting a pattern, saving boilerplate |
| `recipe` | RCP- | Step-by-step operational guide | Documenting a workflow, onboarding |
| `reference` | REF- | External doc / API quick-reference | Importing docs, saving URL summaries |
| `decision` | DCS- | Architecture Decision Record | Making non-trivial design choices |
| `asset` | AST- | Code/design/API asset | Preserving a reusable concrete asset |
| `blueprint` | BLP- | Architecture blueprint | Capturing a reusable system shape |
| `document` | DOC- | General long-form knowledge | Material that does not fit a narrower type |

All types share `WikiNodeType = 'knowhow'`. The `type` field distinguishes subtypes in wiki queries.

---

## Part A: KnowHow Management (direct document invocation)

Operations: list, search, view, edit, delete, prune across both stores. The MCP `store_knowhow` surface is separate and exposes exactly five operations: `add`, `search`, `supersede`, `history`, and `recover`.

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

**Store auto-detection:** Arguments matching `KNW-*`, `TIP-*`, `TPL-*`, `RCP-*`, `REF-*`, `DCS-*`, `AST-*`, `BLP-*`, or `DOC-*` → workflow store. Other filenames → system store.

### Step 3: List

Workflow: `maestro wiki list --type knowhow --json`, filter by `--keyword`, `--type`, `--category`.
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

## Part B: KnowHow Capture (/maestro-knowhow capture)

Capture reusable knowledge into `.workflow/knowhow/` through the canonical writer. Ordinary creation has exactly three required knowledge parameters: `type`, `title`, `content`.

```bash
maestro knowhow add --type tip --title "Bounded retry" --content "Retry transient failures at most three times."
# Long content: replace --content with --content-file <path>
```

Keywords, sourceRef, relatedPaths, appliesToRepoIds, language, decisionState, explicitId, and tool are advanced optional metadata. On the CLI, `--repo` selects the physical destination and repeatable `--applies-to-repo` records applicability. In host/MCP calls, omit `targetRepoId` for the current repository; pass it only when the user/workflow explicitly selects a linked physical write and the host provides the exact stable UUID plus live `knowhow` write capability. Never infer it from cwd, repository name, alias, or path; never persist alias/path as identity.

### Step 1: Detect Type from Intent

`$ARGUMENTS` is free-form capture intent. Determine the content type:

1. Explicit keyword present → pin that type (deterministic shortcut):

| Keyword | Type |
|-------|------|
| `compact`, `session`, `压缩` | session |
| `template`, `tpl`, `模板` | template |
| `recipe`, `rcp`, `配方`, `步骤` | recipe |
| `reference`, `ref`, `参考` | reference |
| `decision`, `dcs`, `决策`, `adr` | decision |
| `tip`, `note`, `技巧` | tip |
| `asset`, `ast`, `资产` | asset |
| `blueprint`, `blp`, `蓝图` | blueprint |
| `document`, `doc`, `文档` | document |

2. Otherwise infer from the intent, e.g.:
   - “决定/决策/选用 X 因为…” → decision
   - “这段代码/模板/可复用的…” → template
   - “怎么部署/步骤/流程/配方…” → recipe
   - “API/文档参考/速查…” → reference
   - “踩坑/技巧/小记/redis 管道…” → tip
   - “会话/压缩当前进度…” → session
3. No clear signal → AskUserQuestion with the nine compatible types.

### Step 2: Generate Body-Only Content by Type

The temporary content file contains **Markdown body only**. Do not emit YAML frontmatter, `title`, `type`, `keywords`, language, source, decision state, IDs, repository metadata, or generated filenames into it. The canonical writer owns frontmatter and identity; pass metadata only through the flags in Step 4.

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

Reusable code or configuration pattern. Body sections: `## Usage`, `## Parameters`, `## Dependencies`, `## Code`, and `## Notes`. Put the copy-paste-ready code in a fenced block. Pass its language with `--language`; do not add frontmatter or repeat the title in the body.

#### recipe (RCP-{YYYYMMDD}-{slug}.md)

Step-by-step operational guide. Body sections: `## Goal`, `## Prerequisites`, `## Steps`, `## Expected Outcome`, `## Common Pitfalls`, and `## Related`. No frontmatter or duplicate H1.

#### reference (REF-{YYYYMMDD}-{slug}.md)

External documentation digest. Body sections: `## Source`, `## Key Points`, `## Applicable Scenarios`, `## Quick Examples`, and `## Notes`. Pass the source identity with `--source-ref` and any language with `--language`; the body may describe the source but must not contain frontmatter.

#### decision (DCS-{YYYYMMDD}-{slug}.md)

Architecture Decision Record. Body sections: `## Context`, `## Decision`, `## Alternatives Considered`, `## Rationale`, `## Consequences`, and `## Related`. Pass `proposed|accepted|superseded` via `--decision-state`; never encode it as frontmatter in the body.

#### tip (TIP-{YYYYMMDD}-{slug}.md)

Quick note. The body is the concise insight followed, when useful, by `## Context`. Pass detected files/modules through repeatable `--related-path` flags rather than frontmatter.

#### asset (AST-{YYYYMMDD}-{slug}.md)

Reusable concrete code, design, data, API, or prompt asset. Body sections: `## Asset`, `## Usage`, `## Interface or Format`, `## Validation`, and `## Notes`. Put source files in repeatable `--related-path` flags.

#### blueprint (BLP-{YYYYMMDD}-{slug}.md)

Reusable system or architecture shape. Body sections: `## Context`, `## Components`, `## Data Flow`, `## Constraints`, `## Extension Points`, and `## Validation`.

#### document (DOC-{YYYYMMDD}-{slug}.md)

General long-form knowledge that does not fit a narrower type. Use descriptive body headings appropriate to the material; do not add frontmatter or duplicate the title.

### Step 3: Generate Canonical Keywords (Language-Aware)

Auto-generate 3-5 keywords matching the **content language**:

- **Chinese content** → Chinese keywords (2-4 字词语，如 `认证`, `路由`, `状态管理`)
- **English content** → English keywords (lowercase, hyphenated, e.g. `auth`, `routing`, `state-mgmt`)
- **Mixed content** → bilingual keywords (中英各半，如 `认证,auth,令牌,token`)

Keyword quality rules:
- Domain-specific terms users would naturally search for
- Avoid generic words (代码/code, 文件/file, 函数/function)
- Chinese keywords: 2-4 characters, no punctuation
- English keywords: lowercase, hyphenated for multi-word terms

### Step 4: Write Through the Canonical CLI

Write the generated **body only** to a temporary file. Build the command from canonical flags (omit flags without a value):

```bash
maestro knowhow add --type <type> --title "<title>" \
  --content-file <temp-path> \
  --keywords <kw1>,<kw2>,<kw3> \
  [--source-ref <url-or-document-id>] \
  [--related-path <project-relative-path>]... \
  [--language <language>] \
  [--decision-state proposed|accepted|superseded] \
  [--applies-to-repo <selector>]... \
  [--repo <selector>]
```

Do not use deprecated `--body`, `--body-file`, `--lang`, `--tags`, `--status`, or `--source`. The CLI writes canonical frontmatter, derives the summary, chooses `.workflow/knowhow/{PREFIX}-{YYYYMMDD}-{slug}.md`, and resolves repository selectors.

Repository option semantics:
- CLI `--repo` selects the **physical destination repository**. `current` is the default; an ID, alias, or unique registered name is accepted and resolved by the CLI.
- CLI repeatable `--applies-to-repo` records **applicability metadata**; it does not change the destination.
- `targetRepoId` is not a CLI flag. It is a host/MCP field and must be the exact stable UUID supplied by the host for an explicitly selected linked write with live `knowhow` write capability. Never infer it from cwd/name/alias/path.

### Step 5: Report

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
maestro knowhow list --type decision  # decisions only
```

### MCP

`store_knowhow` supports all five canonical operations:

```text
store_knowhow { operation: "add", type: "template", title: "...", content: "...", keywords: ["..."] }
store_knowhow { operation: "search", query: "deploy", limit: 20 }
store_knowhow { operation: "supersede", oldId: "TIP-...", newId: "TIP-..." }
store_knowhow { operation: "history", id: "TIP-..." }
store_knowhow { operation: "recover" }
```

For an ordinary current-repository MCP write, omit `targetRepoId`. A host may provide the exact stable UUID only for an explicitly selected linked physical write with a live matching-corpus capability.

### Type Label Reference

| Wiki type | Type | Prefix | Label |
|-----------|------|--------|-------|
| knowhow | session | KNW- | Session |
| knowhow | tip | TIP- | Tip |
| knowhow | template | TPL- | Template |
| knowhow | recipe | RCP- | Recipe |
| knowhow | reference | REF- | Reference |
| knowhow | decision | DCS- | Decision |
| knowhow | asset | AST- | Asset |
| knowhow | blueprint | BLP- | Blueprint |
| knowhow | document | DOC- | Document |
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
| `/maestro-knowhow capture` | `manual` or `tip` | Manual capture during active work |
| `retrospective` | `retrospective` | Phase retrospective insight distillation |
| `learn-retro` | `retro-git` or `retro-decision` | Retrospective from git activity or decisions |
| `wiki-connect` | `wiki-connect` | Graph connectivity insights |
| `wiki-digest` | `wiki-digest` | Knowledge synthesis meta-insights |

### Retrieval

```bash
maestro wiki list --type spec --category learning # list learning insights
maestro wiki search "<query>"                           # full-text search
```
