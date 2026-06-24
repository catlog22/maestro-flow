---
name: odyssey-ui
description: Long-running UI optimization cycle — visual survey, multi-dimensional audit, divergent exploration, fix, verify, generalize, and design knowledge persistence
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
Deep UI polish cycle: survey → 6-dimension audit → divergent creative exploration →
fix → verify → generalize → discover → persist. Every pixel is a learning opportunity.
</purpose>

<boundary>
**范围内:** 目标组件/页面的视觉体验优化 — 审查 6 维度 → 发散探索 → 修复 → 泛化到兄弟组件
**范围外:** 后端逻辑 / 数据模型 / API 设计 / 业务规则 → `/odyssey-planex` | 深度 bug 调查 → `/odyssey-debug` | 代码质量审查 → `/odyssey-review-test-fix`
**探索自由度:** 边界内最大自由 — S_DIVERGE 阶段鼓励发散思维，不设创意上限。审查 + 发散可发现任何视觉/交互/可访问性细节。在约束下尽可能完善每个像素。
**Zero-residual principle:** Every finding/idea MUST have a concrete action (fix / issue / decision). "Report and shelve" is not allowed. "Pre-existing design debt" is not a valid skip reason — if discovered within scope, it must be addressed.
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**

1. **Phase auto-commit** — 每个阶段完成后**自动** `git commit`，无需用户确认
   - 代码变更 + understanding.md → `git add` → `git commit -m "odyssey-ui({slug}): {phase} — {摘要}"`
   - session.json / evidence.ndjson 为运行时状态，不纳入 commit

2. **Confident edits only, but must attempt** — only modify what you're confident about; record decisions only when genuinely requiring human judgment
   - High visual certainty (missing hover state, insufficient contrast, etc.) → fix directly
   - Design direction uncertain (color choices, layout restructure, etc.) → record decision for user judgment
   - No speculative changes, especially brand/style-level modifications
   - ⚠️ **Decision gate** — ONLY these qualify as decisions (not fixes):
     - Brand/style direction requiring human creative judgment
     - Layout restructuring that changes user flow significantly
     - Requires new design tokens or breaking component API
   - ❌ "Unsure how to fix", "Large scope", "Pre-existing issue" are NOT valid decision reasons — either fix it, or explain specifically why it's unfixable

3. **多 CLI 辅助** — 利用 `maestro delegate` 调用多个 CLI 工具交叉验证
   - survey 阶段: `--role explore` 发现设计系统用法
   - audit/diverge: `--role analyze` 获取多视角创意
   - fix 前后: `--role review` 确认视觉正确性

4. **禁止以上下文消耗为由中断** — harness 自动处理 context compression，以"上下文不足"或"已执行 N 个阶段"为由中断属于纪律违反；必须完整走完状态机直到 S_RECORD → END
</execution_discipline>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Component path | Audit that component |
| Page/route path | Audit that page |
| `staged` / `HEAD` | Review UI changes in diff |
| Feature area name | Resolve to related components/pages |

**Flags:**
| Flag | Effect | Default |
|------|--------|---------|
| `--dimensions <list>` | Comma-separated subset of 6 dimensions | all 6 |
| `--fix-threshold <severity>` | 修复到哪个 severity 为止（all = 全部修复）| all |
| `--skip-fix` | Audit + diverge only, no code changes | false |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER | false |
| `--auto` | CLI delegates without confirmation | false |
| `-y` | Auto-confirm all decisions (see appendix) | false |
| `-c` | Resume most recent session | — |

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-ui-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + audit_result + diverge_result + patterns + phase_goals
  ├── evidence.ndjson    # append-only (phase: survey|audit|diverge|fix|discovery|decision|self-iteration)
  └── understanding.md   # 8-section evolving narrative
