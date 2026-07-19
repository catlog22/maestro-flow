---
name: maestro-spec
disable-model-invocation: true
description: Manage project specs — add, load, remove entries, or initialize the
  spec system. Spec = 项目约束规则（编码规范、架构约束、质量标准）；可复用知识文档走 /maestro-manage knowledge
  capture。Triggers on "maestro-spec add", "记录规范", "添加约束", "添加规则", "加载规范",
  "maestro-spec setup", "初始化规范".
argument-hint: <subcommand> [args...] where subcommand = add|load|remove|setup
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: none
version: 0.5.52
---

<purpose>
Spec management toolkit. Four subcommands:
- `add` — add a `<spec-entry>` by category, with role tagging and 4-scope routing
- `load` — load specs filtered by scope, category, and/or keyword into context
- `remove` — remove a `<spec-entry>` by ID (symmetric with `add`)
- `setup` — initialize `.workflow/specs/` by scanning the codebase for conventions
</purpose>

<routing>
$ARGUMENTS — parse first token as `<subcommand>`, remainder as that subcommand's args.

| Subcommand | Section | Required reading (routed only) |
|------------|---------|--------------------------------|
| `add`    | [Subcommand: add](#subcommand-add)       | `@~/.maestro/workflows/specs-add.md` |
| `load`   | [Subcommand: load](#subcommand-load)     | `@~/.maestro/workflows/specs-load.md` |
| `remove` | [Subcommand: remove](#subcommand-remove) | `@~/.maestro/workflows/specs-remove.md` |
| `setup`  | [Subcommand: setup](#subcommand-setup)   | `@~/.maestro/workflows/specs-setup.md` |

Load only the routed subcommand's required-reading workflow file — do not preload the others.

**Routing errors:**
| Code | Condition | Recovery |
|------|-----------|----------|
| E_NO_SUBCOMMAND | No subcommand provided in $ARGUMENTS | Display valid subcommands (add, load, remove, setup), prompt user to select |
| E_INVALID_SUBCOMMAND | Unrecognized first token | Display valid subcommands with usage hints |
</routing>

---

## Subcommand: add

**Usage**: `/maestro-spec add [--scope project|global|team|personal] [-y] <category> <content>`

<required_reading>
@~/.maestro/workflows/specs-add.md
</required_reading>

<purpose>
Add `<spec-entry>` to specs by category. 4 scopes: project (default), global, team, personal.
</purpose>

<context>
Arguments -- expects `[--scope <scope>] [--uid <uid>] <category> <content>`

**Options:**
- `--description <desc>` — One-line description for search results (falls back to content[:240])
- `--json` — Output JSON with generated `sid` (needed for supersession: `maestro spec supersede <old-sid> --by <new-sid>`)
- `--ref <path>` — Create as index entry referencing a knowhow document. If the path exists, only creates the spec index entry. If path doesn't exist, also creates the knowhow file.
- `--knowhow-type <type>` — Knowhow document type when creating with --ref (asset, blueprint, document, template, recipe, reference, decision)

Scope-to-directory mapping, category-to-file mapping, and entry format defined in workflow specs-add.md.

**Examples:**
```bash
# English content → English keywords
/maestro-spec add coding "Named exports" "Always use named exports" --keywords "exports,naming"

# With description for search results
/maestro-spec add coding "OAuth PKCE Flow" "完整 PKCE 集成流程" --keywords "oauth,pkce" --description "OAuth 2.0 PKCE 认证流程规范"

# Chinese content → Chinese keywords
/maestro-spec add coding "命名导出规范" "始终使用命名导出" --keywords "导出,命名,模块"

# Ref mode
/maestro-spec add arch "OAuth PKCE 集成" "完整流程设计" --ref knowhow/AST-oauth-flow.md
```
</context>

<invariants>
1. **Idempotent append** — duplicate entry ID MUST be rejected (E003-level check on title + category match before write)
2. **Category validation** — category MUST be one of: coding, arch, quality, debug, test, review, learning, ui. Invalid category → E003
3. **Scope isolation** — writes target ONLY the scope-resolved directory; project scope NEVER writes to global (~/.maestro/specs/), global scope NEVER writes to project (.workflow/specs/)
4. **Confirmation gate** — MUST request_user_input before appending entry (unless -y flag); NEVER write without user confirmation in interactive mode
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
- REQUIRED: User confirmation via request_user_input (unless -y flag).
- BLOCKED if: user declines confirmation — abort without writing.

**Confirmation gate**: Unless -y flag is passed, after formatting the `<spec-entry>` block but before appending to the target file, request_user_input showing the formatted entry, target file path, and scope. Proceed only on user confirm.
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
| New entry replaces old one | `maestro spec supersede <old-sid> --by <new-sid>` |
| View evolution chain | `maestro spec history <sid>` |
| Add more entries | `/maestro-spec add <category>` |
| View all specs | `/maestro-spec load --category <category>` |
| Check knowledge health | `maestro spec health` |
</completion>

---

## Subcommand: load

**Usage**: `/maestro-spec load [--scope <scope>] [--category <category>] [--keyword <word>]`

<required_reading>
@~/.maestro/workflows/specs-load.md
</required_reading>

<purpose>
Load relevant specs filtered by scope, category (file-level) and/or keyword (entry-level).
Category-based loading: loads the category's primary doc in full + matching entries from other files.
By default, loads from both global (~/.maestro/specs/) and project (.workflow/specs/) layers.
</purpose>

<context>
Arguments -- optional flags and keyword

**Flags:**
- `--scope <scope>` — Load scope (default: global + project merged):
  - `project`: project baseline only (.workflow/specs/)
  - `global`: global + project merged (~/.maestro/specs/ + .workflow/specs/)
  - `team`: project + team shared (.workflow/collab/specs/)
  - `personal`: project + team + personal (requires uid)
- `--category <category>` — Load by category: primary category doc (full) + cross-file entries with matching category attr. Categories: coding, arch, quality, test, review, debug, learning, ui.
- `--keyword <word>` — Filter by keyword within entries

**File → Primary Category mapping:**
| File | Category |
|------|----------|
| coding-conventions.md | coding |
| architecture-constraints.md | arch |
| test-conventions.md | test |
| review-standards.md | review |
| debug-notes.md | debug |
| ui-conventions.md | ui |
| quality-rules.md | review |
| learnings.md | learning |

**Examples:**
```
/maestro-spec load --category coding            # coding全文 + 跨文件coding条目 (global + project)
/maestro-spec load --scope global --category arch  # 明确包含全局 arch 规范
/maestro-spec load --category review            # review-standards + quality-rules + 跨文件review条目
/maestro-spec load --category coding --keyword auth
/maestro-spec load --keyword auth
```

**Ref entries:**
When loading entries with `ref` attribute, only the summary is shown with a load command:
  → Detail: maestro load --type knowhow --id <knowhow-id>
Use the load command to read the full referenced document.
</context>

<invariants>
1. **Read-only** — NEVER modify, create, or delete any spec files during load. This command is purely a read operation
2. **Output to context only** — loaded specs are injected into the conversation context; NEVER write loaded content to new files or modify existing files
3. **Scope layering** — global scope MUST merge both ~/.maestro/specs/ and .workflow/specs/; project scope loads .workflow/specs/ only; team adds .workflow/collab/specs/; personal adds .workflow/collab/{uid}/specs/
4. **Category primary doc** — when --category is specified, the primary category doc MUST be loaded in full before cross-file matching
5. **Entry-level filtering** — --keyword filtering operates at `<spec-entry>` level via keywords attribute, NOT at file level; unmatched entries in a matching file are excluded
6. **Output boundary** — this command produces NO file writes. All output is conversation-context injection only
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-load.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Discover**
- REQUIRED: Arguments parsed — at least one of --category or --keyword is provided, or empty args triggers full load.
- REQUIRED: Scope resolved (default: global+project merged).
- BLOCKED if: invalid scope value or invalid category value.

**GATE 2: Discover → Load**
- REQUIRED: At least one spec directory exists in the resolved scope chain.
- BLOCKED if: E001 — .workflow/specs/ not initialized AND no global specs available. Warn and abort.

**GATE 3: Load → Display**
- REQUIRED: Spec files read and entries parsed.
- REQUIRED: Keyword filtering applied if --keyword was provided.
- BLOCKED if: no readable spec files found in any scope layer.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | warning | `.workflow/specs/` not initialized -- run `/maestro-spec setup` first (global specs still available) | detect_context |
| W001 | warning | No matching specs found for keyword -- showing all specs in category instead | load_specs |
</error_codes>

<success_criteria>
- [ ] Category and/or keyword parsed from arguments
- [ ] Spec files loaded per category mapping
- [ ] Keyword filtering applied at entry level (via `<spec-entry>` keywords attribute)
- [ ] Legacy entries filtered by text grep fallback
- [ ] Results displayed with file:category references
</success_criteria>

---

## Subcommand: remove

**Usage**: `/maestro-spec remove <entry-id> [--cascade] [-y]`

<required_reading>
@~/.maestro/workflows/specs-remove.md
</required_reading>

<purpose>
Remove a `<spec-entry>` from a specs file. Symmetric with `/maestro-spec add`.
Uses `maestro wiki remove-entry` for atomic removal with index auto-update.
</purpose>

<context>
Arguments -- expects `<entry-id>` (e.g., `spec-learnings-003`, `spec-coding-conventions-001`)

**Entry ID format**: `spec-{file-stem}-{NNN}` — the sub-node ID assigned by WikiIndexer when indexing `<spec-entry>` blocks.

**Discovery**: Use `maestro wiki list --type spec --json` or `/maestro-spec load --keyword <term>` to find entry IDs.

**Flags:**
- `--cascade` — When the target spec is a ref-type entry (created via `maestro-spec add --ref` and linked to a knowhow document), also delete the referenced knowhow file. Without this flag, ref-type removal leaves an orphan knowhow file.
</context>

<invariants>
1. **Confirmation required** — MUST request_user_input before deletion (unless -y flag); NEVER remove entries silently
2. **Referential integrity** — before removing, check if other spec entries reference the target entry; warn user if references exist
3. **Cascade explicit** — ref-type entries MUST NOT cascade-delete the linked knowhow file unless --cascade is explicitly passed; default leaves orphan knowhow intact
4. **Atomic removal** — use `maestro wiki remove-entry` for atomic operation; NEVER manually edit spec files to remove entries
5. **Index consistency** — wiki index MUST be auto-updated after removal; stale index entries are a hard failure
6. **Output boundary** — file modifications MUST target ONLY the spec container file (.workflow/specs/*.md) and optionally the referenced knowhow file (.workflow/knowhow/*) when --cascade is used. NEVER modify source code or files outside these paths
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-remove.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Lookup**
- REQUIRED: Entry ID parsed from arguments.
- BLOCKED if: E001 — no entry ID provided.

**GATE 2: Lookup → Confirm**
- REQUIRED: .workflow/specs/ directory exists.
- REQUIRED: Entry found in wiki index as a spec sub-node.
- REQUIRED: Entry content loaded for user preview.
- BLOCKED if: E002 (specs not initialized), E003 (entry not found), E004 (wrong type).

**GATE 3: Confirm → Remove**
- REQUIRED: User confirmed removal via request_user_input (unless -y flag).
- REQUIRED: If --cascade and entry has ref attribute, user additionally confirmed knowhow file deletion.
- BLOCKED if: user declines — abort without modification.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Entry ID is required -- usage: `/maestro-spec remove <entry-id>` | parse_input |
| E002 | fatal | `.workflow/specs/` not initialized -- run `/maestro-spec setup` first | validate |
| E003 | fatal | Entry ID not found in wiki index | lookup |
| E004 | fatal | Entry is not a spec sub-node (wrong type) | validate |
</error_codes>

<success_criteria>
- [ ] Entry ID parsed and validated
- [ ] Entry found in wiki index (type=spec, is sub-node)
- [ ] User confirmed removal (unless -y flag)
- [ ] Entry removed from container file via `maestro wiki remove-entry`
- [ ] Wiki index auto-updated
- [ ] If `--cascade` and entry has a `ref` attribute: referenced knowhow file deleted, orphan avoided
- [ ] Confirmation displayed with removed entry details (and cascaded knowhow path if applicable)
</success_criteria>

---

## Subcommand: setup

**Usage**: `/maestro-spec setup`

<required_reading>
@~/.maestro/workflows/specs-setup.md
</required_reading>

<purpose>
Initialize `.workflow/specs/` by scanning codebase for conventions. Core files always created; optional files created when signals detected. Also generates recipe knowhow for detected workflows.
</purpose>

<context>
No arguments expected.

**Preconditions:**
- `.workflow/` directory must exist (created by `/maestro-init`)  # (see code: E001)
- Project must contain source files to scan  # (see code: E002)
</context>

<invariants>
1. **Non-destructive** — NEVER overwrite existing spec files; if a file already exists, skip it and report as already-initialized
2. **Idempotent** — safe to re-run on an initialized project; re-running MUST NOT duplicate entries or corrupt existing content
3. **Confirmation gate** — MUST request_user_input showing all files to be created before writing; NEVER write without user confirmation
4. **Output boundary** — ALL file writes MUST target .workflow/specs/ (spec files) and .workflow/knowhow/ (recipe knowhow) only. NEVER modify source code, .workflow/state.json, or files outside these paths
5. **Core files mandatory** — coding-conventions.md, architecture-constraints.md, and learnings.md MUST always be created (unless they already exist)
6. **Signal-driven optionals** — optional spec files (quality-rules.md, test-conventions.md, ui-conventions.md) MUST only be created when corresponding framework/tool signals are detected in the codebase; NEVER create optional files without evidence
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-setup.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Precondition → Scan**
- REQUIRED: .workflow/ directory exists.
- REQUIRED: Project contains source files to scan.
- BLOCKED if: E001 (.workflow/ not initialized), E002 (no source files).

**GATE 2: Scan → Plan**
- REQUIRED: Codebase scan completed — framework, language, and tooling signals collected.
- REQUIRED: Core spec file list determined (always 3: coding-conventions, architecture-constraints, learnings).
- REQUIRED: Optional spec files determined by detected signals only.

**GATE 3: Plan → Write**
- REQUIRED: User confirmed the full list of files to create via request_user_input (showing core specs, optional specs, recipe knowhow, and detected signals).
- BLOCKED if: user declines — abort without writing.

**GATE 4: Write → Report**
- REQUIRED: All confirmed files written to .workflow/specs/ and .workflow/knowhow/.
- REQUIRED: Existing files skipped (not overwritten).
- REQUIRED: .proposed.md files created when slug collision detected (W003).

**Confirmation gate**: After scanning codebase and determining which files/directories will be created (core specs, optional specs, recipe knowhow), request_user_input showing the full list of files to create with their categories and detected signals. Proceed only on user confirm.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` directory not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | No source files found in project -- nothing to scan | scan_codebase |
| W001 | warning | Convention detection uncertain for one or more categories -- marked `[UNCERTAIN]` | generate_specs |
| W002 | warning | Workflow recipe signals detected but commands ambiguous -- recipe skipped | generate_recipes |
| W003 | warning | Existing recipe slug found -- new content written as `.proposed.md` for manual diff | generate_recipes |
</error_codes>

<success_criteria>
- [ ] `.workflow/specs/` directory created
- [ ] Core spec files always created: `coding-conventions.md`, `architecture-constraints.md`, `learnings.md`
- [ ] Optional spec files created when detected: `quality-rules.md` (linter/CI), `test-conventions.md` (test framework), `ui-conventions.md` (frontend framework). `debug-notes.md` / `review-standards.md` deferred (on demand via `/maestro-spec add`).
- [ ] Workflow recipe knowhow created in `.workflow/knowhow/` for each detected operational workflow (test / debug / build / dev / lint). Each recipe matches the `recipe` schema in `~/.maestro/workflows/knowhow.md` Part B and contains at least one runnable command.
- [ ] Report displayed grouped by destination (specs / recipes / skipped / deferred), with `.proposed.md` files surfaced when an existing recipe slug was preserved.
</success_criteria>
</content>
