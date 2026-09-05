---
name: maestro-odyssey
disable-model-invocation: true
description: Long-running iterative cycle — one entry, seven modes
  (debug|improve|planex|review|security|defensive|ui). Shared archaeology/audit
  → fix → verify → generalize → discover → persist skeleton with mode-specific
  dimensions. User-invoked campaign entry; single-step fixes route via
  /maestro-next
argument-hint: <intent> --mode debug|improve|planex|review|security|defensive|ui [-y] [-c]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_plan
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.86
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

If any required file above was not expanded into context by the host, or its content is no longer in context, Read it explicitly before executing any step.

<deferred_reading>
- [odyssey-base.md](~/.maestro/workflows/odyssey-base.md) — read after mode resolved for shared back-half (INTAKE gate → GENERALIZE → DISCOVER → RECORD → END)
- [odyssey-debug.md](~/.maestro/workflows/odyssey-debug.md) — read when mode=debug
- [odyssey-improve.md](~/.maestro/workflows/odyssey-improve.md) — read when mode=improve
- [odyssey-planex.md](~/.maestro/workflows/odyssey-planex.md) — read when mode=planex
- [odyssey-review.md](~/.maestro/workflows/odyssey-review.md) — read when mode=review
- [odyssey-security.md](~/.maestro/workflows/odyssey-security.md) — read when mode=security
- [odyssey-defensive.md](~/.maestro/workflows/odyssey-defensive.md) — read when mode=defensive
- [odyssey-ui.md](~/.maestro/workflows/odyssey-ui.md) — read when mode=ui
</deferred_reading>

<purpose>
Long-running, evidence-driven iterative cycle. A single entry dispatches to one of seven modes; all share the same
skeleton — discovery → domain audit → fix → verify → generalize → discover siblings → persist knowledge —
and iterate exhaustively until the mode's exit condition is met or escalation is required.
</purpose>

<mode_dispatch>

**Mode selection precedence:** explicit `--mode <name>` > intent keyword auto-detection > request_user_input (Normal) / error E000 (`-y`).

**Auto-detection from `<intent>` keywords** (first match wins, ordered):

Keyword matching: case-insensitive substring match against the intent text. Multi-word keywords require all words present (not necessarily adjacent). First matching row wins (ordered by specificity).

| Keywords in intent | Detected mode |
|--------------------|---------------|
| bug, crash, error, broken, fails, regression, race, leak, "why does" | `debug` |
| requirement, implement, build, add feature, I need to implement, I need to build, I need to add, deliver feature, user story | `planex` |
| ui, visual, layout, style, component, page, responsive, a11y, accessibility, UI design, visual design, design system, design tokens | `ui` |
| security audit, OWASP, vulnerability, CVE, secrets scan, STRIDE, threat model, supply chain, dependency audit, dependencies, supply chain audit | `security` |
| defensive programming, defensive code, exception swallowing, silent failure, fallback risk, default value risk, error suppression, 防御性编程, 防御性代码, 异常吞噬, 兜底风险 | `defensive` |
| improve, optimize, performance, refactor quality, reliability, observability | `improve` |
| review, audit, code check, check the code, inspect the code, inspect changes, "look over", zero-residual | `review` |

Ambiguous / no match → Normal: request_user_input (7-way mode pick) | `-y`: E000.

**Mode registry:**

| Mode | Purpose | Discovery phases | Audit phase | Fix→verify pair | Unique states |
|------|---------|------------------|-------------|-----------------|---------------|
| `debug` | Symptom → root cause → fix → confirm | ARCHAEOLOGY, EXPLORE | DIAGNOSE (hypothesis test) | FIX → CONFIRM | ESCALATE_DIAGNOSIS |
| `improve` | 6-dimension quality audit → diagnose → fix | SURVEY | AUDIT (6 dims) + DIAGNOSE | FIX → VERIFY | ESCALATE_DIAGNOSIS |
| `planex` | Requirement → plan → execute → verify loop | (none) | PLAN + EXECUTE | (EXECUTE) → VERIFY → FIX loop | — |
| `review` | Multi-dimension deep review → zero-residual fix | ARCHAEOLOGY, EXPLORE | REVIEW (4+ dims) | FIX → CONFIRM | — |
| `security` | Read-only tiered security audit → severity matrix | RECON | SCAN (OWASP + deps + secrets + CI/CD + STRIDE + git) | (none — read-only) | — |
| `defensive` | Business-anchor → backward-slice → 8-pattern scan → forward-propagate → risk score | ANCHOR, SLICE | SCAN (8 defensive patterns) + PROPAGATE | (none — read-only) | — |
| `ui` | Visual survey → 6-dim audit → diverge → fix | SURVEY | AUDIT (6 dims) + DIVERGE | FIX → VERIFY | — |

CONFIRM and VERIFY are synonymous — both refer to the post-fix validation phase. Mode workflow files use mode-specific naming; semantics are identical.