```

**session.json schema:**
```json
{
  "session_id": "ui-odyssey-{YYYYMMDD-HHmmss}",
  "target": "", "dimensions": [],
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "audit_result": { "dimensions_audited": [], "finding_count": 0, "severity_distribution": { "critical": 0, "high": 0, "medium": 0, "low": 0 } },
  "diverge_result": { "improvements_proposed": 0, "creative_ideas": 0 },
  "patterns": [{ "id": "P1", "source_finding": "F1", "layer": "syntax|semantic|structural", "signature": "", "description": "", "risk": "", "fix_template": "", "confidence": "high|medium|low" }],
  "confirmation": { "test_result": {}, "cli_review": {}, "overall": "confirmed|needs_rework" },
  "generalization_stats": { "patterns_extracted": 0, "total_hits": 0, "cross_layer_confirmed": 0, "regression_risks": 0, "by_layer": {}, "deepening_triggered": false },
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

**evidence.ndjson unified schema:** `{"ts":"","phase":"<phase>","type":"<type>","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":"","category":"","impact":"","effort":""}`

**phase_goals[]:**
| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Divergent exploration done | S_DIVERGE | — |
| G4 | Zero remaining: all findings/ideas fixed and verified | 0 remaining actionable within fix_threshold | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

Lifecycle: `pending → done | skipped | failed` (all set `completion_confirmed`)

### Pre-load（可选，缺失不阻塞）

| 层级 | 命令 | 作用 |
|------|------|------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | 模块边界，组件结构 |
| Wiki search | `maestro search "<target keywords>" --json` | 先前 UI 决策（取 top 5） |
| UI specs | `maestro load --type spec --category ui` | 设计规范、token、组件约定 |
| Coding specs | `maestro load --type spec --category coding` | 编码规范 |
| Role knowledge | `maestro search --category ui` → 选相关 → `maestro load --type knowhow --id <id>` | 累积设计知识 |
| Prior sessions | `Glob(".workflow/scratch/*-ui-odyssey-*")` | 相关会话 |

### Knowledge Persistence（S_RECORD 中写入产出文件）

S_RECORD 阶段将可沉淀知识 **写入 understanding.md §8 Learnings**，按以下分类结构化：

| 分类 | 写入内容 | 后续建议命令 |
|------|---------|-------------|
| 设计 pattern | 组件模式 + 适用场景 + token 引用 | `/spec-add ui "..."` |
| 交互规范 | 状态定义 + 转场规则 + 反馈模式 | `/spec-add ui "..."` |
| 可访问性规则 | WCAG 要求 + 实现方案 | `/spec-add ui "..."` |
| 可复用泛化 pattern | pattern 签名 + 应用范围 | `/spec-add coding "..."` |

**两步模式：** 执行中写入产出文件（临时记录）→ 任务完成后用户通过 next_step_routing 沉淀为永久知识。执行过程中不调用外部 Skill。
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient → re-enter (max **3 rounds**).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All target components/pages analyzed across dimensions | Missed files discoverable via grep/glob |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete improvement action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more components, deeper import chain, extra delegate angles). Round 2 = shift perspective (different CLI tool, reverse dependency trace, manual code reading). Round 3 = combine both + targeted deep-dive on remaining gaps.

**Log:** `evidence.ndjson ← {"phase":"self-iteration","type":"quality-gate","stage":"S_XXX","round":N,"assessment":{},"expansion":""}`

**Applicable stages:** S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE
</self_iteration>

<state_machine>

<states>
S_INTAKE     — Parse target, load design context, resume session           PERSIST: session.json + understanding.md §1
S_SURVEY     — Visual landscape: design tokens, pattern inventory          PERSIST: evidence.ndjson (survey) + understanding.md §2
S_AUDIT      — 6-dimension parallel review                                 PERSIST: evidence.ndjson (audit) + understanding.md §3
S_DIVERGE    — Divergent creative exploration: polish + delight            PERSIST: evidence.ndjson (diverge) + understanding.md §4
S_FIX        — Implement improvements (skip if --skip-fix)                 PERSIST: code changes + evidence.ndjson (fix)
S_VERIFY     — Visual verification + test (skip if --skip-fix)             PERSIST: session.json.confirmation + understanding.md §5
S_GENERALIZE — Pattern extraction + 4-agent scan (skip if --skip-gen)      PERSIST: session.json.patterns + understanding.md §6
S_DISCOVER   — Classify hits, create issues (skip if --skip-gen)           PERSIST: evidence.ndjson (discovery|decision) + understanding.md §7
S_RECORD     — Design knowledge persistence + final report                 PERSIST: understanding.md §8 + spec entries
</states>

<transitions>
S_INTAKE:
  → S_INTAKE      WHEN -c + session found        DO A_RESUME
  → S_SURVEY      WHEN target resolved            DO A_INTAKE
  → S_INTAKE      WHEN no target                  DO AskUserQuestion

S_SURVEY       → S_AUDIT        DO A_SURVEY

S_AUDIT        → S_DIVERGE      DO A_AUDIT

