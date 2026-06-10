---
name: maestro-brainstorm
description: Use when exploring ideas, evaluating approaches, or needing multi-perspective analysis before implementation
argument-hint: "[topic|role-name] [--yes] [--count N] [--session ID] [--update] [--skip-questions] [--include-questions] [--style-skill PKG]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Unified brainstorming combining interactive framework generation, multi-role parallel analysis, cross-role review, and resolution writeback. Two modes: Auto (full pipeline: guidance-specification → parallel {role}/ multi-file analysis → cross-role-reviewer compares Decision Digests for conflicts/gaps/synergies → user-confirmed resolutions patched into role files + logged in guidance §12) and Single Role (individual role analysis for an existing session). Outputs structured artifacts in `.workflow/scratch/{YYYYMMDD}-brainstorm-{slug}/` ready for downstream planning (roadmap / analyze / blueprint consume `guidance-specification.md`).

Pipeline position: downstream of maestro-grill (optional stress-test). Upstream of maestro-roadmap, maestro-analyze, and maestro-blueprint (all consume brainstorm output).
</purpose>

<required_reading>
@~/.maestro/workflows/brainstorm.md
</required_reading>

<deferred_reading>
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
- [index.json](~/.maestro/templates/index.json) — read when operating in phase mode
- [brainstorm-visualize.md](~/.maestro/workflows/brainstorm-visualize.md) — read when html-prototypes/ produced and user wants to browse them
</deferred_reading>

<context>
$ARGUMENTS -- topic text for auto mode, or role name for single role mode.

**Auto mode**: topic text (e.g., "Build real-time collaboration platform") triggers full pipeline.
**Single role mode**: valid role name (e.g., "system-architect") runs one role analysis.
**All output** goes to `.workflow/scratch/{YYYYMMDD}-brainstorm-{slug}/` (orchestrator MUST resolve this to an absolute path before passing to sub-agents).
**Artifact registration**: On completion, registers artifact (type=brainstorm) in state.json.
**Output boundary**: ALL file writes MUST target `{output_dir}/` or `.workflow/state.json` only. NEVER modify source code or files outside these paths.
**Produced files**: `guidance-specification.md`, `design-research.md` (optional), `{role}/analysis.md` + `{role}/analysis-F-*.md` + `{role}/findings-*.md` (per selected role).

**Valid roles**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert

**Flags**:

| Flag | Effect | Default |
|------|--------|---------|
| `--yes` / `-y` | Auto mode — skip interactive questions, use defaults | false |
| `--count N` | Number of roles to select (max 9) | 3 |
| `--session ID` | Use existing session | — |
| `--update` | Update existing analysis (single role) | false |
| `--skip-questions` | Skip context gathering questions | false |
| `--include-questions` | Force context gathering even if analysis exists | false |
| `--style-skill PKG` | Style package for ui-designer role | — |

### Pre-load specs
1. **Architecture specs**: Run `maestro spec load --category arch` to load architecture constraints. Use as context for multi-role analysis — ensures roles respect documented decisions.
2. Optional — proceed without if unavailable.

### Role Knowledge
1. Browse accumulated knowledge for this role:
   `maestro search --category arch`
2. Analyze the index, identify entries relevant to the current task
3. Load selected documents:
   `maestro wiki load <id1> [id2] [id3...]`
4. Review loaded knowledge before proceeding
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven
**Decision tree** (flexible order — user may jump between branches): mode (auto / single-role / review-only) → role selection and --count → --from upstream source (grill:ID, blueprint:ID, @file, path) → whether to enable design-research and DESIGN.md sub-pipeline
**Scope guard**: only brainstorm decisions; do not pre-resolve roadmap/plan choices
**Writeback target**: guidance-specification.md §11 (create section if absent)
**Additional skip conditions**: --skip-questions, --session (existing session)
**Exit condition**: on consensus or explicit user signal → finalize session metadata
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/brainstorm.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

These gates apply to Auto mode (full pipeline). Do NOT advance past a gate until ALL conditions are met.

**GATE 1: Framework → Role Analysis** (Step 1 → Step 3)
- REQUIRED: `guidance-specification.md` written with §10 feature decomposition and RFC 2119 keywords.
- REQUIRED: Role selection completed (interactive or auto-default).
- BLOCKED if missing: complete framework generation before spawning role agents.

**GATE 2: Role Analysis → Cross-Role Review** (Step 3 → Step 4.5)
- REQUIRED: Every selected role has `{role}/analysis.md` with §2 Decision Digest (4 tables).
- REQUIRED: Per-feature files `{role}/analysis-F-*.md` written for each feature in §10.
- BLOCKED if missing: complete all role analyses before spawning cross-role-reviewer.

**GATE 3: Cross-Role Review → Completion** (Step 4.5 → Report)
- REQUIRED: Cross-role-reviewer output received with `patch_targets[]`.
- REQUIRED: If findings > 0, resolutions applied via Edit AND logged in `guidance-specification.md` §12.
- REQUIRED: If findings == 0, final report explicitly states "No cross-role issues detected".
- BLOCKED if missing: complete review synthesis before reporting.

