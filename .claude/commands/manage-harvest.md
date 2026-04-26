---
name: manage-harvest
description: Extract knowledge from workflow artifacts and route to wiki / spec / issue stores
argument-hint: "[<session-id|path>] [--to wiki|spec|issue|auto] [--source <type>] [--recent N] [--dry-run] [-y]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Extract knowledge fragments from workflow artifacts (analysis results, brainstorm outputs, debug sessions, lite-plan/fix results, scratchpad notes, completed sessions) and route them into the project's three knowledge stores: wiki entries, spec conventions, and trackable issues.

Complements `quality-retrospective` (which is phase-scoped) by harvesting from **any** workflow artifact. Prevents knowledge loss from completed analysis and planning sessions that would otherwise only exist as stale files.

**Closed-loop**: harvest extracts → wiki/spec/issue stores → downstream commands consume (wiki-digest, spec-load, maestro-plan --gaps).
</purpose>

<required_reading>
@~/.maestro/workflows/harvest.md
</required_reading>

<deferred_reading>
- @~/.maestro/workflows/issue.md (issues.jsonl schema for issue routing — read when creating issues in Stage 6c)
- @~/.maestro/workflows/specs-add.md (spec entry format — read when routing to spec in Stage 6b)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Modes (auto-detected):**
- No arguments → `scan` mode: discover all harvestable artifacts, interactive selection
- `<session-id>` (e.g., `ANL-auth-20260410`, `WFS-xxx`) → `session` mode: harvest specific session
- `<path>` (e.g., `.workflow/.analysis/ANL-auth-20260410/`) → `path` mode: harvest from explicit directory

Flags, source registry (scan paths), and storage locations defined in workflow harvest.md.
</context>

<execution>
Follow '~/.maestro/workflows/harvest.md' Stages 1-8 in order.

**Key invariants:**
1. **Read-only until Stage 6** — extraction and classification happen in-memory.
2. **Dedup before write** — check harvest-log.jsonl and existing stores before each write.
3. **Never modify source artifacts** — harvest is purely extractive.

Extraction patterns, classification rules, routing infrastructure, and fragment ID scheme defined in workflow harvest.md.

**Next-step routing on completion:**
- Review wiki entries → `maestro wiki list --type note`
- Connect wiki graph → `/wiki-connect --fix`
- Triage issues → `/manage-issue list --source harvest`
- View specs → `/spec-load --category learning`
- Full retrospective → `/quality-retrospective`
</execution>

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
- [ ] Spec entries added via `spec-add` mechanism
- [ ] Issue entries appended to `issues.jsonl` with canonical schema
- [ ] `harvest-log.jsonl` updated with provenance for each routed item
- [ ] `harvest-report-{date}.md` written with full summary
- [ ] No source artifacts modified
- [ ] Summary displayed with counts and next-step routing
</success_criteria>
