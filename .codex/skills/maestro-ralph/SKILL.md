---
name: maestro-ralph
description: Closed-loop lifecycle decision engine — read state, infer position, build adaptive chain, execute via CSV waves, STOP at decision nodes for re-evaluation
argument-hint: "\"intent\" [-y] | status | continue | execute"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Coordinator assembles fully-resolved skill calls and spawns them via `spawn_agents_on_csv` —
never executes skills directly. Uses `functions.update_plan()` for progress tracking.

Entry points:
- **`$maestro-ralph "intent"`** — Read state → infer position → build chain → execute waves until decision node → STOP
- **`$maestro-ralph execute`** — Resume from status.json → run next wave(s) until decision node → STOP
- **`$maestro-ralph status`** — Display session progress
- **`$maestro-ralph continue`** — Alias for `execute`

Key difference from maestro coordinator:
- maestro: static chain → run all waves to completion
- ralph: living chain → decision nodes pause execution → ralph re-evaluates → chain grows/shrinks dynamically

Two node types:
- **skill**: Executed via `spawn_agents_on_csv`. Barrier skills run solo; non-barriers can parallel.
- **decision**: Coordinator evaluates result files, decides whether to expand chain, then STOPs.

Session at `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`.
</purpose>

<context>
$ARGUMENTS — intent text, or keywords.

**Routing:**
```
"status"              → handleStatus(). End.
"execute" | "continue"→ handleExecute(). Jump to Phase 2.
otherwise             → handleNew(). Start from Phase 1.
```

**Flags:**
- `-y` / `--yes` — Auto mode: skip confirmation, decision nodes auto-evaluate 并继续（不 STOP），错误自动重试一次后跳过。

**`-y` 传播：**
```
ralph -y → session.auto_mode = true
         → buildSkillCall() 按传播表直接附加 auto flag 到最终 skill_call
         → CSV 写入完整命令: $maestro-plan 1 -y
```

**`-y` 下游传播表：**

| Skill | 附加 Flag | 效果 |
|-------|-----------|------|
| maestro-init | `-y` | 跳过交互提问 |
| maestro-analyze | `-y` | 跳过交互 scoping |
| maestro-brainstorm | `-y` | 跳过交互提问 |
| maestro-roadmap | `-y` | 跳过交互选择 |
| maestro-plan | `-y` | 跳过确认和澄清 |
| maestro-execute | `-y` | 跳过确认，blocked 自动继续 |
| maestro-verify | *(none)* | 无交互，正常执行 |
| quality-auto-test | `-y` | 跳过计划确认 |
| quality-review | *(none)* | 无交互确认，自动检测级别 |
| quality-test | `-y --auto-fix` | 自动触发 gap-fix loop |
| quality-debug | *(none)* | 无交互确认，正常诊断 |
| maestro-milestone-audit | *(none)* | 无交互，正常执行 |
| maestro-milestone-complete | `-y` | 跳过 knowledge promotion 交互 |

未列出的命令无 auto flag，原样执行。

**Decision-node detection (for execute mode):**
If status.json has a pending decision node as next step → Phase 2b (evaluate), not Phase 2a (spawn).
</context>

<invariants>
1. **ALL skills via spawn_agents_on_csv**: Every skill invocation MUST go through `spawn_agents_on_csv`. Coordinator NEVER executes skills directly. No exceptions.
2. **Coordinator = prompt assembler**: Classify intent → enrich args → build CSV → spawn → read results → assemble next CSV. Never runs skill logic itself.
3. **Decision nodes STOP execution**: After processing a decision node, coordinator writes status.json and STOPS. User must call `$maestro-ralph execute` to resume. **例外：`-y` 模式下 decision 自动评估后继续，不 STOP（post-debug-escalate 除外）。**
4. **Barrier = solo wave**: barrier skills (analyze, plan, execute, brainstorm, roadmap) always run alone.
5. **Non-barriers can parallel**: consecutive non-barrier + non-decision steps grouped into one wave.
6. **Decision = barrier + conditional stop**: decision node is always solo. 默认 STOP；`-y` 模式自动继续。
7. **Wave-by-wave**: never start wave N+1 before wave N results are read.
8. **Coordinator owns context**: sub-agents never read prior results — coordinator assembles full skill_call with resolved args.
9. **Abort on failure**: failed step → `-y` 模式重试一次后跳过并继续；非 `-y` 模式 mark remaining skipped → pause session.
10. **Quality mode governs steps**: quality_mode (full/standard/quick) 决定哪些质量步骤被包含。
11. **passed_gates skip**: 重试循环中已通过的质量门不重复执行（除非代码变更影响了其检查范围）。
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
    passed == true, no review.json              → "post-verify" (chain builder 按 quality_mode 决定下一步)
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

