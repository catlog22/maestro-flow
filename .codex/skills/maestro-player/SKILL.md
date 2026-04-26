---
name: maestro-player
description: Workflow template player — load JSON template, bind variables, execute DAG nodes wave-by-wave via spawn_agents_on_csv, persist state at checkpoints, support resume. Coordinator assembles skill_call from template nodes — never executes skills directly.
argument-hint: "<template-slug|path> [--context key=value...] [-c [session-id]] [--list] [--dry-run]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based template executor using `spawn_agents_on_csv`. Loads a workflow template
(produced by maestro-composer), binds context variables, converts DAG nodes into
CSV waves via topological sort, executes wave-by-wave with barrier/non-barrier grouping.

Aligned with maestro codex coordinator pattern:
- ALL skill execution via `spawn_agents_on_csv` — coordinator never executes directly
- Barrier nodes (checkpoints + artifact-producing skills) execute solo
- Non-barrier nodes grouped into parallel waves
- Session state at `.workflow/.maestro-coordinate/{session-id}/`
- Resume from last completed wave via `-c`

```
Load Template → Bind Variables → Build Wave CSV → spawn → read results →
(barrier: read artifacts, update context) → next wave → report
```
</purpose>

<invariants>
1. **ALL skills via spawn_agents_on_csv**: Every node execution goes through spawn. Coordinator NEVER directly executes any skill.
2. **Coordinator = prompt assembler only**: Load template → resolve refs → build CSV → spawn → read results → assemble next CSV.
3. **Barrier = solo wave**: Checkpoint nodes and artifact-producing skills execute alone (wave size = 1).
4. **Non-barriers can parallel**: Consecutive non-barrier nodes grouped into one wave.
5. **Wave-by-wave**: Never start wave N+1 before wave N results are read and analyzed.
6. **Coordinator owns context**: Sub-agents never read prior results — coordinator assembles full `skill_call` with resolved args.
7. **Resume from wave**: `-c` finds last completed wave, resumes from next pending step.
</invariants>

<context>
$ARGUMENTS — template slug/path, or flags.

**Flags:**
- `--context key=value` — Bind context variables (repeatable)
- `-c` / `--continue [session-id]` — Resume paused/interrupted session
- `--list` — List available templates
- `--dry-run` — Show wave plan without executing

**Entry routing:**

| Detection | Condition | Handler |
|-----------|-----------|---------|
| List | `--list` | handleList |
| Resume | `-c [session-id]` | Phase 0: Resume |
| Dry run | `--dry-run` | Phase 1 + 2, print plan, exit |
| Normal | Template slug/path | Phase 1 |
| No args | Empty | handleList + AskUserQuestion |

**Session tracking (aligned with maestro codex):**

| Constant | Value |
|----------|-------|
| Session prefix | `MCP` (Maestro Composer Player) |
| Session dir | `.workflow/.maestro-coordinate/MCP-<YYYYMMDD>-<HHmmss>/` |
| State file | `state.json` |
| Wave CSV | `wave-{N}.csv` |
| Wave results | `wave-{N}-results.csv` |
| Template dir | `~/.maestro/templates/workflows/` |
| Template index | `~/.maestro/templates/workflows/index.json` |

**Barrier nodes** (solo wave, coordinator reads artifacts after):

| Node type | Artifacts to Read | Context Updates |
|-----------|------------------|-----------------|
| `checkpoint` | — (state save only) | `last_checkpoint` |
| `maestro-plan` | `plan.json`, `.task/TASK-*.json` | `plan_dir`, `task_count` |
| `maestro-execute` | `results.csv` | `exec_status`, `completed_tasks` |
| `maestro-analyze` | `context.md` | `analysis_dir`, `gaps`, `phase` |
| `maestro-brainstorm` | `.brainstorming/` | `brainstorm_dir` |
| `maestro-spec-generate` | `specs/` | `spec_session_id` |

