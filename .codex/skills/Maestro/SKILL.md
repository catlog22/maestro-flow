---
name: maestro
description: Auto-route intent to optimal command chain
argument-hint: "\"intent text\" [-y] [-c|--continue] [--dry-run] [--super]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based pipeline coordinator. Classify intent → resolve chain → wave-by-wave spawn → report.
All skill execution via `spawn_agents_on_csv` — coordinator never executes skills directly.

Entry points:
- **`$maestro "intent"`** — Classify → chain → execute
- **`$maestro --continue`** — Resume from last incomplete wave
- **`$maestro --dry-run "intent"`** — Show chain, no execution
- **`$maestro --super "intent"`** — Production-ready mode (read maestro-super.md)
</purpose>

<deferred_reading>
- [maestro-super.md](~/.maestro/workflows/maestro-super.md) — read when `--super` flag is active
</deferred_reading>

<context>
$ARGUMENTS — user intent text, or special flags.

**Flags:**
- `-y, --yes` — Auto mode: skip all prompts; propagate `-y` to each skill
- `--continue` — Resume latest paused session from last incomplete wave
- `--dry-run` — Display planned chain without executing
- `--super` — Read and follow `maestro-super.md` completely

**Session state**: `.workflow/.maestro/{session-id}/`
</context>

<invariants>
1. **ALL skills via spawn_agents_on_csv** — coordinator NEVER directly executes any skill logic
2. **Coordinator = prompt assembler** — classify → build CSV → spawn → read results → assemble next
3. **Barrier = solo wave** — barrier skills always execute alone (wave size = 1)
4. **Non-barriers can parallel** — consecutive non-barrier skills grouped into one wave
5. **Wave-by-wave** — never start wave N+1 before wave N results are read
6. **Coordinator owns context** — sub-agents never read prior results; coordinator assembles full `skill_call`
7. **Abort on failure** — failed step → mark remaining skipped → report
</invariants>

<state_machine>

<states>
S_PARSE         — 解析参数、检测 flags              PERSIST: —
S_CONTINUE      — 加载已有 session，定位 resume 点   PERSIST: session (loaded)
S_CLASSIFY      — 意图分类、解析 chain (A_CLASSIFY)   PERSIST: —
S_CREATE        — 创建 session + status.json         PERSIST: session.status, session.steps[]
S_DRY_RUN       — 显示 chain 后结束                  PERSIST: —
S_CONFIRM       — 用户确认（auto_mode 跳过）          PERSIST: —
S_WAVE_LOOP     — 构建 wave → spawn → 读结果 → 循环  PERSIST: session.waves[], session.current_step, session.context
S_COMPLETE      — 标记完成、释放目标                  PERSIST: session.status = "completed"
S_ABORTED       — 失败中止、标记剩余 skipped          PERSIST: session.status = "aborted"
S_FALLBACK      — 意图无法分类，请求输入              PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_CONTINUE    WHEN: --continue flag
  → S_CLASSIFY    WHEN: intent text present
  → S_FALLBACK    WHEN: no intent AND no flags

S_CONTINUE:
  → S_WAVE_LOOP   WHEN: session found, has pending steps     DO: A_RESUME_SESSION
  → S_FALLBACK    WHEN: no session found

S_CLASSIFY:
  → S_CREATE      WHEN: chain resolved                      DO: A_CLASSIFY
  → S_FALLBACK    WHEN: no match AND auto_mode
  → S_CLASSIFY    WHEN: no match AND not auto_mode          DO: A_CLARIFY_INTENT
                   GUARD: max 1 clarification attempt → S_FALLBACK

S_CREATE:
  → S_DRY_RUN     WHEN: --dry-run flag                      DO: A_CREATE_SESSION
  → S_CONFIRM     WHEN: not auto_mode                       DO: A_CREATE_SESSION
  → S_WAVE_LOOP   WHEN: auto_mode                           DO: A_CREATE_SESSION

