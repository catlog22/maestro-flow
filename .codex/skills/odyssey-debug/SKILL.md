---
name: odyssey-debug
description: "Long-running debug cycle — archaeology, diagnosis, fix, confirmation, generalization, discovery, and knowledge persistence"
argument-hint: "<issue> [--skip-fix] [--skip-generalize] [--auto] [-y] [-c] [--heartbeat]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<base>@~/.maestro/workflows/odyssey-base.md</base>

<purpose>
Closed-loop deep debugging: archaeology → explore → diagnose → fix & confirm → generalize → discover siblings → persist.
Treats every bug as a learning signal with exhaustive iteration until root cause confirmed or INCONCLUSIVE.

Core philosophy:
- **Archaeology before hypothesis** — look at what changed before guessing why
- **Fix one, find many** — a single bug reveals a class of bugs
- **Decision journal** — human-judgment items recorded, not lost
- **CLI-assisted review** — delegate for second-opinion analysis

**三句哲学约束（穷尽迭代）:**
1. **零遗留** — 根因必须确认到底，修复必须验证通过，泛化必须扫描穷尽
2. **穷尽迭代** — 假设失败不放弃：扩范围 → 换视角 → 升级工具，直到根因确认或明确 INCONCLUSIVE
3. **改进即标准** — 修复后重新确认同区域无新问题，泛化发现的同类 bug 全部处理
</purpose>

<boundary>
**范围内:** 单一 bug/issue 的完整闭环 — 考古 → 探索 → 诊断 → 修复 → 确认 → 泛化同类 → 沉淀
**范围外:** 新功能开发 → `$odyssey-planex` | 代码质量审查 → `$odyssey-review-test-fix` | UI 视觉优化 → `$odyssey-ui` | 架构重设计 → `/maestro-plan`
**探索自由度:** 边界内自由探索 — 可追踪任意调用链、分析任意历史、测试任意假设。泛化阶段可扫描全项目寻找同类问题。
**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Pre-existing issue" is not a valid skip reason.
**模板支持:** `--template <name>` 从预定义调查策略启动：

| Template | 调查策略 | 适用场景 |
|----------|---------|---------|
| `performance` | profiling → hot path → allocation → cache | 性能劣化 |
| `memory-leak` | heap snapshot → retention chain → lifecycle | 内存泄漏 |
| `race-condition` | timeline → concurrent access → lock analysis | 竞态条件 |
| `regression` | git bisect → diff analysis → boundary check | 回归问题 |
| `crash` | stack trace → null chain → error propagation | 崩溃/异常 |
</boundary>

<context>
$ARGUMENTS — issue description and optional flags.

**Flags:** `--skip-fix` analysis-only | `--skip-generalize` quick fix | `--template <name>` 预定义策略 | `--auto` no delegate confirmation | `-y` auto-confirm all decisions | `-c` resume last session | `--heartbeat` enable /loop heartbeat

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-debug-odyssey-{slug}/`
**Output**: `session.json` | `evidence.ndjson` | `explore.json` | `understanding.md`

**session.json unique fields:**
```json
{ "issue": "", "diagnosis_retries": 0, "root_cause": null, "confirmation": null,
  "patterns": [], "generalization_stats": null, "cross_phase_loops": 0, "max_loops": 5 }
