---
name: maestro-next
disable-model-invocation: false
description: "Unified entry for all development intents — classify intent,
  assess complexity, route to the correct execution channel: /maestro-companion
  (lightweight), standard single run, or /maestro and /maestro-ralph (multi-step
  manual/orchestrated). Pure router, never runs execution loops itself"
argument-hint: <intent> [-y]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.83
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Unified interactive entry for all development intents. Pure router: parse intent + project state → classify → assess complexity → route to the appropriate channel:
- **Companion** (lightweight): route to `/maestro-companion "<intent>"` — minimal run lifecycle, continuous evidence recording
- **Standard** (single run): recommend a step → confirm → execute via a v3 Session (`maestro session open` + `maestro run next`)
- **Multi-step**: route to `/maestro "<intent>"` (manual stepwise control) or `/maestro-ralph "<intent>"` (orchestrated closed-loop)

This command is the single entry point. It classifies and routes. Multi-step execution loops live in `/maestro` (manual) and `/maestro-ralph` (orchestrated).
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

**Flags:**

| Flag | Effect |
|------|--------|
| `-y` / `--yes` | Skip confirmation. Auto-executes only the **standard** channel; for companion/multi-step it emits the target invocation (router semantics — the target command owns execution) |

**Mode detection (priority order):**
1. Intent text present → S_STATE → S_RANK → route by complexity verdict
2. "continue"/"next"/"go" → lifecycle inference for natural next step
3. No arguments at all → 1 clarify round

**Candidate pool:** All 14 first-tier steps registered in `prepare/` + `workflows/`. Companion is a routing channel, not a first-tier step. Pipeline orchestrators (`maestro`, `maestro-ralph*`) are NEVER in the candidate pool.
</context>

<invariants>
1. **Pure router for multi-step** — this command never runs execution loops (manual chain or orchestrated). Multi-step execution is delegated to `/maestro` (manual) or `/maestro-ralph` (orchestrated)
2. **Pipeline orchestrators excluded** — only recommend registered steps as single-run targets
3. **Lifecycle continuation** — "continue"/"next"/"go" are explicit continuation signals → lifecycle_position inference (S_STATE). Truly empty arguments (no text at all) → 1 clarify round via request_user_input; still empty → S_FALLBACK (E001)
4. **Literal match priority** — keyword match takes precedence; lifecycle is tie-breaker
5. **Argument pass-through** — the intent phrase is Session metadata only (the objective to `session open`); when a chain step needs domain inputs, store them with repeatable `--arg <value>` on `maestro session chain insert|replace`. A fully specified machine-protocol `run create` passes domain text positionally; `--input <ART-id>` is only for sealed same-Session Artifact IDs. The user can modify command inputs at confirmation; `-y` only passes through when the user provided it
6. **Manual campaigns excluded** — `team-*` and `maestro-odyssey` never enter the executable candidate pool and are never executed in this turn; they may only be emitted as suggest-only invocations (see the odyssey campaign rows in the intent routing table)
7. **Retained commands are suggest-only** — route retained commands to an exact slash command. Never execute them in this turn; `-y` applies only to first-tier steps
8. **Companion routing is suggest-or-execute** — when complexity == lightweight, output `/maestro-companion "<intent>"` invocation. With `-y`, emit the invocation directly (`/maestro-companion "<intent>" -y`); the companion command owns its own execution. Without `-y`, present it as the recommended channel for user confirmation
9. **Multi-step routes to the orchestrators** — when intent spans ≥2 steps or needs orchestration, output `/maestro "<intent>"` (manual stepwise) or `/maestro-ralph "<intent>"` (orchestrated closed-loop). This command never creates sessions or manages chains itself
10. **Cross-category keyword priority** — when an intent keyword matches both a first-tier step and a retained command, the first-tier step wins for candidate selection; complexity assessment still applies independently. Auxiliary clusters are advisory grouping for display, never routing overrides
11. **`-y` means skip-confirmation, not auto-execute** — for standard channel, skipping confirmation proceeds to S_EXECUTE (this command runs the step). For companion/multi-step channels, this command is a router: skipping confirmation means outputting the target invocation text directly. The target command owns its own execution semantics
</invariants>

<state_machine>

<states>
S_PARSE    — Parse arguments, extract flags, detect mode
S_STATE    — Read project state, infer lifecycle_position
S_RANK     — Score candidates, assess complexity, determine channel
S_PRESENT  — Show top pick + alternatives + reasoning + channel verdict
S_CONFIRM  — request_user_input for confirmation (skipped by -y)
S_EXECUTE  — Open Session + dispatch the selected single step Run
S_FALLBACK — Intent empty after clarification
</states>

