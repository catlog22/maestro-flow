---
name: maestro-player
description: Play workflow templates with checkpoint resume
argument-hint: "<template-slug|path> [--context key=value...] [-c [session-id]] [--list] [--dry-run]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based template executor via `spawn_agents_on_csv`. Load template → bind variables → topological sort → group into barrier/non-barrier waves → spawn wave-by-wave → read results → report.

Session: `.workflow/.maestro/MCP-{YYYYMMDD-HHmmss}/state.json`
</purpose>

<invariants>
1. **ALL skills via spawn_agents_on_csv**: Coordinator NEVER directly executes any skill
2. **Coordinator = prompt assembler**: Load → resolve refs → build CSV → spawn → read results → next CSV
3. **Barrier = solo wave**: Checkpoint + artifact-producing skills execute alone
4. **Non-barriers can parallel**: Grouped into one wave
5. **Wave-by-wave**: Never start N+1 before N results read
6. **Coordinator owns context**: Sub-agents never read prior results — coordinator assembles full skill_call
7. **Resume from wave**: `-c` finds last completed wave, resumes next
</invariants>

<context>
$ARGUMENTS — template slug/path, or flags.

**Flags**: `--context key=value` (repeatable), `-c [session-id]` (resume), `--list`, `--dry-run`

**Entry routing**:

| Condition | Handler |
|-----------|---------|
| `--list` or no args | Scan index.json, display templates |
| `-c [session-id]` | S_RESUME |
| Template slug/path | S_LOAD |

**Barrier nodes** (solo wave, coordinator reads artifacts after):

| Node type | Artifacts to read | Context updates |
|-----------|------------------|-----------------|
| checkpoint | — | last_checkpoint |
| maestro-plan | plan.json, .task/ | plan_dir, task_count |
| maestro-execute | results.csv | exec_status |
| maestro-analyze | context.md | analysis_dir, gaps |
| maestro-brainstorm | .brainstorming/ | brainstorm_dir |
| maestro-roadmap | specs/ | spec_session_id |

**state.json schema**:
```json
{
  "id": "MCP-<YYYYMMDD>-<HHmmss>",
  "intent": "<template_name> with context",
  "chain": "<template_id>",
  "template_path": "<path>",
  "auto_yes": false,
  "status": "in_progress|paused|completed|aborted",
  "context": { "goal": "...", "phase": null, "plan_dir": null, "last_checkpoint": null },
  "waves": [],
  "steps": [{
    "step_n": 1, "node_id": "N-001", "skill": "<executor>",
    "args": "<args_template>", "type": "skill|cli|checkpoint",
    "is_barrier": true, "status": "pending|completed|failed|skipped",
    "wave_n": null, "findings": null, "artifacts": null
  }]
}
```

**Runtime reference resolution** (before each wave CSV):
- `{key}` → context[key]
- `{N-xxx.field}` → completed step with matching node_id
- `{prev_field}` → most recently completed non-checkpoint step

**CSV schemas**:

wave-{N}.csv (input): `id,skill_call,topic`
wave-{N}-results.csv (output): from spawn_agents_on_csv result schema
</context>

<state_machine>

<states>
S_ROUTE      — 入口路由                                  PERSIST: —
S_RESUME     — 恢复 session                              PERSIST: —
S_LOAD       — 加载模板、绑定变量                         PERSIST: —
S_INIT       — 拓扑排序、分组 waves、创建 session          PERSIST: state.json
S_WAVE_LOOP  — 逐 wave 执行（核心循环）                   PERSIST: state.json (每 wave 更新)
S_COMPLETE   — 标记完成、输出报告                         PERSIST: state.json (final)
</states>

<transitions>

S_ROUTE:
  → handleList   WHEN: --list or no args
  → S_RESUME     WHEN: -c flag
  → S_LOAD       WHEN: template provided

S_RESUME:
  → S_WAVE_LOOP  WHEN: session found                    DO: load state, resume from next pending wave
  → ERROR(E005)  WHEN: no session found

