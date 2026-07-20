---
name: team-motion-design
disable-model-invocation: true
description: Unified team skill for motion design. Animation token systems,
  scroll choreography, GPU-accelerated transforms, reduced-motion fallback. Uses
  team-worker agent architecture. Triggers on "team motion design", "animation
  system".
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
  - mcp__chrome-devtools__evaluate_script
  - mcp__chrome-devtools__performance_analyze_insight
  - mcp__chrome-devtools__performance_start_trace
  - mcp__chrome-devtools__performance_stop_trace
  - mcp__chrome-devtools__take_screenshot
  - mcp__maestro__edit_file
  - mcp__maestro__read_file
  - mcp__maestro__team_msg
  - mcp__maestro__write_file
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_plan
  - wait_agent
session-mode: run
version: 0.5.52
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

# Team Motion Design

Systematic motion design pipeline: research -> choreography -> animation -> performance testing. Built on **team-worker agent architecture** -- all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_motion_design", message: "Execute skill team-motion-design, args: task description" })
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
- **Session path**: `{run_dir}/work/team/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "motion-design",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: motion-design
requirement: <task-description>
inner_loop: <true|false>

## Progress Milestones
session_id: <run-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final send_message.

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
{run_dir}/work/team/
+-- .msg/
|   +-- messages.jsonl         # Team message bus
|   +-- meta.json              # Pipeline config + GC state
+-- {run_dir}/outputs/research/                  # Motion researcher output
|   +-- perf-traces/           # Chrome DevTools performance traces
|   +-- animation-inventory.json
|   +-- performance-baseline.json
|   +-- easing-catalog.json
+-- {run_dir}/outputs/choreography/              # Choreographer output
|   +-- motion-tokens.json
|   +-- sequences/             # Scroll choreography sequences
+-- {run_dir}/outputs/animations/                # Animator output
|   +-- keyframes/             # CSS @keyframes files
|   +-- orchestrators/         # JS animation orchestrators
+-- {run_dir}/outputs/testing/                   # Motion tester output
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