**Quality pipeline modes** (`quality_mode` in session):

| Mode | 含义 | 质量步骤 |
|------|------|----------|
| `full` | 全量质量管线 | verify → business-test → review → test-gen → test |
| `standard` | 标准管线（默认） | verify → review → test（跳过 business-test、test-gen 按条件） |
| `quick` | 轻量验证 | verify → review --tier quick（跳过 business-test、test-gen、test） |

Mode 选择逻辑（Phase 1a 后自动推断，可被用户覆盖）：
```
有 requirements/REQ-*.md 且 phase scope == "phase" → full
其他场景                                           → standard
用户显式指定                                        → 覆盖自动推断
```

**Lifecycle stages** (带条件的完整管线):
```
Stage              Skill                          Barrier  Decision After          Condition
───────────────────────────────────────────────────────────────────────────────────────────────
brainstorm         maestro-brainstorm "{intent}"  yes      —                       0→1 only
init               maestro-init                   no       —                       always
roadmap            maestro-roadmap "{intent}"     yes      —                       always
analyze            maestro-analyze {phase}        yes      —                       always
plan               maestro-plan {phase}           yes      —                       always
execute            maestro-execute {phase}        yes      —                       always
verify             maestro-verify {phase}         no       decision:post-verify    always
business-test      quality-auto-test {phase}      no       decision:post-biz-test  full only ①
review             quality-review {phase}         no       decision:post-review    always ②
test-gen           quality-auto-test {phase}      no       —                       full; standard 按条件 ③
test               quality-test {phase}           no       decision:post-test      full/standard ④
milestone-audit    maestro-milestone-audit        no       —                       always
milestone-complete maestro-milestone-complete     no       decision:post-milestone always
```

**条件说明：**
- ① `business-test`: 仅 full 模式
- ② `review`: 所有模式均通过 skill spawn；quick 模式附加 `--tier quick`
- ③ `test-gen`: full 模式始终执行；standard 模式仅在覆盖率 < 80% 时执行
- ④ `test`: full/standard 执行；quick 模式跳过

**条件步骤的链构建：**
```
buildSteps(position, target, quality_mode):
  steps = lifecycle_stages[position..target]

  # 按 quality_mode 过滤
  if quality_mode != "full":
    remove business-test + decision:post-biz-test
  if quality_mode == "quick":
    review skill 附加 --tier quick
    remove test-gen
    remove test + decision:post-test
  if quality_mode == "standard":
    mark test-gen as conditional: "check_coverage"

  return steps
```

Generate `steps[]` from current position to target. Decision nodes use:
```json
{ "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}" }
```
Conditional steps use:
```json
{ "type": "skill", "skill": "quality-auto-test", "args": "{phase}", "condition": "check_coverage", "threshold": 80 }
```

### 1d: Create session

Write `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`:
```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph",
  "created_at": "ISO",
  "intent": "{user_intent}",
  "status": "running",
  "chain_name": "ralph-lifecycle",
  "task_type": "lifecycle",
  "lifecycle_position": "{position}",
  "target": "milestone-complete",
  "phase": null,
  "milestone": null,
  "auto_mode": false,
  "quality_mode": "standard",
  "passed_gates": [],
  "context": {
    "issue_id": null,
    "milestone_num": null,
    "spec_session_id": null,
    "scratch_dir": null,
    "plan_dir": null,
    "analysis_dir": null,
    "brainstorm_dir": null
  },
  "steps": [...],
  "waves": [],
  "current_step": 0,
  "updated_at": "ISO"
}
```

