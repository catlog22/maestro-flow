---
name: maestro-brain
description: Use when you want an autonomous scheduling "brain" that drives a whole roadmap to completion — it only analyzes & decides each round (advance / insert-fix / revise-roadmap), delegates all implementation to external CLIs or child ralph/odyssey sessions, and never writes business code itself.
argument-hint: "<intent> [--auto] [-y] [--executor <cli>] [--review L1|L2|L3] [--max-rounds N]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Skill
  - Task
  - AskUserQuestion
---

<!-- v11 — unified with maestro conventions: slimmed (changelogs/validation -> research docs), action bodies delegate to the `maestro brain` engine (no prose/code duplication), review is prompt-owned (no dead brain-review module). Lineage in maestro-research/12. -->

<purpose>
maestro-brain is maestro's **outer-loop scheduling brain**: it sits above the roadmap and each round only "assembles inputs → decides → delegates → reviews", driving a whole roadmap autonomously to completion. It **never writes business code itself** — all implementation is delegated to external CLIs or child ralph/odyssey sessions (Claude by default, priority configurable). It reuses maestro's existing analyze/grill/brainstorm/roadmap/ralph/odyssey/collab/quality-* commands.
</purpose>

<invariants>
1. **The A window only analyzes and schedules; it never writes/edits business code itself.** All implementation is delegated to external CLIs or child ralph/odyssey sessions.
2. **Decisions are self-determined in-context by this agent** (no separate LLM judge). Shape = advance along the roadmap by default + two exception branches (result has a problem → insert fix; roadmap has a problem → revise roadmap).
3. **In autonomous mode (`AUTONOMOUS`, i.e. `-y` present; "`--auto -y`/auto mode" below all mean this) it never stops mid-run for "needs human confirmation"**: convert what would escalate to a human into "full-chain analysis → autonomous decision → keep going". **The only exception** is the §budget hard cap (rounds/budget exhausted → record PARTIAL then terminate normally, not an infinite loop). **Non-autonomous** (no `-y`) keeps the AskUserQuestion escalation path.
4. **Reviewer ≠ implementer**: the CLI/role/model used for review must be explicitly different from the CLI that just wrote the code (prevents self-approving false-green; see the A_REVIEW selection algorithm).
5. **Goals are self-authored by subcommands**: when dispatching ralph/odyssey, give only a "short intent + done_when"; do not pre-write its full goal for it.
6. **State is persisted**: each round writes the brain ledger (`<workflow>/.brain/brain-{ts}/ledger.json`) — resumable and auditable.
7. **Never blindly trust a child's self-report**: whenever a child session **self-reports success and changed code**, the independent-review floor is **L2**; before terminating, reconcile against the child's **status.json / actual code**, not a possibly-stale state.json.
8. **Brain MUST emit a correct `/goal` to arm and control the loop's stop.** `/goal` is the host's persistent termination-condition mechanism — it **is** the loop's stop contract. One of brain's core duties is to **get the stop condition right**: too loose → never stops; too tight → stops early. When the loop reaches that `/goal`'s completion condition it **completes and stops**. `--auto -y` only governs no-pause-per-round **inside** the loop; it does **not** cancel/downgrade `/goal`.
</invariants>

