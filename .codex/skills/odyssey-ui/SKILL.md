---
name: odyssey-ui
description: Long-running UI optimization cycle — visual survey, multi-dimensional audit, divergent exploration, fix, verify, generalize, and design knowledge persistence
argument-hint: "<target>" [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Deep UI polish cycle: survey (design tokens + pattern inventory) -> audit (6 dimensions) ->
diverge (creative exploration) -> fix -> verify -> generalize -> discover -> record.

Unlike `$maestro-impeccable` (single command), this is a persistent session with evidence trails,
decision journal, iterative improvement, and codebase-wide generalization. `--skip-fix` for audit-only.

Core philosophy:
- **Every pixel tells a story** — subtle details create the experience
- **Diverge before converge** — explore creatively, then implement methodically
- **Find one, polish all** — a single improvement reveals a class of opportunities
- **Browser is truth** — verify in real rendering, not just code
</purpose>

<boundary>
**范围内:** 目标组件/页面的视觉体验优化 — 6 维度审查 → 发散探索 → 修复 → 泛化兄弟组件
**范围外:** 后端逻辑 / 数据模型 / API → `$odyssey-planex` | 深度 bug → `$odyssey-debug` | 代码质量 → `$odyssey-review-test-fix`
**探索自由度:** 边界内最大自由 — S_DIVERGE 鼓励发散思维，不设创意上限。在约束下尽可能完善每个像素。
</boundary>

<execution_discipline>
**三条铁律（所有阶段适用）:**
1. **Phase commit** — 阶段完成后 `git commit -m "odyssey-ui({slug}): {phase} — {摘要}"`（session.json/evidence.ndjson 不纳入）
2. **有把握才改** — 确定性高（缺 hover state、对比度不足）→改；设计方向不确定（色彩/布局）→记录 decision
3. **多 CLI 辅助** — survey 用 `--role explore`，audit/diverge 用 `--role analyze`，fix 前后用 `--role review`
</execution_discipline>

<context>
$ARGUMENTS — target and optional flags.

**Target resolution:**
| Input | Resolution |
|-------|-----------|
| Component path | Review those component files |
| Page/route | Resolve route to component tree |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` (UI files only) |
| Feature area | Grep for feature keyword, collect UI files |

**Flags:**
| Flag | Effect |
|------|--------|
| `--dimensions <list>` | Comma-separated subset (default: all 6) |
| `--skip-fix` | Audit-only — skip S_FIX and S_VERIFY |
| `--skip-generalize` | Skip S_GENERALIZE and S_DISCOVER |
| `--auto` | CLI delegates without confirmation |
| `-y` | Auto-confirm at all decision points (see appendix) |
| `-c` | Resume most recent session |

**Dimensions (6):** visual-hierarchy, interaction-states, accessibility, responsiveness, micro-interactions, edge-cases

**Session**: `SESSION_DIR = .workflow/scratch/{YYYYMMDD}-ui-odyssey-{slug}/`

**Output — 3 files:**
```
SESSION_DIR/
  ├── session.json       # state + audit_result + diverge_result + patterns + phase_goals
  ├── evidence.ndjson    # ALL evidence (phase: survey|audit|diverge|fix|discovery|decision|self-iteration)
  └── understanding.md   # 8-section evolving narrative (§1-§8, one per major phase)
```

**session.json schema:**
```json
{ "session_id": "ui-odyssey-{YYYYMMDD-HHmmss}", "target": "", "dimensions": [],
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "current_state": "S_INTAKE",
  "audit_result": { "dimensions_audited": [], "finding_count": 0, "severity_distribution": {} },
  "diverge_result": { "improvements_proposed": 0, "creative_ideas": 0 },
  "patterns": [], "generalization_stats": null,
  "phase_goals": [], "phase_goals_all_done": false, "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 3,
  "created_at": "", "updated_at": "" }
```

**evidence.ndjson:** `{"ts":"","phase":"survey|audit|diverge|fix|discovery|decision|self-iteration","type":"","dimension":"","title":"","severity":"","file":"","line":0,"description":"","suggestion":""}`

**phase_goals[] — auto-derived from flags:**

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Survey completed | S_SURVEY | — |
| G2 | Audit completed | S_AUDIT | — |
| G3 | Divergent exploration done | S_DIVERGE | — |
| G4 | Fix applied and verified | S_VERIFY | skip_fix |
| G5 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | S_RECORD | — |

Lifecycle: `pending -> done | skipped | failed` (all set `completion_confirmed`)

**understanding.md — 8 sections:** SS1 Target & Context (S_INTAKE) | SS2 Visual Survey (S_SURVEY) | SS3 Audit Findings (S_AUDIT) | SS4 Divergent Exploration (S_DIVERGE) | SS5 Fix & Verification (S_FIX+S_VERIFY) | SS6 Generalization (S_GENERALIZE) | SS7 Discoveries (S_DISCOVER) | SS8 Design Learnings (S_RECORD)

### Pre-load

| Layer | Command | Purpose |
|-------|---------|---------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` | Module boundaries |
| Wiki search | `maestro search "<target keywords>" --json` | Prior UI decisions (top 5) |
| UI specs | `maestro spec load --category ui` | Design tokens, standards |
| Coding specs | `maestro spec load --category coding` | Coding conventions |
| Role knowledge | `maestro search --category ui` -> select -> `maestro wiki load <id>` | Domain knowledge |
| Prior sessions | `Glob(".workflow/scratch/*-ui-odyssey-*")` | Related sessions |

### Knowledge Persistence (two-step model)

Write to understanding.md SS8 during execution (temporary). Completion summary suggests follow-up commands.

| Category | Content | Follow-up |
|----------|---------|-----------|
| Design pattern | Component pattern + scenarios | `$spec-add ui "..."` |
| Interaction spec | State defs + transition rules | `$spec-add ui "..."` |
| Accessibility rule | WCAG req + implementation | `$spec-add ui "..."` |
| Reusable generalization | Pattern signature + scope | `$spec-add coding "..."` |
</context>

<self_iteration>
**Quality Gate** — auto-evaluate after each analytical phase. Insufficient -> re-enter (max 2 rounds).

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files/components analyzed | Missed targets discoverable via grep/glob |
| Depth | >=80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Expansion:** Round 1 = widen scope (more directories, more components, deeper token scan). Round 2 = shift perspective (different audit angle, CLI delegate second opinion).

**Applicable stages:** S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE

**Exit:** All sufficient -> advance | 2-round cap -> record gap, continue. Logged to `evidence.ndjson` + `session.json.self_iteration_log[]`.
</self_iteration>

<csv_schema>

### Shared Output Schema (all waves)
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
| 1 | Survey (design-tokens-audit, pattern-inventory) | 2 agents |
| 2 | Audit (visual-hierarchy, interaction-states, accessibility, responsiveness, micro-interactions, edge-cases) | 6 agents |
| 3 | Diverge (polish-agent, delight-agent) | 2 agents |
| 4 | Generalization (syntax-grep, semantic-scan, structural-match, historical-grep) | 4 agents |
</csv_schema>

<invariants>
1. **Browser is truth** — code changes must be visually verifiable
2. **Diverge before converge** — S_DIVERGE runs before S_FIX, never skip
3. **Evidence append-only** — evidence.ndjson is never overwritten
4. **Session is source of truth** — session.json holds all state
5. **Phase goal tracking** — each stage MUST mark its goal on completion
6. **`-y` defers, never drops** — auto-confirm records `deferred`, never silently skips
7. **CLI delegate is background** — all `maestro delegate` calls use run_in_background
8. **Goal is outcome-oriented** — odyssey outputs prompt then continues
9. **Invariant violation = BLOCK** — violating any invariant blocks the operation
</invariants>

<execution>

**States:** S_INTAKE -> S_SURVEY -> S_AUDIT -> S_DIVERGE -> S_FIX -> S_VERIFY -> S_GENERALIZE -> S_DISCOVER -> S_RECORD
- S_FIX/S_VERIFY skip when `--skip-fix`
- S_GENERALIZE/S_DISCOVER skip when `--skip-generalize`

### S_INTAKE
1. Parse target + flags -> resolve file list (filter to UI-relevant: `.tsx`, `.vue`, `.svelte`, `.css`, `.scss`, style files)
2. Generate slug, create `SESSION_DIR`
3. Search prior knowledge: `maestro search "<keywords>"` + Glob prior sessions + ARCHITECTURE.md + spec load (ui, coding)
4. Derive `phase_goals[]` from flags (apply `skip_when`)
5. Write `session.json` + `understanding.md` SS1
6. Display Goal Prompt (appendix), continue without blocking

**Resume (`-c`):** Glob latest session -> read `session.json` -> restore `current_state` -> jump.

### S_SURVEY
**spawn_agents_on_csv (Wave 1):**

Write `tasks.csv` with Wave 1 rows:
```csv
"survey-tokens","Design Token Audit","Scan {target_files} for CSS variables, design tokens, theme values. Return [{token,usage_count,consistency,file,line}].","survey","","","1","pending","","",""
"survey-patterns","Pattern Inventory","Catalog component patterns, layout, spacing, typography in {target_files}. Return [{pattern,files,consistency}].","survey","","","1","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-1-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge -> evidence.ndjson (phase: "survey"). Update SS2. Mark G1 done.

### S_AUDIT
**spawn_agents_on_csv (Wave 2)** — 6 agents:

Append Wave 2 rows to `tasks.csv`:
```csv
"audit-hierarchy","Visual Hierarchy","Spacing, typography scale, contrast, alignment, whitespace, visual weight","audit","visual-hierarchy","","2","pending","","",""
"audit-interaction","Interaction States","hover/focus/active/disabled/loading/error/empty/selected states","audit","interaction-states","","2","pending","","",""
"audit-a11y","Accessibility","WCAG AA contrast, focus mgmt, aria, keyboard nav, screen reader","audit","accessibility","","2","pending","","",""
"audit-responsive","Responsiveness","Breakpoints, overflow, touch targets >=44px, fluid typography","audit","responsiveness","","2","pending","","",""
"audit-motion","Micro-interactions","Transitions, animations, feedback, loading states, scroll behavior","audit","micro-interactions","","2","pending","","",""
"audit-edge","Edge Cases","Long text, empty data, error states, extreme values, i18n, RTL","audit","edge-cases","","2","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:6, max_runtime_seconds:600, output_csv_path:"wave-2-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

Merge -> evidence.ndjson (phase: "audit"). Write `audit_result` with dimensions, finding count, severity distribution. Update SS3. Mark G2 done.

### S_DIVERGE
**spawn_agents_on_csv (Wave 3)** — 2 agents:

Append Wave 3 rows to `tasks.csv`:
```csv
"diverge-polish","Polish Agent","Missing subtle details: shadows, borders, transitions, hover feedback, empty states, skeleton loading, scroll behavior. Return [{idea,category:'polish',impact,effort,description}].","diverge","","","3","pending","","",""
"diverge-delight","Delight Agent","What makes this memorable: motion design, progressive disclosure, smart defaults, celebratory feedback, personality. Return [{idea,category:'delight',impact,effort,description}].","diverge","","","3","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:2, max_runtime_seconds:300, output_csv_path:"wave-3-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

**Optional CLI delegate** for creative review:
```bash
maestro delegate "PURPOSE: Creative UI review for: {target}
TASK: Identify polish opportunities | Suggest delight moments | Evaluate visual rhythm
MODE: analysis  CONTEXT: @{target_files} | Survey: {token_summary} | Audit: {top_findings}
EXPECTED: JSON [{idea, category, impact, effort, description}]
CONSTRAINTS: User-perceptible improvements only
" --role analyze --mode analysis
```
Run_in_background, STOP, wait for callback.

Consolidate: audit findings + divergent ideas -> prioritized improvement list (impact/effort matrix). Write `diverge_result`. Update SS4. Mark G3 done.

### S_FIX
Skip if `--skip-fix`. Filter audit (severity >= high) + divergent (impact:high, effort:low|medium) -> fix candidates.
**Normal**: `request_user_input` to confirm. **`-y`**: auto-fix, record `deferred`.
Implement highest impact first. Record evidence (phase: "fix").

### S_VERIFY
Skip if `--skip-fix`.

1. **Tests**: run covering tests on modified files
2. **CLI visual review**: delegate `--role review --mode analysis` for visual correctness + regression check (run_in_background, STOP)
3. `needs_rework` -> S_FIX (loop). `confirmed` -> mark G4 done, advance
4. Update SS5

### S_GENERALIZE
Skip if `--skip-generalize`.

**Step 1 — Multi-layer pattern extraction** from audit + diverge findings:

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex patterns (direct Grep) | Missing `focus-visible`, hardcoded colors, `!important` |
| Semantic | Agent anti-pattern scan | Missing hover state on interactive element, no empty state |
| Structural | File/module similarity | Same component structure missing accessibility attrs |

Write `session.json.patterns[]`: `[{id, source_finding, layer, signature, description, risk, fix_template}]`

**Step 2 — 4-agent scan (spawn_agents_on_csv, Wave 4):**

Append Wave 4 rows to `tasks.csv`:
```csv
"gen-syntax","Syntax Grep","Grep CSS/style patterns matching '${signatures}' across project","generalization","syntax","","4","pending","","",""
"gen-semantic","Semantic Scan","Find components with same interaction pattern but missing states","generalization","semantic","","4","pending","","",""
"gen-structural","Structural Match","Find structurally similar components, check for same issues","generalization","structural","","4","pending","","",""
"gen-historical","Historical Grep","git log -S '${signature}' for UI pattern history","generalization","historical","","4","pending","","",""
```
`spawn_agents_on_csv({ csv_path:"tasks.csv", max_concurrency:4, max_runtime_seconds:600, output_csv_path:"wave-4-results.csv", output_schema:SHARED_OUTPUT_SCHEMA })`

**Step 3 — Cross-layer dedup**: Multi-layer hit -> boost confidence. Single -> `needs_review`. Historical fix -> `regression_risk`.

**Step 4 — Iterative deepening**: module >= 3 hits -> targeted deep scan. Max 1 round.

**Step 5 — Quality Gate** (self-iteration).

**Step 6:** Write `generalization_stats`. Update SS6. Mark G5 done.

### S_DISCOVER
Skip if no generalization hits.

1. **Triage** each hit: read +-10 lines -> classify `safe` / `risk` / `bug`
2. **Route**: see appendix `-y` behavior. Append evidence (phase: "discovery" + "decision")
3. **Cross-phase loop**: new component to audit → S_AUDIT (loops < max_loops → cross_phase_loops++); fixable sibling → S_FIX (!skip_fix, loops < max_loops); triage complete OR budget exhausted → S_RECORD
4. Update SS7. Mark G6 done.

### S_RECORD
1. Finalize SS8: structured by Knowledge Persistence table (temporary)
2. Mark G7 done. Pending decisions: **Normal** -> `request_user_input`. **`-y`** -> skip, show deferred count
3. **Goal audit**: all confirmed -> `phase_goals_all_done = true`. Any false: **Normal** -> `request_user_input`. **`-y`** -> auto accept
4. **Completion**: `current_state = "COMPLETED"`, emit summary:
```
--- UI ODYSSEY COMPLETE ---
Target: {target}  Dimensions: {audited}
Survey: {token_count} tokens, {pattern_count} patterns
Audit: {C}C {H}H {M}M {L}L  Diverge: {improvements} + {ideas} creative
Fix: {F} applied, {S} skipped  Patterns: {N} ({by_layer})
Scan: {total} hits ({cross_layer} cross-layer)  Issues: {N}
Decisions: {resolved}/{pending}/{deferred}  Self-iter: {R} rounds / {P} phases
Goals: {done}/{total} ({skipped} skipped)
---
```
**Next steps:** `$odyssey-review-test-fix`, `$manage-issue list --source ui-odyssey`, `$maestro-impeccable`, `$maestro-plan --gaps`
</execution>

<appendix>

### Goal Prompt Template

**Time guard: display ONCE after S_INTAKE completes (session created, before survey). NEVER redisplay at S_RECORD completion.**

```
UI Odyssey session created. Copy the following /goal to set termination conditions at any time:

/goal Until {SESSION_DIR}/session.json phase_goals[*] all have completion_confirmed=true
and phase_goals_all_done=true. Advance by state machine. Only modify source in S_FIX.
phase=decision pending entries MUST use request_user_input, never self-resolve.
Diverge (S_DIVERGE) MUST run before fix (S_FIX) — never skip creative exploration.
```

Odyssey outputs prompt then continues without blocking. `/goal` entered by user at any time.

### `-y` Auto-Confirm Behavior

| Decision Point | Normal | `-y` mode |
|----------------|--------|-----------|
| S_DIVERGE consolidation | request_user_input for priority | auto-rank by impact/effort |
| S_FIX fix candidates | request_user_input to confirm | auto-fix high-impact, `deferred` |
| S_DISCOVER bug routing | request_user_input per hit | auto create issue, `deferred` |
| S_DISCOVER ambiguous | request_user_input batch | all `deferred` |
| S_RECORD pending decisions | request_user_input per-item | skip, show deferred count |
| S_RECORD goal audit | request_user_input 3-way | auto accept current state |

`deferred` items shown in summary; recoverable via `-c`.

### Phase Goal Lifecycle

`pending -> done (confirmed=true)` normal | `pending -> skipped (confirmed=true)` flags/manual | `pending -> failed (confirmed=false)` incomplete

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target and no session to resume | Provide target or use -c |
| E002 | error | Target not found or no UI files | Check path, ensure UI files exist |
| E003 | error | Resume but no session found | Start new session |
| W001 | warning | No relevant git history | Proceed with limited context |
| W002 | warning | Audit dimension agent failed | Partial coverage, note gap |
| W003 | warning | Generalization scan 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |
</error_codes>

<success_criteria>
- [ ] Target resolved to UI files, session created with 3 output files
- [ ] Prior knowledge searched (maestro search + sessions + architecture + ui specs)
- [ ] Survey via spawn Wave 1, evidence phase=survey
- [ ] All 6 dimensions audited via spawn Wave 2, severity matrix produced
- [ ] Divergent exploration via spawn Wave 3, prioritized improvement list
- [ ] Fixes applied highest-impact-first and verified (unless --skip-fix)
- [ ] `--skip-fix`: no source code modifications
- [ ] Generalization via spawn Wave 4 + cross-layer dedup (unless --skip-generalize)
- [ ] Discoveries classified and routed
- [ ] understanding.md tracks all 8 sections progressively
- [ ] phase_goals G1-G7 derived from flags, each phase marks its goal
- [ ] Goal Prompt displayed once; `-y` auto-resolves/defers
- [ ] State saved at each transition (resumable via -c)
- [ ] Quality Gate self-iteration logged in self_iteration_log
- [ ] Completion summary with all stats
</success_criteria>
