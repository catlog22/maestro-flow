---
name: team-ultra-analyze
description: Deep collaborative analysis team skill. Multi-role investigation
  with coordinator-driven synthesis. Triggers on "team ultra-analyze", "team
  analyze".
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
version: 0.5.50
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

# Team Ultra Analyze

Deep collaborative analysis: explore -> analyze -> discuss -> synthesize. Supports Quick/Standard/Deep pipeline modes with configurable depth (N parallel agents). Discussion loops enable user-guided progressive understanding.

## Architecture

```
spawn_agent({ task_name: "team_ultra_analyze", message: "Execute skill team-ultra-analyze, args: "<topic>"" })
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

Pipeline (Standard mode):
  [EXPLORE-1..N](parallel) -> [ANALYZE-1..N](parallel) -> DISCUSS-001 -> SYNTH-001

Pipeline (Deep mode):
  [EXPLORE-1..N] -> [ANALYZE-1..N] -> DISCUSS-001 -> ANALYZE-fix -> DISCUSS-002 -> ... -> SYNTH-001

Pipeline (Quick mode):
  EXPLORE-001 -> ANALYZE-001 -> SYNTH-001
```

## Role Registry

| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| explorer | [roles/explorer/role.md](roles/explorer/role.md) | EXPLORE-* | false |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | ANALYZE-* | false |
| discussant | [roles/discussant/role.md](roles/discussant/role.md) | DISCUSS-* | false |
| synthesizer | [roles/synthesizer/role.md](roles/synthesizer/role.md) | SYNTH-* | false |


## Pre-load (coordinator, before dispatch)

1. **Codebase docs**: If `.workflow/codebase/ARCHITECTURE.md` exists, read for module boundaries
2. **Specs (arch)**: `maestro load --type spec --category arch` — load arch constraints as shared context
3. **Wiki knowledge**: `maestro search "analysis investigation deep-dive" --json` — top 5 entries as prior context
4. All optional — proceed without if unavailable
## Role Router

Parse `$ARGUMENTS`:
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `@roles/coordinator/role.md`, execute entry router

## Shared Constants

- **Session prefix**: `UAN`
- **Session path**: `{run_dir}/work/team/`
- **Team name**: `ultra-analyze`
- **CLI tools**: `maestro delegate --mode analysis` (read-only), `maestro delegate --mode write` (modifications)
- **Message bus**: `mcp__maestro__team_msg(session_id=<run-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
spawn_agent({ task_name: "<agent_name>", message: "Spawn <role> worker", fork_turns: "none", agent_type: "team_worker" })
```

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | Output execution status diagram, do not advance pipeline |
| `resume` / `continue` | Check worker status, advance to next pipeline step |

## Session Directory

```
{run_dir}/work/team/
+-- .msg/messages.jsonl          # Message bus log
+-- .msg/meta.json               # Session metadata + cross-role state
+-- {run_dir}/evidence/discussion.md                # Understanding evolution and discussion timeline
+-- explorations/                # Explorer output
|   +-- exploration-001.json
|   +-- exploration-002.json
+-- {run_dir}/outputs/analyses/                    # Analyst output
|   +-- analysis-001.json
|   +-- analysis-002.json
+-- {run_dir}/evidence/discussions/                 # Discussant output
|   +-- discussion-round-001.json
+-- {run_dir}/outputs/conclusions.json             # Synthesizer output
+-- wisdom/                      # Cross-task knowledge
|   +-- learnings.md
|   +-- decisions.md
|   +-- conventions.md
|   +-- issues.md
```

## Completion Action

When pipeline completes, coordinator presents:

```
request_user_input({
  questions: [{
    question: "Ultra-Analyze pipeline complete. What would you like to do?",
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

| Choice | Action |
|--------|--------|
| Archive & Clean | Update session status="completed" -> TeamDelete() -> output final summary |
| Keep Active | Update session status="paused" -> output resume instructions |
| Export Results | request_user_input for target path -> copy deliverables -> Archive & Clean |

## Specs Reference

- [specs/team-config.json](specs/team-config.json) — Team configuration and pipeline settings

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Unknown --role value | Error with role registry list |
| Role file not found | Error with expected path (roles/{name}/role.md) |
| Discussion loop stuck >5 rounds | Force synthesis, offer continuation |
| CLI tool unavailable | Fallback chain: agy -> codex -> manual analysis |
| Explorer agent fails | Continue with available context, note limitation |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