The **back half is identical across all modes**: `GENERALIZE → DISCOVER → RECORD → END` (see odyssey-base.md §Shared Back-Half).

On mode resolved: read the deferred workflow file for that mode + odyssey-base.md, then execute.

</mode_dispatch>

<context>
$ARGUMENTS

**Universal flags:** `--mode <name>` mode selector | `--skip-fix` audit/diagnose only, skip fix+verify | `--skip-generalize` skip GENERALIZE+DISCOVER | `-y` skip all confirmation interactions (including delegate/agent confirmations in execution phases), use default choices; decisions skipped this way are recorded as `deferred`; never bypasses mode ambiguity (E000), INTAKE gate blockers, escalation | `-c` resume the most recent unfinished Session of the SAME mode via exact Session resolution: locate it with `maestro session list --json` + `maestro session status --session {session_id} --json` (both read-only), re-attach context with `maestro session resume-view` and the `brief-result/3.0` Resume Packet via `run brief` (exact invocation per run-mode.md), then continue the chain with fenced `maestro run next` / `run check` / `run complete --advance`. If `--mode` conflicts with the resumed Session's mode → E003 (mode mismatch); no history → ignore -c, create new Session | `--heartbeat` /loop periodic progress

**Mode-scoped flags:**

| Flag | Modes | Description | Default |
|------|-------|-------------|---------|
| `--template <name>` | debug, planex | Predefined strategy/criteria template | — |
| `--dimensions <list>` | improve, review, ui | Audit dimension subset | all |
| `--fix-threshold <sev>` | improve, review, ui | Severity cutoff (critical\|high\|medium\|low\|all) | all |
| `--tier quick\|standard\|deep` | security, defensive | Audit depth tier | standard |
| `--sink-depth <list>` | defensive | Explicit sink layer focus (1\|2\|3\|all) | all |
| `--max-iterations N` | planex | Max verify-fix cycles before escalation | 3 |
| `--method agent\|cli\|auto` | planex | Task execution method | auto |
| `--executor <tool>` | planex | Explicit CLI executor | first enabled |
| `--skip-verify` | planex | Skip post-execution validation gate | false |

`--skip-fix` applicability: security and defensive modes ignore (read-only, no fix phase); planex skips FIX loop but retains EXECUTE+VERIFY; debug/review/improve/ui skip FIX+VERIFY/CONFIRM. `--skip-fix` + `--skip-verify` on planex = PLAN only (no execution).

Mode-scoped flags passed to inapplicable mode: emit W008 warning and ignore the flag.

**Session creation**: follow `run-mode.md` exactly. Negotiate capabilities, then use the receipt-chained self-start path: open an empty Session with `participant == actor` and a unique open request ID, insert `odyssey-<mode>` plus every mode/domain argument through fenced repeatable `--arg`, and dispatch it with fenced `run next` using a third request ID. Every mutation consumes the exact revision returned by the preceding receipt. Consume the resulting birth packet's resolved `task` and structured executable `continuation`; never pass task prose via `--input`. A direct machine-protocol `run create` is allowed only with positional domain arguments, explicit `--session`/`--run`/`--step`, identical participant/actor values, request ID/reason, exact CAS revision, and `--input` values restricted to sealed same-Session Artifact IDs.

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md` | `explore.json` (debug/review only) | `anchors.json` (defensive only)

**Output boundary**: ALL session artifacts MUST target the run outputs directory (`{run_dir}/outputs/`) only. `.workflow/state.json` and all `sessions/<sid>/` protocol files are runtime-owned — a workflow never writes them. Source code modifications during fix/execute phases are in-scope but MUST be committed per action. NEVER write session artifacts outside `{run_dir}/outputs/`.

**session.json — shared core + mode fields:**
```json
{ "mode": "debug|improve|planex|review|security|defensive|ui",
  "target": "", "dimensions": [],
  "patterns": [], "confirmation": null, "generalization_stats": null,
  "cross_phase_loops": 0 }
