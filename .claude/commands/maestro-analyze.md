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
Multi-dimensional analysis of a proposal, decision, or architecture choice via CLI-assisted exploration and interactive discussion. Produces analysis.md (6-dimension scoring), context.md (Locked/Free/Deferred decisions), conclusions.json, and discussion.md with Go/No-Go recommendation. Use `--gaps` for issue root cause analysis feeding `plan --gaps`.
</purpose>

<required_reading>
@~/.maestro/workflows/analyze.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
- [issue-gaps-analyze.md](~/.maestro/workflows/issue-gaps-analyze.md) — read when --gaps is triggered
- [boundary-grill.md](~/.maestro/workflows/boundary-grill.md) — read when boundary conflicts detected (between Phase 4 and Phase 5)
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
2. **Specs**: `maestro load --type spec --category arch` — load architecture constraints
3. **Wiki search**: `maestro search "{topic keywords}" --json` → top 5-10 entries as prior knowledge
4. All optional — proceed without if unavailable (log warning)

### Role Knowledge
`maestro search --category debug` → select relevant → `maestro load --type knowhow --id`
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

### Evidence-Backed Decisions

Every decision MUST trace to independently gathered evidence. Manual Read/Grep is preparation — NOT evidence. Valid evidence sources:
- cli-explore-agent output (code anchors, call chains, data flows)
- maestro delegate CLI analysis output (multi-perspective findings)
- User-provided input (domain knowledge, constraints, corrections)

Decisions without CLI/agent-sourced evidence MUST be flagged as LOW CONFIDENCE.

### Boundary Grill (Step 5 → Step 6)

After discussion rounds, BEFORE synthesis: run boundary grill per `~/.maestro/workflows/boundary-grill.md`.
Input: discussion.md decisions + exploration-codebase.json. Scope guard: "only analyze decisions; do not prejudge plan/execute concerns".
IF conflicts → results to `analysis.md` § Boundary Grill Results + update `context.md` Locked/Free/Deferred.

### Standard Mode Gates

Gates 1-4 are defined in `analyze.md`. NEVER skip gates. NEVER substitute manual Read/Grep for agent/CLI exploration.

### Artifact Verification

Before writing the completion report (Step 9), verify ALL expected artifacts exist in OUTPUT_DIR:
```
FULL_MODE_REQUIRED = [
  "discussion.md",             // Step 3+5
  "exploration-codebase.json", // Step 4.1
  "explorations.json" OR "perspectives.json", // Step 4.3
  "analysis.md",               // Step 6
  "conclusions.json",          // Step 7
  "context.md",                // Step 8
  "context-package.json"       // Step 8.6
]
```
If any artifact is missing: DO NOT report completion. Produce the missing artifact first.

### --gaps Mode

When `--gaps` is present, follow `~/.maestro/workflows/issue-gaps-analyze.md` instead of the standard pipeline.

**Handoff:** context.md is consumed by maestro-plan. In --gaps mode, context.md contains issue root causes for `plan --gaps`.

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
- [ ] Boundary grill executed between Phase 4 and Phase 5 (skip if no conflicts detected)
- [ ] Boundary grill results written to analysis.md § Boundary Grill Results (if conflicts found)
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

