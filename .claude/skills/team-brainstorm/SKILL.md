---
name: team-brainstorm
description: Unified team skill for brainstorming team. Uses team-worker agent architecture with role directories for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team brainstorm".
allowed-tools: TeamCreate(*), TeamDelete(*), SendMessage(*), TaskCreate(*), TaskUpdate(*), TaskList(*), TaskGet(*), Agent(*), AskUserQuestion(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro__team_msg(*)
---

# Team Brainstorm

Orchestrate multi-agent brainstorming: generate ideas → challenge assumptions → synthesize → evaluate. Supports Quick, Deep, and Full pipelines with Generator-Critic loop.

## Architecture

```
Skill(skill="team-brainstorm", args="topic description")
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
                    +-------+-------+-------+
                    v       v       v       v
                 [ideator][challenger][synthesizer][evaluator]
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| ideator | [roles/ideator/role.md](roles/ideator/role.md) | IDEA-* | false |
| challenger | [roles/challenger/role.md](roles/challenger/role.md) | CHALLENGE-* | false |
| synthesizer | [roles/synthesizer/role.md](roles/synthesizer/role.md) | SYNTH-* | false |
| evaluator | [roles/evaluator/role.md](roles/evaluator/role.md) | EVAL-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (arch)**: `maestro load --type spec --category arch` — load arch constraints as shared context
3. **Wiki knowledge**: `maestro search "brainstorm ideation design" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `BRS`
- **Session path**: `.workflow/.team/BRS-<slug>-<date>/`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "brainstorm",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: brainstorm
requirement: <topic-description>
inner_loop: false

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

**Parallel ideator spawn** (Full pipeline with N angles):

When Full pipeline has N parallel IDEA tasks, spawn N distinct team-worker agents named `ideator-1`, `ideator-2`, etc.

```
Agent({
  subagent_type: "team-worker",
  name: "ideator-<N>",
  team_name: "brainstorm",
  run_in_background: true,
  prompt: `## Role Assignment
role: ideator
role_spec: <skill_root>/roles/ideator/role.md
session: <session-folder>
session_id: <session-id>
team_name: brainstorm
requirement: <topic-description>
agent_name: ideator-<N>
inner_loop: false

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries (context loaded -> core work done -> verification).
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/ideator/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery, owner=ideator-<N>) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph, no advancement |
| `resume` / `continue` | Check worker states, advance next step |

## Session Directory

```
.workflow/.team/BRS-<slug>-<date>/
├── session.json                    # Session metadata + pipeline + gc_round
├── task-analysis.json              # Coordinator analyze output
├── .msg/
│   ├── messages.jsonl              # Message bus log
│   └── meta.json                   # Session state + cross-role state
├── wisdom/                         # Cross-task knowledge
│   ├── learnings.md
│   ├── decisions.md
│   ├── conventions.md
│   └── issues.md
├── ideas/                          # Ideator output
│   ├── idea-001.md
│   └── idea-002.md
├── critiques/                      # Challenger output
│   ├── critique-001.md
│   └── critique-002.md
├── synthesis/                      # Synthesizer output
│   └── synthesis-001.md
└── evaluation/                     # Evaluator output
    └── evaluation-001.md
```

## Specs Reference

- [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| CLI tool fails | Worker fallback to direct implementation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| Generator-Critic loop exceeds 2 rounds | Force convergence to synthesizer |
| No ideas generated | Coordinator prompts with seed questions |