<transitions>

S_PARSE:
  → S_STATE    WHEN: intent present / "continue"/"next"/"go"
  → S_PARSE    WHEN: no arguments at all (1 clarify round via request_user_input)
  → S_FALLBACK WHEN: clarification still empty

S_STATE:
  → S_RANK     DO: A_INFER_LIFECYCLE

S_RANK:
  → S_PRESENT  DO: A_SCORE_CANDIDATES (channel verdict embedded in presentation)

S_PRESENT:
  → END        WHEN: target_kind == retained-command    DO: display exact slash command; suggest only
  → S_EXECUTE  WHEN: -y AND channel == standard
  → END        WHEN: -y AND channel == companion        DO: output `/maestro-companion "<intent>" -y`
  → END        WHEN: -y AND channel == multi-step       DO: output the selected orchestrator: `/maestro "<intent>" -y` (manual) or `/maestro-ralph "<intent>" -y` (orchestrated)
  → S_CONFIRM  WHEN: interactive

S_CONFIRM:
  → S_EXECUTE  WHEN: user confirms standard step / selects alternative / modifies args
  → END        WHEN: user picks companion → output `/maestro-companion "<intent>"`
  → END        WHEN: user picks multi-step → output the selected orchestrator: `/maestro "<intent>"` (manual) or `/maestro-ralph "<intent>"` (orchestrated)
  → END        WHEN: user cancels

S_EXECUTE:
  → END        DO: A_EXECUTE_STEP

S_FALLBACK:
  → END        DO: raise E001

</transitions>

<actions>

### A_INFER_LIFECYCLE

Read canonical Session/Run state to infer `lifecycle_position`; never inspect `.workflow/state.json` or choose by mtime:

```bash
maestro session list --json
maestro session status --session {session_id} --json
maestro session resume-view --session {session_id} --json
```

**Canonical state → lifecycle_position → natural next step:**

| State | lifecycle_position | Natural next |
|-------|-------------------|-------------|
| No `.workflow/` + no source code | brainstorm | brainstorm |
| No `.workflow/` + has source code | init | (maestro-init, not a step) |
| No compatible Session | analyze-macro | analyze |
| Session objective spans multiple releases and has no roadmap Artifact | roadmap | roadmap |
| Pending chain starts before feature analysis | analyze | analyze --session {session_id} |
| Latest eligible same-Session Artifact = analysis | plan | plan --session {session_id} |
| Latest eligible same-Session Artifact = plan | execute | execute --session {session_id} |
| Latest eligible same-Session Artifact = execution | review | review --session {session_id} |
| Review verdict = PASS | auto-test | auto-test --session {session_id} |
| Tests green + chain terminal | session-manage --complete | (maestro-session-manage --complete, not a step) |
| Any stage has gaps/failures | debug | debug {gap} |

**Lifecycle main line:**
```
init → {brainstorm | blueprint | analyze-macro} → roadmap
  → [per session] analyze → plan → execute
  → [quality gate] review → auto-test → test
  → session-manage --complete → next dep-ready session
```

**Multi-Session resolution:** historical similarity is read-only evidence. Resolve an exact compatible Session from `session list` plus `session status`; multiple compatible Sessions require user selection. Use `resume-view` and same-Session sealed Artifacts for lifecycle inference. Never select a Session from a local projection, directory order, or modification time.

### A_SCORE_CANDIDATES

**Scoring signals (high → low):**

| Signal | Weight | Description |
|--------|--------|-------------|
| Intent keyword match | High | Literal match against routing table |
| Lifecycle natural next | High | Decisive when intent is empty/"continue" |
| Step name keyword match | Medium | Intent contains "test" → test/auto-test boosted |
| Workflow cluster match | Medium | Learning/knowledge/issue clusters |
| Recent activity avoidance | Low | Recently completed steps demoted |
| Precondition unmet | Exclude | Remove from pool entirely |

**Complexity assessment (determines channel):**

| Complexity | Channel | Criteria |
|-----------|---------|----------|
| Lightweight | `/maestro-companion` | Mechanically clear intent, no design decisions, no artifact handoff, no gate value |
| Standard | Single step (one run) | Produces typed artifacts, needs downstream handoff or gate checks |
| Multi-step (manual) | `/maestro` | Intent spans ≥2 distinct steps, user wants stepwise control, no auto-retry needed |
| Multi-step (orchestrated) | `/maestro-ralph` | Intent needs closed-loop: decision nodes, drift analysis, auto-retry, decomposition |

