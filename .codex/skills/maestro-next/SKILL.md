---
name: maestro-next
description: Single-step recommendation engine — route intent to the best next
  step, with companion utilities
argument-hint: <intent> [-y] [--dry-run] [--top N] [--list] [--suggest] [--note
  <text>] [--promote] [--lite]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
  - spawn_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.51
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Parse intent + project state → score candidates from the step registry → recommend a single atomic step → confirm → execute via `maestro run prepare --platform codex` + `maestro run create`. Also provides companion utilities: knowledge loading (--suggest), structured note recording (--note), and insight promotion (--promote).
Does not create chains or orchestrate multi-step sequences — that is maestro/ralph territory.
</purpose>

<context>
$ARGUMENTS — intent text + optional flags.

**Flags:**

| Flag | Effect |
|------|--------|
| `-y` / `--yes` | Skip confirmation, execute top pick directly |
| `--dry-run` | Show recommendation only, do not execute |
| `--top N` | Show top N candidates (default 3) |
| `--list` | List all available steps grouped by workflow cluster |
| `--suggest` | Suggest-only mode: show recommendation + prepare content, NEVER auto-execute |
| `--note <text>` | Append a structured note to the active run's companion doc |
| `--promote` | Interactively promote run insights to spec/knowhow |
| `--lite` | Force lightweight companion channel (zero-run, knowledge load only) |
| `--run` | Force standard channel (create a run even for simple tasks) |

**Mode detection (priority order):**
1. `--note` → S_NOTE (companion note mode)
2. `--promote` → S_PROMOTE (companion promote mode)
3. `--lite` → S_LITE (companion lightweight channel)
4. `--suggest` → S_RANK → S_PRESENT (suggest only, never execute)
5. `--list` → S_LIST
6. Intent text present → S_STATE → S_RANK → S_PRESENT
7. No arguments → lifecycle inference for natural next step

**Candidate pool:** All 15 first-tier steps registered in `prepare/` + `workflows/`. Pipeline orchestrators (`maestro`, `maestro-ralph*`) are NEVER in the candidate pool.
</context>

<invariants>
1. **No chain creation** — single atomic step execution; orchestration belongs to maestro/ralph
2. **Pipeline orchestrators excluded** — only recommend registered steps
3. **Empty intent or "continue"/"next"** → lifecycle_position inference for natural next step
4. **Literal match priority** — keyword match takes precedence; lifecycle is tie-breaker
5. **Argument pass-through** — intent text becomes first arg to target step; user can modify at confirmation; `-y` only passes through when user provided it
6. **--suggest never executes** — show recommendation + prepare content only
7. **--note is append-only** — never overwrite or reorder existing entries
8. **--promote delegates** — spec/knowhow promotion routes through `spec add` / `manage knowledge capture`, never writes directly
</invariants>

<state_machine>

<states>
S_PARSE     — Parse arguments, extract flags, detect mode
S_LITE      — Lightweight companion: load specs + knowhow for the task, no run creation
S_NOTE      — Append structured note to active run companion doc
S_PROMOTE   — Review run outputs, promote insights to spec/knowhow
S_STATE     — Read project state, infer lifecycle_position
S_RANK      — Score candidates, generate top-N
S_LIST      — --list mode: grouped display of all steps
S_PRESENT   — Show top pick + alternatives + reasoning + prepare content
S_CONFIRM   — request_user_input for confirmation (skipped by -y)
S_EXECUTE   — Run prepare + create for selected step
S_FALLBACK  — Intent empty after clarification
</states>

<transitions>

S_PARSE:
  → S_NOTE       WHEN: --note flag
  → S_PROMOTE    WHEN: --promote flag
  → S_LITE       WHEN: --lite flag
  → S_LIST       WHEN: --list flag
  → S_STATE      WHEN: intent present / "continue"/"next"/"go"
  → S_PARSE      WHEN: no intent (1 clarify round via request_user_input)
  → S_FALLBACK   WHEN: clarification empty

S_LITE:
  → END          DO: load specs + knowhow → display summary → suggest next step (no run)

S_NOTE:
  → END          DO: append entry to {run_dir}/outputs/companion.md

S_PROMOTE:
  → END          DO: review outputs → Skill(spec, "add") / Skill(manage, "knowledge capture") for each insight

S_STATE:
  → S_RANK       DO: A_INFER_LIFECYCLE

S_RANK:
  → S_PRESENT    DO: A_SCORE_CANDIDATES

S_LIST:
  → END          DO: group steps by cluster, display with descriptions

S_PRESENT:
  → END          WHEN: --dry-run OR --suggest
  → S_EXECUTE    WHEN: -y
  → S_CONFIRM    WHEN: interactive

S_CONFIRM:
  → S_EXECUTE    WHEN: user confirms / selects alternative / modifies args
  → END          WHEN: user cancels

S_EXECUTE:
  → END          DO: A_EXECUTE_STEP

S_FALLBACK:
  → END          DO: raise E001

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

