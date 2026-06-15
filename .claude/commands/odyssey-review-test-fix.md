---
name: odyssey-review-test-fix
description: Deep review + fix cycle — archaeology, exploration, multi-dimensional review, targeted fix, generalization, discovery, and knowledge persistence
argument-hint: "<target> [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]"
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
Deep code review with targeted fix and generalization: archaeology → explore → multi-dimensional
review → fix critical/high → confirm → generalize (举一反三) → discover → persist.

Unlike `quality-review` (pipeline gate verdict), this goes deeper: exhaustive documentation,
automated fix, codebase-wide generalization, decision journal. Use `--skip-fix` for review-only.

- **Review to learn AND fix** — depth over speed, action over reports
- **Find one, fix one, find all** — every finding triggers fix + codebase-wide scan
- **Record everything** — ambiguous items → decision journal, never silent skip
- **CLI-assisted** — delegate for multi-angle analysis and verification
</purpose>

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
  "review_result": { "dimensions_reviewed": [], "finding_count": 0, "severity_distribution": { "critical": 0, "high": 0, "medium": 0, "low": 0 } },
  "patterns": [{ "id": "P1", "source_finding": "F1", "layer": "syntax|semantic|structural", "signature": "", "description": "", "risk": "", "fix_template": "", "confidence": "high|medium|low" }],
  "confirmation": { "test_result": {}, "cli_review": {}, "overall": "confirmed|needs_rework" },
  "generalization_stats": { "patterns_extracted": 0, "total_hits": 0, "true_positives": 0, "false_positives": 0, "uncertain": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {}, "deepening_triggered": false, "self_iteration_rounds": 0 },
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "created_at": "", "updated_at": ""
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
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，架构约束 |
| Wiki search | `maestro search "<target keywords>" --json` | 先前 review、已知问题（取 top 5） |
| Specs | `maestro spec load --category review` | review 标准、checklist、knowhow 工具 |
| Role knowledge | `maestro search --category review` → 选相关 → `maestro wiki load <id>` | 累积 review 领域知识 |
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
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient → re-enter (max 2 rounds).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more dirs, deeper git log, extra delegate angles). Round 2 = shift perspective (different CLI tool, reverse trace, manual reading).

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
  → S_FIX           WHEN !skip_fix AND critical/high exist             DO A_REVIEW
  → S_GENERALIZE    WHEN (skip_fix OR no actionable) AND !skip_gen     DO A_REVIEW
  → S_RECORD        WHEN (skip_fix OR no actionable) AND skip_gen      DO A_REVIEW

S_FIX          → S_CONFIRM      DO A_FIX

S_CONFIRM:
  → S_GENERALIZE    WHEN confirmed AND !skip_gen    DO A_CONFIRM
  → S_RECORD        WHEN confirmed AND skip_gen     DO A_CONFIRM
  → S_FIX           WHEN needs_rework               DO A_CONFIRM

S_GENERALIZE:
  → S_DISCOVER      WHEN hits found                 DO A_GENERALIZE
  → S_RECORD        WHEN no hits                    DO A_GENERALIZE

S_DISCOVER     → S_RECORD       DO A_DISCOVER
S_RECORD       → END            DO A_RECORD
</transitions>

<actions>

### A_INTAKE
Parse target + flags → file list. Create `SESSION_DIR`, derive `phase_goals[]` from flags.
Search prior knowledge: `maestro search`, prior sessions, ARCHITECTURE.md.
Write `session.json` + `understanding.md` §1. Display Goal Prompt (appendix).

### A_ARCHAEOLOGY
`git log --oneline -20 -- {target_files}` + `git blame` on key regions.
CLI delegate `--role analyze --mode analysis` to review past changes.
Append evidence.ndjson (phase: "archaeology"). Update `understanding.md` §2.

### A_EXPLORE
CLI delegate `--role explore --mode analysis` — call chains, error gaps, similar patterns.
Write `explore.json`, append evidence.ndjson (phase: "explore").
Update `understanding.md` §3. Mark G2 done.

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

### A_FIX
Filter evidence for `phase=="review" AND severity ∈ [critical, high]` → fix candidates.
**Normal**: AskUserQuestion to confirm which to fix. **`-y`**: auto-fix all, record `deferred`.
For each: read context (file:line ±20), implement fix, append evidence (phase: "fix").
Quality Gate check on fixes.

### A_CONFIRM
Run tests covering modified files. CLI delegate fix review:
```
maestro delegate "PURPOSE: Review fixes for review findings
TASK: Verify fix correctness | Check regressions | Confirm findings addressed
MODE: analysis
CONTEXT: @{modified_files} | Findings: {summary} | Diff: {git_diff}
EXPECTED: JSON {verdict, findings_addressed, regression_risk, remaining_concerns}
CONSTRAINTS: Focus on correctness and regressions
" --role review --mode analysis
```
Run_in_background, STOP, wait. Write `session.json.confirmation`.
Update `understanding.md` §5. `needs_rework` → S_FIX. `confirmed` → mark G3 done.

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

### A_DISCOVER
Classify each hit: `bug` / `risk` / `safe`.
**Normal**: AskUserQuestion for bug routing. **`-y`**: auto create issue, `deferred`.
Append evidence (phase: discovery + decision). Update `understanding.md` §7. Mark G5 done.

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
</actions>

<appendix>

### Goal Prompt Template
**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次（session 创建后、开始考古前）。A_RECORD 完成时禁止重新显示。**

```
📋 Review-Test-Fix Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 直到 {SESSION_DIR}/session.json 的 phase_goals[*] 全部 completion_confirmed=true
且 phase_goals_all_done=true 才停。按状态机推进阶段。
遇到 phase=decision 的 pending 条目必须 AskUserQuestion，不得自行 resolve。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm (5 decision points)
| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_FIX fix candidates | AskUserQuestion | auto-fix critical+high, `deferred` |
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
- [ ] Critical/high findings fixed and confirmed (unless --skip-fix)
- [ ] Pattern generalized with multi-layer scan + deepening (unless --skip-generalize)
- [ ] Quality Gate self-iteration triggered when insufficient
- [ ] Discoveries classified and routed
- [ ] understanding.md §8 finalized
- [ ] phase_goals G1-G6 tracked and audited
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
