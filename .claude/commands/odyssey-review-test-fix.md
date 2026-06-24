---
name: odyssey-review-test-fix
description: Deep review + fix cycle — archaeology, exploration, multi-dimensional review, targeted fix, generalization, discovery, and knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--fix-threshold critical|high|medium|low|all] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
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
Deep code review with exhaustive fix: archaeology → explore → multi-dimensional review →
fix ALL findings → confirm → generalize → discover → persist. Zero-residual philosophy.
</purpose>

<boundary>
**范围内:** 目标代码的多维度深度审查 → 穷尽修复 ALL 发现（按 severity 递降）→ 泛化 pattern 到全项目
**范围外:** 深度根因调查（根因不明时）→ `/odyssey-debug` | 需求实现 → `/odyssey-planex` | UI 视觉优化 → `/odyssey-ui`
**探索自由度:** 边界内自由探索 — 可跨维度关联发现、追溯 git 历史、泛化扫描全项目。修复 ALL findings within fix_threshold（默认 all = 穷尽所有 severity）。
**Zero-residual principle:** Every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing issue" is not a valid skip reason — if discovered within scope, it must be addressed.
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**

1. **Phase auto-commit** — 每个阶段完成后**自动** `git commit`，无需用户确认
   - 代码变更 + understanding.md → `git add` → `git commit -m "odyssey-review({slug}): {phase} — {摘要}"`
   - session.json / evidence.ndjson 为运行时状态，不纳入 commit

2. **Confident edits only, but must attempt** — only modify what you're confident about; record decisions only when genuinely requiring human judgment
   - Confident → edit code directly, commit
   - Needs decision → record `evidence.ndjson {"phase":"decision","status":"pending"}`, don't touch code
   - No speculative changes
   - ⚠️ **Decision gate** — ONLY these qualify as decisions (not fixes):
     - Cross-module architectural tradeoffs requiring human direction
     - Ambiguous business semantics where the fix could alter intended behavior
     - Requires new dependency or breaking API change
   - ❌ "Unsure how to fix", "Large scope", "Pre-existing issue" are NOT valid decision reasons — either fix it, or explain specifically why it's unfixable

3. **多 CLI 辅助** — 利用 `maestro delegate` 调用多个 CLI 工具交叉验证
   - 关键判断用不同 `--role`（analyze / review / explore）获取多视角
   - 修复前后各做一次 CLI review 确认