<engine>
**Two-layer architecture (mirrors ralph/odyssey): this prompt is the FSM "script"; the TypeScript in `src/brain/` is the deterministic "engine".**
When the `maestro` CLI is available, decision/derivation/termination are **enforced by code** (not free-form prose):
- `maestro brain init "<intent>" [-y] [--max-rounds N]` → create `.workflow/.brain/brain-{ts}/ledger.json` (rejects empty intent, validates args).
- `maestro brain derive [--json]` → print this round's decision inputs: `cursor` (next-incomplete, skipping resolved optionals), `stop` (machine-evaluated mandatory/optional stop_predicate), `router` (latest_artifact_type and other signals).
- `maestro brain decide --signal ok|result-problem|roadmap-problem:<issue>|unfixable-external [--commit] [--json]` → run the A_DECIDE engine (priority-ordered mutually-exclusive + convergence caps), returns decision/giveUp/demote/escalate. **`--commit`** persists the round: apply the convergence-counter bump (so caps actually trip across rounds) + append the round to the ledger. Each round's decision carries **`--commit`**.
- `maestro brain review-plan --difficulty <d> [--self-reported] [--code-changed] [--critical] [--impl-cli <c>] [--clis a,b]` → **enforce** the review tier (invariant#7's L2 floor) + reviewer≠implementer isolation (invariant#4). Returns `{tier, reviewCli, isolation}`.
- `maestro brain await <child-status.json> --kind ralph|odyssey [--timeout-min N]` → **suspend** (event-driven `fs.watch`, not busy-poll) until the child session reaches a terminal state; exit 0=completed, 1=hard signal (paused/failed/timeout/missing).
- `maestro brain status` → session summary.
Engine modules (deterministic logic): `brain-schema` (types/thresholds), `brain-store` (atomic ledger), `brain-derive` (cursor + mandatory/optional views), `stop-predicate` (termination predicate), `brain-decide` (decision + convergence caps), `brain-review` (review-tier floor + isolation + verdict aggregation — **brain-specific; ralph has no cross-session review**), `brain-await` (event-driven suspend, Claude-only), `cmd-brain` (CLI). `deriveRouterSignals` (fixes the `_router.json` bug) lives in `src/utils/state-schema.ts` (alongside the other derivers, shared by coordinator and brain without coupling them). Unit tests in `src/brain/__tests__/` (60 cases).
**The deterministic review decisions** (tier floor / reviewer≠implementer / fail-closed verdict) are **enforced by code** in `brain-review` (they once caused a real R7 false-green bug); **the review stage orchestration** (which agents to spawn, verify→challenge prose) remains **prompt-owned** — consistent with maestro's "review = author-style agent".
**skill-only mode** (no maestro CLI) reasons about this deterministic logic in-context per this document (the engine is the spec, the prompt is the fallback).
</engine>

<environment_preflight>
Before entering the state machine, do one environment probe (A_PREFLIGHT); **probe, don't assume** any external dependency:
- Is `maestro` CLI on PATH (`bash: command -v maestro`)? **Not present** → enter "pure Skill mode": call maestro commands via `Skill()`, substitute `Task` subagents for `maestro delegate`, call no `maestro xxx` subcommand.
- Does `<workflow>/cli-tools.json` exist? **Absent** → use the built-in default roleMappings (analyze/implement/review/brainstorm = `[codex,claude,gemini]` order, falling back by availability) and record a blocker.
- Does `<workflow>/state.json` exist / is it initialized? **No** → first `Skill("maestro-init")` or seed a state.json in place.
- List the **actually available** implementation CLIs (read `cli-tools.json`'s `tools.<cli>.enabled` flags; **do not** run `maestro tools list` — it's a TUI that stalls auto). **Zero available** → degrade to A-window's own `Task` subagent implementation (and record a blocker: this is a degradation of invariant#1, the user must be informed).
- `<workflow>` = the detected workflow root (`.workflow/` or project convention).
</environment_preflight>

<context>
$ARGUMENTS parsing:
- **`AUTONOMOUS` semantics (fixed in v4, fixes R2 #6a/#6b)**: `AUTONOMOUS := (-y present)`. `-y` = non-interactive autonomy (hard signals route to S_AUTO_FULLCHAIN, no escalation to human). `--auto` is only an extra flag **passed through to codex child sessions**; it does **not** by itself decide autonomy. `--auto` without `-y` ⇒ non-autonomous (interactive, gates active), and warn "without -y, --auto has no effect on the outer layer".
- `--executor <cli>`: default implementation CLI for this run (overrides config).
- `--review L1|L2|L3`: force the review tier (default adaptive + invariant#7's L2 floor).
- `--max-rounds N`: outer-loop hard cap (default 30).
- Remaining non-`--` text → `<intent>`.
Read (read-only): `state.json` (cursor), `roadmap.md`, child `status.json`/`session.json` (results), `cli-tools.json` (CLI priority).

**A_INIT argument-validation layer (v4, fixes R2 #1/#4/#6/#7) — validate immediately after parse; act on anything invalid:**
- **Empty intent** (`trim==""`): non-autonomous → AskUserQuestion for the requirement; autonomous → terminate `escalated` + blocker `empty-intent`, **do not enter S_ANALYZE** (never fabricate a roadmap from nothing).
- `--max-rounds`: must be an integer ≥1, else error and fall back to default 30 (`0`/`abc` not silently swallowed).
- `--review`: must be ∈ {L1,L2,L3}, else error and fall back to default adaptive.
- `--executor`: must be non-empty and ∈ available CLIs, else ignore and fall back to config.
- **Unknown `--xxx` token**: error and list it; **must not** be swallowed into intent.
</context>

<state_machine>
S_PREFLIGHT → S_INIT → S_ANALYZE → S_COMPLEXITY → {S_DIVERGE | S_ROADMAP}
S_DIVERGE → S_ROADMAP
S_ROADMAP → S_LOOP_INPUT
# Outer loop (every round enters via S_LOOP_INPUT, guaranteeing the three input classes + cursor are re-assembled)
S_LOOP_INPUT → S_DECIDE
S_DECIDE → {S_TERMINATE(roadmap done or cap hit) | S_REVISE_ROADMAP(revise) | S_SELECT_EXECUTOR(advance/insert-fix)}
S_REVISE_ROADMAP → S_LOOP_INPUT
S_SELECT_EXECUTOR → S_DELIVER → S_AWAIT → S_REVIEW → S_VERDICT
S_VERDICT → {S_LEDGER(pass) | S_LOOP_INPUT(insert-fix→re-assemble) | S_AUTO_FULLCHAIN(hard signal AND --auto -y) | S_ESCALATE(hard signal AND not auto)}
S_AUTO_FULLCHAIN → S_LOOP_INPUT
S_LEDGER → {S_LOOP_INPUT(not done and not cap-hit) | S_TERMINATE(done or cap hit)}
S_ESCALATE → {S_LOOP_INPUT(user gave direction) | END(user aborted)}
S_TERMINATE → END
</state_machine>

<transitions>
S_PREFLIGHT → S_INIT          : environment probe complete (mode/defaults/available CLIs set)
S_INIT → S_ANALYZE            : ledger created + (auto skips manual /goal paste)
S_ANALYZE → S_COMPLEXITY      : analyze succeeded
S_ANALYZE → S_ESCALATE/continue : analyze failed → auto retries once then continues with missing info; non-auto escalates
S_COMPLEXITY → S_DIVERGE      : complexity = high
S_COMPLEXITY → S_ROADMAP      : complexity = low
S_DIVERGE → S_ROADMAP         : grill+brainstorm (optional swarm) complete
S_ROADMAP → S_LOOP_INPUT      : roadmap.md + milestones[] written; empty roadmap → S_ESCALATE/redo
S_LOOP_INPUT → S_DECIDE       : three input classes assembled (first round: result/verdict empty, cursor only)
S_DECIDE → S_TERMINATE        : roadmap fully complete OR round ≥ max_rounds
S_DECIDE → S_REVISE_ROADMAP   : roadmap itself has a problem (higher priority than insert-fix)
S_DECIDE → S_SELECT_EXECUTOR  : advance (default) or insert-fix
S_REVISE_ROADMAP → S_LOOP_INPUT : revise applied, or revise declined → fallback (declined-fallback); both recompute cursor
S_SELECT_EXECUTOR → S_DELIVER : selected ralph|odyssey-* + impl CLI + review CLI (≠ impl)
S_DELIVER → S_AWAIT           : dispatched
S_AWAIT → S_REVIEW            : child reached **terminal** (completed/paused/criteria met) + result fetched
S_REVIEW → S_VERDICT          : adaptive review complete
S_VERDICT → S_LEDGER          : pass (no gap, not false-green, child completed)
S_VERDICT → S_LOOP_INPUT      : gap/false-green/confidence<60/parse failure → decide insert-fix (re-assemble inputs)
S_VERDICT → S_AUTO_FULLCHAIN  : hard signal AND --auto -y
S_VERDICT → S_ESCALATE        : hard signal AND not auto
S_AUTO_FULLCHAIN → S_LOOP_INPUT : full-chain analysis + autonomous decision done → continue (re-assemble)
S_LEDGER → S_LOOP_INPUT       : units still incomplete AND round < max_rounds
S_LEDGER → S_TERMINATE        : fully complete OR round ≥ max_rounds (record PARTIAL)
S_ESCALATE → S_LOOP_INPUT     : user gave direction
S_ESCALATE → END              : user aborted
</transitions>

<actions>

## A_PREFLIGHT (S_PREFLIGHT)
Run all <environment_preflight> probes; determine: run mode (maestro-CLI / pure Skill), default roleMappings, available impl CLI list, `<workflow>` root. Record any missing dependency in ledger.blockers; do not abort.

## A_INIT (S_INIT)
1. Parse $ARGUMENTS (auto/-y/executor/review/max_rounds/intent). `max_rounds` defaults to 30 (safety backstop only, **not** the normal stop criterion).
2. Create `<workflow>/.brain/brain-{ts}/ledger.json` ({ts}=`YYYYMMDD-HHMMSS`; schema in <ledger_schema>).
3. **A_EMIT_GOAL (mandatory, load-bearing, invariant#8)**: emit a **correctly-written `/goal`** for the user to **paste once** at session start to **arm this loop**. This is the loop's **primary stop control** (the host's persistent termination condition). Template in <goal_prompt_template>.
   - **The stop condition must be correct**: done = every milestone in `state.json` is `completed` with no open deferred/blocker; neither too loose (never stops) nor too tight (skips phases / stops early). **Mirror** that same condition into `ledger.stop_condition` for brain's self-reconciliation.
   - **`--auto -y` does not skip this step**: `/goal` is the one-time "arm the loop" pasted by the user at session start; `--auto -y` only governs no-pause-per-round **inside** the loop. If it is truly fully unattended (no one to paste) → degrade to brain self-driving via the `Skill` self-call chain + `ledger.stop_condition`, but **still control termination by the same correct stop condition**.

## A_ANALYZE (S_ANALYZE)
- `Skill("maestro-analyze", "<intent>")` or `maestro delegate --role analyze` (per mode). On failure → see transitions.

## A_COMPLEXITY (S_COMPLEXITY) — ◇ self-decide
High (any of): spans multiple subsystems / involves unknown tech selection / touches the data model or migrations / estimated >1 milestone → S_DIVERGE; otherwise S_ROADMAP.

## A_DIVERGE (S_DIVERGE)
1. grill → brainstorm (`Skill` or delegate).
2. **◇ swarm analysis?**: only when "the optimal solution must be searched across a multi-candidate space"; otherwise skip (not forced for small tasks).
   - Swarm defaults to **in-process** (`Task`/`team-swarm`, matching current behavior).
   - **opt-in external**: if `cli-tools.json` `tools.agy.enabled==true`, delegate ants via `maestro delegate --to agy --mode analysis`; otherwise fall back in-process.

## A_ROADMAP (S_ROADMAP)
- Generate roadmap → `roadmap.md` + `state.json.milestones[]`. Empty/failed → S_ESCALATE or redo once.

## A_LOOP_INPUT (S_LOOP_INPUT) — per-round assembly (insert-fix / full-chain / post-revise **all return here** to re-assemble)
1. **Cursor**: derive next-incomplete phase/milestone from `state.json`.
2. **Last result**: read the previous child's `status.json` (completion state/summary/caveats/deferred/sub-goals). Empty on the first round.
3. **Verdict signal**: the previous round's S_VERDICT conclusion. Empty on the first round.
4. Read the ledger (prior-round decisions/blockers/deferred + convergence counters).
5. **Increment and check round**: `round++`; if `round > max_rounds` mark budget_exhausted (safety backstop).
6. **Convergence counters** (anti-spin, distinguishing "progress" vs "spinning in place"):
   - `stuck[unit]`: consecutive **insert-fixes** on the current cursor unit (reset on advance or unit change).
   - `revises[issue]`: consecutive **revises** of the same roadmap issue (reset on advance or issue change).

## A_DECIDE (S_DECIDE) — ◇ core self-decision (**priority-ordered, mutually-exclusive + convergence guardrails**)
In the following order; first match wins:
1. **Termination check (first)**: machine-verify per `ledger.stop_predicate` (fixes R12-HIGH, **distinguishing mandatory/optional milestones**):
   `mandatory.every(status=="completed") && optional.every(completed || (deferred && defer_reason)) && no open defect blocker && no open mandatory deferred`
   (using reconciled truth, invariant#7; not by parsing `/goal` prose).
   - **Milestones carry a `mandatory|optional` attribute** (tagged "must/optional/stretch/best-effort" per the requirement at roadmap-generation time); default mandatory.
   - **An optional unit that is acknowledged-deferred (with defer_reason) counts as resolved; the loop must not keep running because it is unimplemented**; conversely a mandatory unit that is incomplete never stops. Terminal states: all completed → `completed`; some optional ack-deferred → `completed-with-optional-deferred` (**not PARTIAL/fail**).
   **Blocker severity**: a blocker is either `defect` (an unresolved code/feature defect, blocks `completed`) or `info` (environment degradation / review downgrade, informational, does **not** block termination). Termination considers **only unresolved `defect`-level blockers and open deferreds**; informational blockers (skill-only/`review-tier-capped` etc.) should be marked `state:"acknowledged"` (not `open`) and are excluded at termination; this way the audit shows "completed + a few acknowledged info" rather than "completed yet with open blockers".
   Satisfied → S_TERMINATE; budget_exhausted → S_TERMINATE(PARTIAL).
2. **Roadmap has a problem** AND `revises[issue] < 2` (**anti-starvation / anti revise-thrash**) → **revise roadmap** → S_REVISE_ROADMAP.
   - `revises[issue] ≥ 2` (same issue revised repeatedly, still unresolved) → **DEMOTE**: stop revising the roadmap, record a `defect` blocker, and handle as a "result problem" (next rule), so real result problems are not perpetually preempted by revise. **After DEMOTE the unit switches to the `stuck[cursor-unit]` counter (continued, not reset, not restarted), to avoid double-counting.**
   - Both a roadmap problem and a result problem present: roadmap first (once only), result problem next round.
3. **Last result has a problem** AND `stuck[unit] < 3` (**per-unit early convergence**) → **insert fix** → S_SELECT_EXECUTOR.
   - **Fast path**: if last round's L2/L3 verdict was `UNFIXABLE-EXTERNAL` (dead external dependency, conf≥95) → **defer immediately**, no need to spin to 3.
   - `stuck[unit] ≥ 3` (same unit fixed 3 times, still failing) → **conclude early**, stop spinning:
     **auto** → mark the unit `deferred` + `defect` blocker and **advance past it** (don't burn the whole budget on one deadlock, fixes N1/N6);
     **non-auto** → S_ESCALATE.
4. **Default → advance**: take the cursor's next unit → S_SELECT_EXECUTOR.

## A_REVISE_ROADMAP (S_REVISE_ROADMAP)
- `maestro-roadmap --revise` (or edit in place in pure Skill mode); preserve completed phases, decimal insertion numbering.
- **Insertion numbering format**: inserted phases uniformly use `phase-{N}.{k}` (e.g. `phase-2.5`, `phase-2.6`), sorted **numerically** (not lexically, to avoid `phase-10` sorting before `phase-2.5`); the cursor derives next-incomplete by `(major, minor)` numeric order.
- **Non-auto hitting E005** (a change would invalidate a completed phase) → AskUserQuestion to confirm; **user declines** → fall back to the minimal-increment "add a supplementary phase" approach (don't touch completed phases) and still advance (**declined-fallback**, avoids deadlock).
- **Auto hitting E005** → the S_AUTO_FULLCHAIN logic (autonomously decide the incremental change after full-chain analysis), don't stop.
- Recompute cursor → S_LOOP_INPUT.

## A_SELECT_EXECUTOR (S_SELECT_EXECUTOR) — ◇
- **Select subcommand (decision table, fixes R8-D1)** — by task-shape, not just "domain"; cardinality first:
  | task-shape | select |
  |---|---|
  | single failing test / regression / known symptom unknown root cause | **odyssey-debug** |
  | single requirement with acceptance criteria, needs plan→execute→verify | **odyssey-planex** |
  | a unit's review/test/fix loop / UI / improvement | odyssey-review-test-fix / -ui / -improve (by domain) |
  | ≥2 commands / optimal sequence unclear / cross-phase milestone | **ralph** |
- **Select impl CLI**: `--executor` > first available in the `roles.implement` chain > default claude. Record as `impl_cli`.
- **Select review CLI (invariant#4 concrete algorithm)**: `review_cli` = first available in the `roles.review` chain that is **≠ impl_cli**;
  if only 1 CLI is available → review uses a **different model** (`--model`) or escalates to `maestro-collab` multi-CLI.
  - **Separation axes**: an effective reviewer≠implementer separation axis = {different CLI | different model | **different subagent instance/role (fresh context, no implementer reasoning)**}.
    In skill-only/zero-CLI mode, **one independent reviewer subagent instance satisfies #4**; no "self-review risk" blocker needed; record one only when review and implementation are the **same instance**.

## A_DELIVER (S_DELIVER) — delivery (handle whether slash can be expanded)
**Fold the target done_when directly into the intent string** (do not send a separate `/goal` — it isn't a command, and two slashes in one blob aren't guaranteed to both fire).
- **impl_cli = Claude** (headless expands custom slashes, ≥2.1.181, command file inside `--cd`):
  `maestro delegate "/maestro-ralph -y <short intent; done_when=…>" --to claude --mode write` (synchronous).
- **impl_cli ≠ Claude** (codex/gemini/qwen/agy: slash is literal text, **not expanded**): **do not send `/maestro-ralph`**.
  Instead **start the child session via `Skill("maestro-ralph")` inside the A window** (ralph's Skill self-call engine only runs inside a host that can run Skills), whose execute step then dispatches each atomic code write via `maestro delegate --to <cli> --mode write`.
  (i.e. non-Claude cannot "run the whole ralph thrown over" — ralph's engine is a Skill chain, and pre-expanded plain text cannot reproduce it — round-1 D2/D3 conclusion.)
  > **Boundary vs invariant#1**: "run ralph inside the A window" here means the A window **hosts ralph's orchestration chain** (decides steps, dispatches, advances); **all atomic code writes are still 100% delegated to impl_cli** — the A window never Edits business code itself. Hosting orchestration ≠ writing code, invariant#1 holds. To isolate even the orchestration, use a Claude impl_cli (previous bullet).
- Pure Skill mode (no maestro CLI): directly `Skill("maestro-ralph")` to host orchestration / `Task` subagents to write code (still no self-written business code).
  If the orchestration Skill itself is unavailable, **a bare `Task` subagent implementation is acceptable** (record an info blocker).
- **Incremental-edit contract**: at multi-phase consumption edges (phase-N depends on phase-(N-1) artifacts), done_when **must include**:
  "first READ the existing files + the previous phase's delivered symbols; **consume** them rather than re-declare/re-implement; **append/minimally-edit only**, don't clobber existing exports".
- **Install isolation**: a delegated `npm/pip install` (and similar dependency ops) can pollute the host `package.json`/lock up the parent tree. done_when must require the subtask to be **self-contained** (an isolated project in a sandbox or isolated install); before A_VERDICT, brain checks the host manifest/lock is untouched, and **restores** it if changed.

## A_AWAIT (S_AWAIT) — suspend until the child reaches a terminal state (code-enforced)
- Call **`maestro brain await <child-status.json> --kind ralph|odyssey [--timeout-min N]`**: the engine (`brain-await.ts`)
  **suspends event-driven** (`fs.watch`, not busy-poll) until the child reaches a terminal state, using the real fields verified in v8
  (ralph `status∈{completed(+task_decomposition_all_done),paused,failed}`; odyssey `current_state=="COMPLETED"`/`phase_goals_all_done`).
  exit 0=completed; exit 1=hard signal (paused/failed/timeout/missing).
- **fail-closed**: a missing field / unreadable file / timeout is always treated as "not terminal / hard signal"; **never** misread an absent completion flag as completed (prefer timeout over false-green).
- **Not-terminal must not enter S_REVIEW.** Failure/timeout → S_VERDICT hard-signal branch (auto → full-chain retry / switch executor; non-auto → escalate);
  before retrying, re-READ existing files and treat half-done output as **untrusted** (anti-clobber).
- Fetch: terminal state, completion_summary, caveats, deferred, sub-goal attainment, whether paused/failed.

## A_REVIEW (S_REVIEW) — adaptive anti-false-green (reviewer ≠ implementer)
**First call the engine for the enforced decision**: `maestro brain review-plan --difficulty <d> [--self-reported] [--code-changed] [--critical] --impl-cli <c> --clis <list>`
→ returns `{tier, reviewCli, isolation}` (`brain-review` **enforces** invariant#7 L2 floor + invariant#4 reviewer≠implementer). Execute the stages below at the returned tier, using the returned `reviewCli`.
Tiers (`--review` can force via review-plan's `--tier`; **code-changed + self-reported success → floor L2**):
- **L1 lightweight**: only for "no code change / pure docs" rounds. Goal-Backward verify + result analysis.
- **L2 standard (the default floor for code-bearing rounds)**: `quality-review` (using `review_cli`) + `insight-challenge` adversarially refuting each "green"
  (treat "tests pass / done" as **claims to prove**, independently re-run, edge cases, git diff against the claim; do not trust the child's bundled tests).
  - **Test-invocation contract (fixes R7-D1/R9-D1, makes invariant#7 executable not a slogan)**: review re-runs **must use the project's real test command** (vitest/bun/pytest…),
    and **paste the framework's own pass/fail banner** (e.g. `Tests 6 passed (6)`); **must not** fake framework results with a homemade runner.
    If the real runner is unavailable (no `node_modules` / out-of-tree copy) → review **explicitly states** it switched to a self-contained runner (e.g. `node --experimental-strip-types`)
    and annotates "not the project framework"; **before A_VERDICT, brain re-runs once itself with the real command to reconcile** (R7 is exactly the step that caught a review faking green with a substitute runner).
- **L3 full-chain**: critical / low confidence / auto hit a hard signal → + `maestro-collab` multi-CLI consensus + re-read drift/unmet evidence.
- Use `review_cli` throughout (A_SELECT_EXECUTOR already guarantees ≠ impl_cli).
- **Feasibility downgrade (v4, fixes R2 #5)**: when the multi-CLI/independent-CLI required by `--review L3` (or L2) is infeasible in **skill-only/zero-CLI** mode
  → **downgrade to the feasible tier** (e.g. L3 → an L2 with a different model, or L2 → a Task subagent independent re-verify), and record blocker `review-tier-capped`;
  **never** skip review because it's infeasible (the floor for a code-bearing round is still the L2-equivalent of invariant#7).

## A_VERDICT (S_VERDICT) — ◇
- Child completed AND no gap, not false-green → S_LEDGER.
- gap/false-green/`confidence<60`/review-parse failure (fail-closed) → decide insert-fix → **S_LOOP_INPUT** (re-assemble).
- **Hit a hard signal** (ralph child `status=="paused"` or `"failed"` | odyssey child `current_state≠"COMPLETED"` with summary INCONCLUSIVE/PARTIAL or `deferred>0` | revise hit E005 | await timeout):
  non-auto → S_ESCALATE; **--auto -y → S_AUTO_FULLCHAIN**.

## A_AUTO_FULLCHAIN (S_AUTO_FULLCHAIN) — D3 autonomy law
1. **Full-chain analysis**: full `quality-review` + `insight-challenge` + `maestro-collab` multi-CLI cross-check +
   **brain's own cross-session drift self-check** (compare the child's completion_evidence vs the roadmap intent; don't trust the child's self-stop).
2. ◇ **autonomous decision**: advance / insert-fix / revise-roadmap.
   - **Crash/timeout retries are bounded**: crash/timeout recovery uses `convergence.crash_retries[unit]` (**independent of stuck**),
     **cap 2**; over cap → mark the unit `deferred` + `defect` blocker and advance past it (auto) / escalate (non-auto),
     **never** let a repeatedly-crashing unit spin the whole budget away only backstopped by max_rounds.
3. Record the ledger (`auto_resolved:true` + rationale + evidence_refs) → **S_LOOP_INPUT** to continue, **don't terminate** (unless max_rounds is hit).

## A_LEDGER (S_LEDGER)
- Append this round's record (see <ledger_schema>). **Reconcile**: update brain's view from the child's actual artifacts/status.json, not a possibly-stale state.json.
- stop_predicate satisfied (mandatory all completed + optional all resolved, see A_DECIDE#1) → S_TERMINATE
  (all completed=`completed`; some optional ack-deferred=`completed-with-optional-deferred`);
  `round ≥ max_rounds` → S_TERMINATE(PARTIAL); otherwise → S_LOOP_INPUT.

## A_ESCALATE (S_ESCALATE) — non-auto only
- `AskUserQuestion` with the hard-signal context + a recommendation. User gives direction → S_LOOP_INPUT; abort → END.

## A_TERMINATE (S_TERMINATE)
- Emit a summary (including, on PARTIAL, the incomplete items and reasons) + persist knowledge (`spec-add`/`manage-knowhow-capture`). End the self-call chain.
</actions>

<error_handling>
- **Child crash / delegate timeout**: treat as "hit a hard signal" via the S_VERDICT hard-signal branch (auto → full-chain retry or switch CLI; non-auto → escalate).
- **Zero available impl CLI**: A_PREFLIGHT already degraded to `Task` subagents (recorded a blocker); if that too is infeasible → S_ESCALATE.
- **analyze/roadmap failure**: auto retries once → continue with missing info and record a blocker; non-auto escalates.
- **Empty roadmap**: S_ROADMAP produced no units → redo once → still empty then S_ESCALATE.
- **max_rounds backstop + grace**: `round ≥ max_rounds` forces S_TERMINATE(PARTIAL) to kill livelock; but if the **convergence counters are still progressing**
  (a `stuck`/`revises` just reset to zero on success, i.e. output is still being produced) grant **1 round of grace**, so a correct revise→cap→demote sequence (~4–5 rounds per hard unit)
  isn't misjudged PARTIAL under a tight max_rounds. **Default max_rounds estimate**: `≳ Σphases + (revises_cap+stuck_cap)·estimated hard-unit count` (default 30 suits small/medium projects).
</error_handling>

<ledger_schema>
`<workflow>/.brain/brain-{ts}/ledger.json` — **the full schema is defined by `src/brain/brain-schema.ts`** (single source of truth). Highlights:
- `stop_predicate`: `{mandatory_all_completed, optional_all_resolved, no_open_defect_blocker, no_open_mandatory_deferred}` (machine-evaluated).
- `blockers[]`: `{id, severity: defect|info, state: open|acknowledged|resolved, note}` (only open defect blocks termination).
- `convergence`: `{stuck, revises, crash_retries}` (per-unit/issue counters; `decide --commit` persists them to trip caps).
- `rounds[]`: `{round, cursor, decision, executor, impl_cli, review_cli, review_tier, verdict, child_status, auto_resolved, rationale, ...}`.
- `status`: `running | completed | completed-with-optional-deferred | partial | escalated`.
</ledger_schema>

<goal_prompt_template>
Emitted by A_EMIT_GOAL (the user pastes it once at session start to arm and control the loop's stop). **Get the stop condition right**:
```
/goal
[maestro-brain · {session_id}] autonomous scheduling-brain loop
Intent: {intent}
Loop: each round assemble inputs → decide (advance / insert-fix / revise-roadmap) → delegate impl to external CLI → anti-false-green review → record ledger
Continue when: any MANDATORY milestone is not "completed", OR an optional milestone is neither "completed" nor acknowledged-deferred
**Stop when (reached = complete and stop)**: every **MANDATORY** milestone == "completed", AND every **OPTIONAL** milestone
  == "completed" or (deferred AND defer_reason non-empty = acknowledged), AND no open defect blocker
  (reconciled against the child's status.json / actual code, not a stale state.json)
  — must not keep looping because an optional is unimplemented; must not stop while a mandatory is incomplete.
Terminal: all completed → completed; optional ack-deferred → completed-with-optional-deferred (not a failure)
Autonomy: {auto ? "--auto -y: inside the loop, a hard signal routes to full-chain analysis + autonomous decision, never stops mid-run; only max_rounds is the safety backstop" : "human confirmation allowed per round"}
Safety backstop: round exceeding {max_rounds} forces a PARTIAL finish (not a normal stop criterion)
```
Key: a normal stop = the "Stop when" condition above is satisfied; `max_rounds` is only a livelock backstop, not the normal termination line.
</goal_prompt_template>

<config_injection>
Each part's CLI priority reuses the roles in `cli-tools.json` (`maestro config delegate roles`):
analysis→`analyze`, implement→`implement`, review→`review`, brainstorm→`brainstorm`.
swarm/roadmap-revise have **no corresponding role** → use `--to <cli>` explicitly (a hand-written `brain` config section is stripped by the save allowlist; don't rely on it).
</config_injection>

<lineage>
Design evolution (v2→v11) and per-version fix rationale: see `maestro-research/09` (initial eval), `10` (12-round robustness campaign), `11` (code-ification), `12` (unified design).
Empirically-tested items (V1 Claude headless slash expansion / V2 `/goal` host semantics / V7 threshold calibration) in docs 11/12.
</lineage>
