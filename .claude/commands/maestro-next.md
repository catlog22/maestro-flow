---
name: maestro-next
disable-model-invocation: false
description: "Primary default entry for development intents — score intent + project state, recommend one atomic step, execute after confirmation. Multi-step intents use a user-confirmed manual-engine chain or hand off to /maestro"
argument-hint: "<intent>|--list|--suggest [-y] [--dry-run]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Default interactive entry for development intents. Parse intent + project state → score candidates from the step registry → assess complexity → route to the appropriate channel:
- **Companion** (lightweight): execute directly with any tools, continuously record to `{run_dir}/evidence/` — minimal run lifecycle (create + complete only)
- **Standard** (single run): recommend a step → confirm → execute via `maestro run prepare` + `maestro run create`
- **Multi-step**: user-confirmed manual-engine chain, stepwise, or handoff to /maestro

Also provides companion utilities: structured note recording (--note) and insight promotion (--promote). Never auto-orchestrates.
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
| `--note <text>` | Append a structured note to the active run's evidence log |
| `--promote` | Interactively promote run insights to spec/knowhow |
| `--lite` | Force companion channel: full task execution with minimal run lifecycle (create + complete), continuous recording |
| `--run` | Force standard channel (create a run even for simple tasks) |
| `--chain` | Force manual-engine chain creation for a multi-step intent (skip detection, go straight to S_CHAIN_CREATE) |

**Mode detection (priority order):**
1. `--note` → S_NOTE (companion note mode)
2. `--promote` → S_PROMOTE (companion promote mode)
3. `--lite` → S_COMPANION_CTX (companion channel: direct execution + recording)
4. `--chain` → S_CHAIN_CREATE (build a manual-engine chain from the intent)
5. `--suggest` → S_RANK → S_PRESENT (suggest only, never execute)
6. `--list` → S_LIST
7. Active manual-engine chain with pending steps AND intent empty/"continue" → S_CHAIN_CONT
8. Intent text present → S_STATE → S_RANK → S_COMPANION_CTX (lightweight) | S_PRESENT (standard/multi-step)
9. No arguments → lifecycle inference for natural next step

**Candidate pool:** All 15 first-tier steps registered in `prepare/` + `workflows/`. Pipeline orchestrators (`maestro`, `maestro-ralph*`) are NEVER in the candidate pool.
</context>

<invariants>
1. **No auto-orchestration** — chains only via explicit user confirmation, always `--engine manual`, never auto-dispatched. Every chain step requires per-step confirmation; with `-y` execute the current step only, then stop with a continuation hint — never walk the chain unattended. Chain state lives in session.json and is written via CLI verbs only (`run next` / `run complete --verdict`) — never written directly
2. **Pipeline orchestrators excluded** — only recommend registered steps
3. **Empty intent or "continue"/"next"** → lifecycle_position inference for natural next step
4. **Literal match priority** — keyword match takes precedence; lifecycle is tie-breaker
5. **Argument pass-through** — intent text becomes first arg to target step; user can modify at confirmation; `-y` only passes through when user provided it
6. **--suggest never executes** — show recommendation + prepare content only
7. **--note is append-only** — never overwrite or reorder existing entries
8. **--promote delegates** — spec/knowhow promotion routes through `maestro-spec add` / `maestro-manage knowledge capture`, never writes directly
9. **Manual campaigns excluded** — `team-*` and `maestro-odyssey` are never candidates, recommendations, retained utilities, chain steps, or handoff targets
10. **Retained commands are suggest-only** — route retained commands to an exact slash command. Never execute them in this turn; `-y` applies only to first-tier steps
11. **Companion channel is minimal-run** — single Run in a chainless Session, skipping prepare/brief/check. Only `run create` + `run complete` lifecycle verbs apply. Execution recording goes to `{run_dir}/evidence/companion-log.md` (non-formal, never enters gates). No contract enforcement (consumes/produces/gates all empty)
</invariants>

<state_machine>

<states>
S_PARSE     — Parse arguments, extract flags, detect mode
S_NOTE      — Append structured note to active companion doc
S_PROMOTE   — Review companion/run outputs, promote insights to spec/knowhow
S_CHAIN_CREATE — Compose chain definition from intent → create manual-engine session → step
S_CHAIN_CONT   — Resume active manual-engine chain: show progress, advance the queue head
S_CHAIN_STEP   — One chain step: `run next` → confirm → execute → `run complete --verdict`
S_STATE     — Read project state, infer lifecycle_position
S_RANK      — Score candidates, assess complexity, generate top-N
S_LIST      — --list mode: grouped display of all steps
S_PRESENT   — Show top pick + alternatives + reasoning + prepare content
S_CONFIRM   — [@ask] AskUserQuestion for confirmation (skipped by -y)
S_EXECUTE   — Run prepare + create for selected step
S_FALLBACK  — Intent empty after clarification

