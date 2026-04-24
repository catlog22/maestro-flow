---
name: maestro-analyze
description: Multi-dimensional analysis with CLI exploration, decision extraction, and intent tracking
argument-hint: "[phase|topic] [-y] [-c] [-q] [--gaps [ISS-ID]]"
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
Perform multi-dimensional analysis of a technical proposal, decision, or architecture choice through iterative CLI-assisted exploration and interactive discussion. Produces a discussion timeline (discussion.md) with evolving understanding, multi-perspective findings, Decision Recording Protocol, Intent Coverage tracking, and a final conclusions package with Go/No-Go recommendation.

Combines structured 6-dimension scoring with iterative deepening and decision extraction. Replaces both analysis and decision-capture workflows — produces analysis.md (scoring) AND context.md (Locked/Free/Deferred decisions for plan).

Use `-q` for quick decision extraction only (skip exploration + scoring).

Use `--gaps` for issue-focused root cause analysis (replaces manage-issue-analyze). Loads issues from issues.jsonl, performs CLI exploration against issue context/location, synthesizes root cause into issue.analysis, and outputs context.md for downstream `plan --gaps`.
</purpose>

<required_reading>
@~/.maestro/workflows/analyze.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
- [issue-gaps-analyze.md](~/.maestro/workflows/issue-gaps-analyze.md) — read when --gaps is triggered
</deferred_reading>

<context>
$ARGUMENTS -- phase number for milestone-scoped, topic text for adhoc/standalone mode, no args for milestone-wide.

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive scoping, use recommended defaults, auto-deepen
- `-c` / `--continue`: Resume from existing session (auto-detect session folder + discussion.md)
- `-q` / `--quick`: Quick mode — skip exploration + scoring, go straight to decision extraction (context.md only)
- `--gaps [ISS-ID]`: Issue root cause analysis mode. If ISS-ID provided, analyze single issue. If omitted, analyze all open/registered issues from issues.jsonl.

**Scope routing (per architecture):**

| Invocation | Precondition | Scope | Behavior |
|-----------|-------------|-------|----------|
| `analyze` (no args) | init + roadmap | milestone | Analyze current milestone's all phases |
| `analyze 1` | init + roadmap | phase | Analyze phase 1 only |
| `analyze "topic"` (has milestone) | none | adhoc | Analyze topic, affiliated with current milestone |
| `analyze "topic"` (no milestone) | none | standalone | Analyze topic, no milestone affiliation |
| `analyze --gaps` | issues.jsonl exists | gaps | Load open issues, explore root causes, write analysis records |
| `analyze --gaps ISS-xxx` | issue exists | gaps | Analyze single issue root cause |

**Scope detection rule**: Text argument + `state.json.current_milestone` non-null → adhoc. Text argument + no milestone → standalone. No args + no roadmap → error (need topic or roadmap). `--gaps` → gaps scope (bypasses standard scope routing).

**Output directory** (relative to `.workflow/`):

| Scope | Directory format | Example |
|-------|-----------------|---------|
| Phase | `scratch/{YYYYMMDD}-analyze-P{N}-{slug}/` | `20260420-analyze-P1-auth` |
| Milestone | `scratch/{YYYYMMDD}-analyze-M{N}-{slug}/` | `20260420-analyze-M1-mvp` |
| Adhoc/Standalone | `scratch/{YYYYMMDD}-analyze-{slug}/` | `20260420-analyze-caching` |

Scope prefix (`P{N}` / `M{N}`) enables directory-level identification as fallback when state.json is unavailable.

**Artifact registration**: On completion, register artifact in `state.json.artifacts[]`:
```jsonc
{
  "id": "ANL-{NNN}",
  "type": "analyze",
  "milestone": "{current_milestone or null}",
  "phase": "{phase_number or null}",
  "scope": "{milestone|phase|adhoc|standalone}",
  "path": "scratch/{YYYYMMDD}-analyze-P{N}-{slug}",  // P{N} for phase, M{N} for milestone, omit for adhoc/standalone
  "status": "completed",
  "depends_on": null,
  "harvested": false,
  "created_at": "...",
  "completed_at": "..."
}
```

