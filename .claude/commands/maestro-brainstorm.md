---
name: maestro-brainstorm
description: Unified brainstorming with dual-mode operation - auto pipeline and single role analysis
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
Unified brainstorming combining interactive framework generation, multi-role parallel analysis, and cross-role synthesis. Two modes: Auto (full pipeline with guidance-specification → parallel role analysis → synthesis) and Single Role (individual role analysis for an existing session). Outputs structured artifacts in .brainstorming/ directory ready for downstream planning.
</purpose>

<required_reading>
@~/.maestro/workflows/brainstorm.md
</required_reading>

<deferred_reading>
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
- [index.json](~/.maestro/templates/index.json) — read when operating in phase mode
</deferred_reading>

<context>
$ARGUMENTS -- topic text for auto mode, or role name for single role mode.

**Auto mode**: topic text (e.g., "Build real-time collaboration platform") triggers full pipeline.
**Single role mode**: valid role name (e.g., "system-architect") runs one role analysis.
**Phase mode** (number): resolves phase directory, creates .brainstorming/ inside it.
**Scratch mode** (text): creates `.workflow/scratch/brainstorm-{slug}-{date}/`.

**Valid roles**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert

**Flags**:
- `--yes` / `-y`: Auto mode, skip interactive questions, use defaults
- `--count N`: Number of roles to select (default 3, max 9)
- `--session ID`: Use existing session
- `--update`: Update existing analysis (single role)
- `--skip-questions`: Skip context gathering questions
- `--include-questions`: Force context gathering even if analysis exists
- `--style-skill PKG`: Style package for ui-designer role
</context>

<execution>
Follow '~/.maestro/workflows/brainstorm.md' completely.

**Next-step routing on completion:**

Auto mode:
- Project not initialized → Skill({ skill: "maestro-init" })
- Project initialized, need spec package → Skill({ skill: "maestro-spec-generate", args: "--from-brainstorm {session_id}" })
- Project initialized, quick roadmap → Skill({ skill: "maestro-roadmap", args: "--from-brainstorm {session_id}" })
- Need deeper analysis first → Skill({ skill: "maestro-analyze", args: "{topic}" })
- `html-prototypes/` produced and user wants interactive A/B/C review → suggest Skill({ skill: "maestro-brainstorm-visualize", args: "--session {session_id}" }) (optional, user-triggered)

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
| W001 | warning | Fewer than 10 ideas in divergent phase | Proceed with available ideas |
| W002 | warning | Project context (.workflow/) not found | Continue without project context |
| W003 | warning | Role template not found | Use generic analysis structure |
| W004 | warning | Validation score < 60 | Log warning, suggest manual review |
| W005 | warning | External research agent failed | Continue without designResearchContext |
</error_codes>

<success_criteria>
**Auto mode**:
- [ ] guidance-specification.md with RFC 2119 keywords, terminology, non-goals, feature decomposition
- [ ] design-research.md persisted when Step 1.7 external research ran (fail-soft: absence not a failure)
- [ ] Spec Review Gate passed (Step 3.5) or `--yes` bypassed
- [ ] Role analysis files for each selected NON-UI role in `.brainstorming/{role}/`
- [ ] If `ui-designer` in selected_roles: `ui-designer/analysis.md` exists AND exactly one of `html-prototypes/` / `ascii-mockups/` / `api-sketches/` exists with `README.md` + ≥1 prototype file
- [ ] ui-designer/analysis.md references each prototype via `@-notation`
- [ ] HTML prototypes are self-contained (no external `<link>`/`<script src>` URLs — warn only)
- [ ] Feature specs in `.brainstorming/feature-specs/` (or synthesis-specification.md)
- [ ] UI-bearing feature specs reference the corresponding prototype in Section 3 (Interface Contract)
- [ ] feature-index.json and synthesis-changelog.md
- [ ] Final Output Gate passed (Step 5.5) or `--yes` bypassed
- [ ] All user decisions captured with Decision Recording Protocol
- [ ] Session metadata updated with completion status

**Single role mode**:
- [ ] analysis.md written to `{output_dir}/{role}/`
- [ ] Feature-point organization used when feature list available
- [ ] Framework reference included when guidance-specification.md exists
- [ ] Session metadata updated
</success_criteria>
