---
name: quality-retrospective
description: Multi-lens 复盘 of completed phase(s); routes insights to spec/note/issue stores and the lessons library
argument-hint: "[phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [--auto-yes]"
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
Post-execution multi-perspective retrospective (复盘) for completed phases. Consumes existing execution artifacts (verification.json, review.json, issues.jsonl, plan.json, .summaries/, uat.md, state.json) and runs four parallel lenses — technical, process, quality, decision — to distill reusable insights. Routes each insight into the appropriate store: spec stub for reusable patterns, memory tip for process notes, issue for recurring gaps. Auto-scans for unreviewed completed phases and reports the backlog. Every insight is also persisted to `.workflow/learning/lessons.jsonl` for cross-phase queryability.
</purpose>

<required_reading>
@~/.maestro/workflows/retrospective.md
</required_reading>

<deferred_reading>
- @~/.maestro/workflows/issue.md (issues.jsonl schema for auto-creation)
- @~/.maestro/workflows/learn.md (tip routing via manage-learn tip)
- @~/.maestro/workflows/verify.md (verification.json schema for quality lens parsing)
- @~/.maestro/workflows/review.md (review.json schema for quality lens parsing)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Modes (auto-detected from first non-flag token):**
- No phase argument → `scan` mode: report unreviewed completed phases, prompt selection
- `<N>` → `single` mode: retrospect phase N
- `<N>..<M>` → `range` mode: retrospect phases N through M (inclusive)
- `--all` → batch mode: re-run for every completed phase (archives existing retrospective.json)

**Flags:**
- `--lens <name>` — restrict to one lens; allowed: technical, process, quality, decision (repeatable)
- `--no-route` — produce retrospective.{md,json} only; skip auto-creation of spec/note/issue
- `--compare <M>` — emit a delta section vs phase M's prior retrospective
- `--auto-yes` — accept all routing recommendations without prompting

**Storage written:**
- `.workflow/phases/{NN}-{slug}/retrospective.md` — human-readable record
- `.workflow/phases/{NN}-{slug}/retrospective.json` — structured record
- `.workflow/specs/SPEC-retro-*.md` — spec stubs (one per spec-routed insight)
- `.workflow/issues/issues.jsonl` — appended issue rows (`source: "retrospective"`)
- `.workflow/learning/lessons.jsonl` — tips routed via `manage-learn tip` (formerly manage-memory-capture)
- `.workflow/learning/lessons.jsonl` — append-only insight log
- `.workflow/learning/learning-index.json` — searchable index

**Storage read (never modified):**
- `.workflow/phases/{NN}-{slug}/index.json`, `plan.json`, `verification.json`, `review.json`, `uat.md`
- `.workflow/phases/{NN}-{slug}/.task/TASK-*.json`, `.summaries/TASK-*-summary.md`
- `.workflow/issues/issues.jsonl`, `.workflow/issues/issue-history.jsonl`
- `.workflow/state.json`
</context>

<execution>
Follow `~/.maestro/workflows/retrospective.md` Stages 1–8 in order. Key invariants:

1. **Read-only until Stage 6** — Stages 1–5 must not write anything except the in-memory retrospective record.
2. **Parallel lens dispatch** — Stage 4 spawns one Agent per active lens in a single message (multiple Agent tool calls). All agents use `subagent_type: "general-purpose"` and `run_in_background: false`.
3. **Match canonical issues schema** — Stage 6 issue routing must produce rows that pass `jq` parsing and match the schema in `workflows/issue.md` Step 4 exactly (status `"open"`, full `issue_history` entry, all required fields).
4. **Reuse `manage-learn tip` for note routing** — do not duplicate the learning pipeline; invoke via `Skill({ skill: "manage-learn", args: "tip ..." })`.
5. **Backward-compat with phase-transition** — append a one-line summary per insight to `.workflow/specs/learnings.md` if and only if that file already exists. Never create it.
6. **Stable insight IDs** — `INS-{8 hex}` from `hash(phase_num + lens + title)` so re-runs do not duplicate.
7. **Archive before overwrite** — if existing `retrospective.{md,json}` are being replaced, move them to `{phase_dir}/.history/` with a timestamp suffix first.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `Skill({ skill: "maestro-init" })` first | parse_input |
| E002 | error | Unknown `--lens` name (allowed: technical, process, quality, decision) | parse_input |
| E003 | error | `--compare` requires a single phase argument | parse_input |
| E004 | error | Phase has not executed yet — no `.task/` or `.summaries/` artifacts | load_artifacts |
| E005 | error | Phase argument out of range / phase directory not found | scan_unreviewed |
| W001 | warning | One or more lens agents failed — proceeding with partial coverage | multi_lens_analysis |
| W002 | warning | Existing retrospective.json found and not `--all` — prompted user to overwrite | scan_unreviewed |
| W003 | warning | `manage-learn tip` did not return parseable INS id; fell back to direct write | route_outputs |
| W004 | warning | `--compare` target phase has no retrospective.json; delta omitted | load_artifacts |
</error_codes>

<success_criteria>
- [ ] Mode correctly resolved (scan / single / range / all)
- [ ] At least one phase selected and validated (status == "completed", artifacts exist)
- [ ] All requested lens agents returned valid JSON, or W001 logged for partial coverage
- [ ] `retrospective.json` written with metrics, findings_by_lens, distilled_insights, routing_recommendations
- [ ] `retrospective.md` written and human-readable (tweetable, metrics table, per-lens findings, insights, routing table)
- [ ] Each insight has a stable `INS-{8hex}` id
- [ ] If routing enabled (default): every recommendation either created an artifact or was explicitly skipped by user
- [ ] Spec stubs (if any) written to `.workflow/specs/SPEC-retro-*.md` with proper frontmatter
- [ ] Issue rows (if any) match canonical issues.jsonl schema (status "open", full issue_history, all required fields)
- [ ] Note tips (if any) created via `Skill({ skill: "manage-learn", args: "tip ..." })`
- [ ] `lessons.jsonl` appended with one row per insight regardless of routing target
- [ ] `learning-index.json` updated and parseable
- [ ] No existing phase artifacts modified (verification.json, review.json, plan.json untouched)
- [ ] Confirmation banner displays routing counts and next-step suggestions
- [ ] Next step: `Skill({ skill: "manage-status" })` to review state, or `Skill({ skill: "manage-issue", args: "list --source retrospective" })` to triage created issues, or `Skill({ skill: "manage-learn", args: "list" })` to browse the lessons library
</success_criteria>
