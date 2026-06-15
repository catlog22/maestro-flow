---
name: odyssey-planex
description: Requirement-driven iterative cycle — plan, execute, strict verify, fix loop until acceptance criteria met
argument-hint: "<requirement> [--scope <path>] [--max-iterations N] [--auto] [-y] [-c]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Requirement-to-delivery closed loop: parse requirement → define strict acceptance criteria →
plan tasks → execute → verify against criteria → fix gaps → iterate until ALL criteria pass.

Unlike `$maestro-execute` (single-pass task execution), this treats acceptance criteria as an
iron gate. Every verify failure triggers a targeted fix cycle. The loop continues until the
requirement is fully met or max iterations reached.

Core philosophy:
- **Acceptance criteria are sacred** — no "close enough", no manual override
- **Iterate, don't restart** — each fix cycle targets only the failing criteria
- **CLI-assisted verification** — delegate to external tools for objective checks
- **Evidence-based progress** — every iteration logged with pass/fail per criterion
</purpose>

<context>
$ARGUMENTS — requirement description and optional flags.

**Flags:**
- `--scope <path>`: Restrict implementation scope
- `--max-iterations N`: Max verify→fix cycles (default: 3)
- `--auto`: CLI delegates without confirmation
- `-y`: Auto-confirm — decisions as `deferred`
- `-c`: Resume most recent session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-planex-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + criteria + iterations + plan + phase_goals
  ├── evidence.ndjson    # ALL evidence (phase distinguishes)
  └── understanding.md   # evolving narrative
```

**evidence.ndjson phases:** `planning`, `execution`, `verification`, `fix`, `decision`

**acceptance_criteria[]:**
```json
[{"id":"AC1","criterion":"","verify_method":"test|grep|cli-review|manual","status":"pending","evidence":"","passed_at":null}]
```

**iterations[]:**
```json
[{"iteration":1,"started_at":"","completed_at":"","criteria_before":{"passed":0,"total":0},"criteria_after":{"passed":0,"total":0},"gaps_fixed":[],"files_modified":[]}]
```

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Criteria defined | S_INTAKE | — |
| G2 | Plan created | S_PLAN | — |
| G3 | Implementation complete | S_EXECUTE | — |
| G4 | All criteria pass | S_VERIFY | — |
| G5 | Learnings persisted | S_RECORD | — |
</context>

<csv_schema>

### Shared Output Schema

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "evidence":      { "type": "string" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination Contract:**
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv.
```

### tasks.csv

```csv
id,title,description,task_type,criterion_refs,deps,wave,status,findings,evidence,error
```

**Waves:**
- Wave 1: Verification agents (one per criterion with verify_method=cli-review) — parallel
</csv_schema>

<invariants>
1. **Acceptance criteria are iron gates** — no bypass, no "close enough"
2. **Fix targets failing criteria only** — never re-implement passing parts
3. **Iteration cap respected** — max_iterations prevents infinite loops
4. **Evidence append-only** — evidence.ndjson never modified
5. **Session is source of truth** — session.json holds all state
6. **Phase goal tracking** — each stage MUST mark its goal
7. **`-y` defers, never drops** — records `deferred`, never silently skips
8. **CLI delegate is background** — all `maestro delegate` use run_in_background
9. **Goal is outcome-oriented** — `/goal` user-bound
10. **Invariant violation = BLOCK**
</invariants>

<execution>

### Stage 1: Intake (S_INTAKE)

1. Parse requirement, flags, scope
2. Create `SESSION_DIR`
3. **Define acceptance criteria:**
   - Analyze requirement → derive testable criteria
   - Each gets `verify_method`: `test` | `grep` | `cli-review` | `manual`
   - **Normal**: `request_user_input` to confirm criteria
   - **`-y`**: auto-derive, record `deferred`
4. Search prior knowledge: `maestro search`, related sessions
5. Derive `phase_goals[]`, write `session.json` + `understanding.md` §1
6. Display **Goal Prompt block** (Appendix). Mark `phase_goals[G1]` done.

### Stage 2: Plan (S_PLAN)

1. Decompose requirement into tasks mapped to criteria
2. CLI-assisted planning (optional):
   ```bash
   maestro delegate "PURPOSE: Create plan for: {requirement}
   TASK: Decompose into subtasks | Map to acceptance criteria | Identify dependencies
   MODE: analysis
   CONTEXT: @{scope}/**/* | Criteria: {criteria_summary}
   EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]
   " --role analyze --mode analysis
   ```
   Run_in_background, STOP, wait.
3. Write `session.json.plan`, append `evidence.ndjson` (phase: "planning")
4. Update `understanding.md` §2. Mark `phase_goals[G2]` done. Save `current_state = "S_EXECUTE"`.

### Stage 3: Execute (S_EXECUTE)

1. Implement tasks sequentially
2. Per task: code changes → evidence.ndjson (phase: "execution") → update task status
3. Update `understanding.md` §3. Mark `phase_goals[G3]` done. Save `current_state = "S_VERIFY"`.

