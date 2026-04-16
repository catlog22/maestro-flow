---
name: manage-codebase-rebuild
description: Full rebuild of codebase documentation - scans project, builds doc-index.json, generates all tech-registry and feature-maps
argument-hint: "[--focus <area>] [--force] [--skip-commit]"
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
Perform a full rebuild of the .workflow/codebase/ documentation system from scratch. Scans the entire project source to identify components, features, requirements, and ADRs, then spawns parallel workflow-codebase-mapper agents to generate all documentation artifacts. This is a destructive operation that overwrites existing codebase docs.

Can run before or after Skill({ skill: "maestro-init" }) -- works on any codebase with source files. Also serves the previous `spec-map` use case via `--focus <area>` for scoped dimension analysis.
</purpose>

<required_reading>
@~/.maestro/workflows/codebase-rebuild.md
</required_reading>

<context>
$ARGUMENTS -- optional flags.

**Flags:**
- `--focus <area>` -- Scope mapper agents to a single domain (e.g., `auth`, `api`, `database`). When omitted, all 4 mappers run on the full codebase.
- `--force` -- Skip confirmation prompt and proceed directly
- `--skip-commit` -- Do not auto-commit after rebuild

**Mapper agent assignments (when `--focus` omitted):**
| Agent | Focus | Output file |
|-------|-------|-------------|
| Mapper 1 | **Tech stack** -- languages, frameworks, dependencies, build system | `tech-stack.md` |
| Mapper 2 | **Architecture** -- layers, module boundaries, data flow, entry points | `architecture.md` |
| Mapper 3 | **Features** -- capabilities, API surface, user-facing functionality | `features.md` |
| Mapper 4 | **Cross-cutting concerns** -- error handling, logging, auth, config, testing | `concerns.md` |

**State files:**
- `.workflow/` -- must be initialized (project.md, state.json exist)
- `.workflow/codebase/` -- target directory (will be cleared and rebuilt)
- `.workflow/codebase/doc-index.json` -- generated documentation index
</context>

<execution>
Follow '~/.maestro/workflows/codebase-rebuild.md' completely.

**When `--focus <area>` is set:** pass the area string to each mapper agent as scoping context; only regenerate the docs relevant to that scope (leave others untouched unless missing).

**Next-step routing on completion:**
- View updated project state → Skill({ skill: "manage-status" })
- Incremental updates later → Skill({ skill: "manage-codebase-refresh" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run maestro-init first to create .workflow/ |
| W001 | warning | A mapper agent failed (partial results) | Retry failed mapper or accept partial results |
| W002 | warning | `.workflow/codebase/` already exists -- user prompted for rebuild/skip | check_existing |
</error_codes>

<success_criteria>
- [ ] User confirmed rebuild (or --force used)
- [ ] .workflow/codebase/ cleared and rebuilt from scratch (or scoped subset when --focus set)
- [ ] All 4 mapper agents spawned (failures logged as W001)
- [ ] doc-index.json generated and valid
- [ ] All documentation files regenerated
- [ ] state.json updated with rebuild timestamp
- [ ] project-tech.json refreshed with detected tech stack
- [ ] project.md Tech Stack section updated if changes detected
- [ ] Next step routing: Skill({ skill: "manage-status" }) or Skill({ skill: "manage-codebase-refresh" }) for incremental updates later
</success_criteria>
