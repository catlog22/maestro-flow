---
name: team-roadmap-dev
description: Unified team skill for roadmap-driven development workflow. Coordinator discusses roadmap with user, then dispatches phased execution pipeline (plan -> execute -> verify). All roles invoke this skill with --role arg. Triggers on "team roadmap-dev".
allowed-tools: TeamCreate(*), TeamDelete(*), SendMessage(*), TaskCreate(*), TaskUpdate(*), TaskList(*), TaskGet(*), Agent(*), AskUserQuestion(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro__team_msg(*)
---

# Team Roadmap Dev

Roadmap-driven development with phased execution pipeline. Coordinator discusses roadmap with the user and manages phase transitions. Workers are spawned as team-worker agents.

## Architecture

```
Skill(skill="team-roadmap-dev", args="<task-description>")
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
     +-- roadmap-discuss -> dispatch -> spawn workers -> STOP
                                    |
                    +-------+-------+-------+
                    v       v       v
                 [planner] [executor] [verifier]
                 (team-worker agents)

Pipeline (per phase):
  PLAN-N01 -> EXEC-N01 -> VERIFY-N01 (gap closure loop if needed)

Multi-phase:
  Phase 1 -> Phase 2 -> ... -> Phase N -> Complete
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* | true |
| executor | [roles/executor/role.md](roles/executor/role.md) | EXEC-* | true |
| verifier | [roles/verifier/role.md](roles/verifier/role.md) | VERIFY-* | true |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (arch)**: `maestro load --type spec --category arch` — load arch constraints as shared context
3. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
4. **Wiki knowledge**: `maestro search "roadmap milestone development" --json` — top 5 entries as prior context
5. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `RD`
- **Session path**: `.workflow/.team/RD-<slug>-<date>/`
- **Team name**: `roadmap-dev`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "roadmap-dev",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: roadmap-dev
requirement: <task-description>
inner_loop: true

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

**All worker roles** (planner, executor, verifier): Set `inner_loop: true`.

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | Output execution status graph (phase-grouped), no advancement |
| `resume` / `continue` | Check worker states, advance next step |

## Session Directory

```
.workflow/.team/RD-<slug>-<date>/
+-- roadmap.md                 # Phase plan with requirements and success criteria
+-- state.md                   # Living memory (concise)
+-- config.json                # Session settings (mode, depth, gates)
+-- wisdom/                    # Cross-task knowledge accumulation
|   +-- learnings.md
|   +-- decisions.md
|   +-- conventions.md
|   +-- issues.md
+-- phase-1/                   # Per-phase artifacts
|   +-- context.md
|   +-- IMPL_PLAN.md
|   +-- TODO_LIST.md
|   +-- .task/IMPL-*.json
|   +-- summary-*.md
|   +-- verification.md
+-- phase-N/
|   +-- ...
+-- .msg/
    +-- messages.jsonl          # Team message bus log
    +-- meta.json               # Session metadata + shared state
```

## Completion Action

When the pipeline completes:

```
AskUserQuestion({
  questions: [{
    question: "Roadmap Dev pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up tasks and team resources" },
      { label: "Keep Active", description: "Keep session active for follow-up work or inspection" },
      { label: "Export Results", description: "Export deliverables to a specified location, then clean" }
    ]
  }]
})
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with role registry list |
| Role file not found | Error with expected path (roles/{name}/role.md) |
| project-tech.json missing | Coordinator invokes /workflow:spec:setup  |
| Phase verification fails with gaps | Coordinator triggers gap closure loop (max 3 iterations) |
| Max gap closure iterations (3) | Report to user, ask for guidance |
| Worker crash | Respawn worker, reassign task |
| Session corruption | Attempt recovery, fallback to manual reconciliation |
