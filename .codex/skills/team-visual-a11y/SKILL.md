---
name: team-visual-a11y
disable-model-invocation: true
description: Unified team skill for visual accessibility QA. OKLCH color
  contrast, typography readability, focus management, WCAG AA/AAA audit at
  rendered level. Uses team-worker agent architecture. Triggers on "team visual
  a11y", "accessibility audit", "visual a11y".
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
  - mcp__chrome-devtools__emulate
  - mcp__chrome-devtools__evaluate_script
  - mcp__chrome-devtools__lighthouse_audit
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__resize_page
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
version: 0.5.55
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

# Team Visual Accessibility

Deep visual accessibility QA: OKLCH-based perceptual color contrast, typography readability at all viewports, focus-visible completeness, WCAG AA/AAA audit at rendered level. Built on **team-worker agent architecture** -- all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

## Architecture

```
spawn_agent({ task_name: "team_visual_a11y", message: "Execute skill team-visual-a11y, args: task description" })
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
                    +-------+-------+-------+
                    v       v       v       |
           [3 auditors spawn in PARALLEL]   |
        color-auditor  typo-auditor  focus-auditor
                    |       |       |
                    +---+---+---+---+
                        v
               remediation-planner
                        |
                        v
               fix-implementer (inner_loop)
                        |
                        v
               [re-audit: color + focus in PARALLEL]
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | -- | -- |
| color-auditor | [roles/color-auditor/role.md](roles/color-auditor/role.md) | COLOR-* | false |
| typo-auditor | [roles/typo-auditor/role.md](roles/typo-auditor/role.md) | TYPO-* | false |
| focus-auditor | [roles/focus-auditor/role.md](roles/focus-auditor/role.md) | FOCUS-* | false |
| remediation-planner | [roles/remediation-planner/role.md](roles/remediation-planner/role.md) | REMED-* | false |
| fix-implementer | [roles/fix-implementer/role.md](roles/fix-implementer/role.md) | FIX-* | true |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (ui)**: `maestro load --type spec --category ui` — load ui constraints as shared context
3. **Wiki knowledge**: `maestro search "accessibility WCAG contrast" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `VA`
- **Session path**: `{run_dir}/work/team/`
- **team_name**: `visual-a11y`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`
- **Max GC rounds**: 2

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker for <task-id>",
  team_name: "visual-a11y",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: {run_dir}/work/team
session_id: <run-id>
team_name: visual-a11y
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
- [specs/oklch-standards.md](specs/oklch-standards.md) -- OKLCH color accessibility rules
- [specs/wcag-matrix.md](specs/wcag-matrix.md) -- WCAG 2.1 criteria matrix
- [specs/typography-scale.md](specs/typography-scale.md) -- Typography accessibility rules
- [specs/focus-patterns.md](specs/focus-patterns.md) -- Focus management patterns

## Session Directory

```
{run_dir}/work/team/
+-- .msg/
|   +-- messages.jsonl         # Team message bus
|   +-- meta.json              # Pipeline config + GC state
+-- {run_dir}/outputs/audits/
|   +-- color/                 # Color auditor output
|   |   +-- color-audit-001.md
|   +-- typography/            # Typography auditor output
|   |   +-- typo-audit-001.md
|   +-- focus/                 # Focus auditor output
|       +-- focus-audit-001.md
+-- {run_dir}/outputs/remediation/               # Remediation planner output
|   +-- remediation-plan.md
+-- {run_dir}/outputs/fixes/                     # Fix implementer output
|   +-- fix-summary-001.md
+-- {run_dir}/outputs/re-audit/                  # Re-audit output (GC loop)
|   +-- color-audit-002.md
|   +-- focus-audit-002.md
+-- {run_dir}/evidence/evidence/                  # Screenshots, traces
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
| Chrome DevTools unavailable | Degrade to static analysis only |