S_DRY_RUN:
  → END           DO: display chain with [BARRIER] markers

S_CONFIRM:
  → S_WAVE_LOOP   WHEN: user confirms
  → S_ABORTED     WHEN: user cancels

S_WAVE_LOOP:
  → S_WAVE_LOOP   WHEN: pending steps remain                DO: A_BUILD_AND_SPAWN_WAVE
  → S_COMPLETE    WHEN: no pending steps
  → S_ABORTED     WHEN: step failed
                   GUARD: wave order is sacred — never skip ahead

S_COMPLETE:
  → END           DO: A_FINALIZE

S_ABORTED:
  → END           DO: A_ABORT_REPORT

S_FALLBACK:
  → S_CLASSIFY    WHEN: user provides new intent            DO: AskUserQuestion
  → END           WHEN: user cancels

</transitions>

<actions>

### A_CREATE_SESSION

1. Read `.workflow/state.json` for project context (current phase, milestone, workflow_name)
2. Resolve chain's skill list from Chain Map (see appendix)
3. Create `.workflow/.maestro/maestro-{YYYYMMDD-HHMMSS}/status.json`:
   ```json
   { "session_id", "source": "maestro", "intent", "task_type", "chain_name",
     "phase", "milestone", "auto_mode", "context": { "issue_id", "scratch_dir",
     "plan_dir", "analysis_dir", "brainstorm_dir" },
     "steps": [{ "index", "skill", "args", "status": "pending", "wave_n": null }],
     "waves": [], "current_step": 0, "status": "running" }
   ```
4. Initialize tracking:
   - `create_goal({ objective: "Maestro {chain}: {N} steps [{skill list}]" })`
   - `update_plan({ plan: steps.map(step => { step, status: "pending" }) })`

### A_RESUME_SESSION

1. Glob `.workflow/.maestro/maestro-*/status.json` sorted desc, load most recent
2. Find first pending step → set as resume point
3. Rebuild `update_plan` from status.json (completed→"completed", current→"in_progress", rest→"open")

### A_CLASSIFY

**Layer 1: Exact-match (fast path)**
- `--chain <name>` flag → validate against chainMap, use directly (E002 if not found)
- `continue`/`next`/`go`/`继续`/`下一步` → `state_continue`
- `status`/`状态`/`dashboard` → `status`

If matched, skip to chain resolution.

**Layer 2: Structured intent extraction**

Extract tuple from intent using LLM semantic understanding:
```json
{
  "action":    "<create|fix|analyze|plan|execute|verify|review|test|debug|refactor|explore|manage|transition|continue|sync|learn|retrospect>",
  "object":    "<feature|bug|issue|code|test|spec|phase|milestone|doc|performance|security|ui|memory|codebase|config>",
  "scope":     "<module/file/area or null>",
  "issue_id":  "<ISS-XXXXXXXX-NNN or null>",
  "phase_ref": "<integer or null>",
  "urgency":   "<low|normal|high>"
}
```

Disambiguation: "问题"/"issue"/"problem" as broken → `object: "bug"` (→ debug); as tracked item (with ISS-ID or management context) → `object: "issue"` (→ issue management). When ambiguous, prefer `"bug"`.

**Layer 3: action × object routing matrix**

If `issue_id` present → issue pipeline directly.

| action | object-specific overrides | default |
|--------|--------------------------|---------|
| fix | bug/code/perf/security→`debug`, issue→`issue` | `debug` |
| create | feature→`quick`, issue→`issue`, test→`test_gen`, spec→`spec_generate`, ui→`ui_design`, config→`init` | `quick` |
| analyze | bug/code→`analyze`, issue→`issue_analyze`, codebase→`spec_map` | `analyze` |
| explore | issue→`issue_discover`, feature/ui→`brainstorm`/`ui_design` | `brainstorm` |
| plan | issue→`issue_plan`, spec→`spec_generate` | `plan` |
| execute | issue→`issue_execute` | `execute` |
| manage | issue→`issue`, milestone→`milestone_audit`, phase→`phase_transition`, memory/doc/codebase→`memory`/`sync`/`codebase_refresh` | `status` |
| transition | phase→`phase_transition`, milestone→`milestone_complete` | `phase_transition` |
| verify, review, test, debug, refactor, continue, sync, learn, retrospect, release, amend, compose | — | self-named |

