---
name: maestro
description: Intelligent coordinator — analyze intent, read project state, select chain, execute wave-by-wave via spawn_agents_on_csv. Coordinator only assembles prompts and reads artifacts — never executes skills directly.
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--chain <name>]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based pipeline coordinator. All skill execution happens exclusively in spawned sub-agents
via `spawn_agents_on_csv` — the coordinator never executes skills directly.

Coordinator loop: classify intent → resolve chain → build wave CSV → spawn → read results →
(barrier: read artifacts, update context, assemble next skill_call args) → next wave → report.

Each wave = 1 barrier task (solo) or N parallel non-barrier tasks.
</purpose>

<required_reading>
@~/.maestro/workflows/maestro.codex.md — authoritative `detectTaskType`, `detectNextAction`, `chainMap` (35+ intent patterns, 40+ chain types). Read before executing any step.
</required_reading>

<context>
$ARGUMENTS — user intent text, or special flags.

**Flags:**
- `-y, --yes` — Auto mode: skip all prompts; propagate `-y` to each skill
- `--continue` — Resume latest paused session from last incomplete wave
- `--dry-run` — Display planned chain without executing
- `--chain <name>` — Force specific chain (skips intent classification)

**Session state**: `.workflow/.maestro-coordinate/{session-id}/`
**Core output**: `tasks.csv` (master) + `wave-{N}-results.csv` (per wave) + `context.md` (report)
</context>

<invariants>
1. **ALL skills via spawn_agents_on_csv**: Every skill invocation — barrier or non-barrier — MUST go through `spawn_agents_on_csv`. Coordinator NEVER directly executes any skill. No exceptions.
2. **Coordinator = prompt assembler only**: Classify intent → build CSV → spawn → read results → assemble next CSV. It never runs skill logic itself.
3. **Barrier ≠ execution**: Barrier designation only means the coordinator **pauses after the wave** to read artifacts and assemble the next wave's prompt args. Coordinator role at barrier: **discover artifacts → read → update context → assemble next skill_call args**. Nothing more.
4. **Barrier = solo wave**: A barrier skill always executes alone in its wave (wave size = 1).
5. **Non-barriers can parallel**: Consecutive non-barrier skills grouped into one wave (`max_workers = N`).
6. **Wave-by-wave**: Never start wave N+1 before wave N results are read and analyzed.
7. **Coordinator owns context**: Sub-agents never read prior results — coordinator assembles the full `skill_call` with resolved args.
8. **Simple instruction**: Sub-agent instruction is minimal — just "execute {skill_call}, report result".
9. **Abort on failure**: Failed step → mark remaining as skipped → report.
10. **Resume from wave**: `--continue` finds last completed wave, resumes from next pending step.
</invariants>

<chain_map>
| Intent keywords | Chain | Steps (skills, in order) |
|----------------|-------|--------------------------|
| fix, bug, error, broken, crash | `quality-fix` | $maestro-analyze --gaps → $maestro-plan --gaps → $maestro-execute → $maestro-verify |
| test, spec, coverage | `quality-test` | $quality-test |
| refactor, cleanup, debt | `quality-refactor` | $quality-refactor |
| feature, implement, add, build | `feature` | $maestro-plan → $maestro-execute → $maestro-verify |
| review, check, audit | `quality-review` | $quality-review |
| deploy, release, ship | `deploy` | $maestro-verify → $maestro-milestone-release |
| brainstorm, explore, ideate | `brainstorm-driven` | $maestro-brainstorm → $maestro-plan → $maestro-execute → $maestro-verify |
| plan, design, architect | `plan` | $maestro-plan |
| debug, diagnose, troubleshoot | `debug` | $quality-debug |
| continue, next, go | `state_continue` | (from project state) |
| status, dashboard | `status` | $manage-status |

Full chain map with 40+ chains: see `@~/.maestro/workflows/maestro.codex.md` §3c
</chain_map>

<barrier_skills>
Skills that produce artifacts the coordinator must read before assembling the next wave.
After a barrier skill completes **in its spawned sub-agent**, coordinator reads output and updates `state.context`.

| Skill | Artifacts to Read | Context Updates |
|-------|------------------|-----------------|
| `maestro-analyze` | `.workflow/.csv-wave/*/context.md`, `state.json` | `gaps`, `phase`, `analysis_dir` |
| `maestro-plan` | `{artifact_dir}/plan.json`, `{artifact_dir}/.task/TASK-*.json` | `plan_dir`, `task_count`, `wave_count` |
| `maestro-brainstorm` | `.workflow/.csv-wave/*/.brainstorming/` | `brainstorm_dir`, `features` |
| `maestro-spec-generate` | `.workflow/.csv-wave/*/specs/` | `spec_session_id` |
| `maestro-execute` | `.workflow/.csv-wave/*/results.csv` | `exec_status`, `completed_tasks`, `failed_tasks` |

