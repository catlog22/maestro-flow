---
name: maestro-ralph
description: Closed-loop lifecycle decision engine — read state, infer position, build adaptive chain, execute via CSV waves, STOP at decision nodes for re-evaluation
argument-hint: "\"intent\" | status | continue | execute"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Two entry points with distinct roles:

- **`$maestro-ralph "intent"`** — Decision mode: read state → infer position → build/expand chain → write status.json → execute first wave(s) until a decision node → STOP
- **`$maestro-ralph execute`** — Execute mode: resume from status.json → run next wave(s) until a decision node → STOP
- **`$maestro-ralph status`** — Display session progress
- **`$maestro-ralph continue`** — Alias for `execute` (resume after decision)

Key difference from maestro coordinator:
- maestro: static chain → run all waves to completion
- ralph: living chain → decision nodes pause execution → ralph re-evaluates → chain grows/shrinks dynamically

Three node types in the chain:
- **decision**: Barrier that STOPS execution. Ralph re-reads result files, decides whether to expand chain.
- **skill**: Executed via `spawn_agents_on_csv`. Barrier skills (analyze, plan, execute, brainstorm) run solo. Non-barriers can parallel.
- **cli**: Executed via `spawn_agents_on_csv` with delegate wrapper.

Session at `.workflow/.ralph/ralph-{YYYYMMDD-HHmmss}/status.json`.
</purpose>

<context>
$ARGUMENTS — intent text, or keywords.

**Routing:**
```
"status"              → handleStatus(). End.
"execute" | "continue"→ handleExecute(). Jump to Phase 2.
otherwise             → handleNew(). Start from Phase 1.
```

**Decision-node detection (for execute mode):**
If status.json has a pending decision node as next step → Phase 2b (evaluate), not Phase 2a (spawn).
</context>

<invariants>
1. **ALL skills via spawn_agents_on_csv**: Coordinator NEVER executes skills directly.
2. **Decision nodes STOP execution**: After processing a decision node, coordinator writes status.json and STOPS. User must call `$maestro-ralph execute` to resume.
3. **Barrier = solo wave**: barrier skills (analyze, plan, execute, brainstorm, roadmap) always run alone.
4. **Non-barriers can parallel**: consecutive non-barrier + non-decision steps grouped into one wave.
5. **Decision = barrier + stop**: decision node is always solo AND halts the loop.
6. **Wave-by-wave**: never start wave N+1 before wave N results are read.
7. **Coordinator owns context**: sub-agents never read prior results.
8. **Abort on failure**: failed step → mark remaining skipped → pause session.
</invariants>

<execution>

## Phase 1: Resolve Intent and Build Chain (handleNew)

### 1a: Read project state

Read `.workflow/state.json`. Actual schema:

```json
{
  "current_milestone": "MVP",
  "milestones": [{ "id": "M1", "name": "MVP", "status": "active", "phases": [1, 2] }],
  "artifacts": [
    {
      "id": "ANL-001",
      "type": "analyze",       // analyze | plan | execute | verify
      "milestone": "MVP",
      "phase": 1,
      "scope": "phase",        // phase | milestone | adhoc | standalone
      "path": "phases/01-auth-multi-tenant",   // relative to .workflow/scratch/
      "status": "completed",
      "depends_on": "PLN-001",
      "harvested": true
    }
  ],
  "accumulated_context": {
    "key_decisions": [...],
    "deferred": [...]
  }
}
```

**Bootstrap state detection:**

```
Case A — No .workflow/ at all:
  A1: No source files (empty project, 0→1)
    → position = "brainstorm", chain starts: brainstorm → init → roadmap → analyze → ...
  A2: Has source files (existing code, first time using maestro)
    → position = "init", chain starts: init → roadmap → analyze → ...

Case B — Has .workflow/, no state.json or empty milestones:
    → position = "init" or "roadmap"

Case C — Has state.json with artifacts:
    → artifact-based inference (see below)
```

### 1b: Artifact-based position inference (Case C)

Filter artifacts by `milestone == current_milestone`. Group by phase. For the target phase, find the **latest completed artifact type**:

```
  state.json exists, no milestones[]           → "roadmap"
  Has milestones, no roadmap.md                → "roadmap"
  Has roadmap, no artifacts for target phase   → "analyze"
  Latest artifact type == "analyze"            → "plan"
  Latest artifact type == "plan"               → "execute"
  Latest artifact type == "execute"            → "verify"
  Latest artifact type == "verify"             → check result files (see below)

When latest is "verify", read result files to refine position:
  resolve_artifact_dir(latest_verify_artifact)
  Read verification.json from that dir:
    gaps[] non-empty or passed == false         → "verify-failed" (needs fix loop)
    passed == true, no review.json              → "business-test"
    has review.json with verdict == "BLOCK"     → "review-failed"
    has review.json with verdict != "BLOCK"     → "test"
    has uat.md with status == "complete", all passed → "milestone-audit"
    has uat.md with failures                    → "test-failed"
```

