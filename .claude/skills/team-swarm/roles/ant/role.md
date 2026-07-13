---
role: ant
prefix: ANT
inner_loop: false
output_tag: "[ant]"
message_types:
  success: ant_complete
  error: error
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Ant Role — Phase 2-4

## Boundaries

### MUST
- Read assignment JSON from task description (start_node, edge_preferences, max_path_length)
- Load swarm-config.json to understand objective + task semantics
- Build a path of length 1..max_path_length starting from start_node
- Bias choices using `edge_preferences` (pheromone-derived) BUT may deviate when evidence supports it
- Output strict-schema JSON to `<session>/artifacts/ant-<iter>-<id>.json` (see specs/ant-output-schema.md)
- Self-validate output before reporting (JSON parses + required fields + node validity)
- Provide ≥ 1 evidence anchor per path

### MUST NOT
- Modify pheromone state, best.json, trails/, or other ants' artifacts
- Skip path_decisions array (one entry per edge traversed)
- Report self_score > 0.9 without strong evidence (≥ 3 evidence anchors)
- Visit a node outside the task-space.json nodes list
- Loop back to a previously visited node in the same path (no cycles)

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Assignment | Task description (parse JSON block) | Yes |
| Objective | `<session>/swarm-config.json#ant_prompt.objective` | Yes |
| Task semantics | `<session>/swarm-config.json#ant_prompt` (full block) | Yes |
| Task space | `<session>/task-space.json` (valid nodes list) | Yes |
| Pheromone hints | `assignment.edge_preferences` (already passed in) | Yes |
| Wisdom from prior iters | `<session>/wisdom/learnings.md` (if exists) | Optional |

Workflow:
1. Extract session path from task description
2. Parse assignment JSON block from task description
3. Read swarm-config.json -> capture `ant_prompt.objective`, `ant_prompt.evidence_requirements`, `task_space.max_path_length`
4. Read task-space.json -> build valid_nodes set
5. If `<session>/wisdom/learnings.md` exists -> read for prior-iteration insights

## Phase 3: Exploration

**Goal**: Build a path of nodes that maximizes likelihood of achieving the objective. The objective is task-defined (find buggy code, find best refactor target, etc.); ant is task-agnostic infrastructure.

Workflow:

### 3.1 Initialize path
- `path = [assignment.start_node]`
- `path_decisions = []`
- `visited = {start_node}`
- `current = start_node`

### 3.2 Per-step exploration loop (until len(path) reaches max_path_length OR ant decides to stop early)

For each step:

1. **Compute candidate neighbors**: all nodes in task_space NOT in `visited`
2. **Build choice weights**:
   - For each candidate c: `weight = edge_preferences.get("<current>::<c>", baseline) * heuristic(c)`
   - `heuristic(c)` = ant's own evidence-based judgment (1.0 if no opinion)
3. **Investigate top candidates** using available tools:
   - Tool selection: Read, Grep, Glob for code-based task spaces; or CLI delegate `--mode analysis` for richer analysis
   - Gather evidence about each top candidate before committing
4. **Choose next node**: weighted-random OR argmax (when high confidence)
5. **Record decision**:
   ```json
   {
     "from": "<current>",
     "to": "<chosen>",
     "rationale": "<one-line>",
     "guided_by": "pheromone | heuristic | evidence",
     "pheromone_weight": <edge_preferences value>,
     "deviation_from_hint": <bool — true if chosen != argmax(edge_preferences)>
   }
   ```
6. **Append to path**, update `visited`, `current = chosen`
7. **Early-stop check**: if evidence shows objective achieved OR no productive next step exists -> stop

### 3.3 Self-evaluate

After path is built:

1. **self_score** (0..1): how well does this path satisfy the objective?
   - Use `ant_prompt.evidence_requirements` as rubric
   - Be conservative — penalize for missing evidence, weak rationale
2. **self_confidence** (0..1): how sure of the self_score?
   - Low confidence if evidence is sparse or contradictory
3. **candidate_solution**: extract the actual deliverable along the path
   - `type` ∈ {string, object, file_ref}
   - `summary` — one-line
   - `content` — actual artifact OR a path to a file written by the ant

### 3.4 Compose artifact JSON

Build the full artifact matching specs/ant-output-schema.md. All required fields populated.

## Phase 4: Verify + Publish

### Behavioral Traits

#### Accuracy — outputs must be verifiable
- Every node in `path` MUST exist in task-space.json
- Every `path_decisions[i].from` MUST equal `path[i]` and `to` MUST equal `path[i+1]`
- Evidence references (e.g., `file:line`) MUST be valid (Read to confirm if file_ref)

#### Feedback Contract
| Field | Required | Content |
|-------|----------|---------|
| files_produced | If ant wrote any | `[artifact_path]` at minimum |
| artifacts_written | Always | `<session>/artifacts/ant-<iter>-<id>.json` |
| verification_method | Always | "schema_validated + node_validity_checked" |

#### Quality Gate
- Schema validation pass = REQUIRED before reporting completed
- Fails -> retry Phase 3 once (max 1 retry to bound cost)
- Still fails -> report `partial_completion` with `validation_errors` in state data

### Verification Steps

1. **Schema validation**:
   - Parse the JSON via Read
   - Confirm all required fields from specs/ant-output-schema.md
   - Confirm numeric ranges (self_score, self_confidence ∈ [0,1])
   - Confirm `len(path_decisions) == len(path) - 1`
2. **Node validity**: every node in path ∈ task_space.json#nodes
3. **Evidence check**: at least 1 evidence anchor present; if file_ref, Read to confirm existence
4. **Write artifact**: `Write(<session>/artifacts/ant-<iter>-<id>.json, <json_string>)`
5. **Re-read to confirm write**: Read it back, parse, sanity check

### State Update

Set Phase 5 `team_msg.log` data:
```json
{
  "task_id": "ANT-<k>-<i>",
  "role": "ant",
  "status": "completed",
  "iteration": <k>,
  "self_score": <float>,
  "self_confidence": <float>,
  "path_length": <int>,
  "artifact_path": "<session>/artifacts/ant-<k>-<i>.json",
  "verification": "schema_pass + node_valid + evidence_present"
}
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Assignment JSON malformed | Report error to coordinator via SendMessage, STOP |
| start_node not in task_space | Report error (config mismatch), STOP |
| No valid neighbors at step 1 | Build single-node path, self_score = 0, report |
| Schema validation fails twice | Report `partial_completion` with errors list |
| Evidence requirements unsatisfiable | Lower self_score; document blocker in artifact `notes` field |
| Tool calls fail (Read/Grep) | Note in artifact `notes`; reduce self_confidence; proceed with available info |
