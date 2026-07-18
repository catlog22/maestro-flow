---
name: manage
description: Project management hub — status, issues, knowledge stores, and
  drift/rebuild sync. knowledge 子命令覆盖 capture（knowhow 沉淀）/ audit（知识审计）/ harvest
  / wiki / domain；约束类规则走 /spec add。Triggers on "项目状态", "issue 管理", "知识沉淀",
  "knowhow capture", "knowledge audit", "知识审计", "drift 同步".
argument-hint: <subcommand> [args...] where subcommand = status|issue|knowledge|sync
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - WebFetch
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: none
version: 0.5.51
---

<purpose>
Unified project management hub. Routes to four subcommand groups:
- **status** — project dashboard (progress, tasks, active work, next steps)
- **issue** — issue lifecycle (create/list/status/update/close/link) + automated discovery
- **knowledge** — knowledge stores: capture, audit, harvest, wiki, knowhow, kg-extractors, domain
- **sync** — artifact drift detection/realignment + full codebase doc rebuild
</purpose>

<dispatch>
Parse the first token of $ARGUMENTS as the top-level subcommand. Parse the second token (where applicable) as the group action. Route to the matching section below.

| First token | Second token | Section |
|-------------|-------------|---------|
| `status` | — | [status](#status) |
| `issue` | `create` \| `list` \| `status` \| `update` \| `close` \| `link` | [issue → CRUD](#issue-crud) |
| `issue` | `discover` | [issue → discover](#issue-discover) |
| `knowledge` | `capture` | [knowledge → capture](#knowledge-capture) |
| `knowledge` | `knowhow` | [knowledge → knowhow](#knowledge-knowhow) |
| `knowledge` | `audit` | [knowledge → audit](#knowledge-audit) |
| `knowledge` | `harvest` | [knowledge → harvest](#knowledge-harvest) |
| `knowledge` | `wiki` | [knowledge → wiki](#knowledge-wiki) |
| `knowledge` | `extractors` | [knowledge → extractors](#knowledge-extractors) |
| `knowledge` | `domain` | [knowledge → domain](#knowledge-domain) |
| `sync` | `codebase` | [sync → codebase](#sync-codebase) |
| `sync` | `drift` | [sync → drift](#sync-drift) |
| `sync` | `rebuild` | [sync → rebuild](#sync-rebuild) |

**Routing rules:**
- No subcommand → default to `status`.
- Unrecognized top-level token → E_INVALID_SUBCOMMAND: display the table above.
- For `issue`/`knowledge`/`sync`: remaining tokens after the group action are that action's own arguments (subcommand + flags), parsed per the target section.
- Each section is self-contained: read its `<deferred_reading>` only when that section is dispatched.
</dispatch>

---

## status

<a id="status"></a>

<purpose>
Project dashboard: artifact progress, task counts, active work, next-step suggestions.
</purpose>

<context>
No arguments required.

**State files read:**
- `.workflow/state.json` -- project-level state machine + artifact registry
- `.workflow/roadmap.md` -- milestone and phase structure
- `{run_dir}/outputs/plan.json` -- plan metadata (via artifact registry paths)
- `{run_dir}/outputs/.task/TASK-*.json` -- individual task statuses

**Output boundary**: Read-only command. MUST NOT write any files. All output is displayed to the user via text.
</context>

<invariants>
1. **Read-only** — MUST NOT write or modify any files; this is a pure display command
2. **Graceful degradation** — missing roadmap.md, plan.json, or task files MUST NOT cause failure; display available data and note missing sections
3. **State accuracy** — progress percentages MUST be calculated from actual task statuses, NEVER estimated or inferred
4. **Wiki health optional** — wiki health score display MUST degrade gracefully if wiki is unavailable
5. **Complete dashboard** — MUST include: milestone progress, phase status, task counts, active work, and next-step suggestions
</invariants>

<execution>
Follow '~/.maestro/workflows/status.md' completely.

Next-step decision table defined in workflow status.md Step 5.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Load → Render** (State loading → Dashboard display)
- REQUIRED: `.workflow/` exists and `state.json` is readable (E001/E002 if not).
- REQUIRED: Project state loaded with milestone and artifact registry.
- BLOCKED if state.json missing or corrupt (E002).

**GATE 2: Render → Route** (Dashboard → Next-step suggestions)
- REQUIRED: Per-phase progress calculated from actual task statuses.
- REQUIRED: Dashboard rendered with progress bars and status table.
- BLOCKED if state parsing fails entirely.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` not initialized -- run `/maestro-init` first | parse_input |
| E002 | fatal | `state.json` missing or corrupt -- project state unrecoverable | parse_input |
</error_codes>

<success_criteria>
- [ ] Project state loaded from `state.json`
- [ ] Roadmap parsed with milestone/phase structure
- [ ] Per-phase progress calculated (task counts, completion %)
- [ ] Dashboard rendered with progress bars and status table
- [ ] Active work section shows current phase details
- [ ] Next steps suggested based on current state analysis
- [ ] Wiki health score displayed (or graceful unavailable message)
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Phase needs analysis | step `analyze` (`maestro run prepare --platform codex analyze` + `maestro run create analyze --session YYYYMMDD-analyze-{topic} --intent "{goal}" -- {phase}`) |
| Phase needs planning | step `plan` (`maestro run prepare --platform codex plan` + `maestro run create plan --session YYYYMMDD-plan-{topic} --intent "{goal}" -- {phase}`) |
| Phase needs execution | step `execute` (`maestro run prepare --platform codex execute` + `maestro run create execute --session YYYYMMDD-execute-{topic} --intent "{goal}" -- {phase}`) |
| Session ready to seal | maestro-session-seal (not a step) |
| Issues need triage | `/manage issue list` |
</completion>

---

## issue

Issue lifecycle management. Second token selects the mode:
- `create|list|status|update|close|link` → [CRUD](#issue-crud)
- `discover` → [automated discovery](#issue-discover)

<a id="issue-crud"></a>
### issue → CRUD

<purpose>
Issue lifecycle management: create, list, status, update, close, link. Stored in `.workflow/issues/issues.jsonl`. For automated discovery, use `/manage issue discover`.
</purpose>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) — read when creating or updating issue records (create, update, close)
</deferred_reading>

<context>
Remaining tokens after `issue` -- action subcommand + options. Parse first remaining token as the action.

**Valid actions:**
- `create` -- create a new issue (--title, --severity, --source, --phase, --description)
- `list` -- list issues with optional filters (--status, --phase, --severity, --source)
- `status` -- show full detail for a specific issue (ISS-XXXXXXXX-NNN)
- `update` -- update issue fields (ISS-XXXXXXXX-NNN --status, --priority, --severity, --tags, ...)
- `close` -- close an issue with resolution (ISS-XXXXXXXX-NNN --resolution)
- `link` -- link issue to a task (ISS-XXXXXXXX-NNN --task TASK-NNN)

**State files:**
- `.workflow/issues/issues.jsonl` -- active issues (one JSON per line)
- `.workflow/issues/issue-history.jsonl` -- archived/closed issues

**Output boundary**: ALL file writes MUST target `.workflow/issues/issues.jsonl`, `.workflow/issues/issue-history.jsonl`, or `.workflow/issues/` directory only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Schema compliance** — every issue record MUST conform to the canonical issue.json template schema
2. **ID uniqueness** — issue IDs (ISS-XXXXXXXX-NNN) MUST be unique across issues.jsonl and issue-history.jsonl
3. **Close moves to history** — `close` action MUST move the record from issues.jsonl to issue-history.jsonl, NEVER delete without archiving
4. **Bidirectional links** — `link` action MUST create references in both the issue and the linked task
5. **Confirmation on destructive ops** — `close` and bulk `update` MUST require user confirmation unless `-y` flag is set
6. **Append-only audit** — NEVER overwrite existing issue records; updates MUST preserve all prior fields and add `updated_at` timestamp
</invariants>

<execution>
Parse action from first remaining token after `issue`.
Follow '~/.maestro/workflows/issue.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Execute** (Action routing)
- REQUIRED: Action parsed and validated against valid set (create/list/status/update/close/link).
- REQUIRED: `.workflow/issues/` directory exists (auto-create with empty issues.jsonl if missing).
- BLOCKED if E_NO_SUBCOMMAND or E_INVALID_SUBCOMMAND.

**GATE 2: Execute → Write** (For mutating actions: create/update/close/link)
- REQUIRED: Issue data validated against issue.json template schema.
- REQUIRED: For `close`: resolution text provided.
- REQUIRED: For `link`: target task ID resolved and exists.
- BLOCKED if schema validation fails or target references unresolvable.
</execution>

<completion>
### Next-step routing

| Action | Suggestion |
|-----------|-----------|
| create | `maestro run create analyze --session YYYYMMDD-analyze-{topic} --intent "{goal}" -- --gaps <ISS-ID>` or `maestro run create plan --session YYYYMMDD-plan-{topic} --intent "{goal}" -- --gaps` |
| list | `maestro run create analyze --session YYYYMMDD-analyze-{topic} --intent "{goal}" -- --gaps <ISS-ID>` for open issues |
| close | `/manage status` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_SUBCOMMAND | error | No action provided after `issue` | Display valid actions, prompt user to select |
| E_INVALID_SUBCOMMAND | error | Unrecognized action | Display valid actions with usage hints |
| E_ISSUES_DIR_MISSING | warning | `.workflow/issues/` directory does not exist | Auto-create directory and empty issues.jsonl |
</error_codes>

<success_criteria>
- [ ] Action parsed and routed to correct handler
- [ ] Issue data read/written to correct JSONL file
- [ ] Output displayed in appropriate format (table for list, detail for status)
- [ ] Cross-references maintained (link creates bidirectional references)
- [ ] Next step routed by action
</success_criteria>

<a id="issue-discover"></a>
### issue → discover

<purpose>
Automated issue discovery: multi-perspective (8 perspectives) or prompt-driven. Deduplicates and records to `issues.jsonl`. For CRUD operations, use `/manage issue <create|list|...>`.
</purpose>

<deferred_reading>
- [issue.json template](~/.maestro/templates/issue.json) — read when creating issue records from findings (Step 6/11)
- [search-tools](~/.maestro/templates/search-tools.md) — search tool priority, passed to agents via workflow
</deferred_reading>

<context>
Remaining tokens after `issue discover` -- optional. Parse first remaining token to determine mode.

**Modes:**
- _(empty)_ -- interactive mode selection (request_user_input)
- `multi-perspective` -- 8-perspective parallel agent scan
- `by-prompt "..."` -- prompt-driven iterative agent exploration (CLI-planned)

**Flags:**
- `-y` / `--yes` -- auto mode, skip confirmations
- `--scope=<pattern>` -- file scope (default: `**/*`)
- `--depth=standard|deep` -- exploration depth (by-prompt only, default: `standard`)

**State files:**
- `.workflow/issues/issues.jsonl` -- issues appended here (set `source: "discover"` on each row so concurrent writers like harvest with `source: "harvest"` can be distinguished and deduplicated)
- `.workflow/issues/discoveries/{SESSION_ID}/` -- session artifacts

### Pre-load specs
1. **Debug specs**: Run `maestro load --type spec --category debug` to load known antipatterns, root causes, and gotchas. Informs discovery perspectives with prior findings.
2. Optional — proceed without if unavailable.

**Output boundary**: ALL file writes MUST target `.workflow/issues/issues.jsonl` or `.workflow/issues/discoveries/{SESSION_ID}/` only. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — discovery agents MUST NOT modify source code; only `.workflow/issues/` is writable
2. **Source tagging** — MUST set `source: "discover"` on every issues.jsonl row so concurrent writers (e.g. harvest) can be distinguished and deduplicated
3. **Dedup before write** — MUST check existing issues.jsonl for duplicates before appending new findings
4. **Session traceability** — every discovery run MUST produce a session directory under `.workflow/issues/discoveries/` with full agent outputs
5. **Schema compliance** — every issue row MUST conform to the canonical issue.json template schema
6. **Idempotent re-run** — repeated execution with same scope and prompt MUST NOT create duplicate issues
</invariants>

<execution>
Determine mode from remaining tokens:
- No arguments or empty → interactive selection via request_user_input
- First token is `multi-perspective` → multi-perspective mode
- First token is `by-prompt` → prompt-driven mode, remaining tokens are the user prompt

Follow '~/.maestro/workflows/issue-discover.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Mode Selection → Analysis** (Steps 1-2 → Steps 3-8)
- REQUIRED: Mode correctly determined from arguments (multi-perspective or by-prompt).
- REQUIRED: `.workflow/issues/` directory exists (auto-create if missing).
- BLOCKED if E_NO_PROJECT (`.workflow/` missing) or E_EMPTY_PROMPT (by-prompt without text).

**GATE 2: Analysis → Issue Creation** (Steps 8-9 → Steps 10-11)
- REQUIRED: All perspectives analyzed (multi-perspective) or dimensions explored (by-prompt).
- REQUIRED: Findings deduplicated against existing issues.jsonl.
- BLOCKED if E_DISCOVERY_FAILED (all agents returned no results).

**GATE 3: Issue Creation → Completion** (Steps 11-12)
- REQUIRED: Issues appended to issues.jsonl with correct schema and `source: "discover"`.
- REQUIRED: Discovery session directory created with full agent outputs.
- BLOCKED if schema validation fails on any issue record.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E_NO_PROJECT | error | `.workflow/` does not exist | Prompt user to run `/maestro-init` first |
| E_DISCOVERY_FAILED | error | CLI analysis returned no results | Retry with different tool or report partial findings |
| E_EMPTY_PROMPT | warning | `by-prompt` used without prompt text | Interactive prompt with suggested options |
</error_codes>

<success_criteria>
- [ ] Discovery mode correctly determined from arguments
- [ ] All perspectives analyzed (multi-perspective) or dimensions explored (by-prompt)
- [ ] Findings deduplicated before issue creation
- [ ] Issues appended to issues.jsonl with correct schema
- [ ] Discovery session fully traceable via session directory
- [ ] Next step routed
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Issues discovered | `/manage issue list` to review |
| Need root cause analysis | `maestro run create analyze --session YYYYMMDD-analyze-{topic} --intent "{goal}" -- --gaps <ISS-ID>` |
| Want to plan fixes | `maestro run create plan --session YYYYMMDD-plan-{topic} --intent "{goal}" -- --gaps` |
</completion>

---

## knowledge

Knowledge store management. Second token selects the operation:
- `capture` → [capture reusable knowledge](#knowledge-capture)
- `knowhow` → [manage knowhow entries](#knowledge-knowhow)
- `audit` → [audit/prune knowledge stores](#knowledge-audit)
- `harvest` → [extract knowledge from artifacts](#knowledge-harvest)
- `wiki` → [wiki graph management](#knowledge-wiki)
- `extractors` → [KG extractor generation](#knowledge-extractors)
- `domain` → [register domain term](#knowledge-domain)

<a id="knowledge-capture"></a>
### knowledge → capture

<purpose>
Capture reusable knowledge into `.workflow/knowhow/` with type-specific structured fields.
Auto-indexed by WikiIndexer (type=knowhow), searchable via `maestro search --type knowhow`.
</purpose>

<context>
Remaining tokens after `knowledge capture` — type token + description + optional flags.

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
| No args | — | — | request_user_input (10 options) |

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
- REQUIRED: Type detected from first token or selected via request_user_input.
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
| compact | Extract from conversation: session ID, objective, execution plan (verbatim), working files (3-8), decisions, constraints, pending. Plan priority: workflow IMPL_PLAN.md > update_plan > user-stated > inferred. |
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
| Entry captured | `/manage knowledge knowhow list` to view library |
| Want to connect entries | `/manage knowledge wiki connect` |
| Want to bridge to specs | `/spec add <category>` with `--spec-category` |
</completion>

<a id="knowledge-knowhow"></a>
### knowledge → knowhow

<purpose>
Manage knowhow across two stores: workflow (`.workflow/knowhow/`) and system memory (`~/.claude/projects/*/memory/`). Operations: list, search, view, edit, delete, prune.
</purpose>

<context>
Remaining tokens after `knowledge knowhow` — action + args.

Dual store architecture (paths, formats, index) defined in workflow knowhow.md.

**Output boundary**: Workflow store writes MUST target `.workflow/knowhow/` only. System store writes MUST target `~/.claude/projects/*/memory/` only. NEVER modify source code or files outside these paths.

**Actions:**
- `list` — List entries from both stores (default if no arguments)
- `search <query>` — Full-text search across both stores
- `view <id|file>` — Display a workflow entry by ID or system file by name
- `edit <file>` — Edit a system memory file (MEMORY.md or topic file)
- `delete <id|file>` — Remove an entry/file (with confirmation)
- `prune` — Bulk cleanup by criteria

**Flags:**
- `--store <workflow|system|all>` — Target store (default: `all` for list/search, inferred for other ops)
- `--tag <tag>` — Filter by tag (workflow store)
- `--type <compact|tip>` — Filter by entry type (workflow store)
- `--before <YYYY-MM-DD>` — Entries before date
- `--after <YYYY-MM-DD>` — Entries after date
- `--dry-run` — Preview destructive ops without executing
- `--confirm` — Skip confirmation prompt
</context>

<execution>
Follow '~/.maestro/workflows/knowhow.md' Part A (KnowHow Management) completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Execute** (Action routing)
- REQUIRED: Action parsed from first token (list/search/view/edit/delete/prune).
- REQUIRED: Both store paths resolved (workflow + system).
- BLOCKED if E001 (no memory stores found) or invalid action.

**GATE 2: Execute → Mutate** (For destructive actions: delete/prune/edit)
- REQUIRED: Target entry/file resolved and exists (E002 if not found).
- REQUIRED: MEMORY.md protected from deletion (E004 — use `edit` instead).
- REQUIRED: For `prune`: at least one filter provided (E003).
- REQUIRED: User confirmation before delete/prune unless `--confirm` flag set.
- BLOCKED if target unresolvable or confirmation denied.
</execution>

<invariants>
1. **MEMORY.md protected** — NEVER delete MEMORY.md; only editable via `edit` action
2. **MEMORY.md line limit** — MUST warn (W003) when MEMORY.md exceeds 200 lines; content beyond 200 lines will be truncated at load
3. **Confirmation on destructive ops** — `delete` and `prune` MUST require user confirmation unless `--confirm` flag is set
4. **Store isolation** — `prune` operates on workflow store only; NEVER prune system memory files
5. **Reference integrity** — `delete` MUST check for references from other entries before removing; warn if orphaned references would result
6. **Dry-run safety** — `--dry-run` MUST NOT write any files; preview destructive operations only
7. **Index consistency** — after delete/prune, workflow index MUST be updated to reflect removals
</invariants>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | No memory stores found — for workflow store run `/manage knowledge capture`; for system store create `~/.claude/projects/{project}/memory/MEMORY.md` manually | resolve_paths |
| E002 | error | Entry ID or filename not found | execute_view, execute_delete |
| E003 | error | Prune requires at least one filter (--tag, --type, --before, --after) | execute_prune |
| E004 | error | Cannot delete MEMORY.md — use `edit` action instead | execute_delete |
| W001 | warning | Workflow index has orphaned files or dangling references | integrity_check |
| W002 | warning | MEMORY.md references non-existent topic file | integrity_check |
| W003 | warning | MEMORY.md exceeds 200 lines — content will be truncated at load | execute_edit |
</error_codes>

<success_criteria>
- [ ] Both store paths correctly resolved
- [ ] Action correctly detected from arguments
- [ ] Store auto-detected from argument format (KNW-*/TIP-* vs filename)
- [ ] List: both stores displayed with appropriate formatting
- [ ] Search: results from both stores, ranked by relevance
- [ ] View: correct store selected, full content displayed
- [ ] Edit: system memory files editable, MEMORY.md kept under 200 lines
- [ ] Delete: MEMORY.md protected, confirmation required, references checked
- [ ] Prune: workflow-only, filters validated, index updated
- [ ] Integrity check catches orphans and broken links
- [ ] Next step routed
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Want to capture new knowhow | `/manage knowledge capture` |
| View project state | `/manage status` |
| Prune stale entries | `/manage knowledge audit --scope knowhow` |
</completion>

<a id="knowledge-audit"></a>
### knowledge → audit

<purpose>
审查 spec/knowhow/artifact 存储，识别矛盾/失效/孤儿，通过 keep/deprecate/delete 三态清理。对称于 harvest（写入入口）。
</purpose>

<deferred_reading>
- @~/.maestro/workflows/harvest.md (audit 检测的 artifact 是 harvest 的产物源)
- @~/.maestro/workflows/specs-add.md (deprecate 操作所需的 `<spec-entry>` 变形)
</deferred_reading>

<context>
Remaining tokens after `knowledge audit` — flags.

**Scope（必选）：** `--scope <spec|knowhow|artifact|all>`

**删除策略**默认 `--interactive`（三态面板逐项决策）；非交互模式 `--mark`（仅打标）/ `--delete`（软删到 `.trash/`）/ `--purge`（物理擦除，仅 artifact 且需双重确认）。

**互斥规则：** `--interactive`、`--mark`、`--delete`、`--purge` 四选一，同时传入多个 → E006。

Flag 全集、scope 对应的扫描路径、Stage 步骤、检测算法定义在 workflow knowledge-audit.md。

**Output boundary**: ALL file writes MUST target `.workflow/specs/`, `.workflow/knowhow/`, `.workflow/.trash/knowledge-audit-{timestamp}/`, `.workflow/issues/`, or audit report files (`audit-report-*.md`, `audit-log.jsonl`). NEVER modify source code files.
</context>

<invariants>
1. **Code-as-Truth** — 代码是唯一真理源；spec/knowhow 声明 MUST 与代码实际行为一致；每个 finding 的 evidence MUST 包含代码引用（文件:行号）
2. **Backup before mutate** — MUST create backup tarball in `.workflow/.trash/` before any file modification (E005 if backup fails)
3. **Deprecate over delete** — 文本存储首选 `status="deprecated"` 保留历史；NEVER 物理删除 spec/knowhow 文件
4. **Purge 仅 artifact** — `--purge` MUST NOT 作用于 spec/knowhow scope (E004)
5. **Rescue before delete** — 未 harvest 的 artifact 删除前 MUST 强制提示先跑 `/manage knowledge harvest` (W002)
6. **Conflict marker sync** — deprecate/delete 执行时如果目标条目有 conflict-marker，MUST 同步调用 `maestro spec conflict clear` 清除标记
7. **Mutual exclusion** — `--interactive`/`--mark`/`--delete`/`--purge` 四选一；同时传入多个 MUST trigger E006
8. **Dry-run safety** — `--dry-run` MUST NOT write any files; `--purge` 与 `--dry-run` 互斥 (E003)
</invariants>

<execution>
Follow `~/.maestro/workflows/knowledge-audit.md` Stages 1-8 in order.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Load → Detect** (Stages 1-2 → Stage 4)
- REQUIRED: Scope 解析通过，互斥标志校验完成。
- REQUIRED: 三存储按 scope 加载完成。
- REQUIRED: 加载已有冲突标记: `maestro spec conflict list` → 合并到 finding 池。
- BLOCKED if scope 非法或存储不可读: E001/E002。

**GATE 2: Detect → Decision** (Stage 4 → Stage 5)
- REQUIRED: Finding 池按 P0/P1/P2 分级输出。
- REQUIRED: 已标记 `contested` 的条目自动归入 P0 finding（来源: conflict-marker）。
- REQUIRED: 未 harvest 的 artifact 删除前触发抢救确认（W002）。
- BLOCKED if finding 为空: 无需淘汰，直接输出报告。

**GATE 3: Decision → Mutate** (Stage 5 → Stage 6-7)
- REQUIRED: Backup tarball 生成于 `.workflow/.trash/knowledge-audit-{timestamp}/`。
- REQUIRED: 备份成功后方可执行变更。
- REQUIRED: `--purge` 需双重确认（仅 artifact scope）。
- BLOCKED if 备份失败: E005，禁止执行变更。

### Execution Constraints

- **Deprecate over delete**: 文本存储首选 `status="deprecated"`，保留历史。
- **Purge 仅 artifact**: `--purge` 不作用于 spec/knowhow。
- **Rescue before delete**: 未抽取 artifact 删除前强制提示先 `/manage knowledge harvest`。

### Conflict Resolution Integration

五态决策（扩展自三态 keep/deprecate/delete）：

| 动作 | 适用场景 | 执行 |
|------|---------|------|
| `keep` | 内容正确，无需变更 | 写 audit-log ignore 记录 |
| `contest` | 矛盾真实存在，需进一步审查 | `maestro spec conflict mark <file> <line> --note "<evidence>"` |
| `supersede` | 内容过时，已有更新版本替代 | `maestro spec supersede <old-sid> --by <new-sid>`（保留演化链） |
| `deprecate` | 内容过时，无替代版本 | 注入 `status="deprecated"` + `maestro spec conflict clear <file> <line>` |
| `delete` | 内容明确错误 | 移除 entry + `maestro spec conflict clear <file> <line>` |

**supersede vs deprecate**: supersede 用于有明确替代条目的场景（建立演化链），deprecate 用于无替代条目的场景。
**关键**: deprecate/delete 执行时，如果目标条目有 conflict-marker，必须同步调用 `maestro spec conflict clear` 清除标记，避免悬空冲突。

### Code-as-Truth 校验（审查核心原则）

**代码是唯一真理源。** Spec/knowhow 中的任何声明，必须与代码实际行为一致。

当 detector 发现 spec 条目声称某行为/规则时：
1. **代码校验**: grep/read 代码中相关实现，确认 spec 声明是否与代码一致
2. **不一致处理**:
   - 代码正确、spec 过时 → `deprecate` 或 `delete` spec 条目
   - 代码正确、spec 不完整 → `contest` 并建议补充
   - 代码有 bug、spec 正确 → `keep` spec，生成 issue 修代码
3. **禁止**: 仅凭 spec 文本判断正确性。每个 finding 的 evidence 必须包含代码引用（文件:行号）
</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| 复审淘汰记录 | 查看 `audit-report-{date}.md` |
| 抢救未抽取 artifact | `/manage knowledge harvest <artifact-id>` |
| 验证 spec 现状 | `maestro load --type spec` |
| 查看冲突标记 | `maestro spec conflict list` |
| 清除已解决冲突 | `maestro spec conflict clear-all <file>` |
| 查看演化链 | `maestro spec history <sid>` |
| 知识健康检查 | `maestro spec health` |
| 回填存量 sid | `maestro spec backfill-sid` |
| 周期巡检 | `--scope all --report` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` 未初始化 | 先跑 `/maestro-init` |
| E002 | error | `--scope` 缺失或非法 | 提供 spec/knowhow/artifact/all |
| E003 | error | `--purge` 与 `--dry-run` 同用 | 二选一 |
| E004 | error | `--purge` 作用于非 artifact 范围 | purge 仅支持 artifact scope |
| E005 | error | 备份失败（`.trash/` 写入异常） | 检查磁盘空间与权限，重试 |
| E006 | error | `--interactive`/`--mark`/`--delete`/`--purge` 同时传入多个 | 四选一，默认 `--interactive` |
| W001 | warning | 检出冲突但用户选择 keep | 记入 report，不阻断 |
| W002 | warning | 待删 artifact 无 harvest-log 记录 | 提示先跑 harvest |
| W003 | warning | 循环 supersedes 链 | 自动断环或交互选保留节点 |
| W004 | warning | 检测耗时 >120s（大规模 spec 库） | 建议加 `--scope` 收敛或 `--since` 增量 |
| W005 | warning | LLM detector 不可用 | 降级到正则+图算法子集，跳过 B/G 类语义场景 |
</error_codes>

<success_criteria>
- [ ] Scope 正确解析，互斥标志校验通过
- [ ] 三存储按 scope 加载完成，构建出统一 finding 池
- [ ] Stage 3 时间线索引建立（mtime ↔ session/milestone 状态）
- [ ] Stage 4 按 P0/P1/P2 输出 finding 列表
- [ ] 如非 `--report`：用户对每项做出三态决策
- [ ] 未 harvest 的 artifact 删除前触发抢救确认
- [ ] Stage 6 backup tarball 生成于 `.workflow/.trash/`
- [ ] `deprecate` 通过元数据注入完成（spec/knowhow 文件未被物理删除）
- [ ] `delete` 移动至 `.trash/`，索引同步更新
- [ ] `purge` 仅在双重确认通过后执行
- [ ] `audit-report-{date}.md` + `audit-log.jsonl` 写入完成
- [ ] 摘要展示三存储变更计数与下一步路由
</success_criteria>

<a id="knowledge-harvest"></a>
### knowledge → harvest

<purpose>
Extract knowledge from workflow artifacts → route to wiki/spec/issue stores. Works on any artifact (vs retrospective which is phase-scoped).
</purpose>

<deferred_reading>
- @~/.maestro/workflows/issue.md (issues.jsonl schema for issue routing — read when creating issues in Stage 6c)
- @~/.maestro/workflows/specs-add.md (spec entry format — read when routing to spec in Stage 6b)
</deferred_reading>

<context>
Remaining tokens after `knowledge harvest`.

**Modes (auto-detected):**
- No arguments → `scan` mode: discover all harvestable artifacts, interactive selection
- `<session-id>` (e.g., `ANL-auth-20260410`, `WFS-xxx`) → `session` mode: harvest specific session
- `<path>` (e.g., `.workflow/.analysis/ANL-auth-20260410/`) → `path` mode: harvest from explicit directory

**Flags:**
- `-y` / `--yes` — Skip confirmation prompts for all write operations (artifact selection, routing decisions, store writes). Useful for CI or batch harvesting.

Additional flags, source registry (scan paths), and storage locations defined in workflow harvest.md.

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/`, `.workflow/specs/`, `.workflow/issues/`, `.workflow/wiki/`, `.workflow/harvest/`, or `.workflow/state.json` only. NEVER modify source code, source artifacts, or files outside these paths.
</context>

<invariants>
1. **Read-only until routing** — extraction and classification happen in-memory; no files written until Stage 6
2. **Never modify source artifacts** — harvest is purely extractive; source files remain untouched
3. **Dedup before write** — MUST check harvest-log.jsonl and existing stores before each write to prevent duplicates
4. **Source tagging** — MUST set `source: "harvest"` on every issues.jsonl row so concurrent writers can be distinguished
5. **Relationship pre-check on spec routing** — when routing to spec, MUST compare against existing specs with same keywords/category. Classify the relationship: **supersede** (new replaces old) → attach `supersedes = <old-sid>`, after add run `maestro spec supersede`; **conflict** (genuine dispute) → set `confidence="low"` and log conflict note; **independent** → no metadata
6. **Provenance tracking** — every routed item MUST be logged in harvest-log.jsonl with fragment ID, target store, and timestamp
7. **Dry-run safety** — `--dry-run` MUST NOT write any files; preview only
</invariants>

<execution>
Follow '~/.maestro/workflows/harvest.md' Stages 1-8 in order.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Discovery → Extraction** (Stages 1-3 → Stage 4)
- REQUIRED: Source artifacts discovered and mode resolved (scan/session/path).
- REQUIRED: User selected artifact(s) to harvest (or auto-selected via session/path mode, or `-y`).
- BLOCKED if no harvestable artifacts found (W001) or invalid source (E004/E005).

**GATE 2: Extraction → Routing** (Stage 4 → Stage 5-6)
- REQUIRED: All files in selected artifacts loaded and parsed.
- REQUIRED: Knowledge fragments extracted with category, confidence, and tags.
- REQUIRED: Fragments filtered by `--min-confidence`.
- BLOCKED if extraction produces zero fragments.

**GATE 3: Routing → Write** (Stage 6 → Stage 7-8)
- REQUIRED: Routing classification applied (auto or forced by `--to`).
- REQUIRED: Dedup check passed against harvest-log.jsonl and existing stores.
- REQUIRED: If `--dry-run`: preview displayed, no files written — GATE blocks further writes.
- BLOCKED if dedup check fails or store paths unresolvable.

Extraction patterns, classification rules, routing infrastructure, and fragment ID scheme defined in workflow harvest.md.

</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Wiki entries created | `maestro wiki list --type note` |
| Wiki graph needs linking | `/manage knowledge wiki connect --fix` |
| Issues created | `/manage issue list --source harvest` |
| Specs extracted | `maestro load --type spec` |
| Specs extracted (审查) | `/manage knowledge audit --scope spec` — 新写入的 spec 可能与现有条目矛盾或替代 |
| 查看演化链 | `maestro spec history <sid>` — 确认 supersede 链完整 |
| Spec 冲突标记已存在 | `maestro spec conflict list` — 查看当前冲突状态 |
| 知识健康检查 | `maestro spec health` — 悬空/循环 supersedes 校验 |
| Full phase retrospective | `maestro run prepare --platform codex retrospective` + `maestro run create retrospective --session YYYYMMDD-retrospective-{topic} --intent "{goal}"` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` not initialized | Run `/maestro-init` first |
| E002 | error | Invalid `--to` target (must be: wiki, spec, issue, auto) | Display valid options |
| E003 | error | Invalid `--source` type | Display valid source types from registry |
| E004 | error | Session ID not found in any source path | Show available sessions with `--source all` |
| E005 | error | Path does not exist or contains no parseable artifacts | Verify path and file structure |
| W001 | warning | No harvestable artifacts found within `--recent` window | Widen time window or check `.workflow/` contents |
| W002 | warning | `maestro wiki create` failed — wiki entries saved to `.workflow/harvest/wiki-pending-*.md` | Apply pending entries manually or retry |
| W003 | warning | Some fragments below confidence threshold — logged but not routed | Lower `--min-confidence` to include |
| W004 | warning | Duplicate fragments skipped | Review harvest-log.jsonl for prior routing |
| W005 | warning | `.workflow/issues/` directory missing | Auto-create directory and empty issues.jsonl |
</error_codes>

<success_criteria>
- [ ] Mode correctly resolved (scan / session / path)
- [ ] Source artifacts discovered and listed with metadata
- [ ] User selected artifact(s) to harvest (or auto-selected via session/path mode)
- [ ] All files in selected artifacts loaded and parsed
- [ ] Knowledge fragments extracted with category, confidence, tags
- [ ] Fragments filtered by `--min-confidence`
- [ ] Routing classification applied (auto or forced by `--to`)
- [ ] Dedup check passed against harvest-log.jsonl and existing stores
- [ ] If `--dry-run`: preview displayed, no files written
- [ ] If not dry-run: all routed items written to target stores
- [ ] Wiki entries created via `maestro wiki create` (or fallback to pending files)
- [ ] Spec entries added via `spec add` mechanism
- [ ] Issue entries appended to `issues.jsonl` with canonical schema
- [ ] `harvest-log.jsonl` updated with provenance for each routed item
- [ ] `harvest-report-{date}.md` written with full summary
- [ ] No source artifacts modified
- [ ] Summary displayed with counts and next-step routing
</success_criteria>

<a id="knowledge-wiki"></a>
### knowledge → wiki

<purpose>
Wiki graph management: health, search, cleanup, stats, connect, digest.
</purpose>

<context>
Remaining tokens after `knowledge wiki` — action and optional flags.

**Actions:**
| Action | Description |
|-----------|-------------|
| `health` | Health dashboard — score, broken links, orphans, hubs (default) |
| `search <query>` | Interactive BM25 search with follow-up actions |
| `cleanup` | Find and resolve orphans, broken links, stale entries |
| `stats` | Graph statistics — type distribution, tag frequency, growth trends |
| `connect` | Find and link hidden connections — orphan rescue, missing links, transitive gaps |
| `digest [topic]` | Generate knowledge digest with theme clustering and gap analysis |
| No args | Same as `health` |

**Flags:**
- `--type <type>` — Filter by wiki type: spec, knowhow, note, issue
- `--fix` — Auto-fix issues found during cleanup/connect (remove broken links, apply connections)
- `--dry-run` — Preview mode, no writes. **Overrides `--fix`**: when both are passed, `--dry-run` takes precedence (preview only, no fixes applied).
- `--json` — Output in JSON format
- `--min-similarity N` — (connect) Minimum similarity threshold for link candidates
- `--max N` — (connect) Maximum number of suggestions
- `--format brief|full` — (digest) Output format
- `--recent N` — (digest) Scope to N most recent entries
- `--create-issues` — (digest) Create issues for identified knowledge gaps

**Output boundary**: File writes MUST target `.workflow/wiki/`, `.workflow/knowhow/`, or `.workflow/issues/issues.jsonl` (when `--create-issues`) only. NEVER modify source code or files outside these paths. `--dry-run` overrides `--fix` — no writes when both are set.
</context>

<invariants>
1. **Dry-run precedence** — `--dry-run` MUST override `--fix` when both are passed; preview only, no writes
2. **Read-only by default** — without `--fix` or `--create-issues`, all actions MUST be read-only
3. **Confirmation on fixes** — `--fix` MUST show preview of changes before applying; auto-apply only when explicitly set
4. **Graph integrity** — `connect` MUST NOT create circular link chains; validate graph acyclicity for parent-child relationships
5. **Threshold enforcement** — `--min-similarity` MUST be respected; NEVER suggest connections below the threshold
6. **Action isolation** — each action routes to its own workflow file; NEVER cross-execute action logic
</invariants>

<execution>
**Action routing:**
- `health|search|cleanup|stats` → Follow `~/.maestro/workflows/wiki-manage.md` completely.
- `connect` → Follow `~/.maestro/workflows/wiki-connect.md` completely (Stages 1-6).
- `digest` → Follow `~/.maestro/workflows/wiki-digest.md` completely (Stages 1-8).

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Load** (Action routing → Wiki data loading)
- REQUIRED: Action parsed and validated (health/search/cleanup/stats/connect/digest).
- REQUIRED: `.workflow/` initialized (E001 if missing).
- BLOCKED if E003 (invalid action) or E001.

**GATE 2: Load → Execute** (Wiki data → Action execution)
- REQUIRED: Wiki data loaded via `maestro wiki` CLI.
- REQUIRED: At least one wiki entry exists (E002 if none).
- BLOCKED if wiki data loading fails entirely.

**GATE 3: Execute → Write** (For mutating operations: cleanup --fix, connect --fix, digest --create-issues)
- REQUIRED: Preview of changes shown to user.
- REQUIRED: `--dry-run` NOT set (overrides `--fix`).
- BLOCKED if preview generation fails or user declines.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | `.workflow/` not initialized — run `/maestro-init` first | validate |
| E002 | fatal | No wiki entries found — create content first | load |
| E003 | error | Invalid action | parse_input |
| W001 | warning | Health score below 50 — graph needs attention | health |
| W002 | warning | Orphan cleanup had partial failures | cleanup |
</error_codes>

<success_criteria>
- [ ] Action parsed (health/search/cleanup/stats/connect/digest)
- [ ] Wiki data loaded via `maestro wiki` CLI
- [ ] Results displayed in formatted output
- [ ] If cleanup/connect --fix: issues resolved and delta reported
- [ ] If digest: themes clustered, gaps identified, coverage heatmap generated
- [ ] Next-step suggestions provided
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Health score < 50 | `/manage knowledge wiki cleanup --fix` |
| Orphan entries found | `/manage knowledge wiki connect --fix` |
| Knowledge gaps identified | `/manage knowledge capture` |
| Want knowledge synthesis | `/manage knowledge wiki digest` |
</completion>

<a id="knowledge-extractors"></a>
### knowledge → extractors

<purpose>
Analyze current repository's code patterns to auto-generate `.workflow/kg/extractors.yaml` — a declarative config that teaches MaestroGraph's codegraph extractor to recognize project-specific symbols beyond standard function/class/method declarations.
</purpose>

<context>
Remaining tokens after `knowledge extractors` — optional flags.

**Flags:**
- `--scan-only` — Only report detected patterns, don't write extractors.yaml
- `--append` — Append new rules to existing extractors.yaml (default: overwrite)
- `--language <lang>` — Limit analysis to specific language (python, typescript, java, etc.)
- `--min-count <n>` — Minimum occurrences to include a pattern (default: 3). Use `--min-count 1` to include rare patterns.

**Analysis targets (per language):**

| Language | Pattern Types |
|----------|--------------|
| Python | `define_*()` builder APIs, ALL_CAPS constants, `Final[...]` annotations, dataclass/pydantic fields |
| TypeScript | const enum, namespace exports, decorator factories, config objects |
| Java | static final constants, @Bean/@Component annotations, builder patterns |
| Go | exported constants (const blocks), interface registrations |
| All | Custom factory/builder call patterns with string-literal first args |

**Output:** `.workflow/kg/extractors.yaml` — declarative rules for PluginEngine.

**Output boundary**: ALL file writes MUST target `.workflow/kg/extractors.yaml` only. NEVER modify source code or files outside this path. `--scan-only` MUST NOT write any files.

**Rule format:**
```yaml
version: 1
defaults:
  onError: warn
  conflictPolicy: merge-metadata
plugins:
  - id: <project>.<pattern>
    languages: [<lang>]
    mode: declarative
    declarative:
      rules:
        - id: <rule-id>
          match:
            type: call | assignment | regex
            pattern: "<pattern>"
            nameRegex: "<optional filter>"
            scope: module | class | any
          extract:
            kind: constant | variable | property | field
            decorators: ["<semantic_tag>"]
            metadata:
              semanticKind: "<domain_kind>"
```
</context>

<execution>

<invariants>
1. **Read-only source code** — agents MUST only read source files for pattern discovery; NEVER modify source code
2. **Scan-only safety** — `--scan-only` MUST stop after Phase 2 summary; NEVER write extractors.yaml
3. **Append preservation** — `--append` MUST preserve existing rules in extractors.yaml; default (overwrite) MUST warn (W003) if file exists
4. **Min-count threshold** — patterns with fewer occurrences than `--min-count` MUST be excluded unless explicitly overridden
5. **User confirmation** — each pattern group MUST be confirmed/edited/skipped by user before writing (Phase 3, Step 2)
6. **Schema compliance** — generated extractors.yaml MUST conform to version 1 PluginEngine schema with required fields (id, languages, mode, rules)
7. **Validation mandatory** — MUST run `maestro kg index` after writing to verify new symbols are extractable
</invariants>

### Phase 1: Discover patterns

Spawn **3 parallel agents** to scan the codebase:

| Agent | Focus | Method |
|-------|-------|--------|
| Agent 1 | **Builder/factory calls** | Grep for patterns like `define_*("`, `register_*("`, `add_*("` where first arg is a string literal |
| Agent 2 | **Constants & annotations** | Grep for ALL_CAPS assignments, Final[], static final, const enum, exported const |
| Agent 3 | **Framework patterns** | Detect framework (from package.json/setup.py/go.mod) → grep framework-specific registration patterns |

Each agent returns: `[{pattern_type, regex_evidence, file_count, sample_matches: [{file, line, code}]}]`

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Discovery → Generation** (Phase 1 → Phase 2)
- REQUIRED: At least 1 of 3 agents returned valid pattern results.
- BLOCKED if all 3 agents return empty results (E002).

**GATE 2: Generation → Write** (Phase 2 → Phase 3)
- REQUIRED: At least 1 pattern meets `--min-count` threshold.
- REQUIRED: User confirmed pattern groups via request_user_input.
- BLOCKED if `--scan-only` is set — stop after summary.

**GATE 3: Write → Validation** (Phase 3 → KG Index)
- REQUIRED: extractors.yaml written with valid schema.
- REQUIRED: `maestro kg index` executed to verify extraction.
- BLOCKED if schema validation fails on generated YAML.

### Phase 2: Generate rules

For each discovered pattern with ≥3 occurrences:
1. Determine match type (call/assignment/regex)
2. Build pattern string and optional nameRegex
3. Assign appropriate kind and semanticKind
4. Generate rule entry

### Phase 3: Validate & write

1. Show discovered patterns summary to user
2. request_user_input: confirm/edit/skip each pattern group
3. Write `.workflow/kg/extractors.yaml`
4. Run `maestro kg index` to verify new symbols are extracted

If `--scan-only`: stop after Phase 2 summary.

</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verify new symbols | `maestro search --kg "<pattern_name>"` |
| Re-index after changes | `maestro kg index` |
| View KG stats | `maestro kg stats` |
| Edit rules manually | Edit `.workflow/kg/extractors.yaml` |
| Add script plugin | Create `.workflow/kg/extractors/<name>.mjs` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run maestro-init first |
| E002 | error | All 3 Phase 1 agents failed — zero patterns discovered | Check codebase language detection; retry with `--language` |
| W001 | warning | No patterns detected for language | Try broader scan or different language |
| W002 | warning | Pattern has < 3 occurrences | Skipped by default, include with --min-count 1 |
| W003 | warning | Existing extractors.yaml will be overwritten | Use --append to preserve |
</error_codes>

<success_criteria>
- [ ] At least 1 pattern detected in the codebase
- [ ] extractors.yaml generated with valid rules
- [ ] Each rule has match.type, match.pattern, extract.kind
- [ ] Re-index succeeds with new extractors.yaml active
- [ ] New symbols searchable via `maestro search --kg`
</success_criteria>

<a id="knowledge-domain"></a>
### knowledge → domain

<purpose>
Register a domain term into `.workflow/domain/glossary.yaml`. Domain terms are automatically injected into agent context via hooks (domain-compact for all prompts, domain-expanded on keyword match).
</purpose>

<context>
Remaining tokens after `knowledge domain` -- expects `<canonical> "<definition>"`

**Examples:**
```bash
/manage knowledge domain auth-token "Short-lived credential for API authentication"
/manage knowledge domain event-bus "Central pub-sub message broker for cross-module communication"
/manage knowledge domain 会话上下文 "Runtime state container for active workflow session"
```

Domain term lifecycle: discover/manual → register → active → (optional) deprecated → removed.

**Related commands:**
- `maestro domain list` — list all registered terms
- `maestro domain discover` — scan codebase for term candidates
- `maestro domain show <canonical>` — show term details
- `maestro domain deprecate <canonical> --successor <new>` — deprecate a term
</context>

<invariants>
1. **Single-term atomic operation** — each invocation registers exactly ONE term; NEVER batch-write multiple terms in a single execution
2. **Glossary append-only** — existing terms in `glossary.yaml` SHALL NOT be modified or removed; only new entries are appended
3. **Duplicate guard** — MUST check for exact canonical name match AND near-matches before writing; NEVER create duplicate entries
4. **Confirmation mandatory** — MUST present term details (canonical, definition, aliases, tier, path) via request_user_input before any glossary write; NEVER write without user confirmation
5. **Schema compliance** — every term entry MUST include canonical name, definition, tier, and at least one alias/keyword; incomplete entries SHALL NOT be persisted
6. **Domain directory prerequisite** — `.workflow/domain/` MUST exist before writing; NEVER auto-create the directory (E002 if missing)
</invariants>

<execution>
Follow '~/.maestro/workflows/domain-add.md' completely.

**Confirmation gate**: Before writing to glossary.yaml, request_user_input showing the term canonical name, definition, extracted aliases/keywords, tier, and target file path. Proceed only on user confirm.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Canonical name and definition are both required | parse_input |
| E002 | fatal | `.workflow/domain/` not initialized — run `maestro domain init` first | validate |
| E003 | fatal | Term already registered with same canonical name | duplicate_check |
| E004 | warning | Near-match found — confirm merge or create new | duplicate_check |
</error_codes>

<success_criteria>
- [ ] Canonical name and definition parsed and validated
- [ ] No duplicate term in glossary (or user confirmed near-match)
- [ ] Aliases and keywords auto-extracted from definition
- [ ] Term written to glossary.yaml with tier and relationships
- [ ] Confirmation displayed with term details and verify command
</success_criteria>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verify term added | `maestro domain show <canonical>` |
| Add more terms | `/manage knowledge domain <canonical> "<definition>"` |
| Discover candidates | `maestro domain discover` |
| List all terms | `maestro domain list` |
</completion>

---

## sync

Artifact/code synchronization. Second token selects the operation:
- `codebase` → [incremental codebase doc sync](#sync-codebase)
- `drift` → [detect and realign artifact drift](#sync-drift)
- `rebuild` → [full codebase doc rebuild](#sync-rebuild)

<a id="sync-codebase"></a>
### sync → codebase

<purpose>
Sync codebase docs after code changes: git diff → trace impact via doc-index.json → refresh `.workflow/codebase/` docs. Incremental by default; use `--full` for complete resync.
</purpose>

<required_reading>
@~/.maestro/workflows/sync.md
</required_reading>

<context>
Remaining tokens after `sync codebase` — optional flags:
- `--full` — Complete resync of all tracked files (ignores git diff, rebuilds all docs)
- `--since <commit|HEAD~N>` — Diff since specific commit (default: last sync timestamp)
- `--dry-run` — Show what would be updated without writing changes

**Output boundary**: ALL file writes MUST target `.workflow/codebase/`, `.workflow/state.json`, or `doc-index.json` only. NEVER modify source code or files outside `.workflow/`. `--dry-run` MUST suppress all writes.
</context>

<invariants>
1. **Source code is read-only** — sync reads source files to generate documentation. NEVER modify source code, test files, or any non-documentation files.
2. **Dry-run is side-effect-free** — when `--dry-run` is set, NO file writes occur. Report only what would change.
3. **Impact trace before refresh** — NEVER regenerate a doc file without first tracing which source changes affect it via doc-index.json. Untargeted full-refresh requires explicit `--full` flag.
4. **Idempotent sync** — running sync twice with the same diff MUST produce identical results. State.json timestamp prevents redundant re-runs.
5. **Incremental by default** — without `--full`, only changed components are refreshed. NEVER silently expand to a full rebuild.
</invariants>

<execution>
Follow '~/.maestro/workflows/sync.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Diff → Impact Trace**
- REQUIRED: Git diff computed (or --full flag set for all files).
- BLOCKED if no diff and no --full: nothing to sync (W001).

**GATE 2: Impact Trace → Refresh**
- REQUIRED: Affected components traced via doc-index.json.
- BLOCKED if trace fails: cannot refresh docs without impact mapping.

**GATE 3: Refresh → Completion**
- REQUIRED: `.workflow/codebase/` docs refreshed for affected components.
- REQUIRED: If `--dry-run` is set, skip state.json write and report what would change. Otherwise, update state.json with sync timestamp.
- BLOCKED if missing: do not report completion without updated docs.
</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Docs refreshed | `/manage status` |
| Major structural changes | `/manage sync rebuild` |
| Incremental refresh | Use `--since` flag |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Suggest running `/maestro-init` first|
| W001 | warning | No changes detected since last sync | Report clean state, skip updates |
</error_codes>

<success_criteria>
- [ ] state.json updated with current sync timestamp (skipped if `--dry-run`)
- [ ] Codebase docs refreshed for all affected components
- [ ] doc-index.json reflects current file state
- [ ] Changes tracked and logged
- [ ] project.md Tech Stack section refreshed if dependency manifests changed
</success_criteria>

<a id="sync-drift"></a>
### sync → drift

<purpose>
检测代码重构/增量变更后，代码现实与 .workflow/ 文档之间的漂移。互补于 `/manage knowledge audit`（检测知识存储内部矛盾）。本命令通过 git 时间线 + session 历史检测 code↔document 漂移。
</purpose>

<deferred_reading>
- ~/.maestro/workflows/knowledge-audit.md (交叉引用已有审计发现)
- ~/.maestro/workflows/sync.md (codebase 文档严重漂移时自动触发)
- ~/.maestro/workflows/codebase-rebuild.md (sync 不足时的回退方案)
</deferred_reading>

<context>
Remaining tokens after `sync drift` — flags.

**Scope：** `--scope <roadmap|spec|codebase|state|issue|knowhow|project|all>`（默认 `all`）

**`--since`：** 分析起始点。支持日期（`YYYY-MM-DD`）、commit ref（`abc1234`）、相对引用（`HEAD~N`）。默认自动检测：优先读 `state.json` 的 `last_drift_realign` 或 `last_pruned` 时间戳，回退 90 天。

**`--depth`：** `shallow`（mtime + 引用检查）vs `deep`（LLM 语义分析）。默认 `shallow`。

**`--dry-run`：** 预览模式，不执行任何写入。

**`--report`：** 仅生成报告，不进入交互分诊。

**`--auto-archive`：** 自动归档陈旧项，跳过逐项确认。

**`--interactive`：** 逐项交互分诊（默认）。

**互斥规则：**
- `--report` 覆盖 `--interactive`
- `--auto-archive` 覆盖 `--interactive`
- `--report` 与 `--auto-archive` 互斥（同时传入 → E006）

**状态文件读取：**
- `.workflow/state.json`
- `.workflow/roadmap.md`
- `.workflow/specs/*.md`
- `.workflow/codebase/*.md`
- `.workflow/issues/issues.jsonl`
- `.workflow/knowhow/*.md`
- `.workflow/project.md`

使用 `maestro timeline` CLI 构建统一的 git+session 时间线。

**Output boundary**: ALL file writes MUST target `.workflow/` metadata files (specs, codebase docs, roadmap.md, state.json, issues.jsonl) or `.workflow/.trash/drift-realign-{timestamp}/` (backups) or `.workflow/.drift-realign/` (session details). NEVER modify source code files.
</context>

<invariants>
1. **Code-as-Truth** — 代码是唯一真理源；当文档说 X 但代码做 Y 时，文档漂移，NEVER 反向修改代码来匹配文档
2. **Backup before mutate** — MUST create backup tarball in `.workflow/.trash/` before any file modification (E005 if backup fails)
3. **Never modify source code** — drift-realign only updates `.workflow/` metadata; source code files are read-only
4. **Mutual exclusion** — `--report` 与 `--auto-archive` 互斥；同时传入 MUST trigger E006
5. **Auto-depth escalation** — `drift_window` > 180 天 MUST auto-upgrade to `--depth deep` with W002 warning
6. **Audit trail** — every triage decision MUST be logged in `drift-log.jsonl` with finding ID, action, and timestamp
7. **Rebuild trigger** — codebase scope 的 3+ P0 finding MUST auto-trigger `/manage sync codebase --full` after triage
</invariants>

<execution>
Follow `~/.maestro/workflows/drift-realign.md` Stages 1-9 in order.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Timeline** (Stages 1-2)
- REQUIRED: `.workflow/` 存在，scope 解析通过，`--since` 已解析。
- REQUIRED: `maestro timeline --since <date> --json` 产出有效时间线。
- BLOCKED if `.workflow/` 缺失 (E001)、scope 非法 (E002)、git 不可用 (E003)。

**GATE 2: Timeline → Scan** (Stages 2-3 → Stage 4)
- REQUIRED: `timeline.json` 已生成且包含事件。
- REQUIRED: `drift_score` 已计算（LOW/MODERATE/SEVERE）。
- REQUIRED: 若 SEVERE 且 `--depth shallow`，发出 W002 建议 `--depth deep`。
- BLOCKED if 时间线为空（`--since` 之后无变更）。

**GATE 3: Scan → Triage** (Stage 4 → Stages 5-6)
- REQUIRED: 4 个并行漂移扫描 agent 全部返回结果（或 W003 部分覆盖）。
- REQUIRED: `DriftFinding[]` 已合并、去重、按严重度排序。
- BLOCKED if 所有 agent 均失败。

**GATE 4: Triage → Apply** (Stages 6-7 → Stage 8)
- REQUIRED: 备份 tarball 生成于 `.workflow/.trash/drift-realign-{timestamp}/`。
- REQUIRED: 所有用户决策已记录（或 `--auto-archive`/`--report` 已生效）。
- REQUIRED: codebase scope 的 rebuild 动作自动触发 `/manage sync codebase --full`。
- BLOCKED if 备份失败 (E005)。

### Execution Constraints

- **Code-as-Truth**: 代码是唯一真理源。当文档说 X 但代码做 Y 时，文档漂移。
- **Parallel scan**: Stage 4 在单条消息中派发 4 个 agent（roadmap-scanner、spec-scanner、codebase-scanner、artifact-scanner）。
- **Auto-rebuild**: 当 codebase-scanner 检测到严重漂移（3+ P0 finding）时，分诊后自动触发 `/manage sync codebase --full`。若 sync 报告重大结构变更，建议 `/manage sync rebuild`。
- **Long gap handling**: 当 `drift_window` > 180 天时，自动升级为 `--depth deep` 并警告用户 (W002)。

### Platform Inquiry（Stage 2a，交互式）

当 `session_summary.by_platform` 包含多个平台且 session 总量 > 20 时，使用 request_user_input 询问用户修改主要在哪个平台进行。用户选择后以 `--platform` 参数重新获取 timeline，缩小后续分析范围。

### Session 详情加载策略（Stage 2b）

`maestro timeline` 每条 session 事件已包含：`summary`（用户提问摘要）、`edited_files`、`code_paths`、`platform`。这些信息在 `--depth shallow` 模式下足以支撑漂移检测。

当 `--depth deep` 时，对与 cold_workflow_files 有 edited_files 交集的 session，通过 `maestro load --type session --id <id> --json` 按需加载完整 body 和 related 字段：
- 仅加载 edited_files 与 cold_workflow_files 有交集的 session
- 最多加载 10 个（按交集文件数降序排序）
- 结果写入 `.workflow/.drift-realign/session-details-{date}.json`
- scanner agent 在 deep 模式下同时接收 timeline.json + session-details.json
</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| codebase 文档已重建 | `/manage status` |
| spec 标记待更新 | 手动编辑标记的 spec 文件 |
| roadmap 已过时 | `maestro run prepare --platform codex roadmap` + `maestro run create roadmap --session YYYYMMDD-roadmap-{topic} --intent "{goal}"` 重新生成 |
| state.json 需清理 | `/manage knowledge audit --scope artifact` |
| 需要完整同步 | `/manage sync codebase --full` |
| project.md 已过时 | 编辑 `.workflow/project.md` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` 未初始化 | 先跑 `/maestro-init` |
| E002 | error | `--scope` 非法 | 提供有效 scope: roadmap/spec/codebase/state/issue/knowhow/project/all |
| E003 | error | git 不可用（非 git 仓库） | 初始化 git |
| E004 | error | `--since` 无法解析 | 检查日期格式或 commit ref |
| E005 | error | 备份失败 | 检查磁盘空间 |
| E006 | error | `--report` 与 `--auto-archive` 同时传入 | 二选一：`--report` 仅生成报告，`--auto-archive` 执行归档 |
| W001 | warning | session 历史不可用（wiki 未索引） | 运行 `maestro wiki rebuild` |
| W002 | warning | `drift_window` > 180 天 | 建议使用 `--depth deep` |
| W003 | warning | 部分 scanner agent 失败 | 以部分覆盖继续 |
| W004 | warning | git log > 1000 commits | 自动截断至最近 1000 条 |
</error_codes>

<success_criteria>
- [ ] Scope 正确解析，互斥标志校验通过
- [ ] `maestro timeline` 已调用，`timeline.json` 已生成
- [ ] `drift_score` 已计算（LOW/MODERATE/SEVERE 已展示）
- [ ] 4 个并行 scanner agent 已派发
- [ ] `DriftFinding[]` 已合并并按 P0 > P1 > P2 排序
- [ ] 如 `--interactive`：用户已分诊所有 finding
- [ ] 变更前备份 tarball 已生成
- [ ] archive 动作已将文件移入 `.trash/`
- [ ] update 动作已注入 TODO 标记及提示
- [ ] rebuild 动作已自动触发 `/manage sync codebase --full`
- [ ] `state.json` 已更新 `last_drift_realign` 时间戳
- [ ] `drift-report-{date}.md` 已生成
- [ ] `drift-log.jsonl` 已追加
- [ ] 摘要展示及下一步路由已输出
</success_criteria>

<a id="sync-rebuild"></a>
### sync → rebuild

<purpose>
Full rebuild of `.workflow/codebase/` docs: 4 parallel mapper agents → tech-stack, architecture, features, concerns. Destructive — overwrites existing docs.
</purpose>

<context>
Remaining tokens after `sync rebuild` -- optional flags.

**Flags:**
- `--focus <area>` -- Scope mapper agents to a single domain (e.g., `auth`, `api`, `database`). When omitted, all 4 mappers run on the full codebase.
- `--force` -- Skip confirmation prompt and proceed directly
- `--skip-commit` -- Do not auto-commit after rebuild

**Confirmation gate:** Unless `--force` is set, prompt the user (request_user_input) before executing git commit. Show the list of changed files and proposed commit message. If `--skip-commit` is set, skip the commit entirely.

**Mapper agent assignments (when `--focus` omitted):**
| Agent | Focus | Output file |
|-------|-------|-------------|
| Mapper 1 | **Tech stack** -- languages, frameworks, dependencies, build system | `tech-stack.md` |
| Mapper 2 | **Architecture** -- layers, module boundaries, data flow, entry points | `architecture.md` |
| Mapper 3 | **Features** -- capabilities, API surface, user-facing functionality | `features.md` |
| Mapper 4 | **Cross-cutting concerns** -- error handling, logging, auth, config, testing | `concerns.md` |

**State files:**
- `.workflow/` -- must be initialized (project.md, state.json exist)
- `.workflow/codebase/` -- target directory (will be cleared and rebuilt)
- `.workflow/codebase/doc-index.json` -- generated documentation index
- `.workflow/codebase/knowledge-graph.json` -- Knowledge Graph with nodes, edges, layers, and tour (generated by `maestro kg index`)

**Output boundary**: ALL file writes MUST target `.workflow/codebase/`, `.workflow/state.json`, or `.workflow/project.md` (Tech Stack section only). NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Destructive with confirmation** — rebuild clears `.workflow/codebase/` entirely; MUST confirm with user unless `--force` is set
2. **Commit confirmation** — git commit MUST be confirmed by user unless `--force` is set; `--skip-commit` bypasses commit entirely
3. **Partial failure tolerance** — if 1-3 mapper agents fail, proceed with partial results (W001); only abort if all 4 fail (E002)
4. **Focus scoping** — when `--focus <area>` is set, MUST only regenerate docs relevant to that scope; leave unrelated docs untouched
5. **State update** — MUST update state.json with rebuild timestamp on completion
6. **KG pipeline mandatory** — MUST run `maestro kg index` after doc regeneration; KG validation failure is non-fatal (W003)
</invariants>

<execution>
Follow '~/.maestro/workflows/codebase-rebuild.md' completely.

**When `--focus <area>` is set:** pass the area string to each mapper agent as scoping context; only regenerate the docs relevant to that scope (leave others untouched unless missing).

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Confirmation → Mapping** (Pre-flight → Agent spawn)
- REQUIRED: `.workflow/` initialized (E001 if missing).
- REQUIRED: User confirmed rebuild (or `--force` set). W002 if existing docs found.
- BLOCKED if user declines confirmation.

**GATE 2: Mapping → KG Pipeline** (Agent results → Knowledge Graph)
- REQUIRED: At least 1 of 4 mapper agents returned valid results.
- REQUIRED: All output files written to `.workflow/codebase/`.
- REQUIRED: doc-index.json generated and valid.
- BLOCKED if all 4 mapper agents failed (E002).

**GATE 3: KG Pipeline → Commit** (Knowledge Graph → Git)
- REQUIRED: `maestro kg index` executed (W003 if validation fails — non-blocking).
- REQUIRED: state.json updated with rebuild timestamp.
- REQUIRED: If not `--skip-commit`: user confirmed git commit (or `--force` set).
- BLOCKED if state.json update fails.
</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| View updated state | `/manage status` |
| Incremental updates later | `/manage sync codebase` |
| Verify KG stats | `maestro kg stats` |
| Future change impact | `maestro kg diff-wiki` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run maestro-init first to create .workflow/ |
| E002 | error | All 4 mapper agents failed | Abort rebuild; check agent configuration and retry |
| W001 | warning | A mapper agent failed (partial results) | Retry failed mapper or accept partial results |
| W002 | warning | `.workflow/codebase/` already exists -- user prompted for rebuild/skip | check_existing |
| W003 | warning | KG validation failed (graph written with valid=false) | Review .kg-tmp/ artifacts, re-run KG pipeline |
| W004 | warning | Wiki index rebuild failed after KG generation | Non-fatal, retries on next wiki access |
</error_codes>

<success_criteria>
- [ ] User confirmed rebuild (or --force used)
- [ ] .workflow/codebase/ cleared and rebuilt from scratch (or scoped subset when --focus set)
- [ ] All 4 mapper agents spawned (all-fail → E002; partial fail → W001)
- [ ] If not --skip-commit: user confirmed git commit (or --force used) before committing
- [ ] doc-index.json generated and valid
- [ ] All documentation files regenerated
- [ ] state.json updated with rebuild timestamp
- [ ] project.md Tech Stack section updated if changes detected
- [ ] KG pipeline executed (`maestro kg index`)
- [ ] knowledge-graph.json generated in .workflow/codebase/
- [ ] KG nodes indexed as virtual wiki entries (automatic via WikiIndexer on next wiki access)
- [ ] Next step routed
</success_criteria>
</content>
</invoke>