**resolve_artifact_dir(artifact):**
```
artifact.path is relative path (e.g. "phases/01-auth-multi-tenant")
Full path = .workflow/scratch/{artifact.path}/
If path starts with "phases/": also try .workflow/scratch/{YYYYMMDD}-*-P{phase}-*/
Fallback: glob .workflow/scratch/*-P{phase}-*/ sorted by date DESC, take first
```

### 1c: Build command sequence

**Lifecycle stages** (full pipeline):
```
Stage              Skill                         Barrier  Decision After
──────────────────────────────────────────────────────────────────────────
brainstorm         maestro-brainstorm "{intent}" yes      — (0→1 only)
init               maestro-init                  no       —
roadmap            maestro-roadmap "{intent}"    yes      —
analyze            maestro-analyze {phase}       yes      —
plan               maestro-plan {phase}          yes      —
execute            maestro-execute {phase}       yes      —
verify             maestro-verify {phase}        no       decision:post-verify
business-test      quality-business-test {phase}  no       decision:post-business-test
review             quality-review {phase}        no       decision:post-review
test-gen           quality-test-gen {phase}      no       —
test               quality-test {phase}          no       decision:post-test
milestone-audit    maestro-milestone-audit       no       —
milestone-complete maestro-milestone-complete    no       decision:post-milestone
```

Generate `steps[]` from current position to target. Decision nodes use:
```json
{ "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}" }
```

### 1d: Create session

Write `.workflow/.ralph/ralph-{YYYYMMDD-HHmmss}/status.json`:
```json
{
  "id": "ralph-{YYYYMMDD-HHmmss}",
  "created_at": "ISO",
  "intent": "{user_intent}",
  "status": "running",
  "lifecycle_position": "{position}",
  "target": "milestone-complete",
  "phase": null,
  "milestone": null,
  "auto_mode": false,
  "context": { "plan_dir": null, "analysis_dir": null, "brainstorm_dir": null },
  "steps": [...],
  "waves": [],
  "current_step": 0,
  "updated_at": "ISO"
}
```

### 1e: Display plan + confirm

```
============================================================
  RALPH DECISION ENGINE
============================================================
  Position:  {position} (Phase {N}, {milestone})
  Target:    milestone-complete
  Steps:     {total} ({decision_count} decision points)

  [ ] 0. maestro-plan {phase}              [skill/barrier]
  [ ] 1. maestro-execute {phase}           [skill/barrier]
  [ ] 2. maestro-verify {phase}            [skill]
  [ ] 3. ◆ post-verify                     [decision] ← STOP
  [ ] 4. quality-business-test {phase}     [skill]
  ...
============================================================
```

If not auto_mode: AskUserQuestion → Proceed / Cancel

### 1f: Fall through to Phase 2

---

## Phase 2: Wave Execution Loop (handleExecute)

### 2a: Load session

Read status.json. Find first pending step.

If first pending step is a decision node → go to Phase 2b.
Otherwise → go to Phase 2c.

### 2b: Decision Evaluation (when next pending is decision)

Read decision metadata from step.args: `{ decision, retry_count, max_retries }`

**Locate result files** — find the artifact dir for current phase:
```
Read .workflow/state.json
Filter artifacts: milestone == session.milestone, phase == session.phase
Sort by created_at DESC

For the decision type, find the relevant artifact:
  post-verify        → latest type=="verify" artifact
  post-business-test → same dir as verify (business-test writes to same artifact dir)
  post-review        → latest artifact dir → review.json
  post-test          → latest artifact dir → uat.md + .tests/test-results.json

artifact_dir = resolve_artifact_dir(artifact)
```

**Evaluate by decision type:**

**post-verify:**
```
Read {artifact_dir}/verification.json
Check: gaps[] array and passed field

If gaps found (passed == false or gaps[].length > 0):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{gap_summary}", decision:post-debug-escalate]
    → Display: ◆ post-verify: max retries reached, escalating to debug
  Else:
    → Insert: [quality-debug "{gap_summary}", maestro-plan --gaps {phase},
               maestro-execute {phase}, maestro-verify {phase},
               decision:post-verify(retry+1)]
    → Display: ◆ post-verify: gaps detected, inserting debug+fix loop (retry {N}/{max})

If no gaps (passed == true):
  → No insertion, proceed
```

