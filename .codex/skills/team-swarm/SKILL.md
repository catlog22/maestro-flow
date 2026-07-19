---
name: team-swarm
disable-model-invocation: true
description: Swarm intelligence team skill — ACO-driven multi-agent exploration
  with hybrid LLM coordinator + Python optimization controller. Coordinator
  generates swarm-config from user task, then runs K iterations of N parallel
  ants guided by pheromone state. Universal task space via config (nodes +
  scoring rule). Triggers on "team swarm", "swarm intelligence", "蚁群".
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - update_plan
  - followup_task
  - interrupt_agent
  - list_agents
  - mcp__maestro__team_msg
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
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

<required_reading>
@~/.maestro/workflows/run-mode-lite.md
</required_reading>

> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。

# Team Swarm

Orchestrate ant-colony-style exploration over a user-defined task space. **Hybrid coordinator**: LLM handles task translation + worker spawning; Python script owns all numeric decisions (selection / pheromone update / convergence). Universal — task space and scoring rule come from `swarm-config.json`.

## Architecture

```
spawn_agent({ task_name: "team_swarm", message: "Execute skill team-swarm, args: "task description"" })
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
     +-- Phase 1: gen swarm-config
     +-- Phase 2: init  --> Bash: scripts/aco.py init
     +-- Phase 3: iterate (K rounds, each = spawn-and-stop)
     |   |
     |   +-- Bash: aco.py select --iter k  -> N assignments
     |   +-- Spawn N x team-worker(ant)
     |   +-- [callback when all ants done]
     |   +-- (optional) Spawn team-worker(scorer)
     |   +-- Bash: aco.py update --iter k
     |   +-- Bash: aco.py converged
     |   +-- branch: loop k+1 OR Phase 4
     |
     +-- Phase 4: converge --> Bash: aco.py report -> Spawn team-worker(analyst)
                                                    -> best-solution.md
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| ant | [roles/ant/role.md](roles/ant/role.md) | ANT-* | false |
| scorer | [roles/scorer/role.md](roles/scorer/role.md) | SCORE-* | false |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | ANALYST-* | false |

## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` -> Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` -> `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `TS`
- **Session path**: `{run_dir}/work/team/`
- **Team name**: `swarm`
- **Script root**: `<skill_root>/scripts/aco.py` (Python 3.10+)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<role>", message: "Spawn <role> worker", fork_turns: "none", agent_type: "team_worker" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View iteration progress + convergence curve |
| `resume` / `continue` | Resume interrupted iteration |
| `feedback <text>` | Inject feedback into wisdom; applies at next iteration |
| `revise <ITER>` | Re-run a specific iteration (rare) |

## Specs Reference

| Spec | Purpose |
|------|---------|
| [specs/swarm-protocol.md](specs/swarm-protocol.md) | Master protocol: script <-> coordinator interface, data flow |
| [specs/pheromone-schema.md](specs/pheromone-schema.md) | Pheromone JSON structure, update formula, evaporation |
| [specs/ant-output-schema.md](specs/ant-output-schema.md) | Critical contract for ant JSON artifacts |
| [specs/convergence-criteria.md](specs/convergence-criteria.md) | Stop conditions, multi-criterion logic |
| [specs/swarm-config-template.json](specs/swarm-config-template.json) | User-facing config template with all knobs |

## Scripts

| Script | Purpose | Invocation |
|--------|---------|------------|
| `scripts/aco.py` | Main CLI: init / select / update / converged / report | `python aco.py --session <path> <cmd>` |
| `scripts/pheromone.py` | Pheromone matrix module (imported by aco.py) | — |
| `scripts/scoring.py` | Pluggable scorer (script + fallback modes) | — |

## Session Directory

```
{run_dir}/work/team/
├── team-session.json           # Session state
├── swarm-config.json           # User-facing config (Phase 1 output)
├── role-binding.json           # Worker role_spec path map
├── task-space.json             # Resolved nodes list
├── pheromone/
│   ├── current.json            # Latest pheromone (each iter overwrites)
│   ├── init.json               # Frozen initial state
│   └── history/<iter>.json     # Per-iter snapshot
├── trails/<iter>.jsonl         # Per-iter all-ant paths + scores
├── scores/iter-<iter>-scores.json  # Scorer output (if mode == llm)
├── artifacts/
│   ├── ant-<iter>-<id>.json    # Per-ant schema-locked output
│   ├── swarm-report.json       # Phase 4 full report dump
│   └── best-solution.md        # Analyst final synthesis
├── best.json                   # Canonical best solution
├── wisdom/                     # learnings / decisions / issues
└── .msg/                       # Message bus
```

## Completion Action

When swarm converges, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Swarm pipeline complete. What would you like to do?",
    header: "Completion",
    multiSelect: false,
    options: [
      { label: "Archive & Clean (Recommended)", description: "Archive session, delete team" },
      { label: "Keep Active", description: "Preserve for follow-up" },
      { label: "Export Best Solution", description: "Copy best-solution.md to target" },
      { label: "Run Another Round", description: "Reset convergence, K more iterations" }
    ]
  }]
})
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| `aco.py` not found | Verify `<skill_root>/scripts/aco.py`; check Python install |
| Python version < 3.10 | Use `python3` or report dependency error |
| Config validation fails | request_user_input to fix, regenerate, retry |
| All ants fail in iteration | Halt, request_user_input (retry / abort / refine config) |
| Hallucination cluster (>50%) | Pause, request_user_input (continue / refine scoring) |
| Convergence never trips | `max_iterations` safety net always fires |
| Session corruption | Phase 0 reconciliation; archive if irrecoverable |
