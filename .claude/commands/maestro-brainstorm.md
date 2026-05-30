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
- `--yes` / `-y`: Auto mode, skip interactive questions, use defaults
- `--count N`: Number of roles to select (default 3, max 9)
- `--session ID`: Use existing session
- `--update`: Update existing analysis (single role)
- `--skip-questions`: Skip context gathering questions
- `--include-questions`: Force context gathering even if analysis exists
- `--style-skill PKG`: Style package for ui-designer role

### Pre-load specs
1. **Architecture specs**: Run `maestro spec load --category arch` to load architecture constraints. Use as context for multi-role analysis — ensures roles respect documented decisions.
2. Optional — proceed without if unavailable.

### Role Knowledge
1. Browse accumulated knowledge for this role:
   `maestro wiki list --category arch`
2. Analyze the index, identify entries relevant to the current task
3. Load selected documents:
   `maestro wiki load <id1> [id2] [id3...]`
4. Review loaded knowledge before proceeding
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip when `--yes/-y`, `--skip-questions`, `--session` (existing session), or input is already specific.

- One decision per turn via AskUserQuestion with 2–4 options + a (Recommended) default. The user controls termination — keep interviewing until convergence; they can interrupt naturally or via `Other` at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, the session directory, `maestro spec load`, `maestro wiki search`, Glob/Grep/Read, or — for open-ended multi-file scans — spawn `Agent(subagent_type: Explore)` / `maestro delegate ... --role explore`. Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each time a decision settles, immediately append/update its row in `guidance-specification.md` §11 (create the section if absent). Do NOT batch writeback to the end — partial decisions must already be on disk before the next question.
- Branch jumps allowed: the user may switch freely between mode / role / upstream / sub-pipeline branches; sequence is not enforced, but every decision point must end with a definite answer.
- Scope guard: only ask about decisions owned by `brainstorm`. Do not pre-resolve roadmap/plan choices.

Decision points: mode (auto / single-role / review-only) / role selection and `--count` / `--from` upstream source (grill:ID, blueprint:ID, @file, path) / whether to enable design-research and the DESIGN.md sub-pipeline.

Exit: on consensus or explicit user signal to proceed, finalize session metadata. The §11 table (already populated incrementally) uses this schema:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/brainstorm.md' completely.

**Next-step routing on completion:**

Auto mode:
- Project not initialized → Skill({ skill: "maestro-init" })
- Project initialized, need formal spec package → Skill({ skill: "maestro-blueprint", args: "--from brainstorm:{artifact_id}" })
- Project initialized, quick roadmap → Skill({ skill: "maestro-roadmap", args: "--from brainstorm:{artifact_id}" })
- Need deeper analysis first → Skill({ skill: "maestro-analyze", args: "{topic} --from brainstorm:{artifact_id}" })
- Need stress-testing first → Skill({ skill: "maestro-grill", args: "{topic}" })
- `html-prototypes/` produced with 2+ files and user wants to browse → load `~/.maestro/workflows/brainstorm-visualize.md` and launch visualizer server (optional, user-triggered)
- DESIGN.md established during Step 3.5 → suggest: "Run `/maestro-impeccable build <feature-description>` to build with the established design system"

Single role mode:
- More roles needed → Skill({ skill: "maestro-brainstorm", args: "{next_role} --session {session_id}" })
- All roles done, run synthesis → Skill({ skill: "maestro-brainstorm", args: "{topic} --session {session_id}" })
</execution>

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