All other skill nodes are **non-barrier** (groupable into parallel waves).

**state.json schema:**

```json
{
  "id": "MCP-<YYYYMMDD>-<HHmmss>",
  "intent": "<template_name> with context",
  "chain": "<template_id>",
  "template_path": "~/.maestro/templates/workflows/<slug>.json",
  "template_name": "<name>",
  "auto_yes": false,
  "status": "in_progress | paused | completed | aborted",
  "started_at": "<ISO>",
  "context": {
    "goal": "...", "scope": "...",
    "phase": null, "plan_dir": null, "analysis_dir": null,
    "last_checkpoint": null
  },
  "waves": [],
  "steps": [
    {
      "step_n": 1, "node_id": "N-001",
      "skill": "<executor>", "args": "<args_template>",
      "type": "skill | cli | checkpoint",
      "is_barrier": true,
      "status": "pending | completed | failed | skipped",
      "wave_n": null, "findings": null, "artifacts": null
    }
  ]
}
```
</context>

<execution>

### handleList

Scan `~/.maestro/templates/workflows/index.json`. Display:
```
Available workflow templates:
  feature-tdd-review    [feature, complex]   3 work nodes, 2 checkpoints
  quick-bugfix          [bugfix, simple]     2 work nodes, 1 checkpoint

Run: $maestro-player <slug> --context goal="..."
```

If not found: "No templates. Create with $maestro-composer"

---

### Phase 0: Resume

**Trigger**: `-c [session-id]`

1. If session-id given: load `.workflow/.maestro-coordinate/<session-id>/state.json`
2. If no session-id: Glob `.workflow/.maestro-coordinate/MCP-*/state.json` sorted desc, find `status = "in_progress" | "paused"`
3. None found → error E005
4. Identify last completed wave, resume from next pending step
5. Jump to Phase 3 (Wave Execution)

---

### Phase 1: Load & Bind

**Step 1.1** — Resolve template path:
1. Absolute path → use as-is
2. Slug → look up in `~/.maestro/templates/workflows/index.json`
3. Partial match → confirm with user
4. Not found → show `--list`, AskUserQuestion

**Step 1.2** — Parse `--context key=value` pairs into `bound_context`.

**Step 1.3** — Load and validate template JSON.

**Step 1.4** — Collect missing required variables via AskUserQuestion.

**Step 1.5** — Bind `{variable_name}` in all `args_template` strings. Leave `{N-xxx.field}` and `{prev_*}` unresolved (runtime Phase 3).

**Step 1.6** — If `--dry-run`: print wave plan and exit (see Phase 2 output).

---

### Phase 2: Init Session & Build Wave Plan

**Step 2.1** — Generate session ID: `MCP-<YYYYMMDD>-<HHmmss>`.