--- Companion sub-workflow (minimal-run execution channel) ---
S_COMPANION_CTX  — Create minimal run (`run create companion`), load context, open evidence log
S_COMPANION_EXEC — Execute the task directly (any tool, any action); record each meaningful step to {run_dir}/evidence/companion-log.md
S_COMPANION_SEAL — `run complete`, summarize outcome, offer optional promote to spec/knowhow
</states>

<transitions>

S_PARSE:
  → S_NOTE           WHEN: --note flag
  → S_PROMOTE        WHEN: --promote flag
  → S_COMPANION_CTX  WHEN: --lite flag
  → S_CHAIN_CREATE   WHEN: --chain flag
  → S_LIST           WHEN: --list flag
  → S_CHAIN_CONT     WHEN: active manual-engine chain has pending steps AND intent empty/"continue"
  → S_STATE          WHEN: intent present / "continue"/"next"/"go"
  → S_PARSE          WHEN: no intent (1 clarify round via [@ask] AskUserQuestion)
  → S_FALLBACK       WHEN: clarification empty

S_NOTE:
  → END          DO: append entry to active run's `{run_dir}/evidence/companion-log.md`

S_PROMOTE:
  → END          DO: review outputs → suggest `/maestro-spec add ...` / `/maestro-manage knowledge capture ...` after explicit user confirmation

S_CHAIN_CREATE:
  → S_CHAIN_STEP WHEN: user confirms the chain definition    DO: A_CREATE_CHAIN
  → END          WHEN: user cancels

S_CHAIN_CONT:
  → S_CHAIN_STEP WHEN: pending steps remain    DO: show chain progress (step k/n)
  → END          WHEN: chain exhausted → completion summary

S_CHAIN_STEP:
  → S_CHAIN_STEP WHEN: step completed AND user confirms "Continue next step"
  → END          WHEN: user stops / -y single step done / chain exhausted
  DO: A_STEP_CHAIN

S_STATE:
  → S_RANK       DO: A_INFER_LIFECYCLE

S_RANK:
  → S_COMPANION_CTX  WHEN: complexity == lightweight AND no --run override    DO: A_SCORE_CANDIDATES
  → S_PRESENT        WHEN: complexity >= standard OR multi_step               DO: A_SCORE_CANDIDATES

S_LIST:
  → END          DO: group steps by cluster, display with descriptions

S_PRESENT:
  → END          WHEN: target_kind == retained-command    DO: display exact slash command; suggest only, NEVER auto-execute (`-y` does not override)
  → END          WHEN: --dry-run OR --suggest
  → S_EXECUTE    WHEN: -y
  → S_CONFIRM    WHEN: interactive

S_CONFIRM:
  → S_EXECUTE      WHEN: user confirms / selects alternative / modifies args
  → S_CHAIN_CREATE WHEN: multi_step AND user picks "Create a manual chain"
  → END            WHEN: user cancels

S_EXECUTE:
  → END          DO: A_EXECUTE_STEP

S_FALLBACK:
  → END          DO: raise E001

--- Companion sub-workflow transitions ---

S_COMPANION_CTX:
  → S_COMPANION_EXEC   DO: A_COMPANION_CTX (run create, load context, init evidence log)

S_COMPANION_EXEC:
  → S_COMPANION_EXEC   WHEN: task has more actions remaining    DO: execute next action + A_COMPANION_RECORD
  → S_COMPANION_SEAL   WHEN: task complete                      DO: A_COMPANION_RECORD (final entry)

S_COMPANION_SEAL:
  → END          DO: A_COMPANION_SEAL (run complete + summarize + optional promote offer)

</transitions>

<actions>

### A_INFER_LIFECYCLE

Read project state to infer `lifecycle_position`:

```bash
maestro run prepare --workflow-root .   # check if prepare command works
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

**Multi-step detection:** intent matches keywords of ≥2 distinct steps in the routing table → set `multi_step`. Candidate pool unchanged — orchestrators stay excluded (invariant 2); the flag drives the advisory banner + `Channel: multi-step` in S_PRESENT, offering three continuation modes: a user-confirmed manual-engine chain (S_CHAIN_CREATE), stepwise without a chain, or handoff to /maestro.

**Intent routing table:** first-tier rows enter the executable candidate pool. Retained-command rows are advisory routes: show the exact slash command and stop.

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

**Auxiliary workflow clusters:**

| Cluster | Trigger | Chain |
|---------|---------|-------|
| Learning | New code / unknown module | maestro-learn follow → maestro-learn decompose → maestro-learn consult |
| Knowledge | Distill experience | maestro-manage knowledge harvest → maestro-manage knowledge capture → maestro-spec add |
| Issue | Defect management | maestro-manage issue discover → maestro-manage issue |

### A_EXECUTE_STEP

Non-chain path (standalone single run). Steps inside a manual-engine chain advance via A_STEP_CHAIN instead — never mix the two for one step.

For first-tier steps (those with prepare/ + workflows/ files):

```bash
# 1. Run prepare to get pre-task thinking content
maestro run prepare <step> --workflow-root .