**Non-barrier skills** (groupable into multi-task waves): `maestro-verify`, `quality-review`, `quality-test`, `quality-debug`, `quality-refactor`, `quality-sync`, `manage-*`

### Barrier Analysis Logic

```javascript
function analyzeBarrierArtifacts(step, result, ctx) {
  const artifactPath = result.artifacts;
  switch (step.skill) {
    case 'maestro-analyze':
      const contextMd = Read(`${artifactPath}/context.md`);
      ctx.analysis_dir = artifactPath;
      ctx.gaps = extractGaps(contextMd);
      if (!ctx.phase) ctx.phase = extractPhase(contextMd);
      break;
    case 'maestro-plan':
      const planJson = JSON.parse(Read(`${artifactPath}/plan.json`));
      ctx.plan_dir = artifactPath;
      ctx.task_count = planJson.tasks?.length ?? 0;
      ctx.wave_count = planJson.waves?.length ?? 0;
      break;
    case 'maestro-brainstorm':
      ctx.brainstorm_dir = artifactPath;
      break;
    case 'maestro-spec-generate':
      ctx.spec_session_id = extractSpecId(artifactPath);
      break;
    case 'maestro-execute':
      const execResults = Read(`${artifactPath}/results.csv`);
      ctx.exec_completed = countStatus(execResults, 'completed');
      ctx.exec_failed = countStatus(execResults, 'failed');
      break;
  }
}
```
</barrier_skills>

<execution>

### Phase 1: Resolve Intent and Chain

**`--continue`**: Glob `.workflow/.maestro-coordinate/MCC-*/state.json` sorted desc; load most recent; resume from first pending wave.

**Fresh mode**:
1. Read `.workflow/state.json` for project context (derive current phase from artifact registry, `workflow_name`)
2. If `--chain` given, use directly
3. Otherwise classify intent via keyword heuristics (see chain_map)
4. No match + not AUTO_YES → one clarifying question via `AskUserQuestion`
5. Resolve chain's skill list
6. Write `state.json`:

```javascript
const sessionId = `MCC-${dateStr}-${timeStr}`;
const sessionDir = `.workflow/.maestro-coordinate/${sessionId}`;

Write(`${sessionDir}/state.json`, JSON.stringify({
  id: sessionId, intent, chain: resolvedChain, auto_yes: AUTO_YES,
  status: "in_progress", started_at: new Date().toISOString(),
  context: { phase: null, plan_dir: null, analysis_dir: null,
             brainstorm_dir: null, spec_session_id: null, gaps: null },
  waves: [],
  steps: chain.map((skill, i) => ({
    step_n: i + 1, skill: skill.cmd, args: skill.args ?? '',
    status: "pending", wave_n: null
  }))
}, null, 2));
```

**`--dry-run`**: Display chain with `[BARRIER]` markers, stop.

**User confirmation** (skip if AUTO_YES): Display plan, prompt `Proceed? (yes/no)`.

### Phase 2: Wave Execution Loop

```javascript
let waveNum = 0;
while (state.steps.some(s => s.status === 'pending')) {
  waveNum++;
  const waveSteps = buildNextWave(state.steps);

  // Build CSV — coordinator assembles skill_call, sub-agent executes verbatim
  const csvContent = 'id,skill_call,topic\n' + waveSteps.map(step =>
    `"${step.step_n}","${buildSkillCall(step, state.context).replace(/"/g, '""')}","Chain \"${state.chain}\" step ${step.step_n}/${state.steps.length}"`
  ).join('\n');
  Write(`${sessionDir}/wave-${waveNum}.csv`, csvContent);

  // Spawn — ALL execution via spawn_agents_on_csv, never direct
  spawn_agents_on_csv({
    csv_path: `${sessionDir}/wave-${waveNum}.csv`,
    id_column: "id", instruction: WAVE_INSTRUCTION,
    max_workers: waveSteps.length > 1 ? waveSteps.length : 1,
    max_runtime_seconds: 1800,
    output_csv_path: `${sessionDir}/wave-${waveNum}-results.csv`,
    output_schema: RESULT_SCHEMA
  });

  // Read results, update status
  const results = readCSV(`${sessionDir}/wave-${waveNum}-results.csv`);
  for (const row of results) {
    const step = state.steps.find(s => s.step_n === parseInt(row.id));
    step.status = row.status; step.findings = row.findings; step.wave_n = waveNum;
  }

  // Barrier: read artifacts, update context (NOT execute — skill already ran in sub-agent)
  if (isBarrier(waveSteps[0].skill)) {
    analyzeBarrierArtifacts(waveSteps[0], results[0], state.context);
  }

  // Persist + abort check
  state.waves.push({ wave_n: waveNum, steps: waveSteps.map(s => s.step_n), results });
  Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));

  if (results.some(r => r.status === 'failed')) {
    state.status = 'aborted';
    state.steps.filter(s => s.status === 'pending').forEach(s => s.status = 'skipped');
    Write(`${sessionDir}/state.json`, JSON.stringify(state, null, 2));
    break;
  }
}
```

