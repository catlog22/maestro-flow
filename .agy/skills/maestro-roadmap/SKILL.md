---
name: maestro-roadmap
description: Generate roadmap with milestone/phase structure from requirements or upstream context
argument-hint: <requirement> [-y] [-c] [-m progressive|direct|auto] [--from <source>] [--revise [instructions]] [--review]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
Generate a milestone/phase roadmap from requirements or upstream context. Produces `.workflow/roadmap.md` with Milestone > Phase hierarchy ready for maestro-analyze and maestro-plan.

Operation modes:
- **Create** (default): Build roadmap from requirements or upstream context
- **Revise** (`--revise`): Modify existing roadmap while preserving completed phase progress
- **Review** (`--review`): Health assessment of current roadmap (read-only)

For formal specification documents (Product Brief, PRD, Architecture, Epics), use `/maestro-blueprint` instead.
</purpose>

<required_reading>
@~/.maestro/workflows/roadmap-common.md
@~/.maestro/templates/roadmap.md
</required_reading>

<deferred_reading>
- [roadmap.md](~/.maestro/workflows/roadmap.md) — read for roadmap generation workflow
</deferred_reading>

<context>
$ARGUMENTS -- requirement text, @file reference, or upstream context source.

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive questions, use recommended defaults
- `-c` / `--continue`: Resume from last checkpoint
- `-m progressive|direct|auto`: Decomposition strategy (default: auto)
- `--from <source>`: Load upstream context package (brainstorm:ID, blueprint:BLP-xxx, analyze:ANL-xxx, @file, or path). Consumes context-package.json
- `--from-brainstorm SESSION-ID`: (backward compat alias for `--from brainstorm:ID`)
- `--revise [instructions]`: Revise existing roadmap. If instructions provided, apply directly. If omitted, ask user. Preserves completed phase progress.
- `--review`: Roadmap health assessment (read-only)

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` or `--from analyze:ANL-xxx` or `--from blueprint:BLP-xxx`
- No args + `--revise` / `--review`: Operate on existing `.workflow/roadmap.md`

**Pipeline position:**
```
maestro-brainstorm ─┐
maestro-blueprint  ─┤ (optional upstream, parallel)
maestro-analyze    ─┘ context-package.json
        ↓
maestro-roadmap → .workflow/roadmap.md (Milestone > Phase hierarchy)
        ↓
maestro-analyze {phase} → maestro-plan → maestro-execute → maestro-verify
```

### Pre-load specs
1. **Architecture specs**: Run `maestro spec load --category arch` to load architecture constraints. Use as context for phase decomposition — ensures roadmap respects documented decisions and boundaries.
2. Optional — proceed without if unavailable.
</context>

<interview_protocol>
Interview the user relentlessly until shared understanding is reached. Active only in interactive mode; skip when `-y/--yes`, `--revise`, `--review`, `-c/--continue`, or input is already specific (clear requirement + mode).

- One decision per turn via ask_question with 2–4 options + a (Recommended) default; every question must include a `Proceed now` option.
- Never ask what code can verify — resolve via `state.json`, existing `roadmap.md`, `project.md`, or `maestro spec load`.
- Walk the decision dependency tree strictly: mode → requirement scope → decomposition strategy → phase dependencies/order. Do not open the next branch until the current one is settled.
- Scope guard: only decide the shape of the roadmap. Do not pre-resolve intra-phase task breakdown — that belongs to `plan`.

Decision points: scope (MVP / complete / phased) → strategy (progressive / direct / auto) → milestone boundaries → phase dependencies and order.

Exit: on consensus or `Proceed now`, append the table below to a `Roadmap Decisions` section at the top of `.workflow/roadmap.md`:
`| # | Decision | Choice | Source (user / code / default) |`
</interview_protocol>

<execution>

1. Read `@~/.maestro/workflows/roadmap-common.md` (always — shared logic)
2. Read `@~/.maestro/workflows/roadmap.md`, follow its process

Sub-modes:
- **Create** (default): Build roadmap from requirements or upstream context
- **Revise** (`--revise`): Follow workflow roadmap.md "Mode: Revise" section
- **Review** (`--review`): Follow workflow roadmap.md "Mode: Review" section

### Next-step routing on completion

| Condition | Suggestion |
|-----------|-----------|
| Roadmap approved, need analysis | /maestro-analyze 1 |
| Simple project, ready to plan | /maestro-plan 1 |
| Need UI design first | /maestro-impeccable build |
| View project dashboard | /manage-status |
| Need formal spec documents | /maestro-blueprint |
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement/idea text or @file required | Prompt user for input |
| E002 | error | Context source not found (--from / --from-brainstorm) | Show available sessions/sources |
| E003 | error | Circular dependency detected in phases | Prompt user to re-decompose |
| E004 | error | roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| E005 | error | Revision invalidates completed phase work | Warn user, ask to confirm or adjust |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Max refinement rounds (5) reached | Force proceed with current roadmap |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decision table appended to `.workflow/roadmap.md` "Roadmap Decisions" section
- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Milestones defined with deliverable targets and version tags
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] Phases defined within milestones with success criteria, dependencies, and requirement mappings
- [ ] Every Active requirement from project.md mapped to exactly one phase
- [ ] No circular dependencies in phase ordering
- [ ] User approved roadmap (or auto-approved with -y)
- [ ] `.workflow/roadmap.md` written with Milestone > Phase hierarchy, scope decisions, and progress table
- [ ] No phase directories created (phases are labels in roadmap, not directories)
- [ ] Artifact registered in state.json with milestone entries
</success_criteria>