# 2. LLM performs pre-task thinking using prepare content
#    Produces prep YAML (goal/approach/scope/risks/gates/reads)

# 3. Create run — always pass --session (ASCII slug) + --intent
maestro run create <step> --session YYYYMMDD-<step>-<topic> --intent "<short goal>" --workflow-root . [-- args...]
#    Returns: run_id, run_dir, upstream (alias→artifact), entry_gates, next (progressive hint)

# 4. Load the execution manual (follow the `next` hint from create)
maestro run brief <run_id> --workflow-root .
#    Returns: workflow content, run-mode summary, goal, gate status

# 5. LLM executes the workflow (core process)

# 6. Complete the run
maestro run complete <run_id> --workflow-root .
```

After `run complete`: re-infer lifecycle and surface the natural next step as a continuation hint — stepwise multi-step work proceeds by re-invoking `/maestro-next`.

For retained commands, output the exact slash command as a suggest-only result. Do not execute it, including under `-y`; the user invokes it explicitly in a subsequent message.

### A_CREATE_CHAIN

1. Compose 2-5 steps from the routing-table hits, ordered by the lifecycle main line; `command` values limited to first-tier steps.
2. Present the chain for confirmation (ordered step list + intent). User can drop/reorder steps before creation.
3. Create the session — chain definition JSON via stdin, slug per run-mode convention (`YYYYMMDD-next-<topic>`, ASCII ≤64):

```bash
echo '{"intent":"<phrase>","steps":[{"command":"plan"},{"command":"execute"},{"command":"test"}]}' \
  | maestro session create YYYYMMDD-next-<topic> --chain-file - --engine manual --intent "<phrase>" --workflow-root .
```

4. Capture the returned `session_id`. Leave the lease unset — interactive sessions stay unlocked. Proceed to S_CHAIN_STEP.

### A_STEP_CHAIN

1. `maestro run next --session <session_id> --workflow-root .` — the birth packet carries `run_id` / `run_dir` / `upstream`. NEVER call `run create` for this step (birth-packet red line, run-mode.md).
2. Present the step + chain progress (`step k/n`) → [@ask] AskUserQuestion: **Execute** / **Skip this step** (`maestro session chain skip`) / **Modify step** (`maestro session chain replace`) / **Stop chain**.
3. Execute the workflow (re-attach context via `maestro run brief <run_id>` when needed), then `maestro run complete <run_id> --verdict done` — the chain step advances atomically.
4. Pending steps remain → offer **Continue next step** (loop to 1) or stop with a continuation hint (`/maestro-next` resumes the chain). With `-y`: execute the current step only, then stop with the hint — never walk the chain unattended.
5. No pending steps → chain completion summary (steps done/skipped, artifact paths).

### A_COMPANION_CTX

Entry point for the companion channel. Minimal-run: create + complete only, skip prepare/brief/check.

1. **Create minimal run** (chainless single-step session):
   ```bash
   maestro run create companion --session YYYYMMDD-companion-<topic> --intent "<intent>" --workflow-root .
   ```
   Returns: `run_id`, `run_dir`. No chain, no contract enforcement, no gates.

2. **Load context** (best-effort, non-blocking):
   ```bash
   maestro search "<intent keywords>" --type spec --type knowhow
   ```
   Load top 2-3 relevant entries. If nothing found, proceed without context.

3. **Initialize evidence log** at `{run_dir}/evidence/companion-log.md`:
   ```markdown
   # Companion Log: {intent summary}
   > run_id: {run_id} | session: {session_id}

   ## Context
   - {spec/knowhow entries loaded, or "none"}

   ## Work Log
   ```

4. Proceed to S_COMPANION_EXEC.

### A_COMPANION_RECORD

Append a timestamped entry to `{run_dir}/evidence/companion-log.md` under `## Work Log`. Called after each meaningful action during S_COMPANION_EXEC.

**Entry format:**
```markdown
### {HH:MM} — {action summary}
{what was done, what was found, what changed}
{files touched: path1, path2 (if any)}
```

**Recording rules:**
- One entry per meaningful action (file edit, command run, discovery, decision)
- Trivial reads (single file lookup) can be batched into one entry
- Never overwrite or reorder existing entries (invariant 7 applies)
- Keep entries concise: 1-5 lines each, focus on outcome not process
- Evidence dir is non-formal: never enters gates or artifact registry

### A_COMPANION_SEAL

Wrap up the companion run:

