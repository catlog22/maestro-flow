---
name: manage-harvest
description: Extract knowledge from artifacts into wiki/spec/issues
argument-hint: "[<session-id|path>] [--to wiki|spec|issue|auto] [--source
  <type>] [--recent N] [--dry-run] [-y] [--prune] [--age N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.50
---

<purpose>
Knowledge extraction from workflow artifacts, routed into three stores: wiki entries,
spec conventions, and trackable issues. Prevents knowledge loss from completed sessions.

**Closed-loop**: harvest extracts → stores → downstream consumers (wiki-digest, spec-load, maestro-plan --gaps).
</purpose>

<required_reading>
@~/.maestro/workflows/harvest.md
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<context>
$ARGUMENTS — session-id, path, or empty for scan mode.

**Modes:**
- No args → `scan`: discover all harvestable artifacts, interactive selection
- `<session-id>` → `session`: harvest specific session
- `<path>` → `path`: harvest from explicit directory

**Flags:**
- `--to <target>` — Force routing: wiki, spec, issue, auto (default: auto)
- `--source <type>` — Filter: analysis, brainstorm, debug, lite-plan, lite-fix, scratchpad, session, learning, all
- `--recent N` — Artifacts within last N days (default: 30)
- `--dry-run` — Preview without writing
- `-y` — Skip confirmations
- `--min-confidence N` — Minimum 0.0-1.0 (default: 0.5)
- `--prune` — State hygiene mode: classify artifacts, graduate harvested → knowhow, archive from state.json, prune accumulated_context
- `--age N` — Graduation age threshold in days (default: 14). Used with `--prune`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/`, `.workflow/specs/`, `.workflow/issues/`, `.workflow/wiki/`, `.workflow/harvest/`, or `.workflow/state.json` only. NEVER modify source code, source artifacts, or files outside these paths.

**Source registry:**
| Source | Scan Path | Key Files |
|--------|-----------|-----------|
| analysis | `.workflow/.analysis/ANL-*/` | conclusions.json |
| brainstorm | `{run_dir}/outputs/brainstorm-*/` | guidance-specification.md |
| lite-plan | `.workflow/.lite-plan/*/` | plan.json |
| lite-fix | `.workflow/.lite-fix/*/` | fix-plan.json |
| debug | `.workflow/.debug/*/` | debug-log.md |
| scratchpad | `{run_dir}/outputs/` | *.md |
| session | `.workflow/active/WFS-*/` | workflow-session.json |
| learning | `.workflow/specs/` | learnings.md |
</context>

<invariants>
1. **Read-only until routing** — extraction and classification happen in-memory; no files written until Stage 6
2. **Never modify source artifacts** — harvest is purely extractive; source files remain untouched
3. **Dedup before write** — MUST check harvest-log.jsonl and existing stores before each write to prevent duplicates
4. **Source tagging** — MUST set `source: "harvest"` on every issues.jsonl row so concurrent writers can be distinguished
5. **Conflict pre-check on spec routing** — when routing to spec, MUST compare against existing specs with same keywords/category; set `confidence="low"` and log conflict note if semantic conflict detected
6. **Provenance tracking** — every routed item MUST be logged in harvest-log.jsonl with fragment ID, target store, and timestamp
7. **Dry-run safety** — `--dry-run` MUST NOT write any files; preview only
</invariants>

<execution>
Follow '~/.maestro/workflows/harvest.md' Stages 1–8 (standard mode) or Stage 9 (`--prune` mode).

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

**Routing rules:**
- Universal design patterns → `coding` or `arch` category
- Component-level pitfalls → `learning` category
- Quality enforcement rules → `quality` category
- Wiki: `maestro wiki create --type <type> --slug harvest-<source_type>-<short_id>`
- Spec: `$spec-add "<category> <content>"` (single source of truth — always use spec-add for spec routing; do NOT use `maestro wiki append` for spec entries)
- Issue: append to `issues.jsonl` matching canonical schema, with `source: "harvest"` field (distinguishes from `manage-issue-discover`, which uses `source: "discover"` — required for cross-skill dedup when both write concurrently)

**Next steps:** `$manage-wiki health`, `maestro search --type note`, `$wiki-connect --fix`, `$wiki-digest`, `$manage-issue list --source harvest`, `$manage-knowledge-audit --scope spec` (when specs extracted, check for conflicts)

**Prune mode** (`--prune`): Classifies artifacts (active/graduated/stale/protected), graduates harvested artifacts to wiki knowhow, archives from `artifacts[]` → `artifact_archive[]`, prunes resolved entries from accumulated_context. Files on disk are never deleted. Always backs up state.json before writing.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run $maestro-init |
| E002 | error | Invalid --to target | Valid: wiki, spec, issue, auto |
| E003 | error | Invalid --source type | Display valid types |
| E004 | error | Session ID not found | Show available sessions |
| W001 | warning | No harvestable artifacts in window | Widen --recent |
| W003 | warning | Fragments below threshold | Lower --min-confidence |
| W004 | warning | Duplicate fragments skipped | Review harvest-log.jsonl |
</error_codes>

<success_criteria>
- [ ] Mode resolved (scan / session / path)
- [ ] Artifacts discovered and parsed
- [ ] Fragments extracted with category, confidence, tags
- [ ] Dedup check passed against harvest-log.jsonl and stores
- [ ] If not dry-run: routed items written to target stores
- [ ] harvest-log.jsonl updated with provenance
- [ ] harvest-report-{date}.md written
- [ ] No source artifacts modified
- [ ] If --prune: artifacts classified (active/graduated/stale/protected)
- [ ] If --prune: graduated artifacts → knowhow + artifact_archive[]
- [ ] If --prune: accumulated_context pruned (resolved deferred/blockers, deduplicated decisions)
- [ ] If --prune: state.json backed up before modification
</success_criteria>