**Clarity scoring**: 3=action+object+scope, 2=action+object, 1=action only, 0=empty.
If `clarity < 2` and not `auto_mode` → transition to A_CLARIFY_INTENT.

**Layer 4: State-based routing** (when `taskType === 'state_continue'`)

Read `.workflow/state.json` and route by condition:

| Condition | Chain |
|-----------|-------|
| Not initialized | `init` |
| No phases, no roadmap, has accumulated_context | `next-milestone` |
| No phases | `brainstorm-driven` |
| pending + has context | `plan` |
| pending, no context | `analyze` |
| exploring/planning + has plan | `execute-verify` |
| exploring/planning, no plan | `plan` |
| executing, all tasks done | `verify` |
| executing, tasks remain | `execute` |
| verifying, passed + no review | `review` |
| verifying, passed + BLOCK | `review-fix` |
| verifying, passed + UAT pending | `test` |
| verifying, passed + UAT passed | `milestone-close` |
| verifying, passed + UAT failed | `debug` |
| verifying, not passed | `quality-loop-partial` |
| testing, UAT passed | `milestone-close` |
| testing, UAT not passed | `debug` |
| completed | `milestone-close` |
| blocked | `debug` |
| fallback | `status` |

**Chain resolution order:**
1. `forceChain` → `chainMap[forceChain]` (E002 if not found)
2. `state_continue` → Layer 4 state routing → `{ chain, argsOverride? }`
3. `taskToChain[taskType]` → alias lookup (see Chain Aliases below)
4. `chainMap[taskType]` → direct lookup

**Phase resolution**: structured extraction `phase_ref` → fallback regex (`phase N` or bare number) → `projectState.current_phase`.

### A_CLARIFY_INTENT

1. `AskUserQuestion` with available chain types
2. Re-classify with user response

### A_BUILD_AND_SPAWN_WAVE

1. **buildNextWave**: first pending step; barrier → solo wave; non-barrier → collect consecutive non-barriers
2. **buildSkillCall** per step:
   - Replace placeholders: `{phase}`, `{plan_dir}`, `{analysis_dir}`, `{brainstorm_dir}`, `{spec_session_id}`
   - Append auto-yes flag if `auto_mode` (see Appendix: Auto-Yes Flag Map)
3. Write `{sessionDir}/wave-{N}.csv` (columns: id, skill_call, topic)
4. `spawn_agents_on_csv({ csv_path, id_column: "id", instruction: WAVE_INSTRUCTION, max_workers, max_runtime_seconds: 3600, output_csv_path, output_schema: RESULT_SCHEMA })`
5. Read results → update step statuses in status.json
6. **Barrier analysis** (if barrier skill): read artifacts, update `session.context`
   | Barrier Skill | Read | Context Updates |
   |---------------|------|-----------------|
   | maestro-analyze | context.md, state.json | analysis_dir, gaps, phase |
   | maestro-plan | plan.json, .task/TASK-*.json | plan_dir, task_count, wave_count |
   | maestro-brainstorm | .brainstorming/ | brainstorm_dir, features |
   | maestro-roadmap | specs/ | spec_session_id |
   | maestro-execute | results.csv | exec_completed, exec_failed |
7. Persist: write status.json + sync update_plan

### A_FINALIZE

1. Set `session.status = "completed"`, write status.json
2. Sync update_plan: all steps → "completed"
3. `update_goal({ status: "complete" })` — release goal constraint
4. Generate completion report (see Appendix: Report Format)

### A_ABORT_REPORT