S_DIVERGE:
  → S_FIX          WHEN !skip_fix AND actionable findings/ideas           DO A_DIVERGE
  → S_GENERALIZE   WHEN (skip_fix OR no actionable) AND !skip_gen        DO A_DIVERGE
  → S_RECORD       WHEN (skip_fix OR no actionable) AND skip_gen         DO A_DIVERGE

S_FIX          → S_VERIFY       DO A_FIX

S_VERIFY:
  → S_GENERALIZE   WHEN verified AND !skip_gen    DO A_VERIFY
  → S_RECORD       WHEN verified AND skip_gen     DO A_VERIFY
  → S_FIX          WHEN needs_rework              DO A_VERIFY

S_GENERALIZE:
  → S_DISCOVER     WHEN hits found                DO A_GENERALIZE
  → S_RECORD       WHEN no hits                   DO A_GENERALIZE

S_DISCOVER → S_AUDIT        : discovery reveals new component to audit → cross_phase_loops++
S_DISCOVER → S_FIX          : discovery finds fixable sibling, !skip_fix → cross_phase_loops++
S_DISCOVER → S_RECORD       : triage complete AND remaining_actionable == 0
S_DISCOVER → S_RECORD       : loops >= max_loops → MUST log each unfixed item with specific reason (blanket "pre-existing" is forbidden)

S_RECORD   → END            DO A_RECORD
</transitions>

<actions>

### A_INTAKE
1. Parse arguments: target description, flags, `--dimensions` subset
2. Generate slug, create `SESSION_DIR`
3. Search: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load ui/coding
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` §1 (Target & Design Context)
6. Emit Goal Prompt (see Appendix)

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): INTAKE — 目标解析"`

### A_RESUME
Find latest session via Glob → read `session.json` → display summary → jump to `current_state`.

### A_SURVEY
Visual landscape survey — understand the current state before proposing changes.

1. **Design system inventory**: Scan target files for design tokens, CSS variables, theme imports. Catalog what's used.
2. **Current state analysis**: Read component code, identify styling patterns, layout strategy, component hierarchy.
3. **CLI-assisted survey** (optional):
```bash
maestro delegate "PURPOSE: Survey UI design state of: {target}
TASK: Identify design tokens in use | Catalog spacing/typography patterns | Map component hierarchy | Check consistency with design system
MODE: analysis
CONTEXT: @{target_files}
EXPECTED: JSON {tokens_used, spacing_patterns, typography_scale, component_hierarchy, consistency_issues}
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

4. Append evidence.ndjson (phase: "survey"). Update `understanding.md` §2. Mark G1 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): SURVEY — 视觉调查"`

### A_AUDIT
Spawn 6 parallel Agents (one per dimension, or `--dimensions` subset):

| Agent | Dimension | Focus |
|-------|-----------|-------|
| Visual Hierarchy | visual_hierarchy | Spacing, typography scale, color contrast, alignment, whitespace, visual weight |
| Interaction States | interaction_states | Hover, focus, active, disabled, loading, error, empty, selected states |
| Accessibility | accessibility | WCAG AA contrast, focus management, aria labels, keyboard nav, screen reader |
| Responsiveness | responsiveness | Breakpoints, overflow, touch targets, fluid typography, container queries |
| Micro-interactions | micro_interactions | Transitions, animations, feedback indicators, loading states, progress |
| Edge Cases | edge_cases | Long text truncation, empty data, error states, extreme values, i18n, RTL |

Each returns `[{title, severity, file, line, description, suggestion, dimension}]`.
Merge → evidence.ndjson (phase: "audit"). Write `session.json.audit_result`.
Update `understanding.md` §3 (findings by dimension + severity matrix). Mark G2 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): AUDIT — 多维审查"`

### A_DIVERGE
**The unique phase** — divergent creative exploration. Goes beyond defect fixing to ask "what would make this delightful?"

**Step 1 — Creative exploration (2 parallel Agents):**

| Agent | Angle | Prompt Focus |
|-------|-------|-------------|
| Polish Agent | "What subtle details are missing?" | Shadows, borders, transitions, hover states, feedback, empty states, skeleton loading, scroll behavior |
| Delight Agent | "What would make this experience memorable?" | Motion design, progressive disclosure, smart defaults, contextual hints, celebratory feedback, personality in copy |

Each returns: `[{idea, category (polish|delight), impact (high|medium|low), effort (small|medium|large), description, inspiration}]`