S_LOAD:
  → S_INIT       DO: A_LOAD_AND_BIND

S_INIT:
  → END          WHEN: --dry-run                        DO: display wave plan with [BARRIER] markers
  → S_WAVE_LOOP  DO: A_INIT_SESSION

S_WAVE_LOOP:
  → S_WAVE_LOOP  WHEN: wave completed, more pending     DO: A_EXECUTE_WAVE → advance
  → S_COMPLETE   WHEN: all steps completed
  → END          WHEN: checkpoint pause                 DO: set status=paused
  → END          WHEN: wave failed                      DO: mark remaining skipped, set status=aborted
  GUARD: checkpoint nodes → handle inline (no spawn), save snapshot, optional user pause

S_COMPLETE:
  → END          DO: display per-wave results, set status=completed

</transitions>

<actions>

### A_LOAD_AND_BIND

1. Resolve template: absolute/relative/slug → index.json lookup
2. Parse --context key=value, validate template JSON
3. Collect missing required vars via request_user_input
4. Bind {variable} placeholders (leave {N-xxx.field}/{prev_*} for runtime)

### A_INIT_SESSION

1. Generate ID: MCP-{YYYYMMDD-HHmmss}
2. Topological sort (Kahn's) → classify barrier vs non-barrier → group into waves
3. Build steps array, write state.json
4. Display wave plan (template, session, context, waves with [BARRIER] markers)

### A_EXECUTE_WAVE

1. **Checkpoint**: handle inline — save snapshot, update context.last_checkpoint, mark completed. If auto_continue==false: request_user_input (Continue/Pause/Abort).

2. **Skill nodes**: resolve runtime references → write wave-{N}.csv (only rows with status == "pending") → spawn:
```
spawn_agents_on_csv({
  csv_path: "wave-{N}.csv", id_column: "id",
  instruction: SUB_AGENT_INSTRUCTION,
  max_concurrency: waveSteps.length, max_runtime_seconds: 3600,
  output_csv_path: "wave-{N}-results.csv", output_schema: RESULT_SCHEMA
})
```

3. Read results → map `result_status` → master step `status`; copy `summary` into findings and `artifacts` into the step artifact list
4. **Barrier analysis**: read artifacts, update context per barrier table
5. Append wave record to state.waves[], persist state.json

### SUB_AGENT_INSTRUCTION

```
你是 CSV job 子 agent。
先原样执行技能调用：{skill_call}
然后基于结果完成任务说明：{topic}
限制：不要修改 .workflow/.maestro/ 下的 state 文件
最后必须调用 report_agent_job_result（无论成功/失败/超时都必须上报）。

TERMINATION CONTRACT（强制）：
  - 成功：result_status = completed，summary 描述产出
  - 失败：result_status = failed，error 写明原因
  - 超时：临近 max_runtime_seconds 时立即上报 result_status = failed，error = "timeout"
  - 禁止：无限循环、静默退出、跳过 report_agent_job_result

OUTPUT（必须匹配 output_schema）：
{"id":"<row id>","result_status":"completed|failed","skill_call":"...","summary":"一句话","artifacts":"路径或空","error":"原因或空"}
```

### RESULT_SCHEMA

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "skill_call":    { "type": "string" },
    "summary":       { "type": "string", "maxLength": 500 },
    "artifacts":     { "type": "string" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "summary"]
}
```

</actions>

</state_machine>

<error_codes>
| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | Template not found | Show --list |
| E002 | Template JSON invalid | Point to file |
| E004 | DAG cycle | Suggest maestro-composer --edit |
| E005 | Resume session not found | List sessions |
| E007 | Barrier artifact not found | Retry once, then abort |
</error_codes>

<success_criteria>
- [ ] DAG nodes grouped into barrier (solo) / non-barrier (parallel) waves
- [ ] Every skill via spawn_agents_on_csv, none in coordinator
- [ ] Barrier artifacts read and context updated before next wave
- [ ] Failed step → remaining skipped → abort reported
- [ ] -c resumes from last completed wave
</success_criteria>
