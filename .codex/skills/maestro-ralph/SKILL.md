---
name: maestro-ralph
description: Closed-loop lifecycle decision engine — read state, infer position, build adaptive chain, execute via CSV waves, STOP at decision nodes for re-evaluation
argument-hint: "\"intent\" [-y] | status | continue | execute"
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
- **cli**: Executed via `maestro delegate` (轻量替代，如 quick 模式的 review)。单步执行，不进 CSV wave。

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
- `-y` / `--yes` — Auto mode: skip confirmation, decision nodes auto-evaluate并继续（不 STOP），错误自动重试一次后跳过。`-y` 存入 `session.auto_mode`，传播到 ralph-execute 及下游 skill。

**`-y` 传播链：**
```
ralph -y → session.auto_mode = true
         → wave CSV skill_call 附加 -y: $maestro-ralph-execute -y "$skill_call"
           → ralph-execute 解析 -y，附加到目标 skill: $maestro-plan -y 1
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
1. **Skills via spawn_agents_on_csv, CLI via delegate**: Coordinator NEVER executes skills directly. CLI steps use `maestro delegate`.
2. **Decision nodes STOP execution**: After processing a decision node, coordinator writes status.json and STOPS. User must call `$maestro-ralph execute` to resume. **例外：`-y` 模式下 decision 自动评估后继续，不 STOP（post-debug-escalate 除外）。**
3. **Barrier = solo wave**: barrier skills (analyze, plan, execute, brainstorm, roadmap) always run alone.
4. **Non-barriers can parallel**: consecutive non-barrier + non-decision steps grouped into one wave.
5. **Decision = barrier + conditional stop**: decision node is always solo. 默认 STOP；`-y` 模式自动继续。
6. **Wave-by-wave**: never start wave N+1 before wave N results are read.
7. **Coordinator owns context**: sub-agents never read prior results.
8. **Abort on failure**: failed step → `-y` 模式重试一次后跳过并继续；非 `-y` 模式 mark remaining skipped → pause session.
9. **Quality mode governs steps**: quality_mode (full/standard/quick) 决定哪些质量步骤被包含。
10. **passed_gates skip**: 重试循环中已通过的质量门不重复执行（除非代码变更影响了其检查范围）。
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
| `quick` | 轻量验证 | verify → CLI-review（跳过 business-test、test-gen、test） |

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
review             quality-review {phase}         no       decision:post-review    full/standard ②
  └─ CLI alt       delegate --role review         —        decision:post-review    quick ②
test-gen           quality-auto-test {phase}      no       —                       full; standard 按条件 ③
test               quality-test {phase}           no       decision:post-test      full/standard ④
milestone-audit    maestro-milestone-audit        no       —                       always
milestone-complete maestro-milestone-complete     no       decision:post-milestone always
```

**条件说明：**
- ① `business-test`: 仅 full 模式。与 `quality-test` 有 40% 重叠（PRD 正向 vs 代码反向），full 模式两者互补覆盖，standard/quick 模式省略
- ② `review`: full/standard 用完整 skill spawn（6 维度并行）；quick 模式改用 CLI delegate（轻量代码审查）
- ③ `test-gen`: full 模式始终执行；standard 模式仅在 `validation.json` 覆盖率 < 80% 或不存在时执行
- ④ `test`: full/standard 执行；quick 模式跳过（依赖 verify + CLI-review 即可）

**CLI review 替代（quick 模式）：**
```json
{
  "type": "cli",
  "skill": "maestro delegate",
  "args": "\"review changed files in phase {phase}\" --role review --mode analysis --rule analysis-review-code-quality",
  "output_file": "{artifact_dir}/review.json"
}
```
CLI review 输出需符合 review.json schema（verdict + issues[]），供 post-review 决策节点消费。

**条件步骤的链构建：**
```
buildSteps(position, target, quality_mode):
  steps = lifecycle_stages[position..target]

  # 按 quality_mode 过滤
  if quality_mode != "full":
    remove business-test + decision:post-biz-test
  if quality_mode == "quick":
    replace review skill → CLI review
    remove test-gen
    remove test + decision:post-test
  if quality_mode == "standard":
    # test-gen 延迟决定：在 post-verify 决策后检查覆盖率
    mark test-gen as conditional: "check_coverage"

  return steps
```

