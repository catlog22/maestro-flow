---
name: team-interactive-craft
description: Unified team skill for interactive component crafting. Vanilla JS + CSS interactive components with zero dependencies. Research -> interaction design -> build -> a11y test. Uses team-worker agent architecture. Triggers on "team interactive craft", "interactive component".
allowed-tools: Agent, AskUserQuestion, Read, Write, Edit, Bash, Glob, Grep, TaskList, TaskGet, TaskUpdate, TaskCreate, TeamCreate, TeamDelete, SendMessage, mcp__maestro__read_file, mcp__maestro__write_file, mcp__maestro__edit_file, mcp__maestro__team_msg
---

# Team Interactive Craft

Systematic interactive component pipeline: research -> interaction design -> build -> a11y test. Built on **team-worker agent architecture** -- all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
Skill(skill="team-interactive-craft", args="task description")
                    |
         SKILL.md (this file) = Router
                    |
     +--------------+--------------+
     |                             |
  no --role flag              --role <name>
     |                             |
  Coordinator                  Worker
  roles/coordinator/role.md    roles/<name>/role.md
     |
     +-- analyze -> dispatch -> spawn workers -> STOP
                                    |
                    +-------+-------+-------+-------+
                    v       v       v       v
           [team-worker agents, each loads roles/<role>/role.md]
        researcher  interaction-designer  builder  a11y-tester
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| researcher | [roles/researcher/role.md](roles/researcher/role.md) | RESEARCH-* | false |
| interaction-designer | [roles/interaction-designer/role.md](roles/interaction-designer/role.md) | INTERACT-* | false |
| builder | [roles/builder/role.md](roles/builder/role.md) | BUILD-* | true |
| a11y-tester | [roles/a11y-tester/role.md](roles/a11y-tester/role.md) | A11Y-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
3. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
4. **Wiki knowledge**: `maestro search "interactive component animation" --json` — top 5 entries as prior context
5. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `IC`
- **Session path**: `.workflow/.team/IC-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "interactive-craft",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: interactive-craft
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) -- Pipeline definitions and task registry
- [specs/interaction-patterns.md](specs/interaction-patterns.md) -- Interaction pattern catalog
- [specs/vanilla-constraints.md](specs/vanilla-constraints.md) -- Zero-dependency rules

## Session Directory

```
.workflow/.team/IC-<slug>-<date>/
+-- .msg/
|   +-- messages.jsonl         # Team message bus
|   +-- meta.json              # Pipeline config + GC state
+-- research/                  # Researcher output
|   +-- interaction-inventory.json
|   +-- browser-api-audit.json
|   +-- pattern-reference.json
+-- interaction/               # Interaction designer output
|   +-- blueprints/
|       +-- {component-name}.md
+-- build/                     # Builder output
|   +-- components/
|       +-- {name}.js
|       +-- {name}.css
+-- a11y/                      # A11y tester output
|   +-- a11y-audit-{NNN}.md
+-- wisdom/                    # Cross-task knowledge
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| GC loop stuck > 2 rounds | Escalate to user: accept / retry / terminate |