**Routing preference: prefer the lightest channel that satisfies the task.** Default to Companion for anything that looks like a quick fix/lookup/exploration. Only upgrade to Standard when there is concrete evidence the task produces artifacts a downstream step will consume, or needs a gate/verdict for lifecycle tracking. Only route to /maestro when the intent genuinely spans ≥2 distinct lifecycle steps. When in doubt between Companion and Standard, ask the user via the confirmation menu rather than auto-upgrading.

**Lightweight signals (all must hold):**
- Intent specifies a concrete, bounded action — the user names what to change and where (file, function, error message). "Fix the login bug" is NOT lightweight (unbounded diagnosis); "change the timeout from 30s to 60s in auth.ts" IS lightweight. File count is irrelevant; a 20-file rename with a known pattern is still lightweight
- No typed artifact needs to be consumed by a downstream step
- No gate/verdict needs to be recorded for lifecycle tracking
- Task does not require pre-task thinking (prepare) or structured brief to execute correctly
- Single concern — intent does not span multiple lifecycle phases (e.g., analyze+plan, execute+review)

**Multi-step detection:** intent matches keywords of ≥2 distinct steps in the routing table → classify the relationship before setting `multi_step`:

| Pattern | Classification | Channel |
|---------|---------------|--------|
| Sequential lifecycle steps ("analyze then plan", "review and fix") | Multi-step | `/maestro` or `/maestro-ralph` |
| Single action with multiple aspects ("review and improve the auth module") | Single intent, pick dominant step | Standard or Companion |
| Ambiguous compound ("test and deploy") | Present both as alternatives in S_CONFIRM | — |

Dominant step = the step whose keyword appears first or carries the primary verb. When in doubt, present both as alternatives rather than auto-selecting.

**Orchestrator selection (for multi-step routing):**
- `/maestro` (manual): user explicitly asks for stepwise/per-step control ("one step at a time", "confirm each step"), or intent is a simple sequential pipeline of ≤3 steps without quality gates
- `/maestro-ralph` (orchestrated, default): intent implies iterative quality convergence — broad refactoring (>5 files), migration, "end-to-end", "full lifecycle", or needs decision gates/drift analysis/auto-retry. When in doubt, default to `/maestro-ralph`

**Override flags:**
- Channel is auto-detected from the signals above; the verdict is shown to the user before routing, and the user may override the channel at the confirmation menu (S_CONFIRM).

**Intent routing table:** first-tier rows enter the executable candidate pool. Retained-command rows are advisory routes: show the exact slash command and stop.

> **Cross-category priority:** first-tier step keywords take precedence over retained-command keywords when both match. Example: "security test" → `test` (first-tier) wins over `security/OWASP` (odyssey campaign), unless the intent explicitly says "security audit" or "OWASP". Auxiliary cluster triggers are the lowest priority — they group retained commands for display but never override individual keyword matches.

> **Scope guard:** keyword match identifies the *candidate step*, but the complexity verdict still applies independently. A keyword hit does NOT override lightweight signals. Example: "rename this variable" matches `execute/implement` keywords → candidate = execute step, but complexity = lightweight (1 file, no handoff) → channel = `/maestro-companion`. The routing table answers "which step?", the complexity assessment answers "which channel?".

