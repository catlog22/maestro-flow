---
name: maestro-ralph
description: Adaptive lifecycle engine -- infer state, build command chain
argument-hint: "\"intent\" [-y] | status | continue | execute"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Closed-loop decision engine for the maestro workflow lifecycle.
Coordinator assembles fully-resolved skill calls -> spawns via `spawn_agents_on_csv` ->
delegates evaluation at decision nodes -> dynamically expands/shrinks chain.

Entry: `"intent"` (new session), `execute`/`continue` (resume), `status` (display).
Two node types: **external** (spawn_agents_on_csv) and **decision** (delegate evaluate).
Session at `.workflow/.maestro/ralph-{YYYYMMDD-HHmmss}/status.json`.
</purpose>

<context>
$ARGUMENTS -- intent text, flags, or keywords.

**Parse**: `-y` -> auto_mode. `.md/.txt` path -> input_doc (supplementary, never substitutes lifecycle). Remaining -> intent.

**`-y` downstream propagation**:

| Skill | Flag | Effect |
|-------|------|--------|
| maestro-init | `-y` | skip interactive |
| maestro-analyze | `-y` | skip scoping |
| maestro-brainstorm | `-y` | skip questions |
| maestro-roadmap | `-y` | skip choices |
| maestro-plan | `-y` | skip confirmation |
| maestro-execute | `-y` | skip confirmation, auto-continue blocked |
| quality-auto-test | `-y` | skip plan confirmation |
| quality-test | `-y --auto-fix` | auto gap-fix loop |
| maestro-verify | `-y` | skip confirmation |
| quality-review | `-y` | skip confirmation |
| quality-debug | `-y` | skip confirmation |
| maestro-milestone-complete | `-y` | skip knowledge promotion |
| maestro-milestone-audit | `-y` | skip confirmation |

**State files**: `.workflow/state.json`, `.workflow/roadmap.md`, `.workflow/.maestro/ralph-*/status.json`
</context>

<invariants>
1. **ALL external steps via spawn_agents_on_csv** -- coordinator NEVER executes skill logic directly
2. **Coordinator = prompt assembler** -- classify -> enrich args -> build CSV -> spawn -> read results -> assemble next
3. **Decision nodes delegate-evaluate** -- `maestro delegate --role analyze`; structural decisions evaluated directly
4. **Barrier = solo wave** -- analyze, plan, execute, brainstorm, roadmap always run alone
5. **Non-barriers can parallel** -- consecutive non-barrier, non-decision external steps grouped
6. **Wave-by-wave** -- never start wave N+1 before wave N results read
7. **Coordinator owns context** -- sub-agents never read prior results; coordinator assembles full skill_call
8. **Quality mode governs steps** -- full/standard/quick determines quality stages
9. **passed_gates skip** -- already-passed gates not re-run (unless code changed)
</invariants>

<state_machine>

<states>
S_PARSE_ROUTE     -- 解析参数、路由入口点                PERSIST: --
S_STATUS          -- 显示 session 进度后结束             PERSIST: --
S_INFER           -- 推断生命周期位置                    PERSIST: session.lifecycle_position
S_RESOLVE_PHASE   -- 解析目标 phase                      PERSIST: session.phase
S_QUALITY_MODE    -- 确定质量模式 full/standard/quick     PERSIST: session.quality_mode
S_BUILD_CHAIN     -- 构建步骤链                          PERSIST: session.steps[]
S_CREATE_SESSION  -- 写 status.json                      PERSIST: session (full)
S_CONFIRM         -- 用户确认（auto_mode skip）          PERSIST: --
S_LOAD_NEXT       -- 找下一个 pending step               PERSIST: --
S_WAVE_EXEC       -- 构建并执行 wave                     PERSIST: session.waves[], context
S_DECISION_EVAL   -- 评估质量门                          PERSIST: --
S_APPLY_VERDICT   -- 应用裁决                            PERSIST: passed_gates[], retry_count
S_FIX_LOOP        -- 插入修复步骤、重索引                PERSIST: session.steps[] (expanded)
S_COMPLETE        -- 标记完成                            PERSIST: session.status = "completed"
S_PAUSED          -- 暂停等待人工                        PERSIST: session.status = "paused"
S_FALLBACK        -- 请求用户输入                        PERSIST: session.status = "paused"
</states>

<transitions>

S_PARSE_ROUTE:
  -> S_STATUS        WHEN: intent == "status"
  -> S_LOAD_NEXT     WHEN: intent == "execute" | "continue"
  -> S_DECISION_EVAL WHEN: running session with decision step in "running"
  -> S_INFER         WHEN: intent non-empty
  -> S_FALLBACK      WHEN: no intent AND no running session

S_STATUS -> END      DO: A_SHOW_STATUS

S_INFER:
  -> S_RESOLVE_PHASE WHEN: position resolved    DO: A_INFER_POSITION
  -> S_FALLBACK      WHEN: cannot infer

S_RESOLVE_PHASE:
  -> S_QUALITY_MODE  DO: A_RESOLVE_PHASE