1. **Append outcome** to `{run_dir}/evidence/companion-log.md`:
   ```markdown
   ## Outcome
   **Status:** done | partial
   **Summary:** {1-2 sentence result}
   **Artifacts:** {files created/modified, or "none"}
   **Follow-up:** {suggested next step if any, or "none"}
   ```

2. **Complete the run**:
   ```bash
   maestro run complete <run_id> --verdict done --workflow-root .
   ```

3. **Optional promote offer** — if the work produced reusable insights (patterns, decisions, pitfalls):
   - Suggest: `/maestro-spec add <category> "title" "content"` or `/manage-knowhow-capture`
   - Only suggest, never auto-execute (invariant 8)

4. Display completion summary to user:
   ```
   Companion done. Run: {run_id} | Evidence: {run_dir}/evidence/companion-log.md
   Outcome: {summary}
   {promote suggestion if applicable}
   ```

</actions>

</state_machine>

<complexity_routing>

### Three-way complexity routing

Assess task complexity at S_RANK. The verdict determines the execution channel:

| Complexity | Channel | Criteria | Action |
|-----------|---------|----------|--------|
| Lightweight | Companion (minimal-run) | ≤1-2 files, no typed artifact handoff, no gate value, quick lookup/fix/exploration | Execute directly with any tools; record to `{run_dir}/evidence/` |
| Standard | Single step (one run) | Produces typed artifacts, needs downstream handoff or gate checks | prepare → create → brief → complete |
| Multi-step | Chain or stepwise | Intent spans ≥2 distinct steps | User-confirmed manual-engine chain (S_CHAIN_CREATE), stepwise, or hand off to `/maestro` |

**Companion channel capabilities:** The companion channel can do anything the LLM can do — read/write files, run commands, search code, edit code. It is NOT limited to knowledge loading. Protocol overhead is minimal: one `run create` + one `run complete`, with continuous recording to `{run_dir}/evidence/companion-log.md` (invariant 11). This preserves the original companion value: small tasks don't carry full lifecycle cost (no prepare/brief/check/gates).

**Routing preference: prefer Standard over Lightweight.** When uncertain, create a run. A run with a thin report is better than a missed artifact. Companion is chosen only when there is clearly no handoff value.

**Lightweight signals (all must hold):**
- Intent involves ≤1-2 files or is a pure lookup/question
- No typed artifact needs to be consumed by a downstream step
- No gate/verdict needs to be recorded for lifecycle tracking
- Task can complete in a single conversational turn or a few tool calls

**Override flags:**
- `--lite` forces Companion channel regardless of complexity assessment
- `--run` forces Standard channel (single run) regardless of complexity assessment
- Neither flag: auto-detect from the signals above; verdict shown to user before execution

</complexity_routing>

<presentation>

### --list mode

Group all 15 first-tier steps by cluster + show retained commands separately with their slash invocation form. Do not list `team-*` or `maestro-odyssey`:

```
Core Chain:  analyze → plan → execute → verify
Quality:     review, test, auto-test, debug, retrospective
Discovery:   grill, collab, brainstorm, blueprint, roadmap, quick

Retained Commands (manual): /quality-refactor, /maestro-manage ..., /maestro-learn ..., /maestro-spec ..., /maestro-impeccable ...
```

### Normal mode

```
[⚠ Multi-step intent — create a manual chain, take just the first step, or hand off to /maestro "<intent>"]   ← only when multi_step

Target: /<step-name>
Kind: first-tier step | retained command
  <description>
  Reason: <match rule + lifecycle position>
  Channel: companion (minimal-run) | single run | multi-step (stepwise / chain)
  Invocation:
    first-tier step → Confirm to execute through Maestro Run lifecycle
    retained command → Run manually: /<command> <subcommand> <args> (suggest only; not executed now)

Alternatives:
  2. /<alt-1> — <description> — <invocation method>
  3. /<alt-2> — <description> — <invocation method>

Args: <args>
```

When `multi_step`: the executable recommendation stays the best first step, and the confirmation menu becomes three-way — **Create a manual chain** (Recommended; → S_CHAIN_CREATE), **Just this step** (stepwise; lifecycle inference recommends the follow-up), **Hand off to /maestro**.

`--dry-run` / `--suggest`: display and stop.
`-y`: execute immediately.
Otherwise: [@ask] AskUserQuestion (single-select, header: "Confirm"):
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
| E004 | error | Multiple running manual chains, ambiguous resolution | Pass --session <id> explicitly (`run next` lists candidates) |
| W001 | warning | Top-1 and top-2 scores too close | Force show top 3 for user decision |
| W002 | warning | No good match for intent | Suggest /maestro or /maestro-ralph for orchestration |
| W003 | warning | Chain step skipped or replaced | Recorded in chain (status=skipped); remaining steps unaffected |

</error_codes>