| Intent keywords | Recommended step | What it does |
|----------------|-----------------|--------------|
| brainstorm / ideate / what-if / perspectives / multi-role | brainstorm | Multi-role creative exploration with cross-role conflict resolution |
| blueprint / PRD / architecture doc / formal spec / epic | blueprint | Generate formal specification package (Brief, PRD, Architecture, Epics) via 6-phase document chain |
| analyze / assess / evaluate / multi-dimension / findings | analyze | Systematic multi-angle assessment producing findings + risk-matrix for plan consumption |
| plan / decompose / breakdown / task split / DAG / waves | plan | Decompose confirmed analysis into executable task DAG with waves and collision avoidance |
| execute / implement / build / code / develop | execute | Implement code changes following current-plan DAG+waves with smoke self-check |
| verify / validate / acceptance / confirm implementation | verify | Independent verification of requirement coverage and behavioral correctness against plan |
| debug / bug / error / root cause / failing / broken / trace | debug | Scientific-method root cause diagnosis — reproduction, hypothesis testing, backward tracing |
| review / code review / audit / inspect / PR review | review | Layered multi-dimensional code review producing traceable review-findings |
| test / UAT / manual test / browser test / acceptance test | test | Conversational UAT + coverage + optional browser acceptance on verified deliverables |
| auto-test / automated test / CI test / pipeline test / L0-L3 | auto-test | Automated CSV-layered test pipeline iterating to convergence |
| roadmap / milestone / phasing / session plan / work breakdown | roadmap | Decompose requirements into session DAG with scope, success criteria, dependency edges |
| quick / small / ad-hoc / one-off / trivial | `/maestro-companion "<intent>"` | Lightweight direct execution with no typed artifact handoff |
| retrospective / retro / lessons learned / post-mortem / reflect | retrospective | Post-phase four-lens review (technical/process/quality/decision) → spec/knowhow/issue routing |
| grill / pressure test / stress test | grill | Socratic pressure-test of a plan/idea against codebase reality — adversarial questioning, terminology collision checks |
| collab / cross-verify / multi-tool / second opinion | collab | Fan out one requirement to multiple CLI tools, cross-verify findings into a unified conclusion |
| refactor / tech debt | `/maestro-odyssey "<scope>" --mode improve` (odyssey campaign) | Output invocation; user invokes it |
| issue / defect | `/maestro-issue "<intent>"` (retained command) | Suggest exact slash command; user invokes it |
| wiki / knowledge graph | `/maestro-knowledge "<intent>"` (retained command) | Suggest exact slash command; user invokes it |
| spec / rule / constraint | `/maestro-spec "<intent>"` (retained command) | Suggest exact slash command; user invokes it |
| init / project setup | `/maestro-init ...` (retained command) | Suggest exact slash command; user invokes it |
| security / OWASP | `/maestro-odyssey "<scope>" --mode security` (odyssey campaign) | Output invocation; user invokes it |
| defensive programming / exception swallowing / silent failure / fallback risk / 防御性编程 / 兜底风险 | `/maestro-odyssey "<scope>" --mode defensive` (odyssey campaign) | Output invocation; user invokes it |
| learn / explore code / follow | `/maestro-learn follow|investigate|decompose|consult ...` (retained command) | Suggest exact slash command; user invokes it |
| UI design / design system / polish / impeccable | `/maestro-impeccable "<intent>" ...` (retained command) | Suggest exact slash command; user invokes it |
| harvest / extract knowledge | `/maestro-knowledge "<intent>"` (retained command) | Suggest exact slash command; user invokes it |
| fork / parallel dev | `/maestro-fork ...` (retained command) | Suggest exact slash command; user invokes it |
| note / record observation during active Run | write content to a temp file, then `maestro knowledge stage knowhow "<title>" --content-file <path> --run <run-id>` | Stage a reviewable candidate; do not direct-write project knowledge |
| promote / distill insights | `maestro knowledge review <session-id>` → `maestro knowledge promote ...` | Review candidate receipts and evidence before explicit promotion |

**Auxiliary workflow clusters:**

| Cluster | Trigger | Chain |
|---------|---------|-------|
| Learning | New code / unknown module | maestro-learn follow → maestro-learn decompose → maestro-learn consult |
| Knowledge | Review & promote experience | knowledge stage (--signal) → knowledge review --refresh --resolve → knowledge promote |
| Issue | Defect management | maestro-issue discover → maestro-issue |

### A_EXECUTE_STEP

Single-run path only. Multi-step execution is handled by `/maestro` (manual) and `/maestro-ralph` (orchestrated).

For first-tier steps (those with prepare/ + workflows/ files):

