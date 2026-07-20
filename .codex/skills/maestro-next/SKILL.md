---
name: maestro-next
disable-model-invocation: false
description: "Unified entry for all development intents — classify intent,
  assess complexity, route to the correct execution channel: /maestro-companion
  (lightweight), standard single run, or /maestro (multi-step with manual/ralph
  engine). Pure router, never runs execution loops itself"
argument-hint: <intent>|--list|--suggest [-y] [--dry-run] [--lite] [--run]
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
version: 0.5.52
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Unified interactive entry for all development intents. Pure router: parse intent + project state → classify → assess complexity → route to the appropriate channel:
- **Companion** (lightweight): route to `/maestro-companion "<intent>"` — minimal run lifecycle, continuous evidence recording
- **Standard** (single run): recommend a step → confirm → execute via `maestro run prepare --platform codex` + `maestro run create`
- **Multi-step**: route to `/maestro "<intent>"` with engine hint (manual for stepwise control, ralph for closed-loop orchestration)

This command is the single entry point. It classifies and routes. Multi-step execution loops (manual or orchestrated) live in `/maestro`.
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

**Flags:**

| Flag | Effect |
|------|--------|
| `-y` / `--yes` | Skip confirmation, execute/route top pick directly |
| `--dry-run` | Show recommendation only, do not execute |
| `--top N` | Show top N candidates (default 3) |
| `--list` | List all available steps grouped by workflow cluster |
| `--suggest` | Suggest-only mode: show recommendation + prepare content, NEVER auto-execute |
| `--lite` | Force companion channel: route to `/maestro-companion "<intent>"` |
| `--run` | Force standard channel (create a run even for simple tasks) |

**Mode detection (priority order):**
1. `--lite` → route to `/maestro-companion "<intent>"` (suggest invocation, execute if -y)
2. `--suggest` → S_RANK → S_PRESENT (suggest only, never execute)
3. `--list` → S_LIST
4. Intent text present → S_STATE → S_RANK → route by complexity verdict
5. No arguments → lifecycle inference for natural next step

**Candidate pool:** All 14 first-tier steps registered in `prepare/` + `workflows/`. Companion is a routing channel, not a first-tier step. Pipeline orchestrators (`maestro`, `maestro-ralph*`) are NEVER in the candidate pool.
</context>

<invariants>
1. **Pure router for multi-step** — this command never runs execution loops (manual chain or orchestrated). All multi-step execution is delegated to `/maestro`
2. **Pipeline orchestrators excluded** — only recommend registered steps as single-run targets
3. **Empty intent or "continue"/"next"** → lifecycle_position inference for natural next step
4. **Literal match priority** — keyword match takes precedence; lifecycle is tie-breaker
5. **Argument pass-through** — `--intent` is Session metadata only; the selected step's domain payload becomes command input through repeatable `--arg <value>` or arguments after `--`. The user can modify command inputs at confirmation; `-y` only passes through when the user provided it
6. **--suggest never executes** — show recommendation + prepare content only
7. **Manual campaigns excluded** — `team-*` and `maestro-odyssey` are never candidates, recommendations, retained utilities, or handoff targets
8. **Retained commands are suggest-only** — route retained commands to an exact slash command. Never execute them in this turn; `-y` applies only to first-tier steps
9. **Companion routing is suggest-or-execute** — when complexity == lightweight, output `/maestro-companion "<intent>"` invocation. With `-y`, invoke it directly; otherwise present it as the recommended channel for user confirmation
10. **Multi-step always routes to /maestro** — when intent spans ≥2 steps or needs orchestration, output `/maestro "<intent>"` with appropriate engine hint. This command never creates sessions or manages chains itself
</invariants>

<state_machine>

<states>
S_PARSE    — Parse arguments, extract flags, detect mode
S_STATE    — Read project state, infer lifecycle_position
S_RANK     — Score candidates, assess complexity, determine channel
S_LIST     — --list mode: grouped display of all steps
S_PRESENT  — Show top pick + alternatives + reasoning + channel verdict
S_CONFIRM  — request_user_input for confirmation (skipped by -y)
S_EXECUTE  — Run prepare + create for selected single step
S_FALLBACK — Intent empty after clarification
</states>

<transitions>

S_PARSE:
  → S_LIST     WHEN: --list flag
  → S_STATE    WHEN: intent present / "continue"/"next"/"go" / --lite / --run
  → S_PARSE    WHEN: no intent (1 clarify round via request_user_input)
  → S_FALLBACK WHEN: clarification empty

S_STATE:
  → S_RANK     DO: A_INFER_LIFECYCLE

S_RANK:
  → S_PRESENT  DO: A_SCORE_CANDIDATES (channel verdict embedded in presentation)

S_LIST:
  → END        DO: group steps by cluster, display with descriptions