S_QUALITY_MODE:
  -> S_BUILD_CHAIN   DO: A_DETERMINE_QUALITY_MODE

S_BUILD_CHAIN:
  -> S_CREATE_SESSION DO: A_BUILD_STEPS

S_CREATE_SESSION:
  -> S_CONFIRM       WHEN: not auto_mode
  -> S_LOAD_NEXT     WHEN: auto_mode

S_CONFIRM:
  -> S_LOAD_NEXT     WHEN: "Proceed"
  -> S_BUILD_CHAIN   WHEN: "Edit"
  -> S_QUALITY_MODE  WHEN: "Change quality mode"
  -> S_PAUSED        WHEN: "Cancel"

S_LOAD_NEXT:
  -> S_DECISION_EVAL WHEN: next_step.type == "decision"
  -> S_WAVE_EXEC     WHEN: next_step.type == "external"
  -> S_COMPLETE      WHEN: no pending steps

S_WAVE_EXEC:
  -> S_LOAD_NEXT     WHEN: success            DO: A_BUILD_AND_SPAWN_WAVE
  -> S_PAUSED        WHEN: failed             GUARD: auto_mode retry once then pause

S_DECISION_EVAL:
  -> S_APPLY_VERDICT WHEN: quality-gate        DO: A_DELEGATE_EVALUATE
  -> S_APPLY_VERDICT WHEN: structural          DO: A_STRUCTURAL_EVALUATE

S_APPLY_VERDICT:
  -> S_LOAD_NEXT     WHEN: proceed             DO: add gate to passed_gates
  -> S_FIX_LOOP      WHEN: fix                 DO: clear passed_gates, increment retry
  -> S_PAUSED        WHEN: escalate
  -> S_LOAD_NEXT     WHEN: post-milestone + next milestone    DO: A_ADVANCE_MILESTONE
  -> S_COMPLETE      WHEN: post-milestone + no next
  -> S_PAUSED        WHEN: post-debug-escalate (always, even -y)
  GUARD: retry >= max_retries -> force escalate
  GUARD: confidence < 60 AND proceed -> override to fix
  GUARD: confidence > 95 AND fix AND retry > 0 -> suggest proceed

S_FIX_LOOP:
  -> S_LOAD_NEXT     DO: A_INSERT_FIX_LOOP

S_COMPLETE -> END    DO: A_FINALIZE
S_PAUSED -> END      DO: A_PAUSE_SESSION
S_FALLBACK -> S_PARSE_ROUTE WHEN: user input | -> END WHEN: cancel

</transitions>

<actions>

### A_INFER_POSITION

**Intent-based override**: brainstorm pattern -> position = brainstorm.

**Bootstrap detection**:

| Condition | Position |
|-----------|----------|
| No .workflow/ + no source | brainstorm |
| No .workflow/ + has source | init |
| Has .workflow/ but no state.json | init |
| Has state.json | artifact-based inference |

**Artifact-based**: filter by current_milestone + target phase. Latest artifact type: none->analyze, analyze->plan, plan->execute, execute->verify, verify->refine from result files:

| Condition | Position |
|-----------|----------|
| verification.json: passed==false or gaps[] non-empty | verify-failed |
| passed==true, no review.json, has auto-test report | review |
| passed==true, no review.json, no auto-test report | business-test (full) / review (standard/quick) |
| review.json: verdict=="BLOCK" | review-failed |
| review.json: verdict!="BLOCK" | test |
| uat.md: all passed | milestone-audit |
| uat.md: has failures | test-failed |

### A_RESOLVE_PHASE

Priority: regex from intent `phase\s*(\d+)` -> latest in-progress artifact's phase -> first incomplete phase -> null (brainstorm/init/roadmap) -> request_user_input if ambiguous.

### A_DETERMINE_QUALITY_MODE

| Condition | Mode | Pipeline |
|-----------|------|----------|
| Has REQ-*.md + phase scope | full | verify -> business-test -> review -> test-gen -> test |
| Default | standard | verify -> review -> test (test-gen if coverage < 80%) |
| User --quality quick | quick | verify -> review --tier quick |

### A_BUILD_STEPS

Lifecycle stages (start from position, skip completed, filter by quality_mode):

| Stage | Skill | Barrier | Decision after |
|-------|-------|---------|----------------|
| brainstorm | maestro-brainstorm | yes | -- |
| init | maestro-init | no | -- |
| roadmap | maestro-roadmap | yes | -- |
| analyze | maestro-analyze | yes | -- |
| plan | maestro-plan | yes | -- |
| execute | maestro-execute | yes | -- |
| verify | maestro-verify | no | post-verify |
| business-test | quality-auto-test | no | post-business-test (full) |
| review | quality-review | no | post-review |
| test-gen | quality-auto-test | no | -- (full; standard if coverage<80%) |
| test | quality-test | no | post-test |
| milestone-audit | maestro-milestone-audit | no | -- |
| milestone-complete | maestro-milestone-complete | no | post-milestone |

