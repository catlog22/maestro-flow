---
name: team-motion-design
description: Unified team skill for motion design. Animation token systems, scroll choreography, GPU-accelerated transforms, reduced-motion fallback. Uses team-worker agent architecture. Triggers on "team motion design", "animation system".
allowed-tools: Agent, AskUserQuestion, Read, Write, Edit, Bash, Glob, Grep, TaskList, TaskGet, TaskUpdate, TaskCreate, TeamCreate, TeamDelete, SendMessage, mcp__maestro__read_file, mcp__maestro__write_file, mcp__maestro__edit_file, mcp__maestro__team_msg, mcp__chrome-devtools__performance_start_trace, mcp__chrome-devtools__performance_stop_trace, mcp__chrome-devtools__performance_analyze_insight, mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__take_screenshot
---

# Team Motion Design

Systematic motion design pipeline: research -> choreography -> animation -> performance testing. Built on **team-worker agent architecture** -- all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
Skill(skill="team-motion-design", args="task description")
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
      motion-researcher  choreographer  animator  motion-tester
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| motion-researcher | [roles/motion-researcher/role.md](roles/motion-researcher/role.md) | MRESEARCH-* | false |
| choreographer | [roles/choreographer/role.md](roles/choreographer/role.md) | CHOREO-* | false |
| animator | [roles/animator/role.md](roles/animator/role.md) | ANIM-* | true |
| motion-tester | [roles/motion-tester/role.md](roles/motion-tester/role.md) | MTEST-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
3. **Wiki knowledge**: `maestro search "animation motion design tokens" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `MD`
- **Session path**: `.workflow/.team/MD-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "motion-design",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: motion-design
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
- [specs/motion-tokens.md](specs/motion-tokens.md) -- Animation token schema
- [specs/gpu-constraints.md](specs/gpu-constraints.md) -- Compositor-only animation rules
- [specs/reduced-motion.md](specs/reduced-motion.md) -- Accessibility motion preferences

## Session Directory

```
.workflow/.team/MD-<slug>-<date>/
+-- .msg/
|   +-- messages.jsonl         # Team message bus
|   +-- meta.json              # Pipeline config + GC state
+-- research/                  # Motion researcher output
|   +-- perf-traces/           # Chrome DevTools performance traces
|   +-- animation-inventory.json
|   +-- performance-baseline.json
|   +-- easing-catalog.json
+-- choreography/              # Choreographer output
|   +-- motion-tokens.json
|   +-- sequences/             # Scroll choreography sequences
+-- animations/                # Animator output
|   +-- keyframes/             # CSS @keyframes files
|   +-- orchestrators/         # JS animation orchestrators
+-- testing/                   # Motion tester output
|   +-- traces/                # Performance trace data
|   +-- reports/               # Performance reports
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
