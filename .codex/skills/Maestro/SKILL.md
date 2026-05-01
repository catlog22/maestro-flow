---
name: maestro
description: Intelligent coordinator — analyze intent, read project state, select chain, execute wave-by-wave via spawn_agents_on_csv. Coordinator only assembles prompts and reads artifacts — never executes skills directly.
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--super]"
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

<deferred_reading>
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag is active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special flags.

**Flags:**
- `-y, --yes` — Auto mode: skip all prompts; propagate `-y` to each skill
- `--continue` — Resume latest paused session from last incomplete wave
- `--dry-run` — Display planned chain without executing
- `--super` — Super mode: deliver production-ready complete software system. Read `maestro-super.md` from deferred_reading, then follow it completely.

**Session state**: `.workflow/.maestro/{session-id}/`
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
| `maestro-roadmap` | `.workflow/.csv-wave/*/specs/` | `spec_session_id` |
| `maestro-execute` | `.workflow/.csv-wave/*/results.csv` | `exec_status`, `completed_tasks`, `failed_tasks` |

**Non-barrier skills** (groupable into multi-task waves): `maestro-verify`, `quality-review`, `quality-test`, `quality-debug`, `quality-refactor`, `quality-sync`, `manage-*`

### Barrier Analysis Logic

After each barrier skill completes, read its artifacts and update `state.context`:

| Barrier Skill | Read | Context Updates |
|---------------|------|-----------------|
| `maestro-analyze` | `{artifacts}/context.md` | `analysis_dir`, `gaps` (extracted), `phase` (if unset) |
| `maestro-plan` | `{artifacts}/plan.json` | `plan_dir`, `task_count`, `wave_count` from plan JSON |
| `maestro-brainstorm` | `{artifacts}/` | `brainstorm_dir` |
| `maestro-roadmap` | `{artifacts}/` | `spec_session_id` (extracted) |
| `maestro-execute` | `{artifacts}/results.csv` | `exec_completed`, `exec_failed` (counted by status) |
</barrier_skills>

<execution>

### Phase 1: Resolve Intent and Chain

**`--continue`**: Glob `.workflow/.maestro/maestro-*/status.json` sorted desc; load most recent; resume from first pending wave.

**Fresh mode**:
1. Read `.workflow/state.json` for project context (derive current phase from artifact registry, `workflow_name`)
2. Classify intent via keyword heuristics (see chain_map)
4. No match + not AUTO_YES → one clarifying question via `AskUserQuestion`
5. Resolve chain's skill list
6. Create session dir `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/` and write `status.json`:

```json
{
  "session_id": "maestro-{YYYYMMDD-HHMMSS}",
  "created_at": "ISO",
  "intent": "...",
  "task_type": "...",
  "chain_name": "...",
  "phase": null,
  "auto_mode": false,
  "exec_mode": "auto",
  "cli_tool": "codex",
  "gemini_session_id": null,
  "step_analyses": [],
  "context": { "plan_dir": null, "analysis_dir": null,
               "brainstorm_dir": null, "spec_session_id": null, "gaps": null },
  "waves": [],
  "steps": [{ "index": 0, "skill": "...", "args": "", "engine": null, "status": "pending", "started_at": null, "completed_at": null, "wave_n": null }],
  "current_step": 0,
  "status": "running"
}
```

7. **Initialize plan tracking** (dual-track: status.json + update_plan):

```
functions.update_plan({
  plan: steps.map((step, i) => ({
    id: `step-${i}`,
    title: `[${i + 1}/${steps.length}] ${step.skill}${barrier(step) ? ' [BARRIER]' : ''}`,
    status: "open"
  }))
})
```

**`--dry-run`**: Display chain with `[BARRIER]` markers, stop.

**User confirmation** (skip if AUTO_YES): Display plan, prompt `Proceed? (yes/no)`.

**`--continue` plan rebuild**: When resuming, rebuild `update_plan` from status.json — completed steps → `"completed"`, current → `"in_progress"`, rest → `"open"`.

### Phase 2: Wave Execution Loop