4. **禁止以上下文消耗为由中断** — harness 自动处理 context compression，以"上下文不足"或"已执行 N 个阶段"为由中断属于纪律违反；必须完整走完状态机直到 S_RECORD → END
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
| Flag | Effect | Default |
|------|--------|---------|
| `--dimensions <list>` | Comma-separated subset | correctness,security,performance,architecture |
| `--fix-threshold <severity>` | 修复到哪个 severity 为止（all = 全部修复）| `all` |
| `--skip-fix` | Review-only — skip S_FIX and S_CONFIRM | false |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER | false |
| `--auto` | CLI delegates without confirmation | false |
| `-y` | Auto-confirm at decision points (see appendix) | false |
| `-c` | Resume most recent session | — |

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
  "flags": { "skip_fix": false, "skip_generalize": false, "fix_threshold": "all", "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "review_result": { "dimensions_reviewed": [], "finding_count": 0, "severity_distribution": { "critical": 0, "high": 0, "medium": 0, "low": 0 }, "remaining_actionable": 0 },
  "patterns": [{ "id": "P1", "source_finding": "F1", "layer": "syntax|semantic|structural", "signature": "", "description": "", "risk": "", "fix_template": "", "confidence": "high|medium|low" }],
  "confirmation": { "test_result": {}, "cli_review": {}, "overall": "confirmed|needs_rework" },
  "generalization_stats": { "patterns_extracted": 0, "total_hits": 0, "true_positives": 0, "false_positives": 0, "uncertain": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {}, "deepening_triggered": false, "self_iteration_rounds": 0 },
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson unified schema:** `{"ts":"","phase":"<phase>","type":"<type>","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":"","files_modified":[]}`

**phase_goals[]:**
| ID | Goal | Done When | Phase | skip_when |
|----|------|-----------|-------|-----------|
| G1 | Review completed | all dimensions reviewed, findings logged | S_REVIEW | — |
| G2 | Explore context gathered | explore.json populated | S_EXPLORE | — |
| G3 | Zero remaining: all findings fixed | `remaining_actionable == 0` within fix_threshold | S_CONFIRM | skip_fix |
| G4 | Pattern generalized | patterns[] ≥1 entry | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | spec entries created OR no actionable | S_RECORD | — |

Lifecycle: `pending → done | skipped | failed` (all set `completion_confirmed`)

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，架构约束 |
| Wiki search | `maestro search "<target keywords>" --json` | 先前 review、已知问题（取 top 5） |
| Specs | `maestro load --type spec --category review` | review 标准、checklist、knowhow 工具 |
| Role knowledge | `maestro search --category review` → 选相关 → `maestro load --type knowhow --id <id>` | 累积 review 领域知识 |
| Prior sessions | `Glob(".workflow/scratch/*-review-odyssey-*")` | 相关 odyssey 会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §8 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 跨维度反复 pattern | 模式描述 + 出现维度 + 建议规范 | `/spec-add review "..."` |
| 安全发现 | 漏洞类型 + 触发条件 + 修复方案 | `/spec-add debug "..."` |
| 架构违反 pattern | 违反描述 + 正确边界 + 检查方法 | `/spec-add arch "..."` |
| 可复用泛化 pattern | pattern 签名 + 风险说明 + fix 模板 | `/spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户通过 next_step_routing 沉淀为永久知识。执行过程中不调用外部 Skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient → re-enter (max 3 rounds).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more dirs, deeper git log, extra delegate angles). Round 2 = shift perspective (different CLI tool, reverse trace, manual reading). Round 3 = combine both + targeted deep-dive on remaining gaps.

**Log:** `evidence.ndjson ← {"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{},"expansion":""}`

**Applicable stages:** S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE
</self_iteration>

<state_machine>

<states>
S_INTAKE       — Parse target, load context, resume session            PERSIST: session.json + understanding.md §1
S_ARCHAEOLOGY  — Git history of target files                           PERSIST: evidence.ndjson (archaeology) + understanding.md §2
S_EXPLORE      — CLI-assisted structure/call-chain exploration         PERSIST: explore.json + evidence.ndjson (explore) + understanding.md §3
S_REVIEW       — Parallel multi-dimension review (4 Agents)            PERSIST: evidence.ndjson (review) + understanding.md §4
S_FIX          — Targeted fix for critical/high (skip if --skip-fix)   PERSIST: code changes + evidence.ndjson (fix)
S_CONFIRM      — Test + CLI review confirmation (skip if --skip-fix)   PERSIST: session.json.confirmation + understanding.md §5
S_GENERALIZE   — Pattern extraction + 4-agent scan (skip if --skip-generalize) PERSIST: session.json.patterns + understanding.md §6
S_DISCOVER     — Classify hits, create issues (skip if --skip-generalize)      PERSIST: evidence.ndjson (discovery|decision) + understanding.md §7
S_RECORD       — Knowledge persistence + final report                  PERSIST: understanding.md §8 + spec entries
</states>

<transitions>
S_INTAKE:
  → S_INTAKE        WHEN -c + session found        DO A_RESUME
  → S_ARCHAEOLOGY   WHEN target resolved            DO A_INTAKE
  → S_INTAKE        WHEN no target                  DO AskUserQuestion

S_ARCHAEOLOGY  → S_EXPLORE      DO A_ARCHAEOLOGY
S_EXPLORE      → S_REVIEW       DO A_EXPLORE

S_REVIEW:
  → S_FIX           WHEN !skip_fix AND any findings within fix_threshold   DO A_REVIEW
  → S_GENERALIZE    WHEN (skip_fix OR no findings) AND !skip_gen           DO A_REVIEW
  → S_RECORD        WHEN (skip_fix OR no findings) AND skip_gen            DO A_REVIEW

S_FIX          → S_CONFIRM      DO A_FIX

S_CONFIRM:
  → S_GENERALIZE    WHEN confirmed AND !skip_gen    DO A_CONFIRM
  → S_RECORD        WHEN confirmed AND skip_gen     DO A_CONFIRM
  → S_FIX           WHEN needs_rework               DO A_CONFIRM

S_GENERALIZE:
  → S_DISCOVER      WHEN hits found                 DO A_GENERALIZE
  → S_RECORD        WHEN no hits                    DO A_GENERALIZE

S_DISCOVER → S_FIX          : discovery finds fixable sibling, !skip_fix → cross_phase_loops++
S_DISCOVER → S_REVIEW       : discovery opens new review target, loops < max_loops → cross_phase_loops++
S_DISCOVER → S_RECORD       : triage complete AND remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

S_RECORD   → END            DO A_RECORD
</transitions>

<actions>

### A_INTAKE
Parse target + flags → file list. Create `SESSION_DIR`, derive `phase_goals[]` from flags.
Search prior knowledge: `maestro search`, prior sessions, ARCHITECTURE.md.
Write `session.json` + `understanding.md` §1. Display Goal Prompt (appendix).

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): INTAKE — 目标解析与上下文加载"`

### A_ARCHAEOLOGY
`git log --oneline -20 -- {target_files}` + `git blame` on key regions.
CLI delegate `--role analyze --mode analysis` to review past changes.
Append evidence.ndjson (phase: "archaeology"). Update `understanding.md` §2.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): ARCHAEOLOGY — git 考古分析"`

