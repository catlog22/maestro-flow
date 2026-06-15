---
name: odyssey-planex
description: Requirement-driven iterative cycle — plan, execute, strict verify, fix loop until acceptance criteria met
argument-hint: "<requirement> [--scope <path>] [--max-iterations N] [--auto] [-y] [-c]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Requirement-to-delivery closed loop: parse requirement → define strict acceptance criteria →
plan tasks → execute → verify against criteria → fix gaps → iterate until ALL criteria pass.

Unlike `maestro-execute` (single-pass task execution), this command treats acceptance criteria
as an iron gate. Every verify failure triggers a targeted fix cycle. The loop continues until
the requirement is fully met or max iterations reached.

Core philosophy:
- **Acceptance criteria are sacred** — no "close enough", no manual override
- **Iterate, don't restart** — each fix cycle targets only the failing criteria
- **CLI-assisted verification** — delegate to external tools for objective quality checks
- **Evidence-based progress** — every iteration logged with pass/fail per criterion
</purpose>

<context>
$ARGUMENTS — requirement description and optional flags.

**Flags:**
- `--scope <path>`: Restrict implementation scope (default: inferred from requirement)
- `--max-iterations N`: Max verify→fix cycles before escalation (default: 3)
- `--auto`: CLI delegate calls without confirmation
- `-y`: Auto-confirm — decisions recorded as `deferred`, no blocking prompts
- `-c`: Resume most recent session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-planex-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # session state + criteria + iterations + plan
  ├── evidence.ndjson    # ALL evidence (phase distinguishes origin)
  └── understanding.md   # evolving narrative across all sections