### A_BUILD_AND_SPAWN_WAVE

1. Conditional step eval: check_coverage -> read validation.json, skip if >= threshold
2. buildNextWave: barrier -> solo; non-barrier -> batch consecutive; stop at decision
3. buildSkillCall: resolve {phase}/{intent}/{dirs} placeholders, enrich (plan -> --dir analyze, execute -> --dir plan), append -y if auto_mode
4. Write wave-{N}.csv (id, skill_call, topic) -> `spawn_agents_on_csv`
5. Read results -> update step statuses
6. Barrier context update: analyze->context.analysis_dir, plan->context.plan_dir, execute->context.exec_status, brainstorm->context.brainstorm_dir, roadmap->context.spec_session_id
7. Persist status.json

### A_DELEGATE_EVALUATE

1. Resolve result files per decision type (post-verify: verification.json, post-business-test: report.json, post-review: review.json, post-test: uat.md + test-results.json)
2. Execute `maestro delegate` with analysis prompt -> parse verdict: STATUS (proceed/fix/escalate), REASON, GAP_SUMMARY, CONFIDENCE_SCORE, WEAKEST_DIMENSION
3. Confidence adjustment: score < 60 + proceed -> fix; score > 95 + fix + retry > 0 -> suggest proceed

### A_STRUCTURAL_EVALUATE

**post-milestone**: Read state.json -> next milestone -> update session (milestone, phase, reset gates), re-infer quality_mode, insert lifecycle steps. No next -> complete.
**post-debug-escalate**: Pause (always, even -y). Display: max retries reached, manual intervention needed.

### A_INSERT_FIX_LOOP

Insert fix template by decision type after current position, reindex:
- **post-verify**: debug -> plan --gaps -> execute -> verify -> decision:post-verify
- **post-business-test**: debug --from-business-test -> plan --gaps -> execute -> verify -> decision:post-verify -> auto-test -> decision:post-business-test
- **post-review**: debug -> plan --gaps -> execute -> verify -> decision:post-verify -> review -> decision:post-review
- **post-test**: debug --from-uat -> plan --gaps -> execute -> verify -> decision:post-verify -> [auto-test + decision:post-business-test (full)] -> review -> decision:post-review -> [auto-test (full; standard if <80%)] -> test -> decision:post-test

### A_ADVANCE_MILESTONE

Update session: milestone, phase, reset passed_gates. Re-infer quality_mode. Build + insert new lifecycle steps for next milestone.

### A_FINALIZE

Set status = "completed". Sync update_plan. Release goal. Display completion report.

### A_PAUSE_SESSION

Set status = "paused". Do NOT release goal. Display: use $maestro-ralph execute to continue.

</actions>

</state_machine>

<appendix>

### Session JSON Schema

```json
{
  "session_id": "ralph-{YYYYMMDD-HHmmss}",
  "source": "ralph", "intent": "", "status": "running|paused|completed",
  "lifecycle_position": "", "phase": null, "milestone": null,
  "auto_mode": false, "quality_mode": "standard", "passed_gates": [],
  "context": { "issue_id": null, "scratch_dir": null, "plan_dir": null, "analysis_dir": null, "brainstorm_dir": null },
  "steps": [{ "index": 0, "type": "external|decision", "skill": "", "args": "", "barrier": false, "status": "pending", "wave_n": null }],
  "waves": [], "current_step": 0
}
```

### Worker Contract

```
Execute skill_call: {skill_call}. Topic: {topic}.
Do not modify .workflow/.maestro/ status files.
Return: { status, skill_call, summary, artifacts, error }
```

### Wave CSV Schema

```csv
id,skill_call,topic
"3","$maestro-verify 1","Ralph step 3/14: verify phase 1"
```

Rules: decision nodes NEVER in CSV; barrier -> single-row; non-barrier -> multi-row.

### Error Codes

| Condition | Recovery |
|-----------|----------|
| No intent and no running session | Prompt for intent |
| Cannot infer lifecycle position | Show raw state, ask user |
| Artifact dir not found for decision | Show glob results, ask user |
| Delegate verdict parse failed | Fallback: treat as "fix" |
| Wave timeout | Mark step failed, pause |
| No session for execute/continue | Suggest $maestro-ralph "intent" |

### Success Criteria

- [ ] Lifecycle position inferred from bootstrap + artifact chain + result files
- [ ] Quality mode governs step generation
- [ ] buildSkillCall() with arg enrichment + auto flag
- [ ] Quality-gate decisions delegate-evaluated via maestro delegate --role analyze
- [ ] Confidence-based verdict adjustment applied
- [ ] -y: auto-follow verdict, no STOP (except post-debug-escalate)
- [ ] passed_gates[] tracked, cleared on code changes
- [ ] Fix-loop templates with gap_summary from delegate
- [ ] retry_count per decision, max_retries enforced
- [ ] ALL external steps via spawn_agents_on_csv
- [ ] Barrier solo wave, non-barriers parallel
- [ ] status.json persisted after every wave and decision

</appendix>
