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
session_path = "<project_root>/.workflow/.team/<session_id>"
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
- exit_code 2 -> config validation error -> AskUserQuestion to fix
- exit_code 1 -> runtime error -> log to issues.md + retry once

On success, capture:
- `n_nodes` — search space size
- `n_edges` — initial edge count
- `pheromone_path` — confirm written

### Step 7: Initialize team-session.json

```json
{
  "session_id": "<session-id>",
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
  "created_at": "<iso8601>"
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
  session_id: "<session-id>",
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

- `<session>/swarm-config.json` exists and validates
- `<session>/pheromone/current.json` exists with `iteration: 0`
- `<session>/task-space.json` exists with `n_nodes > 0`
- team-session.json initialized with `iteration: 0`

## Failure Recovery

| Failure | Action |
|---------|--------|
| Config invalid | AskUserQuestion, regenerate, retry |
| `aco.py init` runtime error | Log to issues.md, retry once, then AskUserQuestion (abort/refine) |
| Directory creation fails | Check disk space / permissions, retry |
| TeamCreate fails | Check team name conflict (existing swarm session), prompt to clean or resume |