```

**session.json schema:**
```json
{
  "session_id": "planex-odyssey-{YYYYMMDD-HHmmss}",
  "requirement": "", "scope": null,
  "flags": { "max_iterations": 3, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "acceptance_criteria": [],
  "plan": null,
  "iterations": [],
  "current_iteration": 0,
  "phase_goals": [], "phase_goals_all_done": false,
  "created_at": "", "updated_at": ""
}
```

**acceptance_criteria[] schema:**
```json
[
  {"id":"AC1","criterion":"","verify_method":"test|grep|cli-review|manual","status":"pending","evidence":"","passed_at":null}
]
```

**iterations[] schema:**
```json
[
  {"iteration":1,"started_at":"","completed_at":"","criteria_before":{"passed":0,"total":0},"criteria_after":{"passed":0,"total":0},"gaps_fixed":[],"files_modified":[]}
]
```

**evidence.ndjson phases:** `planning`, `execution`, `verification`, `fix`, `decision`

**understanding.md sections:**
1. Requirement & Acceptance Criteria ← S_INTAKE
2. Plan ← S_PLAN
3. Execution Summary ← S_EXECUTE
4. Verification Results (per iteration) ← S_VERIFY
5. Fix Log (per iteration) ← S_FIX
6. Learnings ← S_RECORD

**phase_goals[]:**
```json
[
  {"id":"G1","goal":"Acceptance criteria defined","done_when":"≥1 criterion in acceptance_criteria[]","phase":"S_INTAKE","status":"pending","completion_confirmed":false},
  {"id":"G2","goal":"Plan created","done_when":"session.json.plan populated with tasks","phase":"S_PLAN","status":"pending","completion_confirmed":false},
  {"id":"G3","goal":"Implementation complete","done_when":"all plan tasks executed","phase":"S_EXECUTE","status":"pending","completion_confirmed":false},
  {"id":"G4","goal":"All criteria pass","done_when":"all acceptance_criteria[].status == passed","phase":"S_VERIFY","status":"pending","completion_confirmed":false},
  {"id":"G5","goal":"Learnings persisted","done_when":"spec entries created OR no actionable","phase":"S_RECORD","status":"pending","completion_confirmed":false}
]
```
</context>

<state_machine>

<states>
S_INTAKE    — 解析需求、定义验收标准                    PERSIST: session.json + understanding.md §1
S_PLAN      — 分解任务、生成执行计划                    PERSIST: session.json.plan + evidence.ndjson (phase=planning) + understanding.md §2
S_EXECUTE   — 实现任务                                  PERSIST: code changes + evidence.ndjson (phase=execution) + understanding.md §3
S_VERIFY    — 严格验证：逐条检查 acceptance_criteria     PERSIST: evidence.ndjson (phase=verification) + understanding.md §4
S_FIX       — 修复未通过的 criteria（循环回 S_VERIFY）   PERSIST: code changes + evidence.ndjson (phase=fix) + understanding.md §5
S_RECORD    — 知识沉淀                                  PERSIST: understanding.md §6 + spec entries
</states>

<transitions>

S_INTAKE:
  → S_INTAKE    WHEN: -c + session found               DO: A_RESUME
  → S_PLAN      WHEN: requirement + criteria defined    DO: A_INTAKE
  → S_INTAKE    WHEN: no requirement                   DO: AskUserQuestion "描述需求"

S_PLAN:
  → S_EXECUTE   DO: A_PLAN

S_EXECUTE:
  → S_VERIFY    DO: A_EXECUTE

S_VERIFY:
  → S_RECORD    WHEN: all criteria passed               DO: A_VERIFY
  → S_FIX       WHEN: some criteria failed AND iteration < max   DO: A_VERIFY
  → S_RECORD    WHEN: some criteria failed AND iteration >= max  DO: A_VERIFY (escalate)

S_FIX:
  → S_VERIFY    DO: A_FIX (loop back)

S_RECORD:
  → END         DO: A_RECORD

</transitions>

<actions>

### A_INTAKE

1. Parse requirement, flags, scope
2. Generate slug, create `SESSION_DIR`
3. **Define acceptance criteria** — the core of this command:
   - Analyze requirement → derive testable criteria
   - Each criterion gets a `verify_method`: `test` (run test), `grep` (code pattern check), `cli-review` (delegate), `manual` (user confirms)
   - **Normal**: `AskUserQuestion` to confirm/edit criteria list
   - **`-y`**: auto-derive, record `{"phase":"decision","type":"criteria-confirmation","status":"deferred"}`
4. Search prior knowledge: `maestro search`, related sessions
5. Derive `phase_goals[]`, write `session.json` + `understanding.md` §1
6. Display Goal Prompt (Appendix)

### A_PLAN

1. Decompose requirement into ordered tasks based on acceptance criteria
2. CLI-assisted planning (optional):
   ```bash
   maestro delegate "PURPOSE: Create implementation plan for: {requirement}
   TASK: Decompose into ordered subtasks | Identify dependencies | Map tasks to acceptance criteria
   MODE: analysis
   CONTEXT: @{scope}/**/* | Criteria: {acceptance_criteria_summary}
   EXPECTED: JSON [{task_id, title, description, criteria_refs, deps, estimated_complexity}]
   " --role analyze --mode analysis
   ```
   Run_in_background, STOP, wait.
3. Write `session.json.plan`:
   ```json
   {"tasks":[{"id":"T1","title":"","description":"","criteria_refs":["AC1"],"status":"pending","files_modified":[]}],"created_at":""}
   ```
4. Append `evidence.ndjson` (phase: "planning"), update `understanding.md` §2
5. Mark `phase_goals[G2]` done. Save `current_state = "S_EXECUTE"`

### A_EXECUTE

1. Execute plan tasks sequentially:
   - For each task: implement code changes
   - Record: `evidence.ndjson` (phase: "execution"):
     ```json
     {"ts":"","phase":"execution","type":"task-completed","task_id":"T1","files_modified":[],"summary":""}
     ```
   - Update task `status = "completed"` in `session.json.plan.tasks[]`
2. Update `understanding.md` §3 with execution summary
3. Mark `phase_goals[G3]` done. Save `current_state = "S_VERIFY"`

### A_VERIFY

The iron gate — every acceptance criterion checked objectively.

**Step 1 — Verify each criterion by its method:**

| Method | Verification |
|--------|-------------|
| `test` | Run relevant tests, check pass/fail |
| `grep` | Grep for expected pattern, check exists/absent |
| `cli-review` | `maestro delegate --role review --mode analysis` with criterion as focus |
| `manual` | **Normal**: AskUserQuestion "AC{N} 是否满足？" / **`-y`**: record `deferred` |

**Step 2 — Record results per criterion:**
```json
{"ts":"","phase":"verification","type":"criterion-check","criterion_id":"AC1","method":"","result":"passed|failed","evidence":"","iteration":1}
```
Update `acceptance_criteria[].status` in `session.json`.

**Step 3 — Assess iteration:**
```json
// Append to session.json.iterations[]
{"iteration":N,"started_at":"","completed_at":"","criteria_before":{"passed":M,"total":T},"criteria_after":{"passed":P,"total":T},"gaps_fixed":[],"files_modified":[]}
```

Update `understanding.md` §4 with per-criterion pass/fail table.

**Step 4 — Route:**
- All passed → mark `phase_goals[G4]` done → S_RECORD
- Some failed + iteration < max → S_FIX
- Some failed + iteration >= max:
  - **Normal**: AskUserQuestion — 继续迭代 / 降低标准 / 接受现状
  - **`-y`**: record `{"phase":"decision","type":"max-iteration","status":"deferred"}`, proceed to S_RECORD

### A_FIX

Targeted fix for failing criteria only.

1. Increment `session.json.current_iteration`
2. For each failed criterion:
   - Diagnose: Read code + evidence → identify gap
   - Fix: targeted code change addressing only this criterion
   - Record: `evidence.ndjson` (phase: "fix"):
     ```json
     {"ts":"","phase":"fix","type":"criterion-fix","criterion_id":"AC1","description":"","files_modified":[],"iteration":N}
     ```
3. CLI-assisted fix review (if not `--auto` skip):
   ```bash
   maestro delegate "PURPOSE: Review fixes for failing criteria
   TASK: Check fix correctness | Verify no regressions on passing criteria
   MODE: analysis
   CONTEXT: @{modified_files} | Passing: {passing_criteria} | Fixed: {fixed_criteria}
   EXPECTED: JSON {verdict, regression_risk, concerns}
   " --role review --mode analysis
   ```
4. Update `understanding.md` §5 with fix log
5. → S_VERIFY (loop back)

### A_RECORD

**Step 1 — Final understanding.md §6:** iteration summary, what worked, what needed rework.

**Step 2 — Persist learnings:**
| Condition | Action |
|-----------|--------|
| Criterion required multiple fix cycles | `Skill("spec-add", "debug ...")` |
| Reusable implementation pattern | `Skill("spec-add", "coding ...")` |
| Acceptance criteria template | `Skill("spec-add", "review ...")` |

**Step 3 — Pending decisions:**
- **Normal**: display, AskUserQuestion.
- **`-y`**: display deferred count.

**Step 4 — Goal audit:** check `phase_goals[*].completion_confirmed`.

**Step 5 — Completion:**
```
--- PLANEX ODYSSEY COMPLETE ---
Requirement: {requirement}
Criteria:    {passed}/{total} passed
Iterations:  {N} cycles
Fix cycles:  {total_fixes} fixes across {iterations} iterations
Decisions:   {N} resolved, {M} pending, {K} deferred
Learnings:   {N} spec entries
Goals:       {done}/{total} confirmed ({skipped} skipped)
Status:      {ALL_PASSED|PARTIAL|ESCALATED}
---
```

</actions>

<appendix>

### Goal Prompt Template

```
📋 Planex Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 直到 {SESSION_DIR}/session.json 的 acceptance_criteria[*] 全部 status==passed
且 phase_goals_all_done=true 才停。每轮以 session.json 为唯一行动手册。
verify 失败时自动进入 fix 循环，不超过 max_iterations 次。
遇到 phase=decision 的 pending 条目必须 AskUserQuestion，不得自行 resolve。
```

### `-y` Auto-Confirm Behavior

| 决策点 | Normal | `-y` |
|--------|--------|------|
| S_INTAKE 验收标准确认 | AskUserQuestion | auto-derive, `deferred` |
| S_VERIFY manual 类型标准 | AskUserQuestion | `deferred` |
| S_VERIFY max iteration 达标 | AskUserQuestion | auto accept, `deferred` |
| S_RECORD 决策清单 | AskUserQuestion | skip |
| S_RECORD 目标审计 | AskUserQuestion | auto accept |

### Iteration Model

```
S_EXECUTE → S_VERIFY ──all pass──→ S_RECORD
                │
           some fail + iter < max
                │
                ▼
             S_FIX ──→ S_VERIFY (loop)
```

Max iterations (default 3) prevents infinite loops. Each iteration records:
- Which criteria were failing before
- What was fixed
- Which criteria pass after

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No requirement provided | Provide requirement |
| E002 | error | --scope path not found | Check path |
| E003 | error | Resume but no session | Start new |
| E004 | error | Delegate failed | Retry or proceed |
| W001 | warning | No acceptance criteria derived | Manual definition needed |
| W002 | warning | Max iterations reached, criteria still failing | Escalate |
| W003 | warning | CLI review regression concern | Review before next iteration |
| W004 | warning | Delegate parse failed | Raw output |
</error_codes>

<success_criteria>
- [ ] Requirement parsed and acceptance criteria defined (≥1 criterion)
- [ ] Each criterion has verify_method assigned
- [ ] Plan created with tasks mapped to criteria
- [ ] Tasks executed with evidence logged
- [ ] Every criterion verified by its method after each iteration
- [ ] Failing criteria trigger targeted fix (not full re-implementation)
- [ ] Iteration count tracked, max respected
- [ ] CLI review on fixes for regression check
- [ ] understanding.md §4 updated per iteration with pass/fail table
- [ ] phase_goals tracked and audited
- [ ] Goal Prompt displayed
- [ ] `-y` mode: no blocking prompts, deferred counted
- [ ] Session resumable via -c
- [ ] Completion summary with iteration stats
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| All criteria passed | `/quality-review-odyssey <changed-files>` |
| Max iterations, still failing | `/quality-debug-odyssey "<failing criterion>"` |
| Want formal review | `/quality-review <phase>` |
| Issues from fix cycles | `/manage-issue list --source planex-odyssey` |
</next_step_routing>
