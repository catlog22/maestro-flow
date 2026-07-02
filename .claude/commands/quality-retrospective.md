---
name: quality-retrospective
description: Use after completing a phase to extract lessons, patterns, and improvement opportunities
argument-hint: "[phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [-y]"
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
Post-execution retrospective (复盘): four parallel lenses (technical/process/quality/decision) → distill insights → route to spec/knowhow/issue stores.
</purpose>

<required_reading>
@~/.maestro/workflows/retrospective.md
</required_reading>

<deferred_reading>
- @~/.maestro/workflows/issue.md (issues.jsonl schema for auto-creation)
- @~/.maestro/workflows/learn.md (tip routing via manage-knowhow-capture tip)
- @~/.maestro/workflows/verify.md (verification.json schema for quality lens parsing)
- @~/.maestro/workflows/review.md (review.json schema for quality lens parsing)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Flags:**
- `-y` — Skip confirmation prompts for external writes (issues.jsonl, spec entries, knowhow capture)
- `--no-route` — Skip routing stage (produce retrospective files only, no spec/issue/knowhow writes)
- `--compare N` — Compare current phase retrospective against phase N (requires single phase argument)
- `--all` — Run retrospective on all completed phases that lack retrospective.json
- `--lens <name>` — Restrict to specific lens (technical|process|quality|decision); default: all four

Modes (scan/single/range/all) and storage paths defined in workflow retrospective.md Argument Shape and Stages 1-7.

**Output boundary**: ALL file writes MUST target the phase's retrospective directory (`.workflow/scratch/{YYYYMMDD}-retrospective-P{N}/`), `.workflow/state.json`, `.workflow/issues.jsonl`, or `.workflow/specs/` (append-only). NEVER modify source code, verification.json, review.json, plan.json, or other existing artifacts.
</context>

<invariants>
1. **Source artifacts are read-only** — NEVER modify verification.json, review.json, plan.json, or any execution artifact. Retrospective reads these for analysis only.
2. **Stable insight IDs** — `INS-{8hex}` MUST be deterministic from `hash(phase_num + lens + title)`. Re-runs MUST NOT create duplicate insights.
3. **Routing requires confirmation** — unless `-y` flag is set, every external write (issues.jsonl, spec entry, knowhow capture) MUST be confirmed by user before execution.
4. **Lens independence** — each lens agent (technical/process/quality/decision) operates independently. One lens's findings MUST NOT suppress or override another's.
5. **Append-only for specs** — learnings.md entries are appended as `<spec-entry>` blocks. NEVER overwrite or restructure existing entries.
6. **Archive before overwrite** — if retrospective.json already exists for a phase, the existing file MUST be archived before writing a new version.
</invariants>

<execution>
Follow `~/.maestro/workflows/retrospective.md` Stages 1–8 in order.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Input → Lens Analysis** (Stages 1-3 → Stage 4)
- REQUIRED: Mode resolved (scan/single/range/all) and phases validated.
- REQUIRED: At least one phase selected with status=completed and existing artifacts.
- REQUIRED: Read-only — no file writes in Stages 1-3.
- BLOCKED if no valid phases: E004/E005.

**GATE 2: Lens Analysis → Routing** (Stages 4-5 → Stage 6)
- REQUIRED: All requested lens agents returned valid JSON (or W001 logged for partial).
- REQUIRED: Insights distilled with stable `INS-{8hex}` IDs.
- REQUIRED: Archive existing `retrospective.{md,json}` before overwrite.
- BLOCKED if all lens agents failed: cannot synthesize without results.

**GATE 3: Routing → Completion** (Stage 6 → Stages 7-8)
- REQUIRED: `retrospective.json` written with metrics, findings, insights, routing.
- REQUIRED: `retrospective.md` written (human-readable).
- REQUIRED: Issue rows match canonical `issues.jsonl` schema (status "open", full fields).
- REQUIRED: Note tips routed via `Skill({ skill: "manage-knowhow-capture", args: "tip ..." })`.
- REQUIRED: Unless `-y` flag is set, confirm before each external write (issues.jsonl append, spec-entry append, knowhow-capture). With `-y`, skip all confirmation prompts.
- BLOCKED if routing incomplete: finish all write operations before reporting.

### Execution Constraints

- **Parallel lens dispatch**: Stage 4 spawns one Agent per active lens in a single message.
- **Stable IDs**: `INS-{8 hex}` from `hash(phase_num + lens + title)` — re-runs do not duplicate.
- **No source modification**: Never modify verification.json, review.json, plan.json.
- **Backward-compat**: Append to `.workflow/specs/learnings.md` only if file already exists.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `/maestro-init` first | parse_input |
| E002 | error | Unknown `--lens` name (allowed: technical, process, quality, decision) | parse_input |
| E003 | error | `--compare` requires a single phase argument | parse_input |
| E004 | error | Phase has not executed yet — no `.task/` or `.summaries/` artifacts | load_artifacts |
| E005 | error | Phase argument out of range / phase directory not found | scan_unreviewed |
| W001 | warning | One or more lens agents failed — proceeding with partial coverage | multi_lens_analysis |
| W002 | warning | Existing retrospective.json found and not `--all` — prompted user to overwrite | scan_unreviewed |
| W003 | warning | `manage-knowhow-capture tip` did not return parseable INS id; fell back to direct write | route_outputs |
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
- [ ] Spec entries (if any) appended as `<spec-entry>` to matching `.workflow/specs/{category-file}.md`
- [ ] Issue rows (if any) match canonical issues.jsonl schema (status "open", full issue_history, all required fields)
- [ ] Note tips (if any) created via `Skill({ skill: "manage-knowhow-capture", args: "tip ..." })`
- [ ] `.workflow/specs/learnings.md` appended with one `<spec-entry>` per insight regardless of routing target
- [ ] No existing phase artifacts modified (verification.json, review.json, plan.json untouched)
- [ ] Confirmation banner displays routing counts and next-step suggestions
</success_criteria>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS
CONCERNS: {description if applicable}
--- END STATUS ---
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Insights routed | `/manage-status` |
| Issues created | `/manage-issue list --source retrospective` |
| Knowhow captured | `/manage-knowhow list` |
| More phases to review | `/quality-retrospective --all` |
</completion>
