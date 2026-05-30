---
name: maestro-analyze
description: Use when a topic needs structured multi-dimensional investigation before planning or decision-making
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
$ARGUMENTS -- phase number for micro mode, topic text for macro/adhoc mode, no args for milestone-wide.

**Dual-layer mode:**
- **Macro mode** (text argument): Explore impact surface of a topic/requirement. Produces coarse-grained context with `scope_verdict` to route next step. Use before roadmap or for standalone analysis.
- **Micro mode** (numeric argument): Phase-level deep analysis within an existing roadmap. Produces fine-grained context for plan consumption. `analyze 1` = Phase 1 of current milestone.

**Disambiguation rule (mode selection):**
- First positional arg matches `^\d+$` (pure digits, e.g. `1`, `42`) → **micro mode** (treat as phase number)
- First positional arg is non-numeric text (e.g. `auth-refactor`, `improve search`) → **macro mode** (treat as topic)
- No positional arg → milestone-wide micro mode (when roadmap present) else macro fallback
- Mixed input like `"1 phase"` is treated as text → macro mode (only bare numerics trigger micro)

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive scoping, use recommended defaults, auto-deepen
- `-c` / `--continue`: Resume from existing session (auto-detect session folder + discussion.md)
- `-q` / `--quick`: Quick mode — skip exploration + scoring, go straight to decision extraction (context.md only)
- `--from <source>`: Load upstream context package (grill:ID, brainstorm:ID, blueprint:BLP-xxx, @file, or path)
- `--gaps [ISS-ID]`: Issue root cause analysis mode. If ISS-ID provided, analyze single issue. If omitted, analyze all open/registered issues from issues.jsonl.

Scope routing, output directory format, artifact registration schema, and output artifact listing are defined in workflow analyze.md (Scope Routing and Output Structure sections).

### Role Knowledge
`maestro wiki list --category debug` → select relevant → `maestro wiki load`
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip when `-y/--yes`, `-c/--continue`, or input is already specific (explicit phase number or unambiguous topic).

- One decision per turn via AskUserQuestion with 2–4 options + a (Recommended) default. The user controls termination — keep interviewing until convergence; they can interrupt naturally or via `Other` at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, `roadmap.md`, `issues.jsonl`, `maestro spec load`, `maestro wiki search`, Grep, Read, or — for open-ended multi-file scans — spawn `Agent(subagent_type: Explore)` / `maestro delegate ... --role explore`. Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each settled decision is immediately appended/updated in `discussion.md` (top table) and mirrored into `context.md` "Interview Decisions". Do NOT batch writeback to the end — partial decisions must already be on disk before the next question.
- Walk the decision dependency tree strictly: scope → depth → dimensions → Go/No-Go threshold. Do not open the next branch until the current one is settled.
- Scope guard: only ask about decisions owned by `analyze`. Do not prejudge plan/execute concerns.

Decision points: scope (phase / topic / milestone-wide / adhoc / --gaps) → depth (quick / standard / deep) → dimensions (which of the 6 to keep) → Go/No-Go threshold.

Exit: when all decision points are settled (or user explicitly signals to proceed), finalize session metadata. The decision table (populated incrementally during interview) uses this schema:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

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
  - Run maestro delegate --role analyze --mode analysis with codebase context
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

**scope_verdict** (added to context.md in Step 6 Synthesis for macro/adhoc/standalone scopes):
- `large` (3+ independent subsystems or hard serial dependencies) → suggest `/maestro-roadmap --from analyze:ANL-xxx`
- `medium` (1-2 subsystems, parallelizable) → suggest `/maestro-plan --from analyze:ANL-xxx`
- `small` (single-file or few-file change) → suggest `/maestro-plan --from analyze:ANL-xxx`

**Next-step routing on completion:**

Phase/Milestone scope (micro mode):
- Go recommendation, UI work needed → `/maestro-impeccable build {target}`
- Go recommendation, ready to plan → `/maestro-plan` or `/maestro-plan {phase}`
- No-Go recommendation → revisit requirements or `/maestro-brainstorm {topic}`

Macro/Adhoc/Standalone scope:
- scope_verdict = large → `/maestro-roadmap --from analyze:ANL-xxx`
- scope_verdict = medium/small → `/maestro-plan --from analyze:ANL-xxx`
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
- [ ] Confidence tracking initialized (Step 4.6) and re-scored each round (Step 5.8)
- [ ] Readiness gate checked before synthesis (Step 5.10)
- [ ] Pressure pass completed ≥ 1 time before Step 6
- [ ] Confidence summary with factor decomposition written to analysis.md

Gaps mode:
- [ ] Issues loaded from issues.jsonl (all open/registered, or single ISS-ID)
- [ ] CLI exploration executed per issue with codebase context
- [ ] Analysis record attached to each issue in issues.jsonl
- [ ] context.md written with aggregated root causes for plan --gaps

Both modes (full + quick):
- [ ] Interactive mode: interview decision table written to `discussion.md` and mirrored into `context.md` "Interview Decisions"
- [ ] context.md written with all decisions classified as Locked/Free/Deferred
- [ ] Gray areas identified through phase-specific analysis
- [ ] Decision Recording Protocol applied to all decisions
- [ ] Scope creep redirected to Deferred section
- [ ] Deferred items auto-created as issues (if any)
- [ ] Artifact registered in state.json with correct scope/milestone/phase
- [ ] Next step routed (impeccable/plan for Go, brainstorm for No-Go)
- [ ] Session sealed via finish-work (archive.json written, optional spec/knowhow extraction)
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR=OUTPUT_DIR, SESSION_TYPE=analyze, SESSION_ID={artifact_id}, LINKED_MILESTONE={target_milestone or null}
</on_complete>