```
共有字段（`progress_metrics`, `directions_tried` 等）见 base。

**evidence.ndjson phases:** `archaeology|explore|diagnosis|discovery|decision|self-iteration`
- `archaeology`: `sha`, `author`, `date`, `message`, `relevance`
- `explore`: `category` (call_chain|recent_change|error_gap|similar_pattern), `detail`
- `diagnosis`: `hypothesis`, `result` (confirmed|disproved|inconclusive)
- `discovery`: `file`, `line`, `classification` (safe|risk|bug), `action` (fix|issue|decision|skip)
- `decision`: `question`, `options`, `context`, `status`, `resolution`
- `self-iteration`: `stage`, `round`, `assessment`, `expansion`

**explore.json**: `{call_chains, recent_changes, error_gaps, similar_patterns, cli_tool, timestamp}`

**phase_goals[]:**

| ID | Goal | done_when | phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Root cause identified | phase=diagnosis result=confirmed | S_DIAGNOSE | — |
| G2 | Explore context gathered | explore.json ≥1 category | S_EXPLORE | — |
| G3 | Fix applied and confirmed | confirmation.overall == confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR none actionable | S_RECORD | — |

**understanding.md — 9 sections:**
1. Issue & Scope ← S_INTAKE | 2. Archaeology ← S_ARCHAEOLOGY | 3. Exploration ← S_EXPLORE
4. Hypotheses ← S_DIAGNOSE | 5. Root Cause ← S_DIAGNOSE | 6. Fix & Confirmation ← S_FIX+S_CONFIRM
7. Generalization ← S_GENERALIZE | 8. Discoveries ← S_DISCOVER | 9. Learnings ← S_RECORD

### Pre-load（可选，缺失不阻塞）

| 命令 | 作用 |
|------|------|
| Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界 |
| `maestro search "<issue keywords>" --json` | 先前调查（top 5） |
| `maestro load --type spec --category debug --keyword "<symptom>"` | 已知 issue/workaround |
| `Glob(".workflow/scratch/*-debug-odyssey-*")` | 相关 odyssey 会话 |

### Knowledge Persistence（S_RECORD → understanding.md §9）

| 分类 | 后续建议命令 |
|------|-------------|
| 反复根因模式 | `/spec-add debug "..."` |
| 非显而易见 workaround | `/spec-add learning "..."` |
| 架构边界违反 | `/spec-add arch "..."` |
| 可复用泛化 pattern | `/spec-add coding "..."` |
</context>

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

<self_iteration>
适用阶段: S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE
</self_iteration>

<state_machine>

<states>
S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_DIAGNOSE → S_FIX → S_CONFIRM → S_GENERALIZE → S_DISCOVER → S_RECORD → END
</states>

<transitions>
S_INTAKE → S_INTAKE       : -c + session found → A_RESUME_SESSION
S_INTAKE → S_ARCHAEOLOGY  : issue parsed → A_INTAKE
S_INTAKE → S_INTAKE       : no issue, no session → request_user_input

S_ARCHAEOLOGY → S_EXPLORE     : A_ARCHAEOLOGY complete
S_EXPLORE     → S_DIAGNOSE    : A_EXPLORE complete

S_DIAGNOSE → S_FIX          : root cause confirmed, !skip_fix
S_DIAGNOSE → S_GENERALIZE   : root cause confirmed, skip_fix, !skip_generalize
S_DIAGNOSE → S_RECORD       : root cause confirmed, skip_fix, skip_generalize
S_DIAGNOSE → S_DIAGNOSE     : all hypotheses failed, retries < 3 → A_ESCALATE_DIAGNOSIS
S_DIAGNOSE → S_RECORD       : retries >= 3 → mark INCONCLUSIVE

S_FIX     → S_CONFIRM       : fix implemented
S_CONFIRM → S_GENERALIZE    : confirmed, !skip_generalize
S_CONFIRM → S_RECORD        : confirmed, skip_generalize
S_CONFIRM → S_FIX           : needs_rework

S_GENERALIZE → S_DISCOVER   : similar code found
S_GENERALIZE → S_RECORD     : no similar code

S_DISCOVER → S_DIAGNOSE     : new bug worth investigating → cross_phase_loops++
S_DISCOVER → S_FIX          : same-pattern bug, fix template applies, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : triage complete, remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → log each unfixed item with specific reason

S_RECORD   → END            : A_RECORD complete
</transitions>

<actions>

### A_INTAKE
1. Parse arguments, generate slug, create `SESSION_DIR`
2. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + Grep keywords
3. Derive `phase_goals[]` from flags (apply `skip_when`)
4. Write `session.json` + `understanding.md` §1, emit Goal Prompt

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): INTAKE — 目标解析与上下文加载"`

### A_RESUME_SESSION
Find latest session via Glob → read `session.json` → display summary → jump to `current_state`.

### A_ARCHAEOLOGY
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

**Step 2 — CLI change review** via `maestro delegate --role analyze --mode analysis` (`run_in_background: true`):
- PURPOSE: Review recent modifications related to {issue}
- EXPECTED: JSON [{commit_sha, risk_level, analysis, could_cause_issue, explanation}]

Update §2.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): ARCHAEOLOGY — git 考古分析"`

### A_EXPLORE
Skip if no enabled CLI tools (W006).

`maestro delegate --role explore --mode analysis` (`run_in_background: true`):
- PURPOSE: Gather codebase evidence — call chains, recent changes, error gaps, similar patterns
- EXPECTED: JSON {call_chains, recent_changes, error_gaps, similar_patterns}

Parse → write `explore.json` + evidence (phase: "explore"). Update §3. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): EXPLORE — 代码探索完成"`

### A_DIAGNOSE
1. Form hypotheses from evidence, ranked [HIGH]/[MEDIUM]/[LOW] → §4
2. Test each: design test → execute → evidence (phase: "diagnosis")
3. Decision journal: ambiguity → evidence (phase: "decision"); Normal: request_user_input | `-y`: defer
4. Root cause confirmed → `session.json.root_cause` + §5. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): DIAGNOSE — 根因确认"`

