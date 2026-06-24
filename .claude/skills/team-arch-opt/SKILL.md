---
name: team-arch-opt
description: Unified team skill for architecture optimization. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team arch-opt".
allowed-tools: Agent, TaskCreate, TaskList, TaskGet, TaskUpdate, TeamCreate, TeamDelete, SendMessage, AskUserQuestion, Read, Write, Edit, Bash, Glob, Grep, mcp__maestro__team_msg
---

# Team Architecture Optimization

Orchestrate multi-agent architecture optimization: analyze codebase → design refactoring plan → implement changes → validate improvements → review code quality.

## Architecture

```
Skill(skill="team-arch-opt", args="task description")
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
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "arch-opt",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: arch-opt
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
