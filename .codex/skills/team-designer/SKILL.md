---
name: team-designer
description: Meta-skill for generating team skills following the v4 architecture
  pattern. Produces complete skill packages with SKILL.md router, coordinator,
  worker roles, specs, and templates. Triggers on "team-designer", "design
  team".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - mcp__maestro__team_msg
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - wait_agent
session-mode: none
version: 0.5.50
---

# Team Skill Designer

Generate complete team skills following the team-lifecycle-v4 architecture: SKILL.md as universal router, coordinator with beat model, worker roles with optional commands/, shared specs, and templates.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Team Skill Designer (SKILL.md)                                  │
│  → Orchestrator: gather requirements, generate files, validate   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
    ┌───────────┬───────────┼───────────┬───────────┐
    ↓           ↓           ↓           ↓
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Phase 1 │ │ Phase 2 │ │ Phase 3 │ │ Phase 4 │
│ Require │ │ Scaffold│ │ Content │ │ Valid   │
│ Analysis│ │  Gen    │ │  Gen    │ │ & Report│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
     ↓           ↓           ↓           ↓
  teamConfig  SKILL.md    roles/      Validated
              + dirs     specs/       skill pkg
                         templates/
```

## Key Design Principles

1. **v4 Architecture Compliance**: Generated skills follow team-lifecycle-v4 pattern — SKILL.md = pure router, beat model = coordinator-only, unified structure (roles/ + specs/ + templates/)
2. **Golden Sample Reference**: Uses `team-lifecycle-v4` as reference implementation at `~  or <project>/.codex/skills/team-lifecycle-v4/`
3. **Intelligent Commands Distribution**: Auto-determines which roles need `commands/` (2+ commands) vs inline logic (1 command)
4. **team-worker Compatibility**: Role.md files include correct YAML frontmatter for team-worker agent parsing

## Pre-load (before execution)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
3. **Wiki knowledge**: `maestro search "skill design team architecture" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable

## Execution Flow

```
Input Parsing:
   └─ Parse user requirements (skill name, roles, pipelines, domain)

Phase 1: Requirements Analysis
   └─ Ref: phases/01-requirements-analysis.md
      ├─ Tasks: Detect input → Gather roles → Define pipelines → Build teamConfig
      └─ Output: teamConfig

Phase 2: Scaffold Generation
   └─ Ref: phases/02-scaffold-generation.md
      ├─ Tasks: Create dirs → Generate SKILL.md router → Verify
      └─ Output: SKILL.md + directory structure

Phase 3: Content Generation
   └─ Ref: phases/03-content-generation.md
      ├─ Tasks: Coordinator → Workers → Specs → Templates
      └─ Output: roles/**/*.md, specs/*.md, templates/*.md

Phase 4: Validation
   └─ Ref: phases/04-validation.md
      └─ Output: Validation report (PASS/REVIEW/FAIL)

Return:
   └─ Summary with skill location and usage instructions
```

**Phase Reference Documents** (read on-demand when phase executes):

| Phase | Document | Purpose |
|-------|----------|---------|
| 1 | [phases/01-requirements-analysis.md](phases/01-requirements-analysis.md) | Gather team skill requirements, build teamConfig |
| 2 | [phases/02-scaffold-generation.md](phases/02-scaffold-generation.md) | Generate SKILL.md router and directory structure |
| 3 | [phases/03-content-generation.md](phases/03-content-generation.md) | Generate coordinator, workers, specs, templates |
| 4 | [phases/04-validation.md](phases/04-validation.md) | Validate structure, references, and consistency |

## Golden Sample

Generated skills follow the architecture of `~  or <project>/.codex/skills/team-lifecycle-v4/`:

```
.claude/skills/<skill-name>/
├── SKILL.md                              # Universal router (all roles read)
├── roles/
│   ├── coordinator/
│   │   ├── role.md                       # Orchestrator + beat model + entry router
│   │   └── commands/
│   │       ├── analyze.md                # Task analysis
│   │       ├── dispatch.md               # Task chain creation
│   │       └── monitor.md                # Beat control + callbacks
│   ├── <inline-worker>/
│   │   └── role.md                       # Phase 2-4 embedded (simple role)
│   └── <command-worker>/
│       ├── role.md                       # Phase 2-4 dispatcher
│       └── commands/
│           ├── <cmd-1>.md
│           └── <cmd-2>.md
├── specs/
│   ├── pipelines.md                      # Pipeline definitions + task registry
│   └── <domain-specs>.md                 # Domain-specific specifications
└── templates/                            # Optional document templates
```

## Data Flow

```
User Input (skill name, roles, pipelines)
    ↓
Phase 1: Requirements Analysis
    ↓ Output: teamConfig
    ↓
Phase 2: Scaffold Generation
    ↓ Input: teamConfig
    ↓ Output: SKILL.md + skillDir
    ↓
Phase 3: Content Generation
    ↓ Input: teamConfig + skillDir
    ↓ Output: roles/, specs/, templates/
    ↓
Phase 4: Validation
    ↓ Input: teamConfig + all files
    ↓ Output: validation report
    ↓
Return summary to user
```

## Core Rules

1. **Start Immediately**: First action is Phase 1 execution
2. **Parse Every Output**: Extract teamConfig from Phase 1 for subsequent phases
3. **Auto-Continue**: After each phase, automatically execute next phase
4. **Progressive Phase Loading**: Read phase docs ONLY when that phase is about to execute
5. **Golden Sample Fidelity**: Generated files must match team-lifecycle-v4 patterns
6. **DO NOT STOP**: Continuous workflow until all 4 phases complete

## Input Processing

Convert user input to structured format:

```
SKILL_NAME: [kebab-case name, e.g., team-code-review]
DOMAIN: [what this team does, e.g., "multi-stage code review with security analysis"]
ROLES: [worker roles beyond coordinator, e.g., "analyst, reviewer, security-expert"]
PIPELINES: [pipeline types and flows, e.g., "review-only: SCAN-001 → REVIEW-001 → REPORT-001"]
SESSION_PREFIX: [3-4 char, e.g., TCR]
```

## Error Handling

- **Invalid role name**: Must be lowercase alphanumeric with hyphens, max 20 chars
- **Circular dependencies**: Detect and report in pipeline validation
- **Missing golden sample**: Fall back to embedded templates in phase files
- **Directory conflict**: Warn if skill directory already exists, ask user to confirm overwrite