### Stage 4: Verify (S_VERIFY)

Iron gate — every acceptance criterion verified.

**Step 1 — Verify by method:**

| Method | Action |
|--------|--------|
| `test` | Run tests, check pass/fail |
| `grep` | Grep expected pattern |
| `cli-review` | `maestro delegate --role review` with criterion focus |
| `manual` | **Normal**: `request_user_input` / **`-y`**: `deferred` |

For `cli-review` criteria, use `spawn_agents_on_csv` (Wave 1):
```csv
"verify-AC1","Verify AC1","Review against criterion: {AC1.criterion}","verification","AC1","","1","pending","","",""
"verify-AC2","Verify AC2","Review against criterion: {AC2.criterion}","verification","AC2","","1","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: VERIFICATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

**Step 2 — Record results per criterion.** Append evidence.ndjson (phase: "verification").

**Step 3 — Route:**
- All passed → mark `phase_goals[G4]` done → S_RECORD
- Some failed + iteration < max → S_FIX
- Some failed + iteration >= max:
  - **Normal**: `request_user_input` — continue / lower bar / accept
  - **`-y`**: `deferred`, proceed to S_RECORD

Update `understanding.md` §4 with pass/fail table.

### Stage 5: Fix (S_FIX)

1. Increment iteration counter
2. For each failed criterion: diagnose gap → targeted fix
3. CLI fix review (optional): `maestro delegate --role review` for regression check
4. Append evidence.ndjson (phase: "fix"). Update `understanding.md` §5.
5. → S_VERIFY (loop back)

### Stage 6: Record (S_RECORD)

1. Finalize `understanding.md` §6: iteration summary, what needed rework
2. Persist learnings: `$spec-add` for patterns
3. Pending decisions: **Normal** → `request_user_input`. **`-y`** → skip.
4. Goal audit: check `phase_goals[*].completion_confirmed`
5. Mark `phase_goals[G5]` done. Completion:
   ```
   --- PLANEX ODYSSEY COMPLETE ---
   Requirement: {requirement}
   Criteria:    {passed}/{total} passed
   Iterations:  {N} cycles
   Decisions:   {N} resolved, {M} pending, {K} deferred
   Learnings:   {N} spec entries
   Goals:       {done}/{total} ({skipped} skipped)
   Status:      {ALL_PASSED|PARTIAL|ESCALATED}
   ---
   ```

**Next steps:** `$odyssey-review <changed-files>`, `$quality-debug-odyssey "<failing>"`,
`$quality-review <phase>`, `$manage-issue list --source odyssey-planex`
</execution>

<appendix>

### Goal Prompt Template

```
📋 Planex Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 直到 {SESSION_DIR}/session.json 的 acceptance_criteria[*] 全部 status==passed
且 phase_goals_all_done=true 才停。每轮以 session.json 为唯一行动手册。
verify 失败时自动进入 fix 循环，不超过 max_iterations 次。
遇到 phase=decision 的 pending 条目必须 request_user_input，不得自行 resolve。
```

### `-y` Auto-Confirm Behavior

| 决策点 | Normal | `-y` |
|--------|--------|------|
| S_INTAKE 验收标准 | request_user_input | auto-derive, `deferred` |
| S_VERIFY manual 标准 | request_user_input | `deferred` |
| S_VERIFY max iteration | request_user_input | auto accept, `deferred` |
| S_RECORD 决策清单 | request_user_input | skip |
| S_RECORD 目标审计 | request_user_input | auto accept |

### Iteration Model

```
S_EXECUTE → S_VERIFY ──all pass──→ S_RECORD
                │
           some fail + iter < max
                │
                ▼
             S_FIX ──→ S_VERIFY (loop)
```

### Phase Goal Lifecycle

```
pending → done | skipped | failed
```

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No requirement | Provide requirement |
| E002 | error | --scope not found | Check path |
| E003 | error | Resume no session | Start new |
| E004 | error | Delegate failed | Retry or skip |
| W001 | warning | No criteria derived | Manual definition |
| W002 | warning | Max iterations, criteria failing | Escalate |
| W003 | warning | CLI regression concern | Review before next |
</error_codes>

<success_criteria>
- [ ] Requirement parsed, acceptance criteria defined (≥1)
- [ ] Each criterion has verify_method
- [ ] Plan with tasks mapped to criteria
- [ ] Tasks executed with evidence logged
- [ ] Every criterion verified per iteration
- [ ] Failing criteria trigger targeted fix only
- [ ] cli-review criteria verified via spawn_agents_on_csv
- [ ] Iteration count tracked, max respected
- [ ] understanding.md §4 updated per iteration
- [ ] Goal Prompt displayed, phase_goals tracked
- [ ] `-y`: no blocking, deferred counted
- [ ] Resumable via -c
</success_criteria>
