---
name: maestro-roadmap
description: Interactive roadmap creation with iterative refinement — lightweight alternative to spec-generate
argument-hint: "<requirement> [-y] [-c] [-m progressive|direct|auto] [--from-brainstorm SESSION-ID]"
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
Create a project roadmap through interactive requirement decomposition and iterative refinement. This is the lightweight path for structured decomposition — directly from requirements to roadmap without full specification documents. For the heavy path with formal specs, use maestro-spec-generate instead.

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

**Input types:**
- Direct text: `"Implement user authentication system with OAuth and 2FA"`
- File reference: `@requirements.md`
- Brainstorm import: `--from-brainstorm WFS-xxx`

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

**Dual modes:**
| Mode | Strategy | Best For |
|------|----------|----------|
| Progressive | MVP → Usable → Refined (as **Milestones**, each with 1-2 phases) | High uncertainty, need validation |
| Direct | Topological task sequence (1-2 phases, wave DAG handles ordering) | Clear requirements, confirmed tech |

Auto-selection: ≥3 high uncertainty factors → Progressive, ≥3 low → Direct, else → ask user.

**Minimum-phase principle:** Default 1 phase per milestone. Only split into 2 phases when hard dependency exists (runtime + not parallelizable + full barrier). Max 2 phases, exceptional 3 with justification.
</context>

<execution>
Follow '~/.maestro/workflows/roadmap.md' completely.

**Next-step routing on completion:**
- Roadmap approved → Skill({ skill: "maestro-analyze", args: "1" })
- Simple project, skip analysis → Skill({ skill: "maestro-plan", args: "1" })
- Need UI design first → Skill({ skill: "maestro-ui-design", args: "1" })
- View project dashboard → Skill({ skill: "manage-status" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Requirement text or @file required | Prompt user for input |
| E002 | error | Brainstorm session not found (--from-brainstorm) | Show available sessions |
| E003 | error | Circular dependency detected in phases | Prompt user to re-decompose |
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
- [ ] Phase directories created under `.workflow/phases/`
</success_criteria>