Generate `steps[]` from current position to target. Decision nodes use:
```json
{ "type": "decision", "skill": "maestro-ralph", "args": "{\"decision\":\"post-verify\",\"retry_count\":0,\"max_retries\":2}" }
```
Conditional steps use:
```json
{ "type": "skill", "skill": "quality-auto-test {phase}", "condition": "check_coverage", "threshold": 80 }
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
  "cli_tool": "gemini",
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

### 1e: Display plan + confirm

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
  [ ] 4. quality-review {phase}            [skill]        ← standard
  [ ] 4. quality-review {phase}            [cli/delegate] ← quick
  [ ] 5. ◆ post-review                     [decision] ← STOP
  ...
  ── skipped (standard mode) ──────────────────────────────
  [~] _. quality-auto-test {phase}          [skip: standard]
  [?] _. quality-auto-test {phase}          [conditional: coverage < 80%]
============================================================
```

If not auto: AskUserQuestion → Proceed / Cancel / Change quality mode
If auto (`-y`): skip confirmation, proceed directly

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
    → Display: ◆ post-verify: max retries reached, escalating to debug
  Else:
    → Insert: [quality-debug "{gap_summary}", maestro-plan --gaps {phase},
               maestro-execute {phase}, maestro-verify {phase},
               decision:post-verify(retry+1)]
    → Display: ◆ post-verify: gaps detected, inserting debug+fix loop (retry {N}/{max})

If no gaps (passed == true):
  → Add "verify" to passed_gates
  → 条件检查 test-gen（standard 模式）：
    Read {artifact_dir}/validation.json
    If coverage < 80% or validation.json not found:
      activate conditional test-gen step (set condition = "met")
    Else:
      skip test-gen step (set status = "skipped")
  → No insertion, proceed
```

**post-biz-test (仅 full 模式):**
```
Read {artifact_dir}/business-test-results.json or scan for business test output
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
  → Add "business-test" to passed_gates
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
    → Clear passed_gates (code will change)
    → Insert: [quality-debug "{block_issues}",
               maestro-plan --gaps {phase}, maestro-execute {phase},
               quality-review {phase}, decision:post-review(retry+1)]
    注：review 失败只重跑 review，不回滚到 verify（verify 已通过且代码仅修复 review 问题）

If verdict == "PASS" or "WARN":
  → Add "review" to passed_gates
  → No insertion, proceed
```

**post-test (仅 full/standard 模式):**
```
Read {artifact_dir}/uat.md (parse frontmatter + gap sections)
Read {artifact_dir}/.tests/test-results.json if exists

If failures found (any test result != pass, or gaps with severity >= high):
  If meta.retry_count >= meta.max_retries:
    → Insert: [quality-debug --from-uat {phase}, decision:post-debug-escalate]
  Else:
    → Clear passed_gates (code will change)
    → 轻量重试：仅重新执行 verify + 未通过的质量门
    → Insert: [quality-debug --from-uat {phase},
               maestro-plan --gaps {phase}, maestro-execute {phase},
               maestro-verify {phase}, decision:post-verify(retry:0),
               // 对 passed_gates 中的每个门：对比修改文件列表与该门的检查范围
               //   有交集 → 重新插入该门 + 对应 decision
               //   无交集 → 跳过（不插入）
               quality-test {phase}, decision:post-test(retry+1)]
    注：不再重新插入整条管线。verify 始终重跑（代码已变），其余门按影响范围判断。

If all pass:
  → Add "test" to passed_gates
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

  → Reset passed_gates = []
  → Re-infer quality_mode for next milestone (check REQ-*.md existence)
  → Insert lifecycle for next milestone (按 quality_mode 过滤):
    [maestro-analyze {first_phase} [barrier],
     maestro-plan {first_phase} [barrier],
     maestro-execute {first_phase} [barrier],
     maestro-verify {first_phase},
     decision:post-verify(retry:0),
     ...quality steps per quality_mode (see 1c buildSteps)...,
     maestro-milestone-audit,
     maestro-milestone-complete,
     decision:post-milestone]
  注：使用 buildSteps() 按当前 quality_mode 生成质量步骤，不硬编码完整管线

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
5. **STOP 判定：**
   - `post-debug-escalate` → 始终 STOP（无论 `-y` 与否）
   - `auto_mode == true` (`-y`) → 不 STOP，直接 fall through to Phase 2c
   - `auto_mode == false` → STOP。Display: `⏸ 到达决策节点。使用 $maestro-ralph execute 继续。`

