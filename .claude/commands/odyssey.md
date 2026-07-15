---
name: odyssey
description: Long-running iterative cycle — one entry, five modes (debug|improve|planex|review|ui). Shared archaeology/audit → fix → verify → generalize → discover → persist skeleton with mode-specific dimensions.
argument-hint: "<intent> --mode debug|improve|planex|review|ui [--auto] [-y] [-c]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<deferred_reading>
- [odyssey-base.md](~/.maestro/workflows/odyssey-base.md) — read after mode resolved for shared back-half (A_INTAKE, A_RESUME, GENERALIZE → DISCOVER → RECORD → END)
- [odyssey-debug.md](~/.maestro/workflows/odyssey-debug.md) — read when mode=debug
- [odyssey-improve.md](~/.maestro/workflows/odyssey-improve.md) — read when mode=improve
- [odyssey-planex.md](~/.maestro/workflows/odyssey-planex.md) — read when mode=planex
- [odyssey-review.md](~/.maestro/workflows/odyssey-review.md) — read when mode=review
- [odyssey-ui.md](~/.maestro/workflows/odyssey-ui.md) — read when mode=ui
</deferred_reading>

<purpose>
Long-running, evidence-driven iterative cycle. A single entry dispatches to one of five modes; all share the same
skeleton — discovery → domain audit → fix → verify → generalize → discover siblings → persist knowledge —
and iterate exhaustively until the mode's exit condition is met or escalation is required.
</purpose>

<mode_dispatch>

**Mode selection precedence:** explicit `--mode <name>` > intent keyword auto-detection > [@ask] AskUserQuestion (Normal) / error E000 (`-y`).

**Auto-detection from `<intent>` keywords** (first match wins, ordered):

| Keywords in intent | Detected mode |
|--------------------|---------------|
| bug, crash, error, broken, fails, regression, race, leak, "why does" | `debug` |
| requirement, implement, build, add feature, deliver, "I need", user story | `planex` |
| ui, visual, layout, style, component, page, responsive, a11y, accessibility, design | `ui` |
| improve, optimize, performance, security, refactor quality, reliability, observability | `improve` |
| review, audit, check, inspect, "look over", zero-residual | `review` |

Ambiguous / no match → Normal: [@ask] AskUserQuestion (5-way mode pick) | `-y`: E000.

**Mode registry:**

| Mode | Purpose | Discovery phases | Audit phase | Fix→verify pair | Unique states |
|------|---------|------------------|-------------|-----------------|---------------|
| `debug` | Symptom → root cause → fix → confirm | ARCHAEOLOGY, EXPLORE | DIAGNOSE (hypothesis test) | FIX → CONFIRM | ESCALATE_DIAGNOSIS |
| `improve` | 6-dimension quality audit → diagnose → fix | SURVEY | AUDIT (6 dims) + DIAGNOSE | FIX → VERIFY | ESCALATE_DIAGNOSIS |
| `planex` | Requirement → plan → execute → verify loop | (none) | PLAN + EXECUTE | (EXECUTE) → VERIFY → FIX loop | — |
| `review` | Multi-dimension deep review → zero-residual fix | ARCHAEOLOGY, EXPLORE | REVIEW (4+ dims) | FIX → CONFIRM | — |
| `ui` | Visual survey → 6-dim audit → diverge → fix | SURVEY | AUDIT (6 dims) + DIVERGE | FIX → VERIFY | — |

The **back half is identical across all modes**: `GENERALIZE → DISCOVER → RECORD → END` (see odyssey-base.md §Shared Back-Half).

On mode resolved: read the deferred workflow file for that mode + odyssey-base.md, then execute.

</mode_dispatch>

<context>
$ARGUMENTS

**Universal flags:** `--mode <name>` mode selector | `--skip-fix` audit/diagnose only, skip fix+verify | `--skip-generalize` skip GENERALIZE+DISCOVER | `--auto` no delegate confirmation | `-y` auto-confirm (decisions → `deferred`) | `-c` resume most recent session | `--heartbeat` /loop periodic progress

**Mode-scoped flags:**

| Flag | Modes | Description | Default |
|------|-------|-------------|---------|
| `--template <name>` | debug, planex | Predefined strategy/criteria template | — |
| `--dimensions <list>` | improve, review, ui | Audit dimension subset | all |
| `--fix-threshold <sev>` | improve, review, ui | Severity cutoff (critical\|high\|medium\|low\|all) | all |
| `--max-iterations N` | planex | Max verify-fix cycles before escalation | 3 |
| `--method agent\|cli\|auto` | planex | Task execution method | auto |
| `--executor <tool>` | planex | Explicit CLI executor | first enabled |
| `--skip-verify` | planex | Skip post-execution validation gate | false |

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md` | `explore.json` (debug/review only)

**Output boundary**: ALL session artifacts MUST target the session directory (`{run_dir}/outputs/`) or `.workflow/state.json` only. Source code modifications during fix/execute phases are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json — shared core + mode fields:**
```json
{ "mode": "debug|improve|planex|review|ui",
  "target": "", "dimensions": [],
  "patterns": [], "confirmation": null, "generalization_stats": null,
  "cross_phase_loops": 0 }