**Output artifacts:**
| Artifact | Mode | Description |
|----------|------|-------------|
| `context.md` | both | Locked/Free/Deferred decisions for downstream plan |
| `discussion.md` | full | Full discussion timeline with TOC, Current Understanding, rounds, decisions, intent coverage |
| `analysis.md` | full | Executive summary with 6-dimension scores and risk matrix |
| `conclusions.json` | full | Final synthesis with recommendations, decision trail, intent coverage |
| `explorations.json` | full | Codebase exploration findings (single perspective) |
| `perspectives.json` | full | Multi-perspective findings with synthesis (if multi-perspective) |
</context>

<execution>
Follow '~/.maestro/workflows/analyze.md' completely.

### --gaps Mode (Issue Root Cause Analysis)

When `--gaps` flag is present, follow `~/.maestro/workflows/issue-gaps-analyze.md` instead of the standard analyze pipeline:

```
Phase 1: Load issues from .workflow/issues/issues.jsonl
  - If ISS-ID provided: load single issue
  - If no ISS-ID: filter issues where status = open | registered
  - Validate: at least 1 issue loaded, else error E_NO_ISSUES

Phase 2: CLI exploration per issue
  - For each issue: build exploration prompt from issue.title, description, context, related_files
  - Run maestro delegate --to gemini --mode analysis with codebase context
  - Gather affected files, call chains, root cause evidence

Phase 3: Root cause synthesis → write issue.analysis
  - Parse CLI output into analysis record: { root_cause, affected_files, impact_scope, fix_direction, confidence, analyzed_at, tool, depth }
  - Write analysis record to issue in issues.jsonl
  - Append history entry: { action: "analyzed", at: <ISO>, by: "maestro-analyze --gaps" }

Phase 4: Output context.md for downstream plan --gaps
  - Aggregate all analyzed issues into context.md with root causes and fix directions
  - Register ANL artifact in state.json
```

**Handoff:** context.md is consumed by maestro-plan (loads Locked/Free/Deferred decisions). In --gaps mode, context.md contains issue root causes for `plan --gaps` consumption.

**Next-step routing on completion:**

Phase/Milestone scope:
- Go recommendation, UI work needed → `/maestro-ui-design {phase}`
- Go recommendation, ready to plan → `/maestro-plan` or `/maestro-plan {phase}`
- No-Go recommendation → revisit requirements or `/maestro-brainstorm {topic}`

Adhoc/Standalone scope:
- Ready to plan → `/maestro-plan --dir {scratch_dir}`
- Need more exploration → `/maestro-analyze {topic} -c`

Gaps scope:
- Issues analyzed → `/maestro-plan --gaps` (plan fix tasks linked to issues)
- Need more context → `/maestro-analyze --gaps {ISS-ID}` (re-analyze specific issue)
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No args and no roadmap (cannot determine scope) | Prompt user for topic text or create roadmap first |
| W001 | warning | CLI exploration failed | Continue with available context, note limitation |
| W002 | warning | CLI analysis timeout | Retry with shorter prompt, or skip perspective |
| W003 | warning | Insufficient evidence for scoring dimensions | Note low-confidence dimensions, proceed with available evidence |
| W004 | warning | Max rounds reached (5) | Force synthesis, offer continuation option |
| E_NO_ISSUES | error | --gaps but no open/registered issues found | Suggest `/manage-issue-discover` or `/manage-issue create` |
| E_ISSUE_NOT_FOUND | error | --gaps with ISS-ID but issue not found | Suggest `/manage-issue list` to find valid IDs |
</error_codes>

<success_criteria>
Full mode:
- [ ] CLI exploration completed with code anchors and call chains
- [ ] discussion.md created with full timeline, TOC, Current Understanding
- [ ] analysis.md written with all 6 dimensions scored with evidence
- [ ] conclusions.json created with recommendations and decision trail
- [ ] Intent Coverage tracked and verified (no unresolved ❌ items)

Gaps mode:
- [ ] Issues loaded from issues.jsonl (all open/registered, or single ISS-ID)
- [ ] CLI exploration executed per issue with codebase context
- [ ] Analysis record attached to each issue in issues.jsonl
- [ ] context.md written with aggregated root causes for plan --gaps

Both modes (full + quick):
- [ ] context.md written with all decisions classified as Locked/Free/Deferred
- [ ] Gray areas identified through phase-specific analysis
- [ ] Decision Recording Protocol applied to all decisions
- [ ] Scope creep redirected to Deferred section
- [ ] Deferred items auto-created as issues (if any)
- [ ] Artifact registered in state.json with correct scope/milestone/phase
- [ ] Next step routed (ui-design/plan for Go, brainstorm for No-Go)
</success_criteria>
