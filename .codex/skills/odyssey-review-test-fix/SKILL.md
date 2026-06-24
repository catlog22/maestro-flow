---
name: odyssey-review-test-fix
description: "Deep review cycle — archaeology, exploration, multi-dimensional review, targeted fix, generalization, discovery, and detailed knowledge persistence"
argument-hint: "<target> [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Deep code review with generalization: archaeology → explore → multi-dimensional review →
fix all findings → confirm → generalize (举一反三) → discover → persist.

**三句哲学约束（穷尽迭代）:**
1. **零遗留** — 每个 finding 必须是 action item（修复 / issue / 决策），不允许只报告不处理
2. **穷尽迭代** — 按 severity 从高到低逐轮修复，直到 0 remaining actionable findings 才退出 fix loop
3. **改进即标准** — 每次修复后重审同区域，发现新问题继续修，直到该区域无可改善

Core behaviors:
- **Find one, fix one, find all** — every finding triggers fix + codebase-wide scan
- **Record everything** — ambiguous items → decision journal, never silent skip
- **CLI-assisted** — delegate for multi-angle analysis
</purpose>

<boundary>
**范围内:** 目标代码多维度审查 → Fix ALL findings within fix_threshold (default: all = exhaustive across all severity levels) → 泛化 pattern
**范围外:** 深度根因 → `$odyssey-debug` | 需求实现 → `$odyssey-planex` | UI 优化 → `$odyssey-ui`
**探索自由度:** 边界内自由 — 跨维度关联、追溯历史、泛化全项目。穷尽修复 ALL 发现（按 severity 递降）。

**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**
1. **Phase auto-commit** — 阶段完成后**自动** `git commit`，无需用户确认（session.json/evidence.ndjson 不纳入）
2. **Confident edits only, but must attempt** — only modify what you're confident about; record decisions only when genuinely requiring human judgment
   - Confident → edit code directly, commit
   - Needs decision → record `evidence.ndjson {"phase":"decision","status":"pending"}`, don't touch code
   - No speculative changes
   - ⚠️ **Decision gate** — ONLY these qualify as decisions (not fixes):
     - Cross-module architectural tradeoffs requiring human direction
     - Ambiguous business semantics where the fix could alter intended behavior
     - Requires new dependency or breaking API change
   - ❌ "Unsure how to fix", "Large scope", "Pre-existing issue" are NOT valid decision reasons — either fix it, or explain specifically why it's unfixable
3. **多 CLI 辅助** — `maestro delegate` 多 `--role`（analyze/review/explore）交叉验证，修复前后各 review 一次
</execution_discipline>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Phase number | Resolve via state.json → changed files |
| PR number | `git diff main...HEAD` |

**Flags:**
| Flag | Effect |
|------|--------|
| `--dimensions <list>` | Comma-separated subset (default: correctness,security,performance,architecture) |
| `--skip-fix` | Review-only — skip S_FIX and S_CONFIRM |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER |
| `--auto` | CLI delegates without confirmation |
| `-y` | Auto-confirm at 5 decision points (see appendix) |
| `-c` | Resume most recent session |

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-review-odyssey-{slug}/`

**Output — 4 files:**
```
SESSION_DIR/
  ├── session.json       # state + review_result + confirmation + patterns + phase_goals
  ├── evidence.ndjson    # ALL evidence (phase: archaeology|explore|review|fix|discovery|decision)
  ├── explore.json       # CLI exploration snapshot
  └── understanding.md   # 8-section evolving narrative (§1-§8, one per major phase)