### A_ESCALATE_DIAGNOSIS
Increment `diagnosis_retries`. < 3: broaden via `maestro delegate --role analyze`, new hypotheses, return S_DIAGNOSE. >= 3: Normal → request_user_input | `-y` → auto INCONCLUSIVE → S_RECORD.

### A_FIX
1. Present root cause + proposed fix. Normal: request_user_input | `-y`: auto proceed
2. Implement fix, record evidence (phase: "decision")

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-debug({slug}): FIX — {修复摘要}"`

### A_CONFIRM
1. Run covering tests (auto-detect framework)
2. CLI fix review via `maestro delegate --role review --mode analysis` (`run_in_background: true`):
   - EXPECTED: JSON {verdict, findings [{severity, description, suggestion}], regression_risk}
3. Write `session.json.confirmation`: `{test_result, cli_review, overall: "confirmed|needs_rework"}`
4. Update §6. `needs_rework` → S_FIX. `confirmed` → mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): CONFIRM — 修复验证"`

### A_GENERALIZE
Skip if `--skip-generalize`. Pattern 来源: root cause + fix。

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

**Step 6:** Write `session.json.generalization_stats`: `{patterns_extracted, total_hits, cross_layer_confirmed, regression_risks, by_layer, deepening_triggered}`. Update §7. Mark G4 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): GENERALIZE — 泛化扫描完成"`

### A_DISCOVER
按 base A_DISCOVER 执行。Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): DISCOVER — 发现分类完成"`

### A_RECORD
1. Finalize `understanding.md` §9，按 Knowledge Persistence 表分类记录
2. Mark G6 done. Pending decisions: Normal → request_user_input | `-y` → skip (show deferred count)
3. 其余按 base A_RECORD 执行
4. **Completion summary**:
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

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-debug({slug}): RECORD — 会话总结与知识沉淀"`

</actions>

<appendix>

### Goal Prompt Template

**时机守卫：仅在 A_INTAKE 完成后显示一次。** 机制见 base。

```
📋 Debug Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
穷尽迭代：直到根因确认（或明确 INCONCLUSIVE）且修复验证通过
且泛化扫描穷尽且 phase_goals_all_done=true 才停。
泛化发现的同类 bug 全部修复或创建 issue，不允许遗留。
遇到 phase=decision 的 pending 必须 request_user_input，不得自行 resolve。
```

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` mode |
|---------------|--------|-----------|
| A_DIAGNOSE ambiguity | request_user_input | `deferred`, best-effort continue |
| A_ESCALATE 3-strike | request_user_input 3-way | auto INCONCLUSIVE |
| A_FIX direction | request_user_input | auto proceed with suggested fix |
| A_DISCOVER bug triage | request_user_input | auto create issue |
| A_DISCOVER ambiguous | request_user_input batch | all `deferred` |
| A_RECORD decisions | request_user_input per-item | skip, show deferred count |
| A_RECORD goal audit | request_user_input 3-way | auto accept current state |

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No issue and no session to resume | Provide issue or use -c |
| W001 | warning | No relevant git history | Proceed with limited context |
| W002 | warning | All hypotheses inconclusive after 3 retries | INCONCLUSIVE |
| W005 | warning | Pending decisions unresolved | Filter evidence.ndjson phase=decision |
| W006 | warning | CLI exploration skipped (no tools) | Proceed without explore.json |
</error_codes>

<success_criteria>
- [ ] Session created with 4 output files, prior knowledge searched
- [ ] Git archaeology + CLI change review → evidence phase=archaeology
- [ ] CLI exploration → explore.json + evidence phase=explore
- [ ] Hypotheses tested, root cause declared with evidence refs
- [ ] understanding.md tracks all 9 sections progressively
- [ ] Fix implemented + confirmed (unless --skip-fix)
- [ ] Multi-layer generalization + scan (unless --skip-generalize)
- [ ] Discoveries classified and routed; every unfixed finding individually justified
- [ ] phase_goals derived, goal audit in A_RECORD, state resumable via -c
- [ ] Completion summary with all stats
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Issues from discoveries | `/manage-issue list --source debug-odyssey` |
| Pattern worth documenting | `/learn-decompose <module>` |
| Fix needs formal review | `/quality-review <phase>` |
| Second opinion on root cause | `/learn-second-opinion <understanding.md>` |
| Related question | `/learn-investigate "<question>"` |
| Decisions still pending | Filter evidence.ndjson phase=decision status=pending |
</next_step_routing>