```
Each mode extends the core — see the mode's workflow file for **session fields**.

**Commit convention:** `"odyssey-{mode}({slug}): {STATE} — {summary}"` (mode = active mode short name; review mode uses `odyssey-review`).

</context>

<invariants>
All base invariants apply (evidence append-only, session-as-state, phase goal tracking, auto-commit per action, zero-residual). Additionally:

1. **Evidence append-only** — never delete or overwrite evidence.ndjson entries.
2. **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
3. **Generalize is mandatory** — GENERALIZE and DISCOVER execute unless `skip_generalize == true`. Prior-phase convergence, "no findings / all verified / zero remaining," or context pressure are NOT valid skip reasons. The phase itself determines whether patterns exist.
4. **Zero-residual** (improve/review/ui) — every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" and blanket "pre-existing" skips are forbidden.
5. **Acceptance criteria are sacred** (planex) — no "close enough", no manual override without explicit escalation.
6. **Browser is truth** (ui) — verify in real rendering, not just code review. Diverge before converge.
7. **Goal tracking 与 session 双写** — 各 phase 进入/退出时同步创建/更新 goal，补充 session.json 的 UI 可见进度。
</invariants>

<goal_tracking>

**时机与操作**（goal 是 session.json 的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| INTAKE gate 通过后 | [@task] TaskCreate 整体 session goal | `TaskCreate({ description: "Odyssey {mode}: {intent_summary}", subject: "所有 phase gates 通过 + END 状态" })` |
| Phase 进入时 | [@task] TaskCreate phase goal | `TaskCreate({ description: "Phase: {STATE_NAME}", subject: "{phase_gate} 条件达成" })` |
| Phase gate 通过时 | [@task] TaskUpdate phase goal | `TaskUpdate({ taskId: phase_goal_id, status: "completed" })` |
| END 状态到达时 | [@task] TaskUpdate session goal | `TaskUpdate({ taskId: session_goal_id, status: "completed" })` |
| Phase gate BLOCKED 时 | [@task] TaskUpdate phase goal | `TaskUpdate({ taskId: phase_goal_id, status: "failed" })` |

</goal_tracking>

<self_iteration>
Self-iteration (logic in odyssey-base.md) applies to each mode's discovery + audit + GENERALIZE stages:

| Mode | Self-iterating stages |
|------|----------------------|
| debug | S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE |
| improve | S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE |
| planex | S_PLAN, S_VERIFY, S_GENERALIZE |
| review | S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE |
| ui | S_SURVEY, S_AUDIT, S_DIVERGE, S_GENERALIZE |
</self_iteration>

<execution>
Follow base execution discipline completely. On entry: resolve mode (§mode_dispatch), then read the deferred workflow file for that mode + odyssey-base.md, and run that mode's state machine. All modes converge on the Shared Back-Half in odyssey-base.md.

### Shared Phase Gates (MANDATORY, BLOCKING)

- **INTAKE gate:** mode resolved, target/requirement resolved, SESSION_DIR created, session.json initialized (with baseline_metrics for improve; acceptance_criteria for planex), phase_goals[] derived from flags, understanding.md §1 written. BLOCKED if no target (E001) / no requirement (planex E001) / target path not found (E002) / mode unresolved (E000).
- **GENERALIZE gate:** ALL 3 layers (syntax/semantic/structural) attempted with evidence logged; generalization_stats written with by_layer entries for all 3 layers; generalize goal marked. Any layer not attempted = thoroughness-floor violation (BLOCKED).
- **DISCOVER gate:** all hits triaged with per-item classification and reason; `remaining_actionable == 0` OR `loops >= max_loops` with per-item reasons logged; discover goal marked. Unclassified hits = BLOCKED.

Mode-specific phase gates (Discovery, Audit, FIX, VERIFY/CONFIRM) are defined in each mode's workflow file.

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E000 | error | Mode unresolved (`-y`, ambiguous intent, no `--mode`) | Provide `--mode` |
| E001 | error | No target / no requirement (planex) / no issue (debug) | Provide target or -c |
| E002 | error | Target path not found | Check path |
| W001 | warning | No relevant git history / no dependency manifest / no design system | Proceed with defaults |
| W002 | warning | Some dimension agents failed / 3 retries exhausted | Partial coverage / INCONCLUSIVE |
| W003 | warning | Archaeology agent or delegate failure (debug/review) | Proceed with available results, log failed agent |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
| W005 | warning | Pending decisions | Filter evidence phase=decision |
| W006 | warning | No CLI tools (debug/review explore) | Skip explore |
| W007 | warning | planex CLI review regression concern | Review before next iteration |
</error_codes>

<success_criteria>
- [ ] Mode resolved (explicit or auto-detected); session + output files created; prior knowledge searched
- [ ] Discovery phase(s) for the mode completed with evidence (archaeology/explore/survey)
- [ ] Domain audit completed with structured findings + severity matrix (or acceptance criteria + plan for planex)
- [ ] understanding.md sections written progressively per mode
- [ ] Fix + verify/confirm (unless --skip-fix); zero-residual for improve/review/ui; all criteria pass for planex
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize); every unfixed finding individually justified
- [ ] phase_goals derived, tracked, and hardened-audited; Goal Prompt once; `-y` no blocking prompts
- [ ] Session resumable via -c; mode-specific completion summary emitted
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Discovery issues created | `/manage issue list --source {mode}-odyssey` |
| Deeper debug needed (from any mode) | `/odyssey <finding> --mode debug` |
| Formal review of changes | `/odyssey <changed-files> --mode review` |
| UI-related findings | `/odyssey <component> --mode ui` |
| Document pattern | `/learn decompose <module>` |
| Second opinion | `/learn consult <understanding.md>` |
| Related question | `/learn investigate "<question>"` |
| Design/perf/arch pattern to persist | `/spec add ui\|coding\|arch "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
