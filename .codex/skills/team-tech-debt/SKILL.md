---
name: team-tech-debt
description: Unified team skill for tech debt identification and remediation. Scans codebase for tech debt, assesses severity, plans and executes fixes with validation. Uses team-worker agent architecture with roles/ for domain logic. Coordinator orchestrates pipeline, workers are team-worker agents. Triggers on "team tech debt".
allowed-tools: spawn_agent(*), wait_agent(*), send_message(*), followup_task(*), close_agent(*), list_agents(*), report_agent_job_result(*), request_user_input(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__ace-tool__search_context(*), mcp__maestro-tools__read_file(*), mcp__maestro-tools__write_file(*), mcp__maestro-tools__edit_file(*), mcp__maestro-tools__team_msg(*)
---

<purpose>
Systematic tech debt governance: scan -> assess -> plan -> fix -> validate. Built on **team-worker agent architecture** — all worker roles share a single agent definition with role-specific Phase 2-4 loaded from `roles/<role>/role.md`.

```
Skill(skill="team-tech-debt", args="task description")
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
           [team-worker agents, each loads roles/<role>/role.md]
          scanner  assessor  planner  executor  validator
```
</purpose>

<context>
$ARGUMENTS — task description and optional flags.

**Role Router:**
- Has `--role <name>` → Read `roles/<name>/role.md`, execute Phase 2-4
- No `--role` → `roles/coordinator/role.md`, execute entry router

**Role Registry:**
| Role | Path | Prefix | Inner Loop |
|------|------|--------|------------|
| coordinator | [roles/coordinator/role.md](roles/coordinator/role.md) | — | — |
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | TDSCAN-* | false |
| assessor | [roles/assessor/role.md](roles/assessor/role.md) | TDEVAL-* | false |
| planner | [roles/planner/role.md](roles/planner/role.md) | TDPLAN-* | false |
| executor | [roles/executor/role.md](roles/executor/role.md) | TDFIX-* | true |
| validator | [roles/validator/role.md](roles/validator/role.md) | TDVAL-* | false |

**User Commands:**
| Command | Action |
|---------|--------|
| `check` / `status` | View execution status graph |
| `resume` / `continue` | Advance to next step |
| `--mode=scan` | Scan-only pipeline (TDSCAN + TDEVAL) |
| `--mode=targeted` | Targeted pipeline (TDPLAN + TDFIX + TDVAL) |
| `--mode=remediate` | Full pipeline (default) |
| `-y` / `--yes` | Skip confirmations |

**Delegation Lock — Coordinator is PURE ORCHESTRATOR:**
| Tool Call | Verdict | Reason |
|-----------|---------|--------|
| `spawn_agent`, `wait_agent`, `close_agent`, `send_message`, `followup_task` | ALLOWED | Orchestration |
| `list_agents`, `request_user_input`, `mcp__maestro-tools__team_msg` | ALLOWED | Coordination |
| `Read/Write` on `.workflow/.team/` files | ALLOWED | Session state |
| `Read` on `roles/`, `commands/`, `specs/` | ALLOWED | Loading instructions |
| `Read/Grep/Glob` on project source code | BLOCKED | Delegate to worker |
| `Edit` on any file outside `.workflow/` | BLOCKED | Delegate to worker |
| `Bash` running build/test/lint | BLOCKED | Delegate to worker |

**No exceptions.** Even single-file tasks MUST go through spawn_agent.

**Shared Constants:**
- Session prefix: `TD`
- Session path: `.workflow/.team/TD-<slug>-<date>/`
- CLI tools: `maestro delegate --mode analysis|write`
- Max GC rounds: 3

**Specs:** [specs/pipelines.md](specs/pipelines.md) — Pipeline definitions and task registry

**Session Directory:**
```
.workflow/.team/TD-<slug>-<date>/
├── .msg/            # Team message bus
├── scan/            # Scanner output
├── assessment/      # Assessor output
├── plan/            # Planner output
├── fixes/           # Executor output
├── validation/      # Validator output
└── wisdom/          # Cross-task knowledge
```
</context>

<invariants>
1. **Coordinator never executes domain work** — only orchestrates via spawn_agent
2. **Scanner results inform downstream** — each stage narrows and refines
3. **Pipeline flow**: TDSCAN → TDEVAL → TDPLAN → TDFIX → TDVAL
</invariants>

<execution>

### Worker Spawn Template

```
spawn_agent({
  agent_type: "team_worker",
  task_name: "<task-id>",
  fork_turns: "none",
  message: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
requirement: <task-description>
inner_loop: <true|false>

Read role_spec file to load Phase 2-4 domain instructions.

## Task Context
task_id: <task-id>
title: <task-title>
description: <task-description>
pipeline_phase: <pipeline-phase>

## Upstream Context
<prev_context>`
})
```

After spawning: `wait_agent({ timeout_ms: 1800000 })` (30 min). Timeout handling: STATUS_CHECK (3 min) → FINALIZE with interrupt (3 min) → mark timed_out, close.

### Model Selection Guide

| Role | reasoning_effort | Rationale |
|------|-------------------|-----------|
| scanner | medium | Broad scan, pattern matching |
| assessor | high | Impact and risk assessment |
| planner | high | Prioritize and sequence fixes |
| executor | high | Code fixes must preserve behavior |
| validator | medium | Follows defined acceptance criteria |

### v4 Agent Coordination

**Message Semantics:**
| Intent | API | Example |
|--------|-----|---------|
| Queue supplementary info | `send_message` | Send scan findings to running assessor |
| Assign fix from plan | `followup_task` | Assign TDFIX task from planner output |
| Check running agents | `list_agents` | Verify agent health during resume |

**Agent Health Check:**
```
const running = list_agents({})
// Compare with meta.json active tasks
// Reset orphaned tasks (in_progress but agent gone) to pending
```

**Named Agent Targeting:**
- `send_message({ target: "TDSCAN-001", message: "..." })` — additional scan scope
- `followup_task({ target: "TDFIX-001", message: "..." })` — assign fix from planner
- `close_agent({ target: "TDVAL-001" })` — cleanup after validation
</execution>

<error_codes>
| Scenario | Resolution |
|----------|------------|
| Unknown command | Error with available command list |
| Role not found | Error with role registry |
| Session corruption | Attempt recovery, fallback to manual |
| Fast-advance conflict | Coordinator reconciles on next callback |
| Completion action fails | Default to Keep Active |
| Scanner finds no debt | Report clean codebase, skip to summary |
</error_codes>

<success_criteria>
- [ ] Role routing correct (coordinator vs worker)
- [ ] Delegation lock enforced (coordinator never executes domain work)
- [ ] Pipeline stages execute in order (scan → assess → plan → fix → validate)
- [ ] Worker spawn uses correct template with role-spec paths
- [ ] Timeout handling applied (STATUS_CHECK → FINALIZE → close)
- [ ] Scanner results flow through downstream stages
- [ ] Session directory structure maintained
- [ ] Completion action presented to user
</success_criteria>