### A_EXPLORE
CLI delegate `--role explore --mode analysis` — call chains, error gaps, similar patterns.
Write `explore.json`, append evidence.ndjson (phase: "explore").
Update `understanding.md` §3. Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): EXPLORE — 代码探索完成"`

### A_REVIEW
Spawn N parallel Agents (one per dimension, default 4):

| Agent | Dimension | Focus |
|-------|-----------|-------|
| Correctness | correctness | Logic errors, boundary conditions, null/undefined, race conditions |
| Security | security | Injection, XSS, CSRF, data exposure, auth bypass |
| Performance | performance | Hot paths, N+1, memory leaks, unnecessary recomputation |
| Architecture | architecture | Layer violations, circular deps, interface contracts, SoC |

Each returns `[{title, severity, file, line, description, suggestion, cwe}]`.
Merge → evidence.ndjson (phase: "review"). Write `session.json.review_result`.
Update `understanding.md` §4 (findings by dimension + severity matrix). Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): REVIEW — 多维度审查完成"`

### A_FIX

**穷尽迭代修复** — 按 severity 递降逐轮修复，直到 `remaining_actionable == 0`。

#### Fix Loop (severity tiers)

```
fix_tiers = [critical, high, medium, low].filter(s => severity_order(s) >= severity_order(fix_threshold))
for tier in fix_tiers:
  candidates = evidence.filter(phase=="review" AND severity==tier AND status!="fixed")
  if candidates.empty: continue
  for each candidate:
    read context (file:line ±20) → implement fix → append evidence (phase: "fix")
  run local re-review on modified area ("改进即标准"):
    new_findings in same region? → append to current tier, continue loop
  tier complete → auto-commit
```

**Re-review gate** ("改进即标准"): 每轮修复后，对修改区域执行轻量 re-review（同维度）。若发现新问题，追加到当前轮继续修复。单轮最多 re-review 2 次，防止无限循环。

**Normal**: AskUserQuestion 确认每个 tier 的 candidates。**`-y`**: auto-fix all, record `deferred`.

**Remaining check**: 所有 tiers 完成后，count unfixed findings within fix_threshold → 写入 `review_result.remaining_actionable`。
- If > 0 → retry from tier 1 (NOT limited by max_loops — max_loops only limits cross-phase loops, not FIX-internal retries)
- If remaining unchanged for 2 consecutive rounds (same findings stuck) → classify each stuck finding individually: record as decision (if meets Decision gate criteria) or issue (with fix suggestion)
- ❌ Blanket "N remaining items are pre-existing" is forbidden — each item must have individual classification and reason

📌 **Auto-commit per tier**: `git add -A && git commit -m "odyssey-review({slug}): FIX-{tier} — {N}项修复"`

### A_CONFIRM
Run tests covering modified files. CLI delegate fix review:
```
maestro delegate "PURPOSE: Verify ALL fixes and confirm zero remaining improvements
TASK: Verify fix correctness | Check regressions | Count remaining unfixed findings | Confirm zero-residual
MODE: analysis
CONTEXT: @{modified_files} | Findings: {all_findings_summary} | Diff: {git_diff}
EXPECTED: JSON {verdict, findings_addressed, remaining_unfixed, regression_risk, new_findings_in_modified_area}
CONSTRAINTS: Focus on correctness AND completeness — flag ANY remaining actionable improvement
" --role review --mode analysis
```
以 `run_in_background: true` 执行 delegate，等待回调后继续（不中断 Odyssey 流程）。

**Zero-residual gate:**
- `remaining_unfixed == 0 AND new_findings == 0` → `confirmed`, mark G3 done
- `remaining_unfixed > 0 OR new_findings > 0` → `needs_rework` → S_FIX（追加新发现）
- Regression detected → `needs_rework` → S_FIX

Write `session.json.confirmation` + update `review_result.remaining_actionable`.
Update `understanding.md` §5.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): CONFIRM — 零遗留验证"`

### A_GENERALIZE
**Multi-layer pattern extraction** from findings (severity >= medium):

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex → direct Grep | `eval(`, `innerHTML =` |
| Semantic | Agent understands anti-pattern → scans | Missing error handling on async |
| Structural | File/module structure similarity | Same base class missing override |

Write `session.json.patterns[]`.

**4-agent parallel scan** (single message):
1. **Syntax grep** — Grep syntax-layer signatures across project
2. **Semantic scan** — Check related modules for same anti-patterns
3. **Structural match** — Find structurally similar files, check for same issues
4. **Historical grep** — `git log -S "{pattern}"` for introduction/fix history