**Step 2 — CLI-assisted design review** (optional):
```bash
maestro delegate "PURPOSE: Creative UI review of: {target}
TASK: Identify polish opportunities | Suggest micro-interaction improvements | Review visual rhythm and harmony | Propose delight moments
MODE: analysis
CONTEXT: @{target_files} | Audit summary: {audit_findings_summary}
EXPECTED: JSON [{category, idea, rationale, reference}]
" --role analyze --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

**Step 3 — Consolidate**: Merge audit findings + divergent ideas → prioritized improvement list (severity x impact x effort matrix).
Append evidence.ndjson (phase: "diverge"). Update `understanding.md` §4. Mark G3 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): DIVERGE — 发散探索"`

### A_FIX
Skip if `--skip-fix`. Implement improvements prioritized by impact.

1. **穷尽修复**: Fix ALL findings/ideas by priority tier (critical→high→medium→low + high-impact ideas), not just top items. After each tier, re-review modified area — new findings append.
2. For each fix: implement → append evidence.ndjson (phase: "fix")
3. **Normal**: AskUserQuestion per-fix confirmation. **`-y`**: auto-proceed, record `deferred`.

📌 **Auto-commit**: `git add -A && git commit -m "odyssey-ui({slug}): FIX — 优化实现"`

### A_VERIFY
Visual verification — confirm improvements work in practice.

1. Run tests if applicable (lint, unit, visual regression)
2. **CLI-assisted visual review**:
```bash
maestro delegate "PURPOSE: Verify UI improvements for: {target}
TASK: Check visual correctness | Verify interaction states | Confirm accessibility | Test responsive behavior
MODE: analysis
CONTEXT: @{modified_files} | Improvements: {fix_summary}
EXPECTED: JSON {verdict, verified_improvements, remaining_issues, regression_risk}
" --role review --mode analysis
```
Execute with `run_in_background: true`, then wait for callback (do NOT halt the Odyssey flow).

3. `needs_rework` → S_FIX. `verified` → mark G4 done, advance.
4. Update `understanding.md` §5. Write `session.json.confirmation`.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): VERIFY — 验证"`

### A_GENERALIZE
Multi-layer pattern extraction from findings + improvements → 4-agent scan → cross-layer dedup.

**Pattern extraction** from audit findings + diverge ideas (severity >= medium OR impact = high):

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex → direct Grep | Missing `aria-label`, hardcoded px values, inline styles |
| Semantic | Agent understands anti-pattern → scans | Inconsistent hover states, missing loading feedback |
| Structural | File/module structure similarity | Same component type missing responsive treatment |

Write `session.json.patterns[]`.

**4-agent parallel scan** (single message):

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep CSS/style patterns matching found issues | Full project |
| Semantic scan | Find components with same interaction pattern but missing states | Related modules |
| Structural match | Find structurally similar components (same imports, layout) | Full project |
| Historical grep | `git log -S "{pattern}"` for when similar UI patterns were introduced/fixed | Git history |

**Cross-layer dedup**: Multi-layer hit → boost confidence. Single-layer → `needs_review`. Historical match on fixed code → `regression_risk`.

**Iterative deepening**: Module with ≥3 hits → targeted deep scan (max 1 round).

Update `understanding.md` §6 (per-pattern summary, cross-layer matrix). Write `session.json.generalization_stats`. Mark G5 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): GENERALIZE — 泛化扫描"`

### A_DISCOVER
Classify each hit: `needs_treatment` / `low_risk` / `already_handled`.
- `needs_treatment` + directly fixable → **fix immediately** → back to S_FIX
- `needs_treatment` + requires design direction decision → create issue (with fix suggestion)
- `low_risk` → evaluate if a quick guard/improvement is feasible; if yes, fix it
- `already_handled` → mark skip

**Normal**: AskUserQuestion for routing ambiguity. **`-y`**: auto-fix what's fixable, create issue for rest.
Append evidence (phase: "discovery" + "decision"). Update `understanding.md` §7. Mark G6 done.

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): DISCOVER — 发现分类"`

