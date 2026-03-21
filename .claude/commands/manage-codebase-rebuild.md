---
name: manage-codebase-rebuild
description: Full rebuild of codebase documentation - scans project, builds doc-index.json, generates all tech-registry and feature-maps
argument-hint: "[--force] [--skip-commit]"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion]
---

<purpose>
Perform a full rebuild of the .workflow/codebase/ documentation system from scratch. Scans the entire project source to identify components, features, requirements, and ADRs, then spawns parallel workflow-codebase-mapper agents to generate all documentation artifacts. This is a destructive operation that overwrites existing codebase docs.
</purpose>

<required_reading>
@~/.maestro/workflows/codebase-rebuild.md
</required_reading>

<context>
$ARGUMENTS -- optional flags.

**Flags:**
- `--force` -- Skip confirmation prompt and proceed directly
- `--skip-commit` -- Do not auto-commit after rebuild

**State files:**
- `.workflow/` -- must be initialized (project.md, state.json exist)
- `.workflow/codebase/` -- target directory (will be cleared and rebuilt)
- `.workflow/codebase/doc-index.json` -- generated documentation index
</context>

<execution>
Follow '~/.maestro/workflows/codebase-rebuild.md' completely.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run maestro-init first to create .workflow/ |
| W001 | warning | A mapper agent failed (partial results) | Retry failed mapper or accept partial results |
</error_codes>

<success_criteria>
- [ ] User confirmed rebuild (or --force used)
- [ ] .workflow/codebase/ cleared and rebuilt from scratch
- [ ] All 4 mapper agents spawned (failures logged as W001)
- [ ] doc-index.json generated and valid
- [ ] All documentation files regenerated
- [ ] state.json updated with rebuild timestamp
- [ ] project-tech.json refreshed with detected tech stack
- [ ] project.md Tech Stack section updated if changes detected
- [ ] Next step routing: Skill({ skill: "manage-status" }) or Skill({ skill: "manage-codebase-refresh" }) for incremental updates later
</success_criteria>
