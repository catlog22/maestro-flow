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

Pipeline position: downstream of maestro-grill, maestro-brainstorm, and maestro-blueprint (optional upstream enrichment); upstream of maestro-plan and maestro-roadmap (consumes analysis context).
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

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — skip interactive scoping, use recommended defaults, auto-deepen | false |
| `-c` / `--continue` | Resume from existing session (auto-detect session folder + discussion.md) | false |
| `-q` / `--quick` | Quick mode — skip exploration + scoring, go straight to decision extraction (context.md only) | false |
| `--from <source>` | Load upstream context package (grill:ID, brainstorm:ID, blueprint:BLP-xxx, @file, or path) | — |
| `--gaps [ISS-ID]` | Issue root cause analysis mode. If ISS-ID provided, analyze single issue. If omitted, analyze all open/registered issues from issues.jsonl | — |

**Scope routing:**
| Input | Mode | Scope |
|-------|------|-------|
| Pure digits (e.g. `1`, `42`) | micro | Phase-level deep analysis |
| Non-numeric text (e.g. `auth-refactor`) | macro | Topic impact surface |
| No positional arg + roadmap | micro | Milestone-wide |
| No positional arg + no roadmap | macro | Fallback |
| `--gaps [ISS-ID]` | gaps | Issue root cause analysis |

Output directory format, artifact registration schema, and output artifact listing are defined in workflow analyze.md (Output Structure section).

### Pre-load

1. **Codebase docs**: IF `.workflow/codebase/doc-index.json` exists → Read ARCHITECTURE.md for module boundaries
2. **Specs**: `maestro spec load --category arch` — load architecture constraints
3. **Wiki search**: `maestro search "{topic keywords}" --json` → top 5-10 entries as prior knowledge
4. All optional — proceed without if unavailable (log warning)

### Role Knowledge
`maestro search --category debug` → select relevant → `maestro wiki load`
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (strict order): scope (phase / topic / milestone-wide / adhoc / --gaps) → depth (quick / standard / deep) → dimensions (which of the 6 to keep) → Go/No-Go threshold
**Scope guard**: only analyze decisions; do not prejudge plan/execute concerns
**Writeback target**: discussion.md (top table) + context.md "Interview Decisions"
**Additional search sources**: issues.jsonl (--gaps mode), roadmap.md
**Additional skip conditions**: input is already specific (explicit phase number or unambiguous topic)
**Exit condition**: all decision points settled → finalize session metadata
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/analyze.md' completely.

### Core Principle: Evidence-Backed Decisions

Every decision produced by this command MUST be traceable to independently gathered evidence. Manual file reading (Read/Grep by the orchestrator) is preparation, NOT evidence. Evidence comes from:
- cli-explore-agent output (code anchors, call chains, data flows)
- maestro delegate CLI analysis output (multi-perspective findings)
- User-provided input (domain knowledge, constraints, corrections)

A decision without at least one CLI/agent-sourced evidence item is LOW CONFIDENCE and MUST be flagged as such.

### Standard Mode Phase Gates (when `-q` and `--gaps` are BOTH absent)

These gates are MANDATORY and BLOCKING. Do NOT advance past a gate until ALL conditions are met. Do NOT substitute manual Read/Grep for agent/CLI exploration.

**GATE 1: Step 4 → Step 5** (Exploration → Discussion)
- REQUIRED: cli-explore-agent spawned and completed (Step 4.1). Output written to `exploration-codebase.json` with ≥1 code anchor.
- REQUIRED: At least one maestro delegate CLI call completed (Step 4.2). Output aggregated into `explorations.json` or `perspectives.json`.
- REQUIRED: Baseline confidence scoring recorded in discussion.md (Step 4.6).
- BLOCKED if any missing: complete Step 4 before proceeding.

**GATE 2: Step 5 → Step 6** (Discussion → Scoring)
- REQUIRED: discussion.md contains ≥1 interactive round with user feedback (Step 5.3).
- REQUIRED: Confidence re-scored ≥1 time with delta shown (Step 5.8).
- REQUIRED: Pressure pass completed ≥1 time (Step 5.9).
- BLOCKED if any missing: continue discussion rounds.

**GATE 3: Step 6 → Step 7** (Scoring → Synthesis)
- REQUIRED: analysis.md written with all 6 dimensions scored.
- REQUIRED: Each dimension score cites evidence from exploration-codebase.json or explorations.json — NOT from orchestrator's manual file reading.
- BLOCKED if any missing: complete scoring first.

**GATE 4: Step 7 → Step 8** (Synthesis → Decision Extraction)
- REQUIRED: conclusions.json written with recommendations and decision trail.
- REQUIRED: Intent Coverage Matrix shows no unresolved ❌ items (or user-confirmed deferrals).
- BLOCKED if any missing: complete synthesis first.

### Artifact Verification

Before writing the completion report (Step 9), verify ALL expected artifacts exist in OUTPUT_DIR:
```
FULL_MODE_REQUIRED = [
  "discussion.md",           // Step 3+5
  "exploration-codebase.json", // Step 4.1
  "explorations.json" OR "perspectives.json", // Step 4.3
  "analysis.md",             // Step 6
  "conclusions.json",        // Step 7
  "context.md",              // Step 8
  "context-package.json"     // Step 8.6
]
```
If any artifact is missing: DO NOT report completion. Go back and produce the missing artifact.

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
</execution>

<completion>
### Standalone report

```
=== ANALYSIS READY ===
Artifact: ANL-{id}
Scope: {micro|macro|adhoc|gaps}
Go/No-Go: {GO|NO-GO|CONDITIONAL}
Confidence: {high|medium|low}
Outputs: analysis.md, context.md, conclusions.json, discussion.md
Session dir: {output_dir}
===
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Phase/Milestone scope, Go, UI work needed | `/maestro-impeccable build {target}` |
| Phase/Milestone scope, Go, ready to plan | `/maestro-plan` or `/maestro-plan {phase}` |
| Phase/Milestone scope, No-Go | Revisit requirements or `/maestro-brainstorm {topic}` |
| Macro/Adhoc, scope_verdict = large | `/maestro-roadmap --from analyze:ANL-xxx` |
| Macro/Adhoc, scope_verdict = medium/small | `/maestro-plan --from analyze:ANL-xxx` |
| Need more exploration | `/maestro-analyze {topic} -c` |
| Gaps scope, issues analyzed | `/maestro-plan --gaps` |
| Gaps scope, need more context | `/maestro-analyze --gaps {ISS-ID}` |

### Session seal

@~/.maestro/workflows/finish-work.md — SESSION_DIR=OUTPUT_DIR, SESSION_TYPE=analyze, SESSION_ID={artifact_id}, LINKED_MILESTONE={target_milestone or null}
</completion>

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