**Cross-layer dedup**: Multi-layer hit → boost confidence. Single-layer → `needs_review`. Historical match on fixed code → `regression_risk`.

**Iterative deepening** (conditional): High-density cluster (≥3 hits in same module) → targeted deep scan on that module. Max 1 round.

**CLI validation** (optional): Delegate to validate true/false positives.

Update `understanding.md` §6 (per-pattern summary, cross-layer matrix, risk heatmap).
Write `session.json.generalization_stats`. Mark G4 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): GENERALIZE — 泛化扫描完成"`

### A_DISCOVER
Classify each hit: `bug` / `risk` / `safe`.
- `bug` + directly fixable → **fix immediately** (not just log an issue) → back to S_FIX
- `bug` + requires cross-module/architectural decision → create issue (with fix suggestion + impact analysis)
- `risk` → evaluate if guard/validation can mitigate directly; if yes, fix it
- `safe` → mark skip

**Normal**: AskUserQuestion for routing ambiguity. **`-y`**: auto-fix what's fixable, create issue for rest.
Append evidence (phase: discovery + decision). Update `understanding.md` §7. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): DISCOVER — 发现分类完成"`

### A_RECORD
Finalize `understanding.md` §8: per-dimension summary, top findings with file:line, generalization results, open decisions.
Write learnings to understanding.md §8: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令。
Pending decisions: **Normal** → AskUserQuestion. **`-y`** → skip, display deferred count.
Goal audit: check all `phase_goals[*].completion_confirmed`. Mark G6 done.

Completion summary:
```
--- REVIEW-TEST-FIX ODYSSEY COMPLETE ---
Target:     {target}
Dimensions: {dimensions_reviewed}
Findings:   {C}C {H}H {M}M {L}L
Fix:        {fixed} applied, confirmed={confirmed|skipped}
Patterns:   {extracted} ({by_layer} distribution)
Scan hits:  {total} ({cross_layer} cross-layer confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} spec entries
Self-iter:  {N} rounds across {M} stages
Goals:      {done}/{total} ({skipped} skipped)
---
```

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-review({slug}): RECORD — 会话总结与知识沉淀"`

</actions>

<appendix>

### Goal Prompt Template
**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次（session 创建后、开始考古前）。A_RECORD 完成时禁止重新显示。**

```
📋 Review-Test-Fix Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
穷尽迭代：直到 session.json 的 review_result.remaining_actionable == 0
且 confirmation.verdict == "confirmed" 且 phase_goals_all_done == true 才停。
修复按 severity 逐轮迭代（critical→high→medium→low），每轮修复后 re-review 修改区域。
发现新问题追加到当前轮继续。遇到 phase=decision 的 pending 必须 AskUserQuestion。
不允许"只报告不处理"，每个 finding 必须有 action（fix/issue/decision）。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm (6 decision points)
| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_FIX tier candidates | AskUserQuestion per tier | auto-fix ALL tiers, `deferred` |
| S_FIX re-review new findings | AskUserQuestion | auto-append and fix |
| S_CONFIRM needs_rework | Display, proceed to S_FIX | auto proceed |
| S_DISCOVER bug routing | AskUserQuestion | auto create issue, `deferred` |
| S_DISCOVER ambiguous | AskUserQuestion | all `deferred` |
| S_RECORD pending decisions | AskUserQuestion | skip |
| S_RECORD goal audit | AskUserQuestion | auto accept |

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| E003 | error | Resume but no session | Start new |
| W001 | warning | No git history for target | Proceed |
| W002 | warning | Some dimension agents failed | Partial coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved and session created
- [ ] Git archaeology on target files
- [ ] CLI exploration executed, explore.json written
- [ ] All dimensions reviewed with structured findings
- [ ] Severity matrix produced
- [ ] **ALL findings within fix_threshold fixed** — remaining_actionable == 0 (unless --skip-fix)
- [ ] Per-tier fix with re-review gate: modified area re-reviewed, new findings appended
- [ ] Zero-residual confirmed by CLI external model
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
- [ ] Pattern generalized with multi-layer scan + deepening (unless --skip-generalize)
- [ ] Quality Gate self-iteration triggered when insufficient
- [ ] Discoveries classified and routed
- [ ] understanding.md §8 finalized
- [ ] phase_goals G1-G6 tracked and audited (G3 = zero remaining)
- [ ] Goal Prompt displayed once
- [ ] `-y`: no blocking prompts, deferred counted
- [ ] Session resumable via -c
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Finding needs deeper debug | `/odyssey-debug "<finding>"` |
| Issues created | `/manage-issue list --source review-odyssey` |
| Pattern to document | `/learn-decompose <module>` |
| Plan fixes for findings | `/maestro-plan --gaps` |
</next_step_routing>