```bash
# 1. Open an empty Session; participant and actor are the same identity.
maestro session open "<objective>" --id YYYYMMDD-<step>-<topic> --participant {actor_id} --actor {actor_id} --request-id {open_request_id} --reason "open single-step Session" --json
#    Or attach an existing compatible Session read-only first: maestro session status --session {session_id} --json

# 2. Persist the selected step and each required positional command input.
maestro session chain insert --session {session_id} --step-id {step_id} --command <step> --arg "<domain input>" --participant {actor_id} --actor {actor_id} --request-id {insert_request_id} --reason "add selected step" --expected-orchestration-revision {open_orchestration_revision} --json

# 2a. LLM performs pre-task thinking using the prepare guidance embedded in the birth packet.

# 3. Dispatch with the exact revision returned by chain insert.
maestro run next --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {next_request_id} --reason "dispatch selected step" --expected-orchestration-revision {insert_orchestration_revision} --json
#    Direct machine-protocol alternative (only for an existing exact step):
#    maestro run create <step> "<domain input>" --session {session_id} --run {run_id} --step {step_id} --goal "<goal>" --input <ART-id> --participant {actor_id} --actor {actor_id} --request-id {create_request_id} --reason "create selected Run" --expected-orchestration-revision {step_orchestration_revision} --json
#    Returns: run_id, run_dir, upstream, resolved task, entry blockers, and structured executable continuation

# 3a. Entry blocker degradation (execute-specific)
#    IF step == execute AND entry_blockers is non-empty (missing current-plan):
#      Inspect upstream for alternative artifacts (latest-review, latest-debug, latest-fix-directions).
#      Route per the degradation table in prepare/execute.md:
#        - Small scope (≤3 findings, ≤2 files each) → transition/cancel the attempt, surface /maestro-companion
#        - Larger scope → transition/cancel the attempt, surface /odyssey-planex
#        - No alternative upstream → `maestro run transition {run_id} blocked`, surface E001 + suggest /plan
#      The chain step returns to pending; a later fenced `maestro run next` may retry it.
#      Do NOT proceed to step 4 with a blocked execute run.

# 3b. Entry blocker handling (general, non-execute steps)
#    IF step != execute AND entry_blockers is non-empty:
#      Display each blocker with recovery suggestion:
#        - Missing upstream artifact → suggest the producing step (e.g., "run analyze first")
#        - Gate failure → suggest the gate step (review/verify/auto-test)
#      `maestro run transition {run_id} blocked` (or `maestro run cancel {run_id}`) — do NOT proceed to step 4.

# 4. Load the execution manual (follow the birth packet `guidance`/`brief.command` from step 3)
#    Execute the birth packet guidance verbatim — append no flag.
#    Returns: workflow content, run-mode summary, goal, gate status

# 5. LLM executes the workflow (core process)

# 6. Check and complete the run
maestro run check {run_id} --session {session_id} --json
maestro run complete {run_id} --session {session_id} --participant {actor_id} --actor {actor_id} --request-id {complete_request_id} --reason "complete selected step" --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict done --advance --json
```

After `run complete --advance`: re-infer lifecycle and surface the natural next step as a continuation hint — stepwise multi-step work proceeds by re-invoking `/maestro-next` or `/maestro -c`.

For retained commands, output the exact slash command as a suggest-only result. Do not execute it, including under `-y`; the user invokes it explicitly in a subsequent message.

</actions>

</state_machine>

<presentation>

### Normal mode

```
[⚠ Multi-step intent detected]   ← only when multi_step

Target: /<step-name>
Kind: first-tier step | retained command | companion | multi-step
  <description>
  Reason: <match rule + lifecycle position>
  Channel: /maestro-companion | single run | /maestro (manual) | /maestro-ralph (orchestrated)
  Invocation:
    companion       → /maestro-companion "<intent>"
    single run      → Confirm to execute through Maestro Run lifecycle
    multi-step      → /maestro "<intent>" (manual) or /maestro-ralph "<intent>" (orchestrated)
    retained        → Run manually: /<command> <subcommand> <args> (suggest only)

Alternatives:
  2. /<alt-1> — <description> — <invocation method>
  3. /<alt-2> — <description> — <invocation method>

Args: <args>
```

**Confirmation menu varies by channel verdict:**

When `channel == companion`:
- **Run as companion** (Recommended) → `/maestro-companion "<intent>"`
- **Upgrade to standard run** → S_EXECUTE
- **Cancel**

When `channel == standard`:
- **Execute recommendation** (Recommended)
- **Choose alternative**
- **Modify arguments**
- **Cancel**

When `multi_step`:
- **Hand off to orchestrator** (Recommended) → `/maestro "<intent>"` (manual) or `/maestro-ralph "<intent>"` (orchestrated)
- **Just this step** (execute only the top pick as single run)
- **Cancel**

`-y`: execute/route immediately per channel.

</presentation>

<error_codes>

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent empty after clarification | Provide intent, or ask conversationally for available steps (e.g. run `maestro skills`). |
| E002 | error | No steps found in registry | Check prepare/ and workflows/ directories |
| E003 | error | Selected step has no prepare/workflow files | Verify step installation |
| W001 | warning | Top-1 and top-2 score difference < 15% of max score | Force show top 3 for user decision — yields to `-y`: with `-y`, route/execute the top pick directly |
| W002 | warning | No good match for intent | Suggest /maestro for orchestration |

</error_codes>
