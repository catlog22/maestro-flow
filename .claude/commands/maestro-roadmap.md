---
name: maestro-roadmap
description: Interactive roadmap creation with iterative refinement — lightweight alternative to spec-generate
argument-hint: "<requirement> [-y] [-c] [-m progressive|direct|auto] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]"
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
Create or revise a project roadmap through interactive requirement decomposition and iterative refinement. This is the lightweight path for structured decomposition — directly from requirements to roadmap without full specification documents. For the heavy path with formal specs, use maestro-spec-generate instead.

Supports three modes:
- **Create** (default): Build roadmap from requirements
- **Revise** (`--revise`): Modify existing roadmap while preserving completed phase progress
- **Review** (`--review`): Health assessment of current roadmap — actual vs planned, drift detection, adjustment recommendations (read-only)

Produces `.workflow/roadmap.md` with milestone/phase structure ready for maestro-plan.
</purpose>

<required_reading>
@~/.maestro/workflows/roadmap.md
@~/.maestro/templates/roadmap.md
</required_reading>

<context>
$ARGUMENTS -- requirement text, @file reference, or brainstorm session reference.

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive questions, use recommended defaults
- `-c` / `--continue`: Resume from last checkpoint
- `-m progressive|direct|auto`: Decomposition strategy (default: auto)
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md from a brainstorm session as seed
- `--revise [instructions]`: Revise existing roadmap. If instructions provided, apply directly (e.g. `--revise "add phase 4 for perf optimization"` or `--revise "split phase 2 into 2a and 2b"`). If omitted, ask user for revision instructions via AskUserQuestion. Preserves completed phase progress.
- `--review`: Roadmap health assessment — compare actual vs planned progress, detect drift, assess remaining phases (read-only, produces review report)

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Brainstorm import: `--from-brainstorm WFS-xxx`
- No args + `--revise` / `--review`: Operate on existing `.workflow/roadmap.md`

**Relationship to pipeline:**
```
maestro-brainstorm (optional upstream)
        ↓ guidance-specification.md
maestro-init (project setup — no roadmap)
        ↓ project.md, state.json, config.json
maestro-roadmap (this command — light path)
        ↓ roadmap.md → .workflow/roadmap.md
maestro-plan → maestro-execute → maestro-verify

Alternative heavy path (skip maestro-roadmap):
maestro-init → maestro-spec-generate → spec package + roadmap.md
```

Dual modes (Progressive vs Direct), auto-selection criteria, and minimum-phase principle are defined in workflow roadmap.md (Steps 2-3).
</context>

<execution>

### Mode: Create (default)

Follow '~/.maestro/workflows/roadmap.md' completely.

**Next-step routing on completion:**
- Roadmap approved → /maestro-analyze 1
- Simple project, skip analysis → /maestro-plan 1
- Need UI design first → /maestro-ui-design 1
- View project dashboard → /manage-status

### Mode: Revise (`--revise [instructions]`)

Follow workflow roadmap.md "Mode: Revise" section for full algorithm (load state, obtain instructions, impact analysis, apply revisions, post-validation).

### Mode: Review (`--review`)

Follow workflow roadmap.md "Mode: Review" section for full algorithm (load state, assess dimensions, produce report).
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement text or @file required | Prompt user for input |
| E002 | error | Brainstorm session not found (--from-brainstorm) | Show available sessions |
| E003 | error | Circular dependency detected in phases | Prompt user to re-decompose |
| E004 | error | roadmap.md not found (--revise/--review) | Run maestro-roadmap first |
| E005 | error | Revision invalidates completed phase work | Warn user, ask to confirm or adjust |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Max refinement rounds (5) reached | Force proceed with current roadmap |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
</error_codes>

<success_criteria>
- [ ] Requirement parsed with goal, constraints, stakeholders
- [ ] Decomposition strategy selected (progressive or direct)
- [ ] Phases defined with success criteria, dependencies, and requirement mappings
- [ ] Every Active requirement from project.md mapped to exactly one phase
- [ ] No circular dependencies in phase ordering
- [ ] User approved roadmap (or auto-approved with -y)
- [ ] `.workflow/roadmap.md` written with phase details, scope decisions, and progress table
- [ ] No phase directories created (phases are labels in roadmap, not directories)
</success_criteria>
