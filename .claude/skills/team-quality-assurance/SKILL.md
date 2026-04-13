---
name: team-quality-assurance
description: Unified team skill for quality assurance. Full closed-loop QA combining issue discovery and software testing. Triggers on "team quality-assurance", "team qa".
allowed-tools: TeamCreate(*), TeamDelete(*), SendMessage(*), TaskCreate(*), TaskUpdate(*), TaskList(*), TaskGet(*), Agent(*), AskUserQuestion(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__ccw-tools__team_msg(*)
---

# Team Quality Assurance

Orchestrate multi-agent QA: scout -> strategist -> generator -> executor -> analyst. Supports discovery, testing, and full closed-loop modes with parallel generation and GC loops.

## Architecture

```
Skill(skill="team-quality-assurance", args="task description")
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
                    +-------+-------+-------+-------+-------+
                    v       v       v       v       v
                 [scout] [strat] [gen] [exec] [analyst]
                 team-worker agents, each loads roles/<role>/role.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scout | [roles/scout/role.md](roles/scout/role.md) | SCOUT-* | false |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | QASTRAT-* | false |
| generator | [roles/generator/role.md](roles/generator/role.md) | QAGEN-* | false |
| executor | [roles/executor/role.md](roles/executor/role.md) | QARUN-* | true |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | QAANA-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `QA`
- **Session path**: `.workflow/.team/QA-<slug>-<date>/`
- **Team name**: `quality-assurance`
- **CLI tools**: `maestro cli --mode analysis` (read-only), `maestro cli --mode write` (modifications)
- **Message bus**: `mcp__ccw-tools__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "quality-assurance",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: quality-assurance
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
| `check` / `status` | View pipeline status graph |
| `resume` / `continue` | Advance to next step |
| `--mode=discovery` | Force discovery mode |
| `--mode=testing` | Force testing mode |
| `--mode=full` | Force full QA mode |

## Completion Action

When pipeline completes, coordinator presents:

```
AskUserQuestion({
  questions: [{
    question: "Quality Assurance pipeline complete. What would you like to do?",
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
.workflow/.team/QA-<slug>-<date>/
├── .msg/messages.jsonl     # Team message bus
├── .msg/meta.json          # Session state + shared memory
├── wisdom/                 # Cross-task knowledge
├── scan/                   # Scout output
├── strategy/               # Strategist output
├── tests/                  # Generator output (L1/, L2/, L3/)
├── results/                # Executor output
└── analysis/               # Analyst output
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry
- [specs/team-config.json](specs/team-config.json) — Team configuration and shared memory schema

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with available role list |
| Role not found | Error with expected path (roles/<name>/role.md) |
| CLI tool fails | Worker fallback to direct implementation |
| Scout finds no issues | Report clean scan, skip to testing mode |
| GC loop exceeded | Accept current coverage with warning |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
