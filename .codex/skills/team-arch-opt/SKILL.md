---
name: team-arch-opt
description: Unified team skill for architecture optimization. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team arch-opt".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - create_goal
  - followup_task
  - interrupt_agent
  - list_agents
  - mcp__maestro__team_msg
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_goal
  - wait_agent
session-mode: run
---

> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Team Architecture Optimization

Orchestrate multi-agent architecture optimization: analyze codebase → design refactoring plan → implement changes → validate improvements → review code quality.

## Architecture

```
spawn_agent({ task_name: "team_arch_opt", message: "Execute skill team-arch-opt, args: "task description"" })
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
     +-- analyze → dispatch → spawn workers → STOP
                                    |
                    +-------+-------+-------+-------+
                    v       v       v       v       v
                 [analyzer][designer][refactorer][validator][reviewer]
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| analyzer | [roles/analyzer/role.md](roles/analyzer/role.md) | ANALYZE-* | false |
| designer | [roles/designer/role.md](roles/designer/role.md) | DESIGN-* | false |
| refactorer | [roles/refactorer/role.md](roles/refactorer/role.md) | REFACTOR-*, FIX-* | true |
| validator | [roles/validator/role.md](roles/validator/role.md) | VALIDATE-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REVIEW-*, QUALITY-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (arch)**: `maestro load --type spec --category arch` — load arch constraints as shared context
3. **Specs (coding)**: `maestro load --type spec --category coding` — load coding constraints as shared context
4. **Wiki knowledge**: `maestro search "architecture optimization refactor" --json` — top 5 entries as prior context
5. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TAO`
- **Session path**: `.workflow/.team/TAO-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker", fork_turns: "none" })
```

**Inner Loop roles** (refactorer): Set `inner_loop` dynamically — `true` for single mode, `false` for fan-out/independent (parallel branches).
**Single-task roles** (analyzer, designer, validator, reviewer): Set `inner_loop: false`.

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph (branch-grouped), no advancement |
| `resume` / `continue` | Check worker states, advance next step |
| `revise <TASK-ID> [feedback]` | Revise specific task + cascade downstream |
| `feedback <text>` | Analyze feedback impact, create targeted revision chain |
| `recheck` | Re-run quality check |
| `improve [dimension]` | Auto-improve weakest dimension |

## Session Directory

```
.workflow/.team/TAO-<slug>-<date>/
├── session.json                    # Session metadata + status + parallel_mode
├── task-analysis.json              # Coordinator analyze output
├── artifacts/
│   ├── architecture-baseline.json  # Analyzer: pre-refactoring metrics
│   ├── architecture-report.md      # Analyzer: ranked structural issue findings
│   ├── refactoring-plan.md         # Designer: prioritized refactoring plan
│   ├── validation-results.json     # Validator: post-refactoring validation
│   ├── review-report.md            # Reviewer: code review findings
│   ├── aggregate-results.json      # Fan-out/independent: aggregated results
│   ├── branches/                   # Fan-out mode branch artifacts
│   │   └── B{NN}/
│   │       ├── refactoring-detail.md
│   │       ├── validation-results.json
│   │       └── review-report.md
│   └── pipelines/                  # Independent mode pipeline artifacts
│       └── {P}/
│           └── ...
├── explorations/
│   ├── cache-index.json            # Shared explore cache
│   └── <hash>.md
├── wisdom/
│   └── patterns.md                 # Discovered patterns and conventions
├── discussions/
│   ├── DISCUSS-REFACTOR.md
│   └── DISCUSS-REVIEW.md
└── .msg/
    ├── messages.jsonl              # Message bus log
    └── meta.json                   # Session state + cross-role state
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions, task registry, parallel modes

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| consensus_blocked HIGH | Coordinator creates revision task or pauses pipeline |
| Branch fix cycle >= 3 | Escalate only that branch to user, others continue |
| max_branches exceeded | Coordinator truncates to top N at CP-2.5 |