**post-business-test:**
```
Read {artifact_dir}/business-test-results.json or scan for business test output
Check: failures[] or passed field

If failures found:
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-business-test {phase}, decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug --from-business-test {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase},
               maestro-verify {phase}, decision:post-verify(retry:0),
               quality-business-test {phase}, decision:post-business-test(retry+1)]

If all pass:
  → No insertion, proceed
```

**post-review:**
```
Read {artifact_dir}/review.json
Check: verdict field and issues[].severity

If verdict == "BLOCK" or any issue.severity == "critical":
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{block_summary}", decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug "{block_issues}",
               maestro-plan --gaps {phase}, maestro-execute {phase},
               quality-review {phase}, decision:post-review(retry+1)]

If verdict == "PASS" or "WARN":
  → No insertion, proceed
```

**post-test:**
```
Read {artifact_dir}/uat.md (parse frontmatter + gap sections)
Read {artifact_dir}/.tests/test-results.json if exists

If failures found (any test result != pass, or gaps with severity >= high):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-uat {phase}, decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug --from-uat {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase},
               maestro-verify {phase}, decision:post-verify(retry:0),
               quality-business-test {phase}, decision:post-business-test(retry:0),
               quality-review {phase}, decision:post-review(retry:0),
               quality-test-gen {phase}, quality-test {phase},
               decision:post-test(retry+1)]

If all pass:
  → No insertion, proceed
```

**post-milestone:**
```
Re-read .workflow/state.json (milestone-complete will have updated it).
Check: state.milestones[] for next milestone with status == "pending" or "active"

If next milestone found:
  next_m = next milestone
  first_phase = next_m.phases[0]
  Update ralph session: milestone = next_m.name, phase = first_phase

  → Insert full lifecycle for next milestone:
    [maestro-analyze {first_phase} [barrier],
     maestro-plan {first_phase} [barrier],
     maestro-execute {first_phase} [barrier],
     maestro-verify {first_phase},
     decision:post-verify(retry:0),
     quality-business-test {first_phase},
     decision:post-business-test(retry:0),
     quality-review {first_phase},
     decision:post-review(retry:0),
     quality-test-gen {first_phase},
     quality-test {first_phase},
     decision:post-test(retry:0),
     maestro-milestone-audit,
     maestro-milestone-complete,
     decision:post-milestone]

  → Display: ◆ post-milestone: {completed_m.name} done → advancing to {next_m.name} Phase {first_phase}

If no next milestone:
  → No insertion — session will complete naturally
  → Display: ◆ post-milestone: all milestones complete!
```

**post-debug-escalate:**
```
This is a terminal escalation — debug was run but we exceeded max retries.
→ Set session status = "paused"
→ Display: ◆ 已达最大重试次数，debug 已执行。请人工介入检查结果。
→ Display: 使用 $maestro-ralph execute 在处理后恢复
→ STOP
```

After evaluation:
1. Mark decision step as "completed"
2. Reindex steps if inserted
3. Write status.json
4. Display: `◆ Decision: {type} → {outcome}`
5. Fall through to Phase 2c (continue executing next steps)

### 2c: Build and Execute Next Wave

**While pending non-decision steps remain:**

1. **buildNextWave**: Take first pending step.
   - If barrier → solo wave
   - If non-barrier → collect consecutive non-barrier, non-decision steps
   - Stop at first decision node (it will be processed in next `execute` call)

2. **Assemble args** (placeholder resolution):
   ```
   {phase}       → status.phase
   {intent}      → status.intent
   {scratch_dir} → from latest artifact path
   {plan_dir}    → status.context.plan_dir
   {analysis_dir}→ status.context.analysis_dir
   ```

3. **Write wave CSV**: `{sessionDir}/wave-{N}.csv`
   Each row spawns a `$maestro-ralph-execute` agent with the target skill_call as argument:
   ```csv
   id,skill_call,topic
   "3","$maestro-ralph-execute \"$maestro-verify 1\"","Ralph step 3/14: verify phase 1"
   ```
   The inner `$maestro-verify 1` is the actual skill; `$maestro-ralph-execute` is the worker wrapper.

4. **Spawn**:
   ```
   spawn_agents_on_csv({
     csv_path: "{sessionDir}/wave-{N}.csv",
     id_column: "id",
     instruction: WAVE_INSTRUCTION,
     max_workers: <wave_size>,
     max_runtime_seconds: 3600,
     output_csv_path: "{sessionDir}/wave-{N}-results.csv",
     output_schema: RESULT_SCHEMA
   })
   ```

5. **Read results**: Update step status from results CSV

6. **Barrier check**: If wave was a barrier skill, read artifacts, update context:
   | Barrier | Read | Update |
   |---------|------|--------|
   | maestro-analyze | context.md, state.json | context.analysis_dir, context.gaps |
   | maestro-plan | plan.json | context.plan_dir, context.task_count |
   | maestro-execute | results.csv | context.exec_status |
   | maestro-brainstorm | .brainstorming/ | context.brainstorm_dir |
   | maestro-roadmap | specs/ | context.spec_session_id |