### 2c: Build and Execute Next Wave

**While pending non-decision steps remain:**

1. **buildNextWave**: Take first pending step.
   - If conditional step with condition not met → mark "skipped", advance to next
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

3. **Route by step type:**

   **type == "skill"** → Write wave CSV: `{sessionDir}/wave-{N}.csv`
   Each row spawns a `$maestro-ralph-execute` agent with the target skill_call as argument:
   ```csv
   id,skill_call,topic
   "3","$maestro-ralph-execute \"$maestro-verify 1\"","Ralph step 3/14: verify phase 1"
   ```
   当 `session.auto_mode == true` 时，skill_call 附加 `-y`：
   ```csv
   "3","$maestro-ralph-execute -y \"$maestro-verify 1\"","Ralph step 3/14: verify phase 1"
   ```
   ralph-execute 解析 `-y` 后，按传播表对目标 skill 附加对应 auto flag。
   The inner `$maestro-verify 1` is the actual skill; `$maestro-ralph-execute` is the worker wrapper.

   **type == "cli"** → CLI delegate 执行（quick 模式 review 等）：
   ```
   Bash({
     command: 'maestro delegate "{step.args}" --mode analysis',
     run_in_background: true
   })
   ```
   等待回调 → `maestro delegate output <id>` → 解析输出写入 `{artifact_dir}/{output_file}`
   CLI 步骤始终单步执行，不进 CSV wave。

4. **Spawn** (仅 skill 类型):
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

5. **Read results**: Update step status from results CSV (skill) or delegate output (cli)

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

9. **Decision check**: If next pending step is a decision node:
   - `auto_mode == true` → 不 STOP，直接进入 Phase 2b 评估该决策节点，然后继续循环
   - `auto_mode == false` → STOP。Display: `⏸ 到达决策节点: {decision_type}。使用 $maestro-ralph execute 继续。`

10. **Continue**: If next pending is not decision, loop back to step 1

### Sub-Agent Instruction Template

```
你是 Ralph 执行器子 agent。

skill_call 列包含 $maestro-ralph-execute 调用，它会解析内部的目标 skill 并执行。
直接运行 skill_call 中的命令即可。

限制：
- 不要修改 .workflow/.maestro/ 下的文件
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

All skill execution goes through `$maestro-ralph-execute` as the worker wrapper:

```csv
id,skill_call,topic
"3","$maestro-ralph-execute \"$maestro-verify 1\"","Ralph step 3/14: verify phase 1"
"4","$maestro-ralph-execute \"$quality-auto-test 1\"","Ralph step 4/14: auto test phase 1"
```

- `skill_call` column: `$maestro-ralph-execute [-y] "<inner_skill_call>"`（`session.auto_mode` 时附加 `-y`）
- `topic` column: human-readable step description
- Non-barrier + non-decision steps can be grouped in one wave CSV with multiple rows
- Barrier steps always solo (one row per CSV)
- Decision steps are NEVER in CSV — processed by ralph directly
- CLI steps (type=="cli") are NEVER in CSV — processed by ralph via maestro delegate
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
- [ ] Quality mode (full/standard/quick) 正确推断并影响步骤生成
- [ ] Conditional steps: business-test 仅 full 模式，test-gen 按覆盖率条件
- [ ] CLI 替代: quick 模式 review 走 delegate 而非 skill spawn
- [ ] Decision nodes at: post-verify, post-biz-test (full only), post-review, post-test (full/standard), post-milestone
- [ ] Every decision failure path starts with quality-debug before plan --gaps
- [ ] passed_gates[] 正确追踪，重试时跳过已通过的质量门
- [ ] 重试循环轻量化：post-test 失败不重跑整条管线，仅重跑未通过的门
- [ ] retry_count tracked per decision node, max_retries enforced
- [ ] Max retries → post-debug-escalate → session paused for human intervention
- [ ] Skills via spawn_agents_on_csv, CLI via delegate — coordinator never executes directly
- [ ] Decision nodes STOP execution — user must call `execute` to resume
- [ ] Barrier skills run solo, non-barriers grouped in parallel waves
- [ ] Placeholder args resolved before CSV assembly ({phase}, {intent}, {scratch_dir})
- [ ] post-milestone 用 buildSteps() 生成下一个 milestone 的步骤（按 quality_mode）
- [ ] status.json persisted after every wave
- [ ] Command insertion + reindex works correctly after decision expansion
</success_criteria>