### 1e: Initialize plan tracking + confirm

```
functions.update_plan({
  explanation: "Ralph lifecycle: {position} → milestone-complete",
  plan: steps.map((step, i) => ({
    step: stepLabel(step),
    status: "pending"
  }))
})
```

`stepLabel(step)`:
- skill: `[{i+1}/{total}] ${step.skill} ${step.args}` + barrier 标 `[BARRIER]`
- decision: `[{i+1}/{total}] ◆ ${decision_type} [DECISION]`

Display plan:
```
============================================================
  RALPH DECISION ENGINE
============================================================
  Position:  {position} (Phase {N}, {milestone})
  Target:    milestone-complete
  Quality:   {quality_mode} (full|standard|quick)
  Steps:     {total} ({decision_count} decision points)

  [ ] 0. maestro-plan {phase}              [skill/barrier]
  [ ] 1. maestro-execute {phase}           [skill/barrier]
  [ ] 2. maestro-verify {phase}            [skill]
  [ ] 3. ◆ post-verify                     [decision] ← STOP
  [ ] 4. quality-review {phase}            [skill]
  [ ] 5. ◆ post-review                     [decision] ← STOP
  ...
============================================================
```

If not auto: AskUserQuestion → Proceed / Cancel / Change quality mode
If auto (`-y`): skip confirmation, proceed directly

### 1f: Fall through to Phase 2

---

## Phase 2: Wave Execution Loop (handleExecute)

### 2a: Load session

Read status.json. Rebuild `update_plan` from current step statuses.
Find first pending step.

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
  post-biz-test      → same dir as verify (business-test writes to same artifact dir)
  post-review        → latest artifact dir → review.json
  post-test          → latest artifact dir → uat.md + .tests/test-results.json

artifact_dir = resolve_artifact_dir(artifact)
```

**Evaluate by decision type:**

> **passed_gates 机制**：session.passed_gates[] 记录已通过的质量门。重试循环中跳过已通过的门，避免重复执行。
> 当代码被修改（debug+plan+execute）后，清除 passed_gates 中被影响的门（verify 始终重新执行）。

**post-verify:**
```
Read {artifact_dir}/verification.json
Check: gaps[] array and passed field

If gaps found (passed == false or gaps[].length > 0):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{gap_summary}", decision:post-debug-escalate]
  Else:
    → Insert: [quality-debug "{gap_summary}", maestro-plan --gaps {phase},
               maestro-execute {phase}, maestro-verify {phase},
               decision:post-verify(retry+1)]

If no gaps (passed == true):
  → Add "verify" to passed_gates
  → 条件检查 test-gen（standard 模式）：
    Read {artifact_dir}/validation.json
    If coverage < 80% or not found → activate conditional test-gen step
    Else → skip test-gen step
  → No insertion, proceed
```

**post-biz-test (仅 full 模式):**
```
Read {artifact_dir}/business-test-results.json
Check: failures[] or passed field

If failures found:
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-business-test {phase}, decision:post-debug-escalate]
  Else:
    → Clear passed_gates (code will change)
    → Insert: [quality-debug --from-business-test {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase},
               maestro-verify {phase}, decision:post-verify(retry:0),
               quality-auto-test {phase}, decision:post-biz-test(retry+1)]

If all pass:
  → Add "business-test" to passed_gates, proceed
```

**post-review:**
```
Read {artifact_dir}/review.json
Check: verdict field and issues[].severity

If verdict == "BLOCK" or any issue.severity == "critical":
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug "{block_summary}", decision:post-debug-escalate]
  Else:
    → Clear passed_gates (code will change)
    → Insert: [quality-debug "{block_issues}",
               maestro-plan --gaps {phase}, maestro-execute {phase},
               quality-review {phase}, decision:post-review(retry+1)]