```
Each mode extends the core — see the mode's workflow file for **session fields**.

**Commit convention:** `"odyssey-{mode}({slug}): {STATE} — {summary}"` (mode = active mode short name; review mode uses `odyssey-review`).

</context>

<invariants>
All base invariants apply (evidence append-only, session-as-state, phase goal tracking, auto-commit per action). Additionally:

1. **Evidence append-only** — never delete or overwrite evidence.ndjson entries.
2. **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
3. **Generalize is mandatory** — GENERALIZE and DISCOVER execute unless `skip_generalize == true`. Prior-phase convergence, "no findings / all verified / zero remaining," or context pressure are NOT valid skip reasons. The phase itself determines whether patterns exist.
4. **Zero-residual** (improve/review/ui) — every finding MUST have a concrete action (fix / issue / decision). "Report and shelve" and blanket "pre-existing" skips are forbidden.
5. **Read-only** (security, defensive) — NEVER modify source code, configuration, or dependencies. Security and defensive audits produce reports only; fixes route to `--mode improve`.
6. **Acceptance criteria are sacred** (planex) — no "close enough", no manual override without explicit escalation.
7. **Browser is truth** (ui) — verify in real rendering, not just code review. Diverge before converge.
8. **Goal tracking 与 session 双写** — 各 phase 进入/退出时同步创建/更新 goal，补充 session.json 的 UI 可见进度。
</invariants>

<task_tracking>

**时机与操作**（plan 是 session 权威状态的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | update_plan 初始化步骤清单 | `update_plan({ plan: [{ step: "Step {index}: {step.skill}", status: "pending" }, ...] })` |
| Step 派发时 | update_plan 标记当前 step | `update_plan({ plan: [..., 当前 step status: "in_progress"] })` |
| Step 完成时 | update_plan 标记完成 | `update_plan({ plan: [..., 该 step status: "completed"] })` |
| Step 失败时 | update_plan + explanation 说明 | `update_plan({ explanation: "Step {index} failed: {reason}", plan: [...] })` |

</task_tracking>

<self_iteration>
Self-iteration (logic in odyssey-base.md) applies to each mode's discovery + audit + GENERALIZE stages:

| Mode | Self-iterating stages |
|------|----------------------|
| debug | S_ARCHAEOLOGY, S_EXPLORE, S_DIAGNOSE, S_GENERALIZE |
| improve | S_SURVEY, S_AUDIT, S_DIAGNOSE, S_GENERALIZE |
| planex | S_PLAN, S_VERIFY, S_GENERALIZE |
| review | S_ARCHAEOLOGY, S_EXPLORE, S_REVIEW, S_FIX, S_GENERALIZE |
| security | S_RECON, S_SCAN, S_GENERALIZE |
| defensive | S_ANCHOR, S_SLICE, S_SCAN, S_PROPAGATE, S_GENERALIZE |
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
| E003 | error | -c mode mismatch (resumed session is different mode) | Use correct --mode or omit -c |
| E004 | error | Mode workflow file not found (~/.maestro/workflows/odyssey-{mode}.md) | Verify workflow installation or select another mode |
| W001 | warning | No relevant git history / no dependency manifest / no design system | Proceed with defaults |
| W002 | warning | Some dimension agents failed / 3 retries exhausted | Partial coverage / INCONCLUSIVE |
| W003 | warning | Archaeology agent or delegate failure (debug/review) | Proceed with available results, log failed agent |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD (requires all 3 layers attempted with evidence) |
| W005 | warning | Pending decisions | Filter evidence phase=decision |
| W006 | warning | No CLI tools (debug/review explore) | Skip explore |
| W007 | warning | planex CLI review regression concern | Review before next iteration |
| W008 | warning | Mode-scoped flag ignored (not applicable to resolved mode) | Remove flag or use correct mode |
</error_codes>

<success_criteria>
- [ ] Mode resolved (explicit or auto-detected); session + output files created; prior knowledge searched
- [ ] Discovery phase(s) for the mode completed with evidence (archaeology/explore/survey)
- [ ] Domain audit completed with structured findings + severity matrix (or acceptance criteria + plan for planex)
- [ ] understanding.md sections written progressively per mode
- [ ] Fix + verify/confirm (unless --skip-fix); zero-residual for improve/review/ui; all criteria pass for planex
- [ ] Read-only invariant maintained for security and defensive modes — zero source modifications
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize); every unfixed finding individually justified
- [ ] phase_goals derived, tracked, and hardened-audited; goal_mode injected via prepare goal:true; `-y` no blocking prompts
- [ ] Session resumable via -c; mode-specific completion summary emitted
</success_criteria>

<next_step_routing>
| Condition | Next |
|-----------|------|
| Single-file mechanical fix discovered | `/maestro-companion "<fix>"` |
| Discovery issues created | `/maestro-issue list --source {mode}-odyssey` |
| Deeper debug needed (from any mode) | `/maestro-odyssey <finding> --mode debug` |
| Security findings need remediation | `/maestro-odyssey <finding> --mode improve` |
| Defensive findings need remediation | `/maestro-odyssey <finding> --mode improve` |
| Defensive root-cause needed | `/maestro-odyssey <finding> --mode debug` |
| Formal review of changes | `/maestro-odyssey <changed-files> --mode review` |
| UI-related findings | `/maestro-odyssey <component> --mode ui` |
| Document pattern | `/maestro-learn decompose <module>` |
| Second opinion | `/maestro-learn consult <understanding.md>` |
| Related question | `/maestro-learn investigate "<question>"` |
| Design/perf/arch pattern to persist | `/maestro-spec add ui\|coding\|arch "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
</next_step_routing>