**Intent → step routing table (candidate pool):**

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
| quick / small / ad-hoc / one-off / trivial | quick | Shortened pipeline for small tasks, preserving atomic commits and state tracking |
| retrospective / retro / lessons learned / post-mortem / reflect | retrospective | Post-phase four-lens review (technical/process/quality/decision) → spec/knowhow/issue routing |
| grill / pressure test / stress test | grill | Socratic pressure-test of a plan/idea against codebase reality — adversarial questioning, terminology collision checks |
| collab / cross-verify / multi-tool / second opinion | collab | Fan out one requirement to multiple CLI tools, cross-verify findings into a unified conclusion |
| refactor / tech debt | quality-refactor (retained skill) | — |
| sync docs | manage sync codebase (retained skill) | — |
| issue / defect | manage issue (retained skill) | — |
| wiki / knowledge graph | manage knowledge wiki (retained skill) | — |
| spec / rule / constraint | spec load / spec add (retained skill) | — |
| init / project setup | maestro-init (retained skill) | — |
| status / dashboard | manage status (retained skill) | — |
| security / OWASP | security-audit (retained skill) | — |
| learn / explore code / follow | learn follow / learn investigate (retained skill) | — |
| harvest / extract knowledge | manage knowledge harvest (retained skill) | — |
| fork / parallel dev | maestro-fork (retained skill) | — |

**Auxiliary workflow clusters:**

| Cluster | Trigger | Chain |
|---------|---------|-------|
| Learning | New code / unknown module | learn follow → learn decompose → learn consult |
| Knowledge | Distill experience | manage knowledge harvest → manage knowledge capture → spec add |
| Issue | Defect management | manage issue discover → manage issue |

### A_EXECUTE_STEP

For first-tier steps (those with prepare/ + workflows/ files):

```bash
# 1. Run prepare to get pre-task thinking content
maestro run prepare --platform codex <step> --workflow-root .

# 2. LLM performs pre-task thinking using prepare content
#    Produces prep YAML (goal/approach/scope/risks/gates/reads)

# 3. Create run — always pass --session (ASCII slug) + --intent
maestro run create <step> --session YYYYMMDD-<step>-<topic> --intent "<short goal>" --workflow-root . [-- args...]
#    Returns: run_id, run_dir, upstream (alias→artifact), entry_gates, next (progressive hint)

# 4. Load the execution manual (follow the `next` hint from create)
maestro run brief --platform codex <run_id> --workflow-root .
#    Returns: workflow content, run-mode summary, goal, gate status

# 5. LLM executes the workflow (core process)

# 6. Complete the run
maestro run complete <run_id> --workflow-root .
```

For retained skills (not in step registry): execute via `Skill({ skill: <name>, args: <args> })` directly.

</actions>

</state_machine>

<complexity_routing>

### Three-way complexity routing

Before executing, assess task complexity to choose the right channel:

| Complexity | Channel | Criteria | Action |
|-----------|---------|----------|--------|
| Lightweight | Companion (zero-run) | Simple lookup, quick question, knowledge check | Load specs/knowhow, answer directly, no run created |
| Standard | Single step (one run) | Clear atomic task matching one step | prepare → create → brief → complete |
| Multi-step | Recommend chain | Task spans multiple steps or needs orchestration | Recommend `/maestro` or `/maestro-ralph` instead |

**Routing preference: prefer Standard over Lightweight.** When uncertain, create a run. A run with a thin report is better than a missed artifact.

**Override flags:**
- `--lite` forces Lightweight (companion channel)
- `--run` forces Standard (single run)
- Neither flag: auto-detect from intent complexity

</complexity_routing>

<presentation>

### --list mode

Group all 15 first-tier steps by cluster + show retained skills separately:

```
Core Chain:  analyze → plan → execute → verify
Quality:     review, test, auto-test, debug, retrospective
Discovery:   grill, collab, brainstorm, blueprint, roadmap, quick

Retained Skills: quality-refactor, manage sync codebase, manage-*, learn-*, spec-*, ...
```

### Normal mode

```
Target: /<step-name>
  <description>
  Reason: <match rule + lifecycle position>

Alternatives:
  2. /<alt-1> — <description>
  3. /<alt-2> — <description>

Args: <args>
```

`--dry-run` / `--suggest`: display and stop.
`-y`: execute immediately.
Otherwise: request_user_input (single-select, header: "Confirm"):
- **Execute recommendation** (Recommended)
- **Choose alternative**
- **Modify arguments**
- **Cancel**

</presentation>

<error_codes>

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Intent empty after clarification | Provide intent or use --list |
| E002 | error | No steps found in registry | Check prepare/ and workflows/ directories |
| E003 | error | Selected step has no prepare/workflow files | Verify step installation |
| W001 | warning | Top-1 and top-2 scores too close | Force show top 3 for user decision |
| W002 | warning | No good match for intent | Suggest /maestro or /maestro-ralph for orchestration |

</error_codes>