If verdict == "PASS" or "WARN":
  → Add "review" to passed_gates, proceed
```

**post-test (仅 full/standard 模式):**
```
Read {artifact_dir}/uat.md + {artifact_dir}/.tests/test-results.json

If failures found:
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-uat {phase}, decision:post-debug-escalate]
  Else:
    → Clear passed_gates (code will change)
    → Insert: [quality-debug --from-uat {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase},
               maestro-verify {phase}, decision:post-verify(retry:0),
               quality-test {phase}, decision:post-test(retry+1)]

If all pass:
  → Add "test" to passed_gates, proceed
```

**post-milestone:**
```
Re-read .workflow/state.json.
Check: next milestone with status == "pending" or "active"

If next milestone found:
  Update session: milestone, phase, reset passed_gates
  Re-infer quality_mode
  Insert lifecycle via buildSteps() for next milestone

If no next milestone:
  → Session will complete naturally
```

**post-debug-escalate:**
```
→ Set session status = "paused"
→ Display: ◆ 已达最大重试次数，debug 已执行。请人工介入检查结果。
→ STOP
```

After evaluation:
1. Mark decision step as "completed"
2. Reindex steps if inserted
3. Write status.json
4. Sync `update_plan` with current step statuses
5. Display: `◆ Decision: {type} → {outcome}`
6. **STOP 判定：**
   - `post-debug-escalate` → 始终 STOP
   - `auto_mode == true` → 不 STOP，fall through to Phase 2c
   - `auto_mode == false` → STOP。Display: `⏸ 到达决策节点。使用 $maestro-ralph execute 继续。`

### 2c: Build and Execute Next Wave

**While pending non-decision steps remain:**

1. **buildNextWave**: Take first pending step.
   - If conditional step with condition not met → mark "skipped", advance to next
   - If barrier → solo wave
   - If non-barrier → collect consecutive non-barrier, non-decision steps
   - Stop at first decision node

2. **buildSkillCall(step, ctx)** — Assemble fully-resolved skill_call:

   **Placeholder resolution:**
   ```
   {phase}       → ctx.phase
   {intent}      → ctx.intent
   {scratch_dir} → from latest artifact path
   {plan_dir}    → ctx.plan_dir
   {analysis_dir}→ ctx.analysis_dir
   ```

   **Per-skill arg enrichment** (coordinator does this, not sub-agent):
   ```
   maestro-brainstorm:  args empty → '"{intent}"'
   maestro-roadmap:     args empty → '"{intent}"'
   maestro-analyze:     args empty → '{phase}'
   maestro-plan:        needs dir  → resolve latest analyze artifact → --dir .workflow/scratch/{path}
   maestro-execute:     needs dir  → resolve latest plan artifact → --dir .workflow/scratch/{path}
   quality-debug:       from verify → append gap summary from verification.json
                        from test   → append --from-uat {phase}
                        from biz    → append --from-business-test {phase}
   quality-* (review, test, auto-test):  args empty → '{phase}'
   maestro-verify, milestone-*:          args empty → '{phase}' or empty
   ```

   **Auto flag 附加** (when `session.auto_mode == true`):
   ```
   auto_flag_map = {
     "maestro-init": "-y",
     "maestro-analyze": "-y",
     "maestro-brainstorm": "-y",
     "maestro-roadmap": "-y",
     "maestro-plan": "-y",
     "maestro-execute": "-y",
     "quality-auto-test": "-y",
     "quality-test": "-y --auto-fix",
     "quality-retrospective": "-y",
     "maestro-milestone-complete": "-y"
   }
   ```

   **Result**: `$<skill-name> <enriched-args> [auto-flag]`

3. **Write wave CSV**: `{sessionDir}/wave-{N}.csv`
   ```csv
   id,skill_call,topic
   "3","$maestro-verify 1","Ralph step 3/14: verify phase 1"
   "4","$quality-review 1","Ralph step 4/14: review phase 1"
   ```

4. **Update plan** (mark wave steps as in_progress):
   ```
   functions.update_plan({
     explanation: "Wave {N}: executing {skill_names}",
     plan: steps.map((step, i) => ({
       step: stepLabel(step),
       status: mapStatus(step.status)  // pending→pending, running→in_progress, completed→completed
     }))
   })
   ```

5. **Spawn**:
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

6. **Read results**: Update step status from results CSV

7. **Barrier check**: If wave was a barrier skill, read artifacts, update context:
   | Barrier | Read | Update |
   |---------|------|--------|
   | maestro-analyze | context.md, state.json | context.analysis_dir, context.gaps |
   | maestro-plan | plan.json | context.plan_dir, context.task_count |
   | maestro-execute | results.csv | context.exec_status |
   | maestro-brainstorm | .brainstorming/ | context.brainstorm_dir |
   | maestro-roadmap | specs/ | context.spec_session_id |

8. **Persist**: Write status.json + sync `update_plan`

9. **Failure check**: Any step failed → mark remaining skipped, pause session, STOP

10. **Decision check**: If next pending step is a decision node:
    - `auto_mode == true` → 进入 Phase 2b 评估，然后继续循环
    - `auto_mode == false` → STOP

11. **Continue**: If next pending is not decision, loop back to step 1

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

`{ status, skill_call, summary, artifacts, error }` — all string, status = "completed"|"failed"

---

## Phase 3: Completion (when no pending steps remain)

```
status.status = "completed"
status.updated_at = now
Write status.json