### Artifact Verification (before completion report)

```
AUTO_MODE_REQUIRED = [
  "guidance-specification.md",            // Step 1
  "{role}/analysis.md" (per selected role), // Step 3
  "{role}/analysis-F-*.md" (per feature),   // Step 3
]
```
If any artifact is missing: DO NOT report completion. Go back and produce the missing artifact.

### Evidence Requirement

Role analysis findings in `{role}/analysis.md` §2 Decision Digest MUST cite concrete evidence:
- Code references (file:line), API endpoints, data models from the codebase
- User-provided constraints from interview
- Cross-role references to other role analyses
Decisions without evidence are flagged LOW CONFIDENCE.
</execution>

<completion>
### Standalone report

```
=== BRAINSTORM READY ===
Session: {session_id}
Output:  {output_dir}
Mode:    {auto|single-role}
Roles:   {selected_roles}
Findings: {review_findings_count} cross-role issues, {resolutions_applied} resolutions applied
Status:  COMPLETE
========================
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

**Auto mode:**

| Condition | Suggestion |
|-----------|-----------|
| Project not initialized | `/maestro-init` |
| Need formal spec package | `/maestro-blueprint --from brainstorm:{artifact_id}` |
| Quick roadmap needed | `/maestro-roadmap --from brainstorm:{artifact_id}` |
| Need deeper analysis first | `/maestro-analyze {topic} --from brainstorm:{artifact_id}` |
| Need stress-testing first | `/maestro-grill {topic}` |
| `html-prototypes/` produced with 2+ files and user wants to browse | Load `~/.maestro/workflows/brainstorm-visualize.md` and launch visualizer server |
| DESIGN.md established during Step 3.5 | `/maestro-impeccable build <feature-description>` |

**Single role mode:**

| Condition | Suggestion |
|-----------|-----------|
| More roles needed | `/maestro-brainstorm {next_role} --session {session_id}` |
| All roles done, run synthesis | `/maestro-brainstorm {topic} --session {session_id}` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Topic or role argument required | Prompt user for topic text or role name |
| E002 | error | No active session for single role mode | Guide user to run auto mode first |
| E003 | error | Invalid role name | Show valid roles list |
| E006 | error | `--review-only` but no `{role}/analysis.md` found | Run auto or single-role mode first |
| E007 | error | `--review-only` but `guidance-specification.md` missing | Run auto mode to generate guidance first |
| W001 | warning | Fewer than 10 ideas in divergent phase | Proceed with available ideas |
| W002 | warning | Project context (.workflow/) not found | Continue without project context |
| W003 | warning | Role template not found | Use generic analysis structure |
| W004 | warning | Validation score < 60 | Log warning, suggest manual review |
| W005 | warning | External research agent failed | Continue without designResearchContext |
| W006 | warning | Reviewer patch_targets heading drift (no match) | Skip that patch; report in final summary |
</error_codes>

<success_criteria>
**Auto mode**:
- [ ] Interactive mode: interview decision table written to `guidance-specification.md` §11 and session metadata
- [ ] `guidance-specification.md` with RFC 2119 keywords, terminology, non-goals, feature decomposition (§10), decision tracking (§11), cross-role resolutions placeholder (§12)
- [ ] `design-research.md` persisted when Step 1.7 external research ran (fail-soft: absence not a failure)
- [ ] If `ui-designer` in selected_roles AND Step 3.5 ran: `.workflow/impeccable/DESIGN.md` exists (visual style established via impeccable explore)
- [ ] `{role}/analysis.md` written for each selected role, containing §2 Decision Digest (4 tables) + §3 Cross-Cutting Foundations + §4 File Index
- [ ] `{role}/analysis-F-{id}-{slug}.md` written per feature (one file per feature, < 2000 words)
- [ ] `system-architect/analysis.md` §3 includes Data Model + State Machine when system-architect is selected
- [ ] `ui-designer/analysis.md` references DESIGN.md visual constraints when ui-designer is selected
- [ ] Each `{role}/analysis.md` §2 Decisions table has ≥ 1 row per feature
- [ ] Cross-role review (Step 4.5) executed; reviewer compares §2 Decision Digests; output includes `patch_targets[]` for every finding
- [ ] If findings exist: each accepted resolution applied via Edit (annotate / strikeout / append) AND logged in `guidance-specification.md` §12 "Cross-Role Resolutions"
- [ ] If zero findings: final report explicitly states "No cross-role issues detected"; guidance §12 unchanged
- [ ] Heading-drift patch failures surfaced in final report (if any)
- [ ] Session metadata updated with completion status (review_findings_count, resolutions_applied, patches_skipped)

**Single role mode**:
- [ ] `{role}/analysis.md` written with §2 Decision Digest + §4 File Index
- [ ] `{role}/analysis-F-*.md` written when guidance §10 feature list available
- [ ] §2 Decisions table references guidance decision IDs
- [ ] Session metadata updated
- [ ] Session sealed via finish-work (auto mode only)
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR={output_dir}, SESSION_TYPE=brainstorm, SESSION_ID={artifact_id}, LINKED_MILESTONE=null
</on_complete>
