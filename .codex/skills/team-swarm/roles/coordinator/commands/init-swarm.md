# Command: init-swarm

## Inputs

- `swarm-config.json` from Phase 1 (in-memory or already written to candidate session path)
- `session_id` already computed (`TS-<slug>-<date>`)
- `skill_root` = `<project>/.claude/skills/team-swarm`

## Workflow

### Step 1: Resolve paths

```
project_root = Bash("pwd")
skill_root = "<project_root>/.claude/skills/team-swarm"
session_path = "<project_root>/{run_dir}/work/team/"
```

### Step 2: Create session directory tree

```
mkdir -p <session_path>/{pheromone/history,trails,scores,artifacts,wisdom,.msg}
```

### Step 3: Write swarm-config.json

Write the Phase 1-generated config to `<session_path>/swarm-config.json`.

Validate before write:
- `task_space.nodes` OR `task_space.auto_discover_from` present
- `swarm.n_ants` >= 2 (single-ant defeats swarm purpose)
- `convergence.max_iterations` >= 1

### Step 4: Create team

```
TeamCreate({ name: "swarm" })
```

### Step 5: Write role-binding.json

```json
{
  "ant": "<skill_root>/roles/ant/role.md",
  "scorer": "<skill_root>/roles/scorer/role.md",
  "analyst": "<skill_root>/roles/analyst/role.md"
}
```

Saved at `<session_path>/role-binding.json` — workers resolve their role.md from this file.

### Step 6: Call aco.py init

```
Bash: python <skill_root>/scripts/aco.py --session <session_path> init
```

Parse stdout JSON. On `status: "error"`:
- exit_code 2 -> config validation error -> request_user_input to fix
- exit_code 1 -> runtime error -> log to issues.md + retry once

On success, capture:
- `n_nodes` — search space size
- `n_edges` — initial edge count
- `pheromone_path` — confirm written

### Step 7: Initialize team-session.json

```json
{
  "session_id": "<run-id>",
  "task_description": "<user task>",
  "status": "active",
  "team_name": "swarm",
  "skill": "team-swarm",
  "iteration": 0,
  "max_iterations": <config.convergence.max_iterations>,
  "n_ants_per_iter": <config.swarm.n_ants>,
  "config_path": "swarm-config.json",
  "pheromone_path": "pheromone/current.json",
  "roles": ["coordinator", "ant", "scorer", "analyst"],
  "scoring_mode": "<config.scoring.mode>",
  "active_workers": [],
  "completed_iterations": [],
  "completion_action": "interactive",
  "created_at": "<iso8601>",
  "updated_at": "<iso8601>",
  "run": { "run_id": "<run-id>", "run_dir": "<run-dir>" }
}
```

### Step 8: Initialize wisdom files

Create empty wisdom files with headers:
- `wisdom/learnings.md` — cross-iteration insights
- `wisdom/decisions.md` — config refinements made mid-pipeline
- `wisdom/issues.md` — errors and hallucinations log

### Step 9: Log initialization state_update

```
team_msg({
  operation: "log",
  session_id: "<run-id>",
  from: "coordinator",
  type: "state_update",
  summary: "Swarm initialized: <n_nodes> nodes, <n_ants> ants/iter, max <K> iterations",
  data: {
    iteration: 0,
    n_nodes: <n>,
    n_ants: <n>,
    max_iterations: <K>,
    scoring_mode: "<mode>"
  }
})
```

### Step 10: Proceed to Phase 3 (iterate.md)

Do NOT spawn any workers in this command. First spawn happens in iterate.md step 4.

## Success Criteria

- `{run_dir}/work/team/swarm-config.json` exists and validates
- `{run_dir}/work/team/pheromone/current.json` exists with `iteration: 0`
- `{run_dir}/work/team/task-space.json` exists with `n_nodes > 0`
- team-session.json initialized with `iteration: 0`

## Failure Recovery

| Failure | Action |
|---------|--------|
| Config invalid | request_user_input, regenerate, retry |
| `aco.py init` runtime error | Log to issues.md, retry once, then request_user_input (abort/refine) |
| Directory creation fails | Check disk space / permissions, retry |
| TeamCreate fails | Resolve the exact `run_id` / `run_dir`, inspect its one `work/team/team-session.json`, and offer resume only if lifecycle reconciliation verifies a matching active/paused `team-swarm` session; otherwise fail closed |

### TeamCreate Conflict Recovery Contract

1. Start from the birth-packet `run_id` / `run_dir`. Do not scan sibling Runs and do not treat an arbitrary existing team name as a resumable match.
2. Inspect the exact team session and reconcile canonical Run status, broker-backed live agents, non-terminal tasks, and ordered activity timestamps through the runtime lifecycle adapter.
3. Offer **Resume** only when the exact candidate is a verified matching `team-swarm` session with lifecycle `active` or `paused`. If health is `stale_candidate`, show the evidence and require an explicit operator choice; never convert stale health into cleanup eligibility.
4. If exact locator evidence is absent, mismatched, `unknown`, or `inconsistent`, fail closed. Locator-less legacy discovery must use ranked candidates plus request_user_input and must never choose array index 0 implicitly.
5. Do not offer a generic "clean or resume" action. `abandoned` requires a separate explicit audited transition after all liveness/activity checks, and cleanup requires a second confirmation that removes only team coordination state, never Run authority or outputs.