S_PRESENT:
  → END        WHEN: target_kind == retained-command    DO: display exact slash command; suggest only
  → END        WHEN: --dry-run OR --suggest             DO: display recommendation + channel
  → S_EXECUTE  WHEN: -y AND channel == standard
  → END        WHEN: -y AND channel == companion        DO: output `/maestro-companion "<intent>" -y`
  → END        WHEN: -y AND channel == multi-step       DO: output `/maestro "<intent>" -y`
  → S_CONFIRM  WHEN: interactive

S_CONFIRM:
  → S_EXECUTE  WHEN: user confirms standard step / selects alternative / modifies args
  → END        WHEN: user picks companion → output `/maestro-companion "<intent>"`
  → END        WHEN: user picks multi-step → output `/maestro "<intent>"`
  → END        WHEN: user cancels

S_EXECUTE:
  → END        DO: A_EXECUTE_STEP

S_FALLBACK:
  → END        DO: raise E001

</transitions>

<actions>

### A_INFER_LIFECYCLE

Read project state to infer `lifecycle_position`:

```bash
maestro run prepare --platform codex --workflow-root .   # check if prepare command works
cat .workflow/state.json 2>/dev/null
```

**State → lifecycle_position → natural next step:**

| State | lifecycle_position | Natural next |
|-------|-------------------|-------------|
| No `.workflow/` + no source code | brainstorm | brainstorm |
| No `.workflow/` + has source code | init | (maestro-init, not a step) |
| state.json exists, no roadmap, no sessions | analyze-macro | analyze |
| Has macro analysis, no roadmap | roadmap | roadmap |
| Has roadmap, dep-ready session unstarted | analyze | analyze --session {slug} |
| Latest artifact = analysis | plan | plan --session {active} |
| Latest artifact = plan | execute | execute --session {active} |
| Latest artifact = execution | review | review --session {active} |
| Review verdict = PASS | auto-test | auto-test --session {active} |
| Tests green + active session | session-seal | (maestro-session-seal, not a step) |
| Any stage has gaps/failures | debug | debug {gap} |

**Lifecycle main line:**
```
init → {brainstorm | blueprint | analyze-macro} → roadmap
  → [per session] analyze → plan → execute
  → [quality gate] review → auto-test → test
  → session-seal → next dep-ready session
```

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

| Complexity | Channel | Criteria | Engine hint |
|-----------|---------|----------|-------------|
| Lightweight | `/maestro-companion` | Mechanically clear intent, no design decisions, no artifact handoff, no gate value | — |
| Standard | Single step (one run) | Produces typed artifacts, needs downstream handoff or gate checks | — |
| Multi-step (manual) | `/maestro` | Intent spans ≥2 distinct steps, user wants stepwise control, no auto-retry needed | `--engine manual` |
| Multi-step (orchestrated) | `/maestro` | Intent needs closed-loop: decision nodes, drift analysis, auto-retry, decomposition | `--engine ralph` (default) |

**Routing preference: prefer the lightest channel that satisfies the task.** Default to Companion for anything that looks like a quick fix/lookup/exploration. Only upgrade to Standard when there is concrete evidence the task produces artifacts a downstream step will consume, or needs a gate/verdict for lifecycle tracking. Only route to /maestro when the intent genuinely spans ≥2 distinct lifecycle steps. When in doubt between Companion and Standard, ask the user via the confirmation menu rather than auto-upgrading.

**Lightweight signals (all must hold):**
- Intent is mechanically clear — user knows exactly what to change, no design decisions or multi-angle analysis needed (file count is irrelevant; a 20-file rename is still lightweight)
- No typed artifact needs to be consumed by a downstream step
- No gate/verdict needs to be recorded for lifecycle tracking
- Task does not require pre-task thinking (prepare) or structured brief to execute correctly

**Multi-step detection:** intent matches keywords of ≥2 distinct steps in the routing table → set `multi_step`.

**Engine hint logic (for /maestro routing):**
- Manual: user explicitly asks for stepwise/per-step control, or intent is a simple sequential pipeline without quality gates
- Ralph (default): intent implies closed-loop quality (broad refactoring, migration, "end-to-end", "full lifecycle"), or needs decision gates/drift analysis

**Override flags:**
- `--lite` forces Companion channel regardless of complexity assessment
- `--run` forces Standard channel (single run) regardless of complexity assessment
- Neither flag: auto-detect from the signals above; verdict shown to user before routing

