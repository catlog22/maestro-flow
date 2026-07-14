---
name: team-review
description: Unified team skill for code review. 3-role pipeline: scanner, reviewer, fixer. Triggers on team-review.
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

# Team Review

Orchestrate multi-agent code review: scanner -> reviewer -> fixer. Toolchain + LLM scan, deep analysis with root cause enrichment, and automated fix with rollback-on-failure.

## Architecture

```
spawn_agent({ task_name: "team_review", message: "Execute skill team-review, args: "task description"" })
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
                    v       v       v
                [scan]  [review]  [fix]
                team-worker agents, each loads roles/<role>/role.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | SCAN-* | false |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REV-* | false |
| fixer | [roles/fixer/role.md](roles/fixer/role.md) | FIX-* | true |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `RV`
- **Session path**: `.workflow/.team/RV-<slug>-<date>/`
- **Team name**: `review`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker", fork_turns: "none", agent_type: "team_worker" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--full` | Enable scan + review + fix pipeline |
| `--fix` | Fix-only mode (skip scan/review) |
| `-q` / `--quick` | Quick scan only |
| `--dimensions=sec,cor,prf,mnt` | Custom dimensions |
| `-y` / `--yes` | Skip confirmations |

## Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Review pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, clean up team" },
      { label: "Keep Active", description: "Keep session for follow-up work" },
      { label: "Export Results", description: "Export deliverables to target directory" }
    ]
  }]
})
```

## Session Directory

```
.workflow/.team/RV-<slug>-<date>/
├── .msg/messages.jsonl     # Team message bus
├── .msg/meta.json          # Session state + cross-role state
├── wisdom/                 # Cross-task knowledge
├── scan/                   # Scanner output
├── review/                 # Reviewer output
└── fix/                    # Fixer output
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/dimensions.md](specs/dimensions.md) — Review dimension definitions (SEC/COR/PRF/MNT)
- [specs/finding-schema.json](specs/finding-schema.json) — Finding data schema
- [specs/team-config.json](specs/team-config.json) — Team configuration

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| Scanner finds 0 findings | Report clean, skip review + fix |
| User declines fix | Delete FIX tasks, complete with review-only results |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
