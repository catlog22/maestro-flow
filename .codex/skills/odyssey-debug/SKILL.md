---
name: odyssey-debug
description: Long-running debug cycle — archaeology, diagnosis, fix, confirmation, generalization, discovery, and knowledge persistence
argument-hint: "<issue> [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Closed-loop deep debugging: archaeology (what changed) → explore (call chains, error gaps) → diagnose (hypothesis-driven) → fix & confirm → generalize (举一反三) → discover siblings → persist learnings.

Unlike `quality-debug` (fast fix), this treats every bug as a learning signal — digs into git history before hypotheses, confirms fixes with CLI review, scans for siblings of the root cause.

Core philosophy:
- **Archaeology before hypothesis** — look at what changed before guessing why
- **Fix one, find many** — a single bug reveals a class of bugs
- **Decision journal** — human-judgment items recorded, not lost
- **CLI-assisted review** — delegate for second-opinion analysis
</purpose>

<context>
$ARGUMENTS — issue description and optional flags.

**Flags:** `--skip-fix` analysis-only | `--skip-generalize` quick fix | `--auto` no delegate confirmation | `-y` auto-confirm all decisions | `-c` resume last session

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-debug-odyssey-{slug}/`

**Output — 4 files:**
```
SESSION_DIR/
  ├── session.json       # state + confirmation + patterns + phase_goals
  ├── evidence.ndjson    # append-only evidence trail (phase field distinguishes origin)
  ├── explore.json       # structured CLI exploration snapshot
  └── understanding.md   # evolving narrative — 9 sections
```

**evidence.ndjson — unified trail:**
```json
{"ts":"","phase":"archaeology|explore|diagnosis|discovery|decision|self-iteration","type":"","source":"","content":"","note":""}
```
Phase-specific fields:
- `archaeology`: `sha`, `author`, `date`, `message`, `relevance` (high|medium|low)
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)
- `discovery`: `file`, `line`, `classification` (safe|risk|bug), `action`
- `decision`: `question`, `options`, `context`, `status` (pending|resolved|deferred), `resolution`

**explore.json schema:**
```json
{
  "call_chains": [{"entry":"","chain":["file:line"]}],
  "recent_changes": [{"file":"","commits":[{"sha":"","message":"","date":""}]}],
  "error_gaps": [{"file":"","line":0,"description":""}],
  "similar_patterns": [{"file":"","line":0,"description":""}],
  "cli_tool": "", "timestamp": ""
}
```

**session.json schema:**
```json
{
  "session_id": "debug-odyssey-{YYYYMMDD-HHmmss}", "issue": "",
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE", "diagnosis_retries": 0,
  "root_cause": null, "patterns": [], "confirmation": null,
  "phase_goals": [], "phase_goals_all_done": false, "self_iteration_log": [],
  "generalization_stats": null,
  "created_at": "", "updated_at": ""
}
```

**phase_goals[] — auto-derived from flags:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Root cause identified | evidence.ndjson has phase=diagnosis result=confirmed | S_DIAGNOSE | — |
| G2 | Explore context gathered | explore.json ≥1 category populated | S_EXPLORE | — |
| G3 | Fix applied and confirmed | confirmation.overall == confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR no actionable learnings | S_RECORD | — |

When `flags[skip_when] == true` → auto set `status: "skipped"`, `completion_confirmed: true`.

**understanding.md — 9 sections (written by owning phase):**
1. Issue & Scope ← S_INTAKE | 2. Archaeology ← S_ARCHAEOLOGY | 3. Exploration ← S_EXPLORE
4. Hypotheses ← S_DIAGNOSE | 5. Root Cause ← S_DIAGNOSE | 6. Fix & Confirmation ← S_FIX+S_CONFIRM
7. Generalization ← S_GENERALIZE | 8. Discoveries ← S_DISCOVER | 9. Learnings ← S_RECORD

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界 |
| Wiki search | `maestro search "<issue keywords>" --json` | 先前调查（top 5） |
| Specs + tools | `maestro spec load --category debug --keyword "<symptom>"` | 已知 issue/workaround |
| Role knowledge | `maestro search --category debug` → 选相关 → `maestro wiki load <id>` | 领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-debug-odyssey-*")` | 相关会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 将可沉淀知识 **写入 understanding.md §9 Learnings**，按分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 反复根因模式 | 模式描述 + 触发条件 + 修复模板 | `$spec-add debug "..."` |
| 非显而易见 workaround | 问题场景 + 解决方案 + 适用范围 | `$spec-add learning "..."` |
| 架构边界违反 | 违反描述 + 正确边界 + 检查方法 | `$spec-add arch "..."` |
| 可复用泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `$spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户沉淀为永久知识。执行过程中不调用外部 skill。
</context>

<self_iteration>
**Quality Gate (适用: S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE)**

| 维度 | sufficient | insufficient |
|------|-----------|-------------|
| Coverage | 已知相关文件/模块均已分析 | 遗漏 grep/git log 可发现的目标 |
| Depth | ≥80% 发现有 file:line 级证据 | 多数仅泛泛描述 |
| Actionability | 每条结论有具体后续动作 | 仅"建议关注"类无操作性结论 |

**规则:** 阶段完成 → 评估 3 维度 → 任一 insufficient → 重入（每阶段最多 2 轮）。
- Round 1: 扩范围 — 增加目录、git log depth ×2、增加 delegate 角度
- Round 2: 换视角 — 不同 CLI tool、反向追踪、手动 code reading

**退出:** 全 sufficient → 推进 | 2 轮上限 → 记录 gap 继续。记录至 `evidence.ndjson` + `session.json.self_iteration_log[]`.
</self_iteration>

<csv_schema>
### Shared Output Schema (all waves)
```json
{
  "type": "object",
  "properties": {
    "id": {"type":"string"}, "result_status": {"type":"string","enum":["completed","failed"]},
    "findings": {"type":"string","maxLength":500}, "evidence": {"type":"string"}, "error": {"type":"string"}
  },
  "required": ["id","result_status","findings"]
}
```

**Termination Contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
Success → result_status=completed | Failure → result_status=failed with error | Timeout → completed with partial.
NEVER continue indefinitely. NEVER exit silently. Read-only — do NOT modify source files.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv.
```