```

**session.json schema:**
```json
{
  "session_id": "review-odyssey-{YYYYMMDD-HHmmss}",
  "target": "", "dimensions": [],
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "review_result": { "dimensions_reviewed": [], "finding_count": 0, "severity_distribution": {} },
  "patterns": [{ "id": "P1", "source_finding": "", "layer": "syntax|semantic|structural", "signature": "", "description": "", "risk": "", "fix_template": "" }],
  "confirmation": { "test_result": {}, "cli_review": {}, "overall": "confirmed|needs_rework" },
  "generalization_stats": { "patterns_extracted": 0, "total_hits": 0, "true_positives": 0, "false_positives": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {} },
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5
}
```

**evidence.ndjson unified schema:** `{"ts":"","phase":"<phase>","type":"<type>","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":"","files_modified":[]}`

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Review completed | S_REVIEW | — |
| G2 | Explore context gathered | S_EXPLORE | — |
| G3 | Fix applied and confirmed | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | S_RECORD | — |

Lifecycle: `pending → done | skipped | failed` (all set `completion_confirmed`)

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界 |
| Wiki search | `maestro search "<target keywords>" --json` | 先前 review（top 5） |
| Specs | `maestro load --type spec --category review` | review 标准、checklist |
| Role knowledge | `maestro search --category review` → 选相关 → `maestro load --type knowhow --id <id>` | 领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-review-odyssey-*")` | 相关会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 将可沉淀知识 **写入 understanding.md §8 Learnings**，按分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 跨维度反复 pattern | 模式描述 + 出现维度 + 建议规范 | `$spec-add review "..."` |
| 安全发现 | 漏洞类型 + 触发条件 + 修复方案 | `$spec-add debug "..."` |
| 架构违反 pattern | 违反描述 + 正确边界 + 检查方法 | `$spec-add arch "..."` |
| 可复用泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `$spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户沉淀为永久知识。执行过程中不调用外部 skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient → re-enter (max **3 rounds**).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope. Round 2 = shift perspective. Round 3 = combine both + targeted deep-dive on remaining gaps.
**Applicable stages:** S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE
</self_iteration>

<csv_schema>

### Shared Output Schema
```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings": { "type": "string", "maxLength": 500 },
    "evidence": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination contract:** Call `report_agent_job_result` EXACTLY ONCE. Read-only. Do NOT modify source files, tasks.csv, wave-*.csv, results.csv, or call spawn_agents_on_csv.

### tasks.csv
```csv
id,title,description,task_type,dimension,deps,wave,status,findings,evidence,error
```

**Waves:**
| Wave | Tasks | Parallelism |
|------|-------|-------------|
| 1 | Archaeology (git-timeline, git-blame) | 2 agents |
| 2 | Review (correctness, security, performance, architecture) | 4 agents |
| 3 | Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) | 4 agents |
</csv_schema>

<invariants>
1. **Code modifications only in S_FIX** — `--skip-fix` preserves review-only behavior
2. **Evidence append-only** — evidence.ndjson is never overwritten
3. **Session is source of truth** — session.json holds all state
4. **Phase goal tracking** — each stage MUST mark its goal on completion
5. **`-y` defers, never drops** — auto-confirm records `deferred`, never silently skips
6. **CLI delegate is background** — all `maestro delegate` calls use run_in_background
7. **Goal is outcome-oriented** — odyssey outputs prompt then continues
8. **Invariant violation = BLOCK**
</invariants>

<execution>

**States:** S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → S_GENERALIZE → S_DISCOVER → S_RECORD
- S_FIX/S_CONFIRM skip when `--skip-fix`
- S_GENERALIZE/S_DISCOVER skip when `--skip-generalize`

### S_INTAKE
Parse target + flags → file list. Create `SESSION_DIR`, derive `phase_goals[]`.
Search prior knowledge: `maestro search`, prior sessions, ARCHITECTURE.md.
Write `session.json` + `understanding.md` §1. Display Goal Prompt (appendix).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_INTAKE — 目标解析"`

### S_ARCHAEOLOGY
**spawn_agents_on_csv (Wave 1):**
```csv
"arch-timeline","Git Timeline","git log --oneline -20 -- {target_files}","archaeology","","","1","pending","","",""
"arch-blame","Git Blame","git blame on key regions of target files","archaeology","","","1","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: ARCHAEOLOGY_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 2, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```
Merge → evidence.ndjson (phase: "archaeology").
CLI delegate `--role analyze --mode analysis` for change review (execute with `run_in_background: true`, then wait for callback — do NOT halt the Odyssey flow).
Update `understanding.md` §2.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_ARCHAEOLOGY — 考古"`