### Skill Call Assembly

```javascript
const BARRIER_SKILLS = new Set([
  'maestro-analyze', 'maestro-plan', 'maestro-brainstorm',
  'maestro-spec-generate', 'maestro-execute'
]);
const AUTO_FLAG_MAP = {
  'maestro-analyze': '-y', 'maestro-brainstorm': '-y',
  'maestro-ui-design': '-y', 'maestro-plan': '--auto',
  'maestro-spec-generate': '-y', 'quality-test': '--auto-fix',
  'quality-retrospective': '--auto-yes',
};

function buildSkillCall(step, ctx) {
  let args = (step.args ?? '')
    .replace(/{phase}/g, ctx.phase ?? '')
    .replace(/{description}/g, state.intent ?? '')
    .replace(/{issue_id}/g, ctx.issue_id ?? '')
    .replace(/{plan_dir}/g, ctx.plan_dir ?? '')
    .replace(/{analysis_dir}/g, ctx.analysis_dir ?? '')
    .replace(/{brainstorm_dir}/g, ctx.brainstorm_dir ?? '')
    .replace(/{spec_session_id}/g, ctx.spec_session_id ?? '');
  if (state.auto_yes) {
    const flag = AUTO_FLAG_MAP[step.skill];
    if (flag && !args.includes(flag)) args = args ? `${args} ${flag}` : flag;
  }
  return `$${step.skill} ${args}`.trim();
}

function buildNextWave(steps) {
  const pending = steps.filter(s => s.status === 'pending');
  if (!pending.length) return [];
  if (BARRIER_SKILLS.has(pending[0].skill)) return [pending[0]];
  const wave = [pending[0]];
  for (let i = 1; i < pending.length; i++) {
    if (BARRIER_SKILLS.has(pending[i].skill)) break;
    wave.push(pending[i]);
  }
  return wave;
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

### Phase 3: Completion Report

```
=== COORDINATE COMPLETE ===
Session:  <sessionId>
Chain:    <chain>
Waves:    <N> executed
Steps:    <completed>/<total>

WAVE RESULTS:
  [W1] $maestro-analyze --gaps  →  ✓  found 3 gaps
  [W2] $maestro-plan --gaps     →  ✓  12 tasks in 3 waves
  [W3] $maestro-execute         →  ✓  12/12 tasks done
  [W4] $maestro-verify          →  ✓  all criteria met

State:    .workflow/.maestro-coordinate/<sessionId>/state.json
Resume:   $maestro --continue
```
</execution>

<csv_schema>
### wave-{N}.csv (Per-Wave Input)

```csv
id,skill_call,topic
"1","$maestro-analyze --gaps \"fix auth\" -y","Chain \"quality-fix\" step 1/4"
```

| Column | Description |
|--------|-------------|
| `id` | Step number from chain (string) |
| `skill_call` | Full skill invocation assembled by coordinator with resolved context |
| `topic` | Brief description for the agent |

### tasks.csv (Master State)

```csv
id,skill,args,wave_n,status,findings,artifacts,error
```

Accumulated across all waves. Updated after each wave completes.
</csv_schema>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent unclassifiable after clarification | Default to `feature` chain |
| E002 | error | `--chain` value not in chain map | List valid chains, abort |
| E003 | error | Wave timeout (max_runtime_seconds) | Mark step `failed`, abort chain |
| E004 | error | Barrier artifact not found | Retry wave once, then abort |
| E005 | error | `--continue`: no session found | List sessions, prompt |
| W001 | warning | Barrier artifact partial | Continue with available context |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain resolved (keyword heuristics or `--chain`)
- [ ] Session dir initialized with `state.json` before first wave
- [ ] Every skill invocation goes through `spawn_agents_on_csv` — none executed in coordinator
- [ ] Barrier skills execute solo in their wave; coordinator only reads artifacts afterward
- [ ] Non-barrier skills grouped into parallel waves where possible
- [ ] Each wave: CSV built → spawned → results read → state updated
- [ ] Barrier artifacts read and context updated before assembling next wave's skill_call args
- [ ] Failed step → remaining marked skipped → abort reported
- [ ] Completion report with per-wave status written to `context.md`
- [ ] `--dry-run` shows chain with [BARRIER] markers, no execution
- [ ] `--continue` resumes from last incomplete wave
</success_criteria>