**Intent routing table:** first-tier rows enter the executable candidate pool. Retained-command rows are advisory routes: show the exact slash command and stop.

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
| refactor / tech debt | `/quality-refactor "<scope>"` (retained command) | Suggest exact slash command; user invokes it |
| sync docs | `/maestro-manage sync codebase` (retained command) | Suggest exact slash command; user invokes it |
| issue / defect | `/maestro-manage issue <subcommand> ...` (retained command) | Suggest exact slash command; user invokes it |
| wiki / knowledge graph | `/maestro-manage knowledge wiki ...` (retained command) | Suggest exact slash command; user invokes it |
| spec / rule / constraint | `/maestro-spec load ...` or `/maestro-spec add ...` (retained command) | Suggest exact slash command; user invokes it |
| init / project setup | `/maestro-init ...` (retained command) | Suggest exact slash command; user invokes it |
| status / dashboard | `/maestro-manage status` (retained command) | Suggest exact slash command; user invokes it |
| security / OWASP | `/security-audit ...` (retained command) | Suggest exact slash command; user invokes it |
| learn / explore code / follow | `/maestro-learn follow|investigate|decompose|consult ...` (retained command) | Suggest exact slash command; user invokes it |
| UI design / design system / polish / impeccable | `/maestro-impeccable "<intent>" ...` (retained command) | Suggest exact slash command; user invokes it |
| harvest / extract knowledge | `/maestro-manage knowledge harvest ...` (retained command) | Suggest exact slash command; user invokes it |
| fork / parallel dev | `/maestro-fork ...` (retained command) | Suggest exact slash command; user invokes it |
| note / record observation | `/maestro-companion --note "<text>"` (companion utility) | Route to companion note mode |
| promote / distill insights | `/maestro-companion --promote` (companion utility) | Route to companion promote mode |

**Auxiliary workflow clusters:**

| Cluster | Trigger | Chain |
|---------|---------|-------|
| Learning | New code / unknown module | maestro-learn follow → maestro-learn decompose → maestro-learn consult |
| Knowledge | Distill experience | maestro-manage knowledge harvest → maestro-manage knowledge capture → maestro-spec add |
| Issue | Defect management | maestro-manage issue discover → maestro-manage issue |

### A_EXECUTE_STEP

Single-run path only. Multi-step execution is handled by `/maestro`.

For first-tier steps (those with prepare/ + workflows/ files):

```bash
# 1. Run prepare to get pre-task thinking content
maestro run prepare --platform codex <step> --workflow-root .

# 2. LLM performs pre-task thinking using prepare content
#    Produces prep YAML (goal/approach/scope/risks/gates/reads)

# 3. Create run — always pass --session (ASCII slug) + metadata-only --intent.
#    When the command contract or argument-hint requires input, pass it with
#    repeatable --arg <value> or after -- using the -- <args...> form.
maestro run create <step> --session YYYYMMDD-<step>-<topic> --intent "<short goal>" --workflow-root . [--arg "<required command input>"] [-- <args...>]
#    Returns: run_id, run_dir, upstream (alias→artifact), entry_gates, next (progressive hint)

# 4. Load the execution manual (follow the `next` hint from create)
maestro run brief --platform codex <run_id> --workflow-root .
#    Returns: workflow content, run-mode summary, goal, gate status

# 5. LLM executes the workflow (core process)

# 6. Complete the run
maestro run complete <run_id> --workflow-root .
```

After `run complete`: re-infer lifecycle and surface the natural next step as a continuation hint — stepwise multi-step work proceeds by re-invoking `/maestro-next` or `/maestro -c`.

For retained commands, output the exact slash command as a suggest-only result. Do not execute it, including under `-y`; the user invokes it explicitly in a subsequent message.

</actions>

</state_machine>

<presentation>

### --list mode

Group all 14 first-tier steps by cluster + show channels and retained commands:

```
Core Chain:  analyze → plan → execute → verify
Quality:     review, test, auto-test, debug, retrospective
Discovery:   grill, collab, brainstorm, blueprint, roadmap

Channels:
  /maestro-companion       — lightweight tasks (≤1-2 files, no artifact handoff)
  /maestro --engine manual — multi-step stepwise (per-step confirm, no gates)
  /maestro                 — multi-step orchestrated (decision nodes, drift, auto-retry)

Retained Commands (manual): /quality-refactor, /maestro-manage ..., /maestro-learn ..., /maestro-spec ..., /maestro-impeccable ...
```

### Normal mode

```
[⚠ Multi-step intent detected]   ← only when multi_step

Target: /<step-name>
Kind: first-tier step | retained command | companion | multi-step
  <description>
  Reason: <match rule + lifecycle position>
  Channel: /maestro-companion | single run | /maestro (manual) | /maestro (ralph)
  Invocation:
    companion       → /maestro-companion "<intent>"
    single run      → Confirm to execute through Maestro Run lifecycle
    multi-step      → /maestro "<intent>" (stepwise or orchestrated)
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
- **Hand off to /maestro** (Recommended) → `/maestro "<intent>"`
- **Just this step** (execute only the top pick as single run)
- **Cancel**

`--dry-run` / `--suggest`: display and stop.
`-y`: execute/route immediately per channel.

</presentation>

<error_codes>

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent empty after clarification | Provide intent or use --list |
| E002 | error | No steps found in registry | Check prepare/ and workflows/ directories |
| E003 | error | Selected step has no prepare/workflow files | Verify step installation |
| W001 | warning | Top-1 and top-2 scores too close | Force show top 3 for user decision |
| W002 | warning | No good match for intent | Suggest /maestro for orchestration |

</error_codes>