**While pending steps remain**, increment `waveNum` and repeat:

1. **Build wave**: Select next wave steps via `buildNextWave` (barrier = solo, non-barriers = grouped)
2. **Write CSV**: `{sessionDir}/wave-{N}.csv` with columns `id,skill_call,topic` — one row per step, skill_call assembled with resolved context
3. **Spawn**:
   ```
   spawn_agents_on_csv({
     csv_path: "{sessionDir}/wave-{N}.csv",
     id_column: "id", instruction: WAVE_INSTRUCTION,
     max_workers: <wave size>, max_runtime_seconds: 3600,
     output_csv_path: "{sessionDir}/wave-{N}-results.csv",
     output_schema: RESULT_SCHEMA
   })
   ```
4. **Read results**: Update each step's `status`, `wave_n` from results CSV
5. **Barrier check**: If wave was a barrier skill, run barrier analysis logic (read artifacts, update context)
6. **Dual-track persist**:
   - status.json: Append wave to `state.waves[]`, update step statuses, write `status.json`
   - update_plan: Sync plan items from status.json step statuses:
     ```
     functions.update_plan({
       plan: steps.map((step, i) => ({
         id: `step-${i}`,
         title: `[${i + 1}/${steps.length}] ${step.skill}`,
         status: step.status === 'completed' ? 'completed'
               : step.status === 'pending' && i === nextPendingIndex ? 'in_progress'
               : step.status
       }))
     })
     ```
7. **Abort on failure**: If any result `status === 'failed'` → mark remaining steps `skipped` in both status.json and update_plan, set `state.status = 'aborted'`, break

### Skill Call Assembly

**Barrier skills**: `maestro-analyze`, `maestro-plan`, `maestro-brainstorm`, `maestro-roadmap`, `maestro-execute`

**Auto-yes flag map** (appended when `status.auto_mode` is true):

| Skill | Flag |
|-------|------|
| `maestro-analyze`, `maestro-brainstorm`, `maestro-ui-design`, `maestro-roadmap` | `-y` |
| `maestro-plan` | `--auto` |
| `quality-test` | `--auto-fix` |
| `quality-retrospective` | `--auto-yes` |

**`buildSkillCall(step, ctx)`**: Replace placeholders `{phase}`, `{description}`, `{issue_id}`, `{plan_dir}`, `{analysis_dir}`, `{brainstorm_dir}`, `{spec_session_id}` in `step.args` with corresponding `ctx` values. Append auto-yes flag if applicable. Return `$<skill> <args>`.

**`buildNextWave(steps)`**: Take first pending step. If it is a barrier skill, return it solo. Otherwise, collect consecutive non-barrier pending steps into one wave (stop at first barrier).

### Sub-Agent Instruction Template

```
你是 CSV job 子 agent。

先原样执行这一段技能调用：
{skill_call}

然后基于结果完成这一行任务说明：
{topic}

限制：
- 不要修改 .workflow/.maestro/ 下的 status 文件
- skill 内部有自己的 session 管理，按 skill SKILL.md 执行即可

最后必须调用 `report_agent_job_result`，返回 JSON：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","artifacts":"产物路径或空字符串","error":"失败原因或空字符串"}
```

### Result Schema

Object with all fields required: `status` ("completed"|"failed"), `skill_call` (string), `summary` (string), `artifacts` (path or ""), `error` (reason or "").

### Phase 3: Completion Report

Finalize dual tracking:
- status.json: `state.status = 'completed'`
- update_plan: all steps → `"completed"` (skipped steps also marked completed)

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

State:    .workflow/.maestro/<sessionId>/status.json
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
| E002 | error | Intent unresolvable after retry | List available chains, abort |
| E003 | error | Wave timeout (max_runtime_seconds) | Mark step `failed`, abort chain |
| E004 | error | Barrier artifact not found | Retry wave once, then abort |
| E005 | error | `--continue`: no session found | List sessions, prompt |
| W001 | warning | Barrier artifact partial | Continue with available context |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain resolved (keyword heuristics or `--chain`)
- [ ] Session dir initialized with `status.json` before first wave
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
