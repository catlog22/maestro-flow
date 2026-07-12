---
name: team-swarm
description: Swarm intelligence team skill — ACO-driven multi-agent exploration with hybrid LLM coordinator + Python optimization controller. Coordinator generates swarm-config from user task, then runs K iterations of N parallel ants guided by pheromone state. Universal task space via config (nodes + scoring rule). Triggers on "team swarm", "swarm intelligence", "蚁群".
allowed-tools: TeamCreate(*), TeamDelete(*), SendMessage(*), TaskCreate(*), TaskUpdate(*), TaskList(*), TaskGet(*), Agent(*), AskUserQuestion(*), Read(*), Write(*), Edit(*), Bash(*), Glob(*), Grep(*), mcp__maestro__team_msg(*)
session-mode: run
---

<run_mode>
**Session mode:** `run`. The coordinator MUST call `maestro run create team-swarm -- $ARGUMENTS` before creating workers and retain the returned `run_id`/`run_dir`.

- Formal team deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; the final synthesis and handoff go to `{run_dir}/report.md`.
- `.workflow/.team/` may remain only as the transient Agent message bus. Its `.msg/`, lease, and coordination metadata are not formal artifacts and MUST NOT be indexed as Session knowledge.
- **Legacy Compatibility Mapping:** Any legacy `artifacts/`, `wisdom/`, `understanding.md`, `evidence.ndjson`, or private session directory mentioned by role files is staging-only; copy the accepted result into the active Run before completion.
- Before reporting success, run `maestro run check {run_id}`, fix blocking gaps, then `maestro run complete {run_id}`.
</run_mode>

# Team Swarm

Orchestrate ant-colony-style exploration over a user-defined task space. **Hybrid coordinator**: LLM handles task translation + worker spawning; Python script owns all numeric decisions (selection / pheromone update / convergence). Universal — task space and scoring rule come from `swarm-config.json`.

## Architecture

```
Skill(skill="team-swarm", args="task description")
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
- **Session path**: `.workflow/.team/TS-<slug>-<date>/`
- **Team name**: `swarm`
- **Script root**: `<skill_root>/scripts/aco.py` (Python 3.10+)
- **Message bus**: `mcp__maestro__team_msg(session_id=<session-id>, ...)`

## Worker Spawn Template

Coordinator spawns workers using this template:

```
Agent({
  subagent_type: "team-worker",
  description: "Spawn <role> worker",
  team_name: "swarm",
  name: "<role>",
  run_in_background: true,
  prompt: `## Role Assignment
role: <role>
role_spec: <skill_root>/roles/<role>/role.md
session: <session-folder>
session_id: <session-id>
team_name: swarm
requirement: <task-description>
inner_loop: false

## Assignment (ant only)
<assignment JSON from aco.py select>

## Progress Milestones
session_id: <session-id>
Report progress via team_msg at natural phase boundaries.
Report blockers immediately via team_msg type="blocker".
Report completion via team_msg type="task_complete" after final SendMessage.

Read role_spec file (@<skill_root>/roles/<role>/role.md) to load Phase 2-4 domain instructions.
Execute built-in Phase 1 (task discovery) -> role Phase 2-4 -> built-in Phase 5 (report).`
})
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
.workflow/.team/TS-<slug>-<date>/
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
AskUserQuestion({
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
| Config validation fails | AskUserQuestion to fix, regenerate, retry |
| All ants fail in iteration | Halt, AskUserQuestion (retry / abort / refine config) |
| Hallucination cluster (>50%) | Pause, AskUserQuestion (continue / refine scoring) |
| Convergence never trips | `max_iterations` safety net always fires |
| Session corruption | Phase 0 reconciliation; archive if irrecoverable |