### S_EXPLORE
CLI delegate `--role explore --mode analysis` → `explore.json` + evidence.ndjson (phase: "explore").
Update `understanding.md` §3. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_EXPLORE — 探索"`

### S_REVIEW
**spawn_agents_on_csv (Wave 2)** — append rows:
```csv
"rev-correct","Correctness","Logic errors, boundary conditions, null/undefined, race conditions","review","correctness","","2","pending","","",""
"rev-security","Security","Injection, XSS, CSRF, data exposure, auth bypass","review","security","","2","pending","","",""
"rev-perf","Performance","Hot paths, N+1, memory leaks, unnecessary recomputation","review","performance","","2","pending","","",""
"rev-arch","Architecture","Layer violations, circular deps, interface contracts, SoC","review","architecture","","2","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: REVIEW_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 600,
  output_csv_path: "wave-2-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```
Merge → evidence.ndjson (phase: "review"). Write `session.json.review_result`.
Update `understanding.md` §4. Mark G1 done.
Transition: any findings exist AND !skip_fix → S_FIX. Else → S_GENERALIZE or S_RECORD.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_REVIEW — 审查"`

### S_FIX
Skip if `--skip-fix` or no findings.
**Exhaustive fix** — Fix ALL findings within fix_threshold (default: all = exhaustive across all severity levels). Fix in severity-descending order (critical→high→medium→low), re-review modified areas after each round, append new findings.
**Normal**: `request_user_input` to confirm. **`-y`**: auto-fix all, record `deferred`.
Implement targeted fixes. Record evidence (phase: "fix"). Quality Gate check.

**Remaining check after each round:**
- If > 0 → retry from tier 1 (NOT limited by max_loops — max_loops only limits cross-phase loops, not FIX-internal retries)
- If remaining unchanged for 2 consecutive rounds (same findings stuck) → classify each stuck finding individually: record as decision (if meets Decision gate criteria) or issue (with fix suggestion)
- ❌ Blanket "N remaining items are pre-existing" is forbidden — each item must have individual classification and reason

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-review({slug}): S_FIX — 修复"`

### S_CONFIRM
Skip if `--skip-fix`.
Run tests on modified files. CLI delegate `--role review --mode analysis` for fix review (execute with `run_in_background: true`, then wait for callback — do NOT halt the Odyssey flow).
Write `session.json.confirmation`. Update `understanding.md` §5.
`needs_rework` → S_FIX. `confirmed` → mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_CONFIRM — 确认"`

### S_GENERALIZE
Skip if `--skip-generalize`.

**Pattern extraction** from severity >= medium findings into 3 layers:
| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex → Grep | `eval(`, `innerHTML =` |
| Semantic | Agent anti-pattern scan | Missing error handling on async |
| Structural | File/module similarity | Same base class missing override |

Write `session.json.patterns[]`.

**spawn_agents_on_csv (Wave 3)** — 4 agents parallel:
```csv
"gen-syntax","Syntax Grep","Grep syntax-layer patterns across project","generalization","syntax","","3","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for same anti-patterns","generalization","semantic","","3","pending","","",""
"gen-structural","Structural Match","Find structurally similar files, check for same issues","generalization","structural","","3","pending","","",""
"gen-historical","Historical Grep","git log -S pattern for introduction/fix history","generalization","historical","","3","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: GENERALIZATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 600,
  output_csv_path: "wave-3-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

**Cross-layer dedup**: Multi-layer hit → boost confidence. Single → `needs_review`. Historical fix → `regression_risk`.
**Iterative deepening**: ≥3 hits in same module → targeted deep scan. Max 1 round.
**CLI validation** (optional): Delegate to verify true/false positives (execute with `run_in_background: true`, then wait for callback — do NOT halt the Odyssey flow).

Update `understanding.md` §6. Write `session.json.generalization_stats`. Mark G4 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_GENERALIZE — 泛化"`