1. Mark remaining steps as `skipped` in status.json
2. Set `session.status = "aborted"`, write status.json
3. Sync update_plan (skipped steps marked)
4. Do NOT call update_goal — goal stays for `--continue` resume
5. Display abort report with failure details

</actions>

</state_machine>

<appendix>

### Chain Map (Full)

**Single-step chains:**

| Chain | Command + Args |
|-------|---------------|
| `status` | `manage-status` |
| `init` | `maestro-init` |
| `analyze` | `maestro-analyze {phase}` |
| `ui_design` | `maestro-ui-design {phase}` |
| `plan` | `maestro-plan {phase}` |
| `execute` | `maestro-execute {phase}` |
| `verify` | `maestro-verify {phase}` |
| `test_gen` | `quality-auto-test {phase}` |
| `auto_test` | `quality-auto-test {phase}` |
| `test` | `quality-test {phase}` |
| `debug` | `quality-debug "{description}"` |
| `integration_test` | `quality-auto-test {phase}` |
| `refactor` | `quality-refactor "{description}"` |
| `review` | `quality-review {phase}` |
| `retrospective` | `quality-retrospective {phase}` |
| `learn` | `maestro-learn "{description}"` |
| `sync` | `quality-sync` |
| `milestone_audit` | `maestro-milestone-audit` |
| `milestone_complete` | `maestro-milestone-complete` |
| `codebase_rebuild` | `manage-codebase-rebuild` |
| `codebase_refresh` | `manage-codebase-refresh` |
| `spec_setup` | `spec-setup` |
| `spec_add` | `spec-add "{description}"` |
| `spec_load` | `spec-load` |
| `spec_map` | `manage-codebase-rebuild` |
| `spec_remove` | `spec-remove "{description}"` |
| `knowhow_capture` | `manage-knowhow-capture "{description}"` |
| `knowhow` | `manage-knowhow "{description}"` |
| `issue` | `manage-issue "{description}"` |
| `issue_discover` | `manage-issue-discover "{description}"` |
| `issue_analyze` | `maestro-analyze --gaps "{description}"` |
| `issue_plan` | `maestro-plan --gaps` |
| `issue_execute` | `maestro-execute` |
| `quick` | `maestro-quick "{description}"` |
| `harvest` | `manage-harvest "{description}"` |
| `wiki` | `manage-wiki` |
| `wiki_connect` | `wiki-connect` |
| `wiki_digest` | `wiki-digest` |
| `business_test` | `quality-auto-test {phase}` |
| `amend` | `maestro-amend "{description}"` |
| `release` | `maestro-milestone-release` |
| `compose` | `maestro-composer "{description}"` |
| `play` | `maestro-player "{description}"` |
| `update` | `maestro-update` |
| `overlay` | `maestro-overlay "{description}"` |
| `link_coordinate` | `maestro-link-coordinate "{description}"` |

**Multi-step chains:**