### tasks.csv
```csv
id,title,description,task_type,deps,wave,status,findings,evidence,error
```
- Wave 1: Archaeology (git-timeline, git-blame) — parallel
- Wave 2: Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) — parallel, depends on root cause
- Single-agent stages (explore, diagnose, fix, confirm) remain inline
</csv_schema>

<invariants>
1. **Iron Law**: NO FIX without root cause evidence
2. **Archaeology first**: git history MUST precede any hypothesis
3. **Evidence append-only**: never modify/delete evidence.ndjson entries
4. **Session is source of truth**: session.json holds all state
5. **Phase goal tracking**: each phase MUST mark its goal on completion
6. **Decision journal integrity**: all human-judgment items recorded phase=decision
7. **`-y` defers, never drops**: auto-confirm records "deferred", never silently skips
8. **CLI delegate is background**: all `maestro delegate` → run_in_background, STOP, wait
9. **Resumable state**: current_state saved at every transition
10. **Goal is outcome-oriented**: `/goal` user-bound; odyssey outputs prompt then continues
11. **Violation = BLOCK**: violating any invariant blocks the operation
</invariants>

<execution>

### Stage 1: Intake (S_INTAKE)
1. Parse arguments: issue description, flags
2. Generate slug, create `SESSION_DIR`
3. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + Grep keywords
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` §1
6. Display Goal Prompt (Appendix), continue without blocking

**Resume (`-c`):** Glob latest session → read `session.json` → restore `current_state` → jump.

### Stage 2: Archaeology (S_ARCHAEOLOGY)
**Step 1 — Git archaeology (spawn_agents_on_csv, Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
id,title,description,task_type,deps,wave,status,findings,evidence,error
"arch-timeline","Git Timeline","Run git log --oneline -20 -- {files}. Return [{sha,date,author,message,files_changed}] as JSON.","archaeology","","1","pending","","",""
"arch-blame","Git Blame","Top 3 suspicious files: git blame -L {region}. Return [{file,line_range,sha,author,date,content}] as JSON.","archaeology","","1","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path:"tasks.csv", id_column:"id",
  instruction: ARCHAEOLOGY_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency:2, max_runtime_seconds:300,
  output_csv_path:"wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Merge results → evidence.ndjson (phase: "archaeology").

**Step 2 — CLI change review:**
```bash
maestro delegate "PURPOSE: Review recent modifications related to: {issue}
TASK: Analyze intent | Identify risky modifications | Flag potential bug sources
MODE: analysis
CONTEXT: @{relevant_files} | Git log: {top_10_commits}
EXPECTED: JSON [{commit_sha, risk_level, analysis, could_cause_issue, explanation}]
CONSTRAINTS: Focus on behavioral changes, not formatting
" --role analyze --mode analysis
```
Run_in_background, STOP, wait for callback. Append results.

**Step 3:** Update `understanding.md` §2.

### Stage 3: Exploration (S_EXPLORE)
Skip if no enabled CLI tools (W006).

```bash
maestro delegate "PURPOSE: Gather codebase evidence for: {issue}
TASK: Trace call chains | Find recent changes | Identify error gaps | Check similar patterns
MODE: analysis
CONTEXT: @**/*
EXPECTED: JSON {call_chains, recent_changes, error_gaps, similar_patterns}
CONSTRAINTS: Max 20 entries/category | Symptom-related code paths
Symptoms: {issue}  Archaeology hints: {suspicious_commits}
" --role explore --mode analysis
```
Run_in_background, STOP, wait for callback.

Parse → write `explore.json` + evidence (phase: "explore"). Update §3. Mark G2 done.

### Stage 4: Diagnosis (S_DIAGNOSE)
1. **Form hypotheses** from evidence (archaeology + explore), ranked [HIGH]/[MEDIUM]/[LOW] → §4
2. **Test each** (rank order): design test → execute → evidence (phase: "diagnosis")
3. **Decision journal**: ambiguity → evidence (phase: "decision"); Normal: request_user_input | `-y`: defer
4. **Root cause**: confirmed → `session.json.root_cause` + §5. Mark G1 done.

**Escalation (3-strike):**
All hypotheses fail → increment `diagnosis_retries`.
- < 3: broaden scope via `maestro delegate --role analyze`, form new hypotheses.
- >= 3: Normal → request_user_input (broaden/new/INCONCLUSIVE) | `-y` → auto INCONCLUSIVE, proceed to S_RECORD.

### Stage 5: Fix (S_FIX)
Skip if `--skip-fix`.

1. Present root cause + proposed fix. Normal: request_user_input | `-y`: auto proceed
2. Implement fix
3. Record in evidence (phase: "decision")

### Stage 6: Confirmation (S_CONFIRM)
Skip if `--skip-fix`.

1. **Tests**: auto-detect framework, run covering tests
2. **CLI fix review**:
```bash
maestro delegate "PURPOSE: Review fix for: {issue}
TASK: Verify correctness | Check regressions | Assess completeness
MODE: analysis
CONTEXT: @{modified_files} | Root cause: {summary} | Diff: {git_diff}
EXPECTED: JSON {verdict, findings [{severity, description, suggestion}], regression_risk}
CONSTRAINTS: Focus on correctness, not style
" --role review --mode analysis
```
Run_in_background, STOP, wait for callback.

3. Write `session.json.confirmation`: `{test_result, cli_review, overall, timestamp}`
4. Update §6. `needs_rework` → Stage 5. `confirmed` → mark G3 done, advance.

### Stage 7: Generalization (S_GENERALIZE)
Skip if `--skip-generalize`. 举一反三: extract pattern, scan for siblings.

**Step 1 — Multi-layer pattern extraction:**

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex patterns (direct Grep) | `eval(`, missing `await`, unclosed resource |
| Semantic | Anti-pattern description (Agent scan) | Unhandled async errors, unvalidated input |
| Structural | Architecture-level similarity | Same import structure, missing override |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template}]`

**Step 2 — 4-agent scan (spawn_agents_on_csv, Wave 2):**

Append Wave 2 rows to `tasks.csv`:
```csv
"gen-syntax","Syntax Grep","Grep syntax-layer signatures '${signature}' across project. Return [{file,line,context,risk_level,layer:'syntax',confidence}].","generalization","","2","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for anti-pattern: ${description}. Return [{file,line,context,risk_level,layer:'semantic',confidence}].","generalization","","2","pending","","",""
"gen-structural","Structural Match","Find structurally similar files to ${buggy_files}, check for anti-pattern. Return [{file,line,description,risk,layer:'structural',confidence}].","generalization","","2","pending","","",""
"gen-historical","Historical Grep","Run git log -S '${signature}' --oneline. Return [{sha,file,date,type:'introduced|fixed',context}].","generalization","","2","pending","","",""
```

```javascript
spawn_agents_on_csv({ csv_path:"tasks.csv", id_column:"id",
  instruction: GENERALIZATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency:4, max_runtime_seconds:300,
  output_csv_path:"wave-2-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

**Step 3 — Cross-layer dedup**: same file:line multi-layer → boost confidence | single-layer → `needs_review` | historical fixed → `regression_risk`

**Step 4 — Iterative deepening**: module ≥3 hits → targeted deep scan (max 1 round).

**Step 5 — Quality Gate** (self-iteration).

**Step 6:** Write §7 + `session.json.generalization_stats`: `{patterns_extracted, total_hits, cross_layer_confirmed, regression_risks, by_layer, deepening_triggered}`. Mark G4 done.

### Stage 8: Discovery (S_DISCOVER)
Skip if no generalization hits.

1. **Triage** each hit: read ±10 lines → classify `safe`/`risk`/`bug`
2. **Route**: see Appendix `-y` behavior. Append evidence (phase: "discovery" + "decision")
3. Update §8. Mark G5 done.

### Stage 9: Record (S_RECORD)
1. Finalize `understanding.md` §9
2. **Write learnings** to understanding.md §9: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的后续命令
3. Mark G6 done. Pending decisions: Normal → request_user_input | `-y` → show deferred count
4. **Goal audit**: all confirmed → `phase_goals_all_done = true`. Any false: Normal → request_user_input (回退/跳过/接受) | `-y` → auto accept
5. **Completion**: `current_state = "COMPLETED"`, emit summary:
```
--- DEBUG ODYSSEY COMPLETE ---
Issue:      {issue}
Root cause: {root_cause.hypothesis}
Fix:        {applied|skipped|inconclusive}
Patterns:   {patterns_extracted} ({by_layer} distribution)
Scan hits:  {total_hits} ({cross_layer_confirmed} cross-layer confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} spec entries persisted
Self-iter:  {N} quality gate rounds across {M} stages
Goals:      {done}/{total} confirmed ({skipped} skipped)
---
```

Next steps: `$manage-issue list --source debug-odyssey`, `$learn-decompose <module>`,
`$quality-review`, `$learn-second-opinion <understanding.md>`, `$learn-investigate "<question>"`
</execution>

<appendix>

### Goal Prompt Template

**时机守卫：仅在 Stage 1 完成后显示一次。Stage 9 完成时禁止重新显示。**

```
📋 Debug Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 直到 {SESSION_DIR}/session.json 的 phase_goals[*] 全部 completion_confirmed=true
且 phase_goals_all_done=true 才停。每轮以 session.json 为唯一行动手册，按状态机推进阶段。
禁止跳过未完成的 phase_goal（除非 flags 指定 skip）。
遇到 phase=decision 的 pending 条目必须 request_user_input，不得自行 resolve。
```

Odyssey 输出提示词后继续执行不阻塞。`/goal` 由用户任意时刻输入。

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` mode |
|---------------|--------|-----------|
| Stage 4 ambiguity | request_user_input blocks | record `deferred`, best-effort continue |
| Stage 4 3-strike | request_user_input 3-way | auto INCONCLUSIVE |
| Stage 5 fix direction | request_user_input confirm | auto proceed |
| Stage 8 bug triage | request_user_input route | auto create issue |
| Stage 8 ambiguous | request_user_input batch | all `deferred` |
| Stage 9 decisions | request_user_input per-item | skip, show deferred count |
| Stage 9 goal audit | request_user_input 3-way | auto accept current state |

`deferred` items shown as "待决策" in summary; recoverable via `-c`.

### Phase Goal Lifecycle

`pending → done (confirmed=true)` normal | `pending → skipped (confirmed=true)` flags/manual | `pending → failed (confirmed=false)` INCONCLUSIVE

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No issue and no session to resume | Provide issue or use -c |
| E003 | error | Resume but no session found | Start new session |
| E004 | error | Delegate execution failed | Retry or proceed without CLI |
| W001 | warning | No relevant git history | Proceed with limited context |
| W002 | warning | All hypotheses inconclusive after 3 retries | INCONCLUSIVE |
| W003 | warning | Generalization scan 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
| W005 | warning | Pending decisions unresolved | Filter evidence.ndjson phase=decision |
| W006 | warning | CLI exploration skipped (no tools) | Proceed without explore.json |
</error_codes>

<success_criteria>
- [ ] Session directory created with 4 output files
- [ ] Prior knowledge searched (maestro search + sessions + architecture)
- [ ] Git archaeology (spawn Wave 1) + CLI change review, evidence phase=archaeology
- [ ] CLI exploration, explore.json written, evidence phase=explore
- [ ] Hypotheses formed from archaeology + explore, tested and logged phase=diagnosis
- [ ] Root cause declared with evidence refs
- [ ] understanding.md tracks all 9 sections progressively
- [ ] Fix implemented + confirmed with test + CLI review (unless --skip-fix)
- [ ] Multi-layer patterns extracted (syntax/semantic/structural) (unless --skip-generalize)
- [ ] 4-agent scan (spawn Wave 2) + cross-layer dedup + iterative deepening
- [ ] Discoveries classified and routed (fix/issue/decision/skip)
- [ ] Decision journal: all human-judgment items in evidence.ndjson phase=decision
- [ ] phase_goals derived from flags, skip_when applied, each phase marks its goal
- [ ] Goal audit in Stage 9 — unmet goals surfaced, phase_goals_all_done set correctly
- [ ] Goal Prompt displayed once after session creation
- [ ] `-y`: all decisions auto-resolve/defer, deferred count in summary
- [ ] State saved at each transition (resumable via -c)
- [ ] Quality Gate self-iteration when insufficient, logged in self_iteration_log
- [ ] Spec entries persisted for reusable learnings
- [ ] Completion summary with all stats
</success_criteria>