### A_RECORD
1. Finalize `understanding.md` §8: design learnings
2. Write learnings to understanding.md §8: 按 Knowledge Persistence 表分类记录（临时），completion summary 列出建议的 `/spec-add` 命令
3. Pending decisions: **Normal** → AskUserQuestion. **`-y`** → skip, display deferred count
4. **Goal audit**: all `phase_goals[*].completion_confirmed` true → `phase_goals_all_done = true`. Any false: **Normal** → AskUserQuestion (回退/跳过/接受) | **`-y`** → auto accept
5. Mark G7 done. `current_state = "COMPLETED"`. Emit completion summary:
```
--- UI ODYSSEY COMPLETE ---
Target:     {target}
Dimensions: {dimensions_audited}
Findings:   {C}C {H}H {M}M {L}L
Diverge:    {improvements} polish + {creative} delight ideas
Fix:        {fixed_count} applied, verified={yes|skipped}
Patterns:   {extracted} ({by_layer} distribution)
Scan hits:  {total} ({cross_layer} cross-layer confirmed)
Issues:     {N} created
Decisions:  {N} resolved, {M} pending, {K} deferred
Learnings:  {N} entries in understanding.md §8
Self-iter:  {N} quality gate rounds across {M} stages
Goals:      {done}/{total} ({skipped} skipped)
---
```

📌 **Auto-commit**: `git add understanding.md && git commit -m "odyssey-ui({slug}): RECORD — 会话总结"`

</actions>

<appendix>

### Goal Prompt Template
**⚠️ 时机守卫：仅在 A_INTAKE 完成后显示一次（session 创建后、开始 survey 前）。A_RECORD 完成时禁止重新显示。**

```
📋 UI Odyssey 会话已创建。可随时复制以下 /goal 设定终止条件（执行过程中输入即可）：

/goal 完成以下目标：
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — 完成条件: {G.done_when}
{end for}
穷尽迭代：直到 session.json 的 audit + diverge findings 均已处理（fix/issue/decision）
且 phase_goals_all_done=true 才停。修复按 impact×severity 逐轮迭代。
每轮修复后重审修改区域，新发现追加继续修。
遇到 phase=decision 的 pending 必须 AskUserQuestion。不允许"只报告不处理"。
```

完成时仅输出 completion summary，不重复此提示。

### `-y` Auto-Confirm (5 decision points)
| Decision Point | Normal | `-y` |
|----------------|--------|------|
| A_FIX improvement confirmation | AskUserQuestion | auto-proceed, `deferred` |
| A_DISCOVER hit routing | AskUserQuestion | auto create issue, `deferred` |
| A_DISCOVER ambiguous items | AskUserQuestion | all `deferred` |
| A_RECORD pending decisions | AskUserQuestion | skip, show deferred count |
| A_RECORD goal audit | AskUserQuestion | auto accept |

`deferred` items shown as "待决策" in completion summary; recoverable via `-c`.

### Phase Goal Lifecycle
`pending → done (confirmed=true)` normal | `pending → skipped (confirmed=true)` flags/manual | `pending → failed (confirmed=false)` exception

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target specified | Provide target |
| E002 | error | Target path not found | Check path |
| E003 | error | Resume but no session found | Start new session |
| W001 | warning | No design system detected | Proceed with defaults |
| W002 | warning | Some dimension agents failed | Partial coverage |
| W003 | warning | Generalization 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved and session created
- [ ] Design system inventory captured in survey
- [ ] All dimensions audited (6 parallel agents) with structured findings
- [ ] Severity matrix produced
- [ ] Divergent exploration: polish + delight ideas generated
- [ ] Improvements implemented and verified (unless --skip-fix)
- [ ] Multi-layer generalization scan + cross-layer dedup (unless --skip-generalize)
- [ ] Quality Gate self-iteration triggered when insufficient
- [ ] Discoveries classified and routed
- [ ] **Every unfixed finding has individual classification and reason** — blanket "pre-existing" labels are forbidden
- [ ] understanding.md §8 finalized with design learnings
- [ ] phase_goals G1-G7 tracked and audited
- [ ] Goal Prompt displayed once
- [ ] `-y`: no blocking prompts, deferred counted
- [ ] Session resumable via -c
</success_criteria>

<next_step_routing>
| Condition | Next step |
|-----------|-----------|
| Finding needs deeper debug | `/odyssey-debug "<finding>"` |
| Issues created from discoveries | `/manage-issue list --source ui-odyssey` |
| Design pattern worth documenting | `/spec-add ui "..."` |
| Want full review of changes | `/odyssey-review-test-fix <changed-files>` |
| Sibling components to polish | `/odyssey-ui "<sibling>"` |
</next_step_routing>