| Chain | Steps (→ = sequential, [B] = barrier) |
|-------|---------------------------------------|
| `feature` | [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `quality-fix` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → maestro-verify |
| `deploy` | maestro-verify → maestro-milestone-release |
| `spec-driven` | maestro-init → [B] maestro-roadmap --mode full → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `brainstorm-driven` | [B] maestro-brainstorm → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `ui-design-driven` | maestro-ui-design → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `roadmap-driven` | maestro-init → [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `next-milestone` | [B] maestro-roadmap → [B] maestro-plan → [B] maestro-execute → maestro-verify |
| `full-lifecycle` | [B] maestro-plan → [B] maestro-execute → maestro-verify → quality-review → quality-test → maestro-milestone-audit → maestro-milestone-complete |
| `execute-verify` | [B] maestro-execute → maestro-verify |
| `analyze-plan-execute` | [B] maestro-analyze -q → [B] maestro-plan --dir {scratch_dir} → [B] maestro-execute --dir {scratch_dir} |
| `quality-loop` | maestro-verify → quality-review → quality-test → quality-debug --from-uat → [B] maestro-plan --gaps → [B] maestro-execute |
| `quality-loop-partial` | [B] maestro-plan --gaps → [B] maestro-execute → maestro-verify |
| `review-fix` | [B] maestro-plan --gaps → [B] maestro-execute → quality-review |
| `milestone-close` | maestro-milestone-audit → maestro-milestone-complete |
| `milestone-release` | maestro-milestone-audit → maestro-milestone-release |
| `phase_transition` | maestro-milestone-audit → maestro-milestone-complete |
| `issue-full` | [B] maestro-analyze --gaps → [B] maestro-plan --gaps → [B] maestro-execute → quality-review → manage-issue close |
| `issue-quick` | [B] maestro-plan --gaps → [B] maestro-execute → manage-issue close |

**Chain Aliases** (taskType → chain):

| taskType | Chain |
|----------|-------|
| `spec_generate` | `spec-driven` |
| `brainstorm` | `brainstorm-driven` |
| `issue_execute` | `issue-full` |

### Auto-Yes Flag Map

| Skill | Flag |
|-------|------|
| maestro-init, maestro-analyze, maestro-brainstorm, maestro-ui-design, maestro-roadmap | `-y` |
| maestro-plan, maestro-execute, maestro-milestone-complete | `-y` |
| quality-auto-test, quality-retrospective | `-y` |
| quality-test | `-y --auto-fix` |

### Barrier Skills

`maestro-analyze`, `maestro-plan`, `maestro-brainstorm`, `maestro-roadmap`, `maestro-execute`

Non-barrier (groupable): `maestro-verify`, `quality-review`, `quality-test`, `quality-debug`, `quality-refactor`, `quality-sync`, `manage-*`

### Worker Contract

**Instruction template:**
```
你是 CSV job 子 agent。
先原样执行这一段技能调用：{skill_call}
然后基于结果完成这一行任务说明：{topic}
限制：不要修改 .workflow/.maestro/ 下的 status 文件
最后必须调用 `report_agent_job_result`，返回 JSON：
{"status":"completed|failed","skill_call":"{skill_call}","summary":"一句话结果","artifacts":"产物路径","error":"失败原因"}
```

**Result schema:** `{ status, skill_call, summary, artifacts, error }` — all string, all required

### CSV Schema

**wave-{N}.csv:**
```csv
id,skill_call,topic
"1","$maestro-analyze --gaps \"fix auth\" -y","Chain \"quality-fix\" step 1/4"
```

**Session status.json:** see A_CREATE_SESSION for full schema

### Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent unclassifiable after clarification | Default to `feature` chain |
| E002 | error | Intent unresolvable after retry | List chains, abort |
| E003 | error | Wave timeout | Mark step failed, abort chain |
| E004 | error | Barrier artifact not found | Retry wave once, then abort |
| E005 | error | --continue: no session found | List sessions, prompt |
| W001 | warning | Barrier artifact partial | Continue with available context |

### Success Criteria

- [ ] Intent classified and chain resolved
- [ ] Session dir initialized with status.json before first wave
- [ ] Every skill goes through spawn_agents_on_csv
- [ ] Barrier skills solo wave; non-barriers grouped parallel
- [ ] Each wave: CSV → spawn → results → state updated
- [ ] Barrier artifacts read before assembling next wave args
- [ ] Failed step → remaining skipped → abort reported
- [ ] --dry-run shows chain with [BARRIER], no execution
- [ ] --continue resumes from last incomplete wave

### Report Format

```
=== COORDINATE COMPLETE ===
Session:  {sessionId}
Chain:    {chain}
Waves:    {N} executed
Steps:    {completed}/{total}

WAVE RESULTS:
  [W1] $maestro-analyze --gaps  →  ✓  found 3 gaps
  [W2] $maestro-plan --gaps     →  ✓  12 tasks in 3 waves
  ...

State:    .workflow/.maestro/{sessionId}/status.json
Resume:   $maestro --continue
```

</appendix>