7. **Persist**: Write status.json with updated steps, waves, context

8. **Failure check**: Any step failed → mark remaining skipped, pause session, STOP

9. **Decision check**: If next pending step is a decision node → STOP.
   Display: `⏸ 到达决策节点: {decision_type}。使用 $maestro-ralph execute 继续。`

10. **Continue**: If next pending is not decision, loop back to step 1

### Sub-Agent Instruction Template

```
你是 Ralph 执行器子 agent。

skill_call 列包含 $maestro-ralph-execute 调用，它会解析内部的目标 skill 并执行。
直接运行 skill_call 中的命令即可。

限制：
- 不要修改 .workflow/.ralph/ 下的文件
- ralph-execute 内部处理 skill 路由和执行

完成后调用 report_agent_job_result，返回：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","artifacts":"产物路径或空","error":"失败原因或空"}
```

### Result Schema

`{ status, skill_call, summary, artifacts, error }` — all string, status = "completed"|"failed"

---

## Phase 3: Completion (when no pending steps remain)

```
status.status = "completed"
status.updated_at = now
Write status.json

============================================================
  RALPH COMPLETE
============================================================
  Session:  {id}
  Phase:    {phase} → {milestone}
  Waves:    {wave_count} executed
  Steps:    {completed}/{total}

  [✓] 0. maestro-plan 1            [W1]
  [✓] 1. maestro-execute 1         [W2]
  [✓] 2. maestro-verify 1          [W3]
  [✓] 3. ◆ post-verify             [decision: no gaps]
  [✓] 4. quality-business-test 1   [W4]
  ...

  Resume: $maestro-ralph execute
============================================================
```

</execution>

<csv_schema>
### wave-{N}.csv

All skill execution goes through `$maestro-ralph-execute` as the worker wrapper:

```csv
id,skill_call,topic
"3","$maestro-ralph-execute \"$maestro-verify 1\"","Ralph step 3/14: verify phase 1"
"4","$maestro-ralph-execute \"$quality-business-test 1\"","Ralph step 4/14: business test phase 1"
```

- `skill_call` column: always `$maestro-ralph-execute "<inner_skill_call>"`
- `topic` column: human-readable step description
- Non-barrier + non-decision steps can be grouped in one wave CSV with multiple rows
- Barrier steps always solo (one row per CSV)
- Decision steps are NEVER in CSV — processed by ralph directly
</csv_schema>

<error_codes>
| Code | Severity | Description | Recovery |
|------|----------|-------------|----------|
| E001 | error | No intent and no running session | Prompt for intent |
| E002 | error | Cannot infer lifecycle position | Show raw state, ask user |
| E003 | error | Artifact dir not found for decision evaluation | Show glob results, ask user |
| E004 | error | Result file (verification.json etc) missing in artifact dir | Warn, treat as failure |
| E005 | error | Wave timeout (max_runtime_seconds) | Mark step failed, pause session |
| E006 | error | No session found for execute/continue | Suggest $maestro-ralph "intent" |
| W001 | warning | Decision node expanded chain (gap/failure detected) | Auto-handled, log expansion |
| W002 | warning | Max retries reached, escalating to debug | Auto-handled |
| W003 | warning | Multiple running sessions found | Use latest, warn user |
</error_codes>

<success_criteria>
- [ ] state.json artifacts correctly read with actual schema (type, path, scope, milestone, depends_on)
- [ ] Lifecycle position inferred from artifacts + result files (verification.json, review.json, uat.md)
- [ ] Artifact dir resolved via resolve_artifact_dir() with fallback globs
- [ ] Full quality pipeline: verify → business-test → review → test-gen → test
- [ ] Decision nodes at: post-verify, post-business-test, post-review, post-test, post-milestone
- [ ] Every decision failure path starts with quality-debug before plan --gaps
- [ ] retry_count tracked per decision node, max_retries enforced
- [ ] Max retries → post-debug-escalate → session paused for human intervention
- [ ] All skills via spawn_agents_on_csv (through ralph-execute) — coordinator never executes directly
- [ ] Decision nodes STOP execution — user must call `execute` to resume
- [ ] Barrier skills run solo, non-barriers grouped in parallel waves
- [ ] Placeholder args resolved before CSV assembly ({phase}, {intent}, {scratch_dir})
- [ ] post-milestone inserts next milestone lifecycle with recursive post-milestone
- [ ] status.json persisted after every wave
- [ ] Command insertion + reindex works correctly after decision expansion
</success_criteria>