### S_DISCOVER
Classify hits: `bug` / `risk` / `safe` / `issue`.
**Triage routing:**
- `bug`/`issue` + directly fixable → **fix immediately** → back to S_FIX
- `bug`/`issue` + requires cross-module/architectural decision → create issue (with fix suggestion + impact analysis)
- `risk` → evaluate if guard/validation can mitigate directly; if yes, fix it
- `safe` → mark skip
**Normal**: `request_user_input` for bug routing. **`-y`**: auto create issue, `deferred`.
**Cross-phase loop**:
- Fixable sibling → S_FIX (!skip_fix, cross_phase_loops++)
- New review target → S_REVIEW (cross_phase_loops++)
- S_DISCOVER → S_RECORD: triage complete AND remaining_actionable == 0
- S_DISCOVER → S_RECORD: loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)
Append evidence (phase: discovery + decision). Update `understanding.md` §7. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_DISCOVER — 发现"`

### S_RECORD
Finalize `understanding.md` §8: per-dimension summary, top findings, generalization results, open decisions.
Write learnings to understanding.md §8: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的后续命令。
Pending decisions: **Normal** → `request_user_input`. **`-y`** → skip, display deferred count.
Goal audit: check all `phase_goals[*].completion_confirmed`. Mark G6 done.

Completion summary:
```
--- REVIEW ODYSSEY COMPLETE ---
Target:     {target}
Dimensions: {reviewed}
Findings:   {C}C {H}H {M}M {L}L
Fix:        {F} applied, {S} skipped
Patterns:   {N} extracted ({by_layer} distribution)
Scan hits:  {total} ({cross_layer} cross-layer confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Self-iter:  {R} rounds across {P} phases
Goals:      {done}/{total} ({skipped} skipped)
---
```

**Next steps:** `$odyssey-debug "<finding>"`, `$manage-issue list --source review-odyssey`,
`$learn-decompose <module>`, `$maestro-plan --gaps`

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): S_RECORD — 总结"`
</execution>

<appendix>

### Goal Prompt Template
**⚠️ 时机守卫：仅在 Stage 1 完成后显示一次（session 创建后、开始考古前）。Stage 8 完成时禁止重新显示。**

```
📋 Review-Test-Fix Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件：

/goal 穷尽迭代：直到所有 findings 均已处理（fix/issue/decision），remaining_actionable == 0
且 phase_goals_all_done=true 才停。修复按 severity 逐轮迭代，每轮修复后 re-review。
不允许"只报告不处理"，每个 finding 必须有 action。
遇到 phase=decision 的 pending 必须 request_user_input，不得自行 resolve。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm (5 decision points)
| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_FIX fix candidates | request_user_input | auto-fix critical+high, `deferred` |
| S_DISCOVER bug routing | request_user_input | auto issue, `deferred` |
| S_DISCOVER ambiguous | request_user_input | all `deferred` |
| S_RECORD pending decisions | request_user_input | skip |
| S_RECORD goal audit | request_user_input | auto accept |

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target | Provide target |
| E002 | error | Target not found | Check path |
| E003 | error | Resume no session | Start new |
| W001 | warning | No git history | Proceed |
| W002 | warning | Dimension agent failed | Partial coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
</error_codes>

<success_criteria>
- [ ] Target resolved, session created
- [ ] Archaeology via spawn_agents_on_csv Wave 1
- [ ] CLI exploration, explore.json written
- [ ] All dimensions reviewed via spawn_agents_on_csv Wave 2
- [ ] Severity matrix produced
- [ ] All findings fixed and confirmed within fix_threshold (unless --skip-fix)
- [ ] `--skip-fix`: no source code modifications
- [ ] Generalization via spawn_agents_on_csv Wave 3 (unless --skip-generalize)
- [ ] Discoveries classified and routed
- [ ] understanding.md §8 finalized
- [ ] Goal Prompt displayed, phase_goals G1-G6 tracked
- [ ] `-y`: no blocking, deferred counted
- [ ] Self-iteration quality gates passed
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
</success_criteria>