**Step 2.2** — Topological sort (Kahn's algorithm) on template nodes + edges.

**Step 2.3** — Classify barrier vs non-barrier per node:

```javascript
const BARRIER_SKILLS = new Set([
  'maestro-analyze', 'maestro-plan', 'maestro-brainstorm',
  'maestro-spec-generate', 'maestro-execute'
]);

function isBarrier(node) {
  if (node.type === 'checkpoint') return true;
  return BARRIER_SKILLS.has(node.executor);
}
```

**Step 2.4** — Group into waves:

```javascript
function buildWaves(sortedNodes) {
  const waves = [];
  let currentWave = [];
  for (const node of sortedNodes) {
    if (isBarrier(node)) {
      if (currentWave.length > 0) waves.push(currentWave);
      waves.push([node]); // barrier = solo wave
      currentWave = [];
    } else {
      currentWave.push(node);
    }
  }
  if (currentWave.length > 0) waves.push(currentWave);
  return waves;
}
```

**Step 2.5** — Build steps array from waves. Write `state.json` to `.workflow/.maestro-coordinate/<session-id>/`.

**Step 2.6** — Display start banner:
```
============================================================
  MAESTRO PLAYER
============================================================
  Template: <template.name>
  Session:  <session_id>
  Context:  goal="<value>"

  Wave Plan:
    [W1] N-001 maestro-plan          "{goal}"       [BARRIER]
    [W2] N-002 maestro-execute       {phase}        [BARRIER]
    [W3] N-003 quality-test          {phase}
         N-004 quality-review        {phase}
============================================================
```

**`--dry-run`**: Display above and exit.

---

### Phase 3: Wave Execution Loop

```javascript
let waveNum = 0;
while (state.steps.some(s => s.status === 'pending')) {
  waveNum++;
  const waveSteps = getNextWave(state.steps);
```

**3a. Resolve runtime references** in each step's args:

```javascript
function resolveArgs(args, steps, context) {
  return args
    .replace(/{(\w+)}/g, (_, key) => context[key] ?? '')
    .replace(/{N-(\d+)\.(\w+)}/g, (_, id, field) => {
      const step = steps.find(s => s.node_id === `N-${id}`);
      return step?.[field] ?? '';
    })
    .replace(/{prev_(\w+)}/g, (_, field) => {
      const prev = [...steps].reverse().find(s =>
        s.status === 'completed' && s.type !== 'checkpoint');
      return prev?.[field] ?? '';
    });
}
```

**3b. Handle checkpoint nodes** (no CSV spawn needed):

```javascript
if (waveSteps[0].type === 'checkpoint') {
  const cp = waveSteps[0];
  // Save checkpoint snapshot
  Write(`${sessionDir}/checkpoints/${cp.node_id}.json`, JSON.stringify({
    session_id: state.id, checkpoint_id: cp.node_id,
    saved_at: new Date().toISOString(),
    steps_snapshot: state.steps, context: state.context
  }, null, 2));

  state.context.last_checkpoint = cp.node_id;
  cp.status = 'completed'; cp.wave_n = waveNum;

  // If auto_continue == false: pause for user
  if (!cp.auto_continue) {
    AskUserQuestion: Continue / Pause / Abort
    on Pause: state.status = 'paused', save, exit
    on Abort: state.status = 'aborted', skip remaining, exit
  }

  Write(stateFile, JSON.stringify(state, null, 2));
  continue;
}
```

**3c. Build wave CSV** for skill nodes:

```javascript
const csvContent = 'id,skill_call,topic\n' + waveSteps.map(step => {
  const resolvedArgs = resolveArgs(step.args, state.steps, state.context);
  const skillCall = `$${step.skill} ${resolvedArgs}`.trim();
  return `"${step.step_n}","${skillCall.replace(/"/g, '""')}","Template \"${state.template_name}\" step ${step.step_n}/${state.steps.length}"`;
}).join('\n');

Write(`${sessionDir}/wave-${waveNum}.csv`, csvContent);
```

**3d. Spawn agents**:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionDir}/wave-${waveNum}.csv`,
  id_column: "id",
  instruction: PLAYER_INSTRUCTION,
  max_workers: waveSteps.length,
  max_runtime_seconds: 1800,
  output_csv_path: `${sessionDir}/wave-${waveNum}-results.csv`,
  output_schema: RESULT_SCHEMA
});
```

**3e. Read results, update state**:

```javascript
const results = readCSV(`${sessionDir}/wave-${waveNum}-results.csv`);
for (const row of results) {
  const step = state.steps.find(s => s.step_n === parseInt(row.id));
  step.status = row.status;
  step.findings = row.summary;
  step.artifacts = row.artifacts;
  step.wave_n = waveNum;
}
```

**3f. Barrier analysis** (if barrier wave):

```javascript
if (isBarrier(waveSteps[0])) {
  analyzeBarrierArtifacts(waveSteps[0], results[0], state.context);
}
```

**3g. Persist + abort check**:

```javascript
state.waves.push({ wave_n: waveNum, steps: waveSteps.map(s => s.step_n) });
Write(stateFile, JSON.stringify(state, null, 2));

if (results.some(r => r.status === 'failed')) {
  state.status = 'aborted';
  state.steps.filter(s => s.status === 'pending').forEach(s => s.status = 'skipped');
  Write(stateFile, JSON.stringify(state, null, 2));
  break;
}
```

### Sub-Agent Instruction Template

```
你是 CSV job 子 agent。

先原样执行这一段技能调用：
{skill_call}

然后基于结果完成这一行任务说明：
{topic}

限制：
- 不要修改 .workflow/.maestro-coordinate/ 下的 state 文件
- skill 内部有自己的 session 管理，按 skill SKILL.md 执行即可

最后必须调用 `report_agent_job_result`，返回 JSON：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","artifacts":"产物路径或空字符串","error":"失败原因或空字符串"}
```

### Result Schema

```javascript
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    skill_call: { type: "string" },
    summary: { type: "string" },
    artifacts: { type: "string" },
    error: { type: "string" }
  },
  required: ["status", "skill_call", "summary", "artifacts", "error"]
};
```

---

### Phase 4: Completion Report

```
============================================================
  MAESTRO PLAYER SESSION COMPLETE
============================================================
  Session:   <session_id>
  Template:  <template_name> (<template_id>)
  Waves:     <N> executed
  Steps:     <completed>/<total>
  Context:   goal="<value>"

  WAVE RESULTS:
    [W1] $maestro-plan "{goal}"         →  ✓  plan created
    [W2] $maestro-execute {phase}       →  ✓  12/12 tasks
    [W3] $quality-test {phase}          →  ✓  all tests pass
         $quality-review {phase}        →  ✓  no issues

  State:    .workflow/.maestro-coordinate/<session_id>/state.json
  Resume:   $maestro-player -c
============================================================
```

Update `state.status = "completed"`, write final `state.json`.
</execution>

<csv_schema>
### wave-{N}.csv (Per-Wave Input)

```csv
id,skill_call,topic
"1","$maestro-plan \"implement user auth\"","Template \"feature-plan-test\" step 1/5"
```

| Column | Description |
|--------|-------------|
| `id` | Step number (string) |
| `skill_call` | Full skill invocation with resolved context args |
| `topic` | Brief description for the agent |

### wave-{N}-results.csv (Per-Wave Output)

Written by `spawn_agents_on_csv`. Contains result per agent.
</csv_schema>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Template not found | Show --list, suggest closest match |
| E002 | error | Template JSON invalid | Point to file for fix |
| E003 | error | Required variable missing, user declined | Cannot proceed |
| E004 | error | DAG cycle in template | Suggest $maestro-composer --edit |
| E005 | error | Resume session not found | List sessions |
| E006 | error | Wave timeout | Mark failed, abort chain |
| E007 | error | Barrier artifact not found | Retry wave once, then abort |
| W001 | warning | Runtime reference resolved to empty | Log, continue |
| W002 | warning | Barrier artifact partial | Continue with available context |
</error_codes>

<success_criteria>
- [ ] Template loaded from `~/.maestro/templates/workflows/` and validated
- [ ] All required context variables bound
- [ ] Session dir at `.workflow/.maestro-coordinate/MCP-*/` with `state.json`
- [ ] DAG nodes converted to waves (barrier=solo, non-barrier=parallel)
- [ ] Every skill invocation goes through `spawn_agents_on_csv` — none in coordinator
- [ ] Checkpoint nodes handled inline (state save, optional user pause)
- [ ] Barrier artifacts read and context updated before next wave
- [ ] Runtime references ({N-xxx.field}, {prev_*}) resolved before each wave CSV
- [ ] Failed step → remaining marked skipped → abort reported
- [ ] `--dry-run` shows wave plan with [BARRIER] markers, no execution
- [ ] `-c` resumes from last completed wave
- [ ] Completion report with per-wave status
</success_criteria>
