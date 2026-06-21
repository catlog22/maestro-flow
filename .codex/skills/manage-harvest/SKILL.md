---
name: manage-harvest
description: Extract knowledge from artifacts into wiki/spec/issues
argument-hint: "[<session-id|path>] [--to wiki|spec|issue|auto] [--source <type>] [--recent N] [--dry-run] [-y] [--prune] [--age N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Knowledge extraction from workflow artifacts, routed into three stores: wiki entries,
spec conventions, and trackable issues. Prevents knowledge loss from completed sessions.

**Closed-loop**: harvest extracts → stores → downstream consumers (wiki-digest, spec-load, maestro-plan --gaps).
</purpose>

<required_reading>
@~/.maestro/workflows/harvest.md
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

**Source registry:**
| Source | Scan Path | Key Files |
|--------|-----------|-----------|
| analysis | `.workflow/.analysis/ANL-*/` | conclusions.json |
| brainstorm | `.workflow/scratch/brainstorm-*/` | guidance-specification.md |
| lite-plan | `.workflow/.lite-plan/*/` | plan.json |
| lite-fix | `.workflow/.lite-fix/*/` | fix-plan.json |
| debug | `.workflow/.debug/*/` | debug-log.md |
| scratchpad | `.workflow/.scratchpad/` | *.md |
| session | `.workflow/active/WFS-*/` | workflow-session.json |
| learning | `.workflow/specs/` | learnings.md |
</context>

<execution>
Follow '~/.maestro/workflows/harvest.md' Stages 1–8 (standard mode) or Stage 9 (`--prune` mode).

**Key invariants:**
1. **Read-only until Stage 6** — extraction/classification in-memory only
2. **Dedup before write** — check harvest-log.jsonl + existing stores
3. **Stable fragment IDs** — `HRV-{8 hex}` from `hash(source_id + content_hash)`
4. **Never modify source artifacts** — purely extractive
5. **Confidence filtering** — below threshold logged but not routed
6. **Spec format enforcement** — all spec routing must use `<spec-entry>` closed-tag format with `title`, `description`, `keywords`, `date`, `source="harvest"` attributes
7. **Conflict pre-check on spec routing** — when routing to spec, compare new entry against existing specs with same keywords/category. If semantic conflict detected, set `confidence="low"` on the new entry and log conflict note. Use `maestro spec conflict mark` if contradiction is clear

**Routing rules:**
- Universal design patterns → `coding` or `arch` category
- Component-level pitfalls → `learning` category
- Quality enforcement rules → `quality` category
- Wiki: `maestro wiki create --type <type> --slug harvest-<source_type>-<short_id>`
- Spec: `maestro wiki append spec-<file> --body "<content>" --keywords "<kws>"` (unified write path) or `$spec-add "<category> <content>"`
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
