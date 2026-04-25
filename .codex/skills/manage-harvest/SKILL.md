---
name: manage-harvest
description: Extract knowledge fragments from workflow artifacts (analysis, brainstorm, debug, lite-plan, scratchpad, sessions) and route to wiki / spec / issue stores. Dedup via stable fragment IDs. Closed-loop with downstream consumers.
argument-hint: "[<session-id|path>] [--to wiki|spec|issue|auto] [--source <type>] [--recent N] [--dry-run] [-y]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
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
| learning | `.workflow/learning/` | lessons.jsonl |
</context>

<execution>
Follow '~/.maestro/workflows/harvest.md' Stages 1–8.

**Key invariants:**
1. **Read-only until Stage 6** — extraction/classification in-memory only
2. **Dedup before write** — check harvest-log.jsonl + existing stores
3. **Stable fragment IDs** — `HRV-{8 hex}` from `hash(source_id + content_hash)`
4. **Never modify source artifacts** — purely extractive
5. **Confidence filtering** — below threshold logged but not routed
6. **Spec format enforcement** — all spec routing must use `<spec-entry>` closed-tag format with `category`, `keywords`, `date`, `source="harvest"` attributes

**Routing rules:**
- Universal design patterns → `coding` or `arch` category
- Component-level pitfalls → `learning` category
- Quality enforcement rules → `quality` category
- Wiki: `maestro wiki create --type <type> --slug harvest-<source_type>-<short_id>`
- Spec: `maestro wiki append spec-<file> --category <category> --body "<content>" --keywords "<kws>"` (unified write path) or `Skill({ skill: "spec-add", args: "<category> <content>" })`
- Issue: append to `issues.jsonl` matching canonical schema

**Next steps:** `/manage-wiki health`, `maestro wiki list --type note`, `/wiki-connect --fix`, `/wiki-digest`, `/manage-issue list --source harvest`
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
</success_criteria>