functions.update_plan({
  explanation: "Ralph lifecycle complete",
  plan: steps.map((step, i) => ({
    step: stepLabel(step),
    status: step.status === "skipped" ? "completed" : "completed"
  }))
})

============================================================
  RALPH COMPLETE
============================================================
  Session:  {session_id}
  Quality:  {quality_mode}
  Phase:    {phase} → {milestone}
  Waves:    {wave_count} executed
  Steps:    {completed}/{total} ({skipped} skipped)

  [✓] 0. maestro-plan 1            [W1]
  [✓] 1. maestro-execute 1         [W2]
  [✓] 2. maestro-verify 1          [W3]
  [✓] 3. ◆ post-verify             [decision: no gaps]
  [~] 4. quality-auto-test 1       [skipped: standard mode]
  [✓] 5. quality-review 1          [W4]
  ...

  Resume: $maestro-ralph execute
============================================================
```

</execution>

<csv_schema>
### wave-{N}.csv

CSV 直接包含目标 skill 调用（coordinator 已完成 arg 组装 + auto flag 附加）：

```csv
id,skill_call,topic
"3","$maestro-verify 1","Ralph step 3/14: verify phase 1"
"4","$quality-review 1 --tier quick","Ralph step 4/14: review phase 1"
```

- `skill_call` column: 完整的 `$<skill> <args> [auto-flag]`，由 `buildSkillCall()` 组装
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
- [ ] Lifecycle position inferred from artifacts + result files
- [ ] Artifact dir resolved via resolve_artifact_dir() with fallback globs
- [ ] Quality mode (full/standard/quick) 正确推断并影响步骤生成
- [ ] buildSkillCall() 完成 arg enrichment + auto flag 附加，CSV 直接包含完整命令
- [ ] Decision nodes at: post-verify, post-biz-test (full only), post-review, post-test (full/standard), post-milestone
- [ ] Every decision failure path starts with quality-debug before plan --gaps
- [ ] passed_gates[] 正确追踪，重试时跳过已通过的质量门
- [ ] retry_count tracked per decision node, max_retries enforced
- [ ] ALL skills via spawn_agents_on_csv — coordinator never executes directly
- [ ] Decision nodes STOP execution — user must call `execute` to resume
- [ ] Barrier skills run solo, non-barriers grouped in parallel waves
- [ ] functions.update_plan() 在 Phase 1e 初始化，每 wave 后同步，Phase 3 完成
- [ ] status.json persisted after every wave
- [ ] Command insertion + reindex works correctly after decision expansion
</success_criteria>
