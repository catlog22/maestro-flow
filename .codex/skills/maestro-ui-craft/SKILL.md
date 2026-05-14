---
name: maestro-ui-craft
description: Chain maestro-impeccable commands with intelligent routing and quality gate loops for automated UI production
argument-hint: "<intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [--skip-design-explore] [--skip-design] [--styles <N>] [--stack <stack>] [-y] [-c]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<purpose>
Orchestrate maestro-impeccable skill commands via intelligent intent routing + quality gate auto-iteration.
Chain: Build → Evaluate → Auto-Refine → Re-evaluate → Verify.

Core innovation: critique/audit scores drive automatic command selection and iteration loops.
maestro-impeccable has 24 commands across 6 categories -- this command chains them into automated pipelines
with quality gates that loop until design quality meets the threshold.

Includes integrated design-explore: delegates to `impeccable explore` for multi-variant design system generation,
HTML prototype rendering for visual comparison, and automatic bridge to DESIGN.md format.

Prerequisite: maestro-impeccable skill available (auto-discovered by harness).

Session: `.workflow/.maestro/ui-craft-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<invariants>
1. **Session before execution** -- status.json created before any chain step runs
2. **All steps via Skill** -- every impeccable command dispatched through `$maestro-impeccable`
3. **Gate scores drive loops** -- refine loop auto-selects commands from P0/P1 findings, never from hardcoded lists
4. **Interactive gates respected** -- teach, shape, craft retain their user gates; never suppress
</invariants>

<context>
$ARGUMENTS -- intent description or target path, with optional flags.

**Keywords:** `continue`/`next` → resume previous session

**Usage:**

```bash
$maestro-ui-craft "create a landing page"
$maestro-ui-craft "improve the dashboard" --chain improve
$maestro-ui-craft "add animations" --chain enhance --enhance animate
$maestro-ui-craft "production ready" --chain harden
$maestro-ui-craft -c                               # resume previous session
$maestro-ui-craft -y "create pricing page --chain build"
```

**Flags:**
- `--chain <type>` -- Force chain type: build, improve, enhance, harden, live
- `--enhance <cmd>` -- Specific enhance command (animate|colorize|typeset|layout|delight|overdrive|bolder)
- `--threshold <score>` -- Critique pass threshold (default: 26/40). Audit threshold auto-computed as threshold*0.5
- `--max-loops <n>` -- Maximum quality gate iterations (default: 3)
- `-c` / `--continue` -- Resume previous ui-craft session
- `-y` -- Auto mode: auto-select at ambiguous routing, skip confirmations where maestro-impeccable allows
- `--skip-design-explore` / `--skip-design` -- Skip design-explore (prototype comparison) and bridge (use existing DESIGN.md or full shape interview)
- `--styles <N>` -- Number of design system variants to generate (2-5, default 3). Only used in build chain design step
- `--stack <stack>` -- Tech stack for supplementary guidelines (default: html-tailwind). Passed to ui-search
</context>

<chains>

### Chain Definitions

| Chain | Sequence | Gate Condition |
|-------|----------|----------------|
| **build** | teach? → **design_explore?** → shape → craft → **critique** → [refine loop] → audit → polish | critique >= threshold AND P0 == 0 |
| **improve** | **critique** → [refine loop] → polish → audit | critique >= threshold AND P0 == 0 |
| **enhance** | {cmd} → **critique** → polish (if needed) | critique >= threshold |
| **harden** | harden → **audit** → polish | audit >= threshold*0.5 |
| **live** | live | -- (interactive, no gate) |

- `teach?` -- conditional: only if PRODUCT.md missing/placeholder
- `design_explore?` -- conditional: only if DESIGN.md missing AND `--skip-design-explore` not set. Delegates to `impeccable explore` which handles variant generation, prototype rendering, visual comparison, user selection/mix, AND bridge to DESIGN.md internally
- `[refine loop]` -- quality gate loop: extract suggested commands from critique → execute → re-critique

### Intent → Chain Routing

| Intent Pattern | Chain |
|---------------|-------|
| create, build, new, landing, feature, page | build |
| design, style, theme, visual, design system | build |
| improve, fix, iterate, better, optimize | improve |
| animate, color, type, bold, delight, enhance | enhance |
| production, harden, ship, edge case, i18n | harden |
| live, browser, variant | live |

Explicit `--chain` overrides routing. Ambiguous + no `-y` → `request_user_input`.

</chains>

<state_machine>

<states>
S_PARSE      -- parse args, intent classification, chain selection       PERSIST: --
S_RESUME     -- scan existing ui-craft sessions, resume execution         PERSIST: --
S_SETUP      -- load context, check PRODUCT.md                           PERSIST: --
S_CREATE     -- create session + status.json                              PERSIST: session (full)
S_DESIGN_EXPLORE -- delegate to impeccable explore: multi-variant generation, prototype comparison, selection/mix, auto bridge to DESIGN.md  PERSIST: explore_completed, design_md_path
S_CHAIN      -- execute chain steps in sequence                           PERSIST: step progress, executed commands
S_GATE       -- quality gate: parse scores, decide                        PERSIST: scores, loop count
S_REFINE     -- execute auto-selected refine commands                     PERSIST: refine commands, loop state
S_REPORT     -- final report + trend                                      PERSIST: final scores, status
</states>

<transitions>

S_PARSE:
  → S_RESUME     WHEN: -c / --continue flag OR keyword "continue"/"next"
  → S_SETUP      WHEN: chain selected (explicit or routed)
  → S_PARSE      WHEN: ambiguous AND not -y          DO: request_user_input
  → END          WHEN: no intent AND no target → E002

S_RESUME:
  → S_CHAIN      WHEN: session found                  DO: A_LOCATE_SESSION
  → END          WHEN: no session found → E005

S_SETUP:
  → S_CREATE     DO: A_LOAD_CONTEXT

S_CREATE:
  → S_CHAIN      DO: A_CREATE_SESSION

S_CHAIN:
  → S_DESIGN_EXPLORE  WHEN: current step is 'design_explore' AND DESIGN.md missing AND --skip-design-explore not set AND --skip-design not set
  → S_GATE       WHEN: current step is gate command (critique/audit)
  → S_CHAIN      WHEN: step is design_explore but skip conditions met → advance
  → S_CHAIN      WHEN: step is normal command → execute → advance
  → S_REPORT     WHEN: all steps complete

S_DESIGN_EXPLORE:
  → S_CHAIN      WHEN: explore completed (DESIGN.md produced) → advance to shape
  → S_CHAIN      WHEN: explore failed → W004 → advance to shape (full interview fallback)

S_GATE:
  → S_CHAIN      WHEN: PASS (score >= threshold AND P0 == 0) → advance
  → S_REFINE     WHEN: FAIL (score < threshold OR P0 > 0)
  → S_CHAIN      WHEN: max loops exceeded → W002 → force advance

S_REFINE:
  → S_GATE       DO: execute auto-selected commands → re-run gate command
                  GUARD: loop_count < max_loops

S_REPORT:
  → END          DO: A_FINAL_REPORT

</transitions>

<actions>

### A_LOCATE_SESSION

1. Scan `.workflow/.maestro/ui-craft-*/status.json`, filter `status == "running"`, sort DESC
2. Take most recent; load into context as current session
3. Resume from `current_step` position

### A_LOAD_CONTEXT

1. Trigger impeccable context loading: `$maestro-impeccable teach`
   - Impeccable's own setup auto-discovers and loads PRODUCT.md / DESIGN.md from `.workflow/impeccable/`
   - If PRODUCT.md missing/placeholder, impeccable teach handles the interview
2. If teach was not in the chain but PRODUCT.md is missing:
   - Prepend `teach` to chain start
   - Announce: W001
3. Context is now loaded for subsequent commands

### A_CREATE_SESSION

1. Read `.workflow/state.json` for project context (phase, milestone)
2. Create `.workflow/.maestro/ui-craft-{YYYYMMDD-HHmmss}/status.json`:
   ```json
   { "session_id": "ui-craft-{ts}", "source": "ui-craft", "intent": "...",
     "chain_type": "build|improve|enhance|harden|live", "target": "...",
     "auto_mode": false, "threshold": 26, "max_loops": 3,
     "steps": [{ "index": 0, "command": "shape", "status": "pending" }],
     "gate_history": [], "loop_count": 0,
     "current_step": 0, "status": "running",
     "created_at": "ISO-8601", "updated_at": "ISO-8601" }
   ```
3. Write status.json before executing any step

### A_DESIGN_EXPLORE

Delegate to impeccable explore as a black-box command. The explore command internally handles:
variant generation, prototype rendering, visual comparison, user review, mix protocol, rejected variant harvest, bridge to DESIGN.md, and spec registration.

1. Execute: `$maestro-impeccable explore --styles {styles_count}`
2. On completion: verify `.workflow/impeccable/DESIGN.md` exists
3. Update status.json: `explore_completed: true`, `design_md_path`

### A_FINAL_REPORT

1. Read critique trend if available (impeccable's critique persists snapshots automatically)
2. Update status.json with `status: "completed"` and final scores
3. Present summary table with scores, iterations, commands executed

</actions>

</state_machine>

<execution>

## 1. Parse & Route

1. If `-c` / `--continue` or keyword "continue"/"next" → S_RESUME
2. If `--chain` present → use directly
3. Otherwise → match $ARGUMENTS against intent patterns
4. If `--enhance` present → chain = enhance, cmd = --enhance value
5. For enhance chain without `--enhance` → infer from intent
6. Ambiguous + no `-y` → `request_user_input`:
   ```json
   { "questions": [{ "id": "chain_select", "header": "Chain", "question": "Which workflow?", "options": [
     { "label": "Build (Recommended)", "description": "New UI from scratch: shape → craft → critique → refine → audit" },
     { "label": "Improve", "description": "Iterate existing: critique → refine → polish → audit" },
     { "label": "Enhance", "description": "Targeted improvement: specific command → critique → polish" },
     { "label": "Harden", "description": "Production-ready: harden → audit → polish" }
   ]}] }
   ```

## 2. Setup Context

1. If chain starts with `teach` → execute it first, maestro-impeccable handles context loading internally
2. Otherwise → invoke `$maestro-impeccable` with no args to trigger setup (context + register)
3. If maestro-impeccable reports PRODUCT.md missing → prepend teach, execute, then resume

## 3. Create Session

Write `.workflow/.maestro/ui-craft-{ts}/status.json` with chain steps before any execution.

## 4. Execute Chain

For each step in chain, sequentially:

```
Step {n}/{total}: $maestro-impeccable {command} {target}
```

After each step: update status.json `current_step` and step `status`.

**Step-specific logic:**

### 4a. Design-explore step (build chain only)

When current step is `design_explore`:

1. Check if `.workflow/impeccable/DESIGN.md` already exists → skip, advance to shape
2. Check if `--skip-design-explore` or `--skip-design` is set → skip, advance to shape
3. Otherwise → execute A_DESIGN_EXPLORE:
   - `$maestro-impeccable explore --styles {styles_count}`
   - explore handles everything internally: variant generation, prototype rendering, visual comparison, user selection/mix, bridge to DESIGN.md, spec registration
4. On completion → verify DESIGN.md exists, advance to shape
5. On failure → W004, advance to shape (full interview fallback, no DESIGN.md)

### 4c. Normal steps

- `teach`, `shape`, `craft` are interactive -- do NOT suppress their user gates
- After `teach` completes → re-run context loader for fresh PRODUCT.md
- After `craft` completes → the build exists, ready for evaluation
- Gate steps (critique/audit) → transition to quality gate logic (Section 5)

## 5. Quality Gate

When chain reaches a gate step (critique or audit):

### 5a. Execute Gate Command

```
$maestro-impeccable critique {target}
```
or
```
$maestro-impeccable audit {target}
```

### 5b. Parse Score

From critique output, extract:
- **score**: Nielsen's total (N/40) -- from "**Total** | | **N/40**" row
- **P0_count**: count of `[P0]` tagged findings
- **P1_count**: count of `[P1]` tagged findings
- **suggested_commands**: list of "$maestro-impeccable <cmd>" from "Suggested command" fields

From audit output, extract:
- **score**: dimension total (N/20) -- from "**Total** | | **N/20**" row
- **P0_count**: count of `[P0]` findings

### 5c. Evaluate

```
critique_pass = (score >= threshold) AND (P0_count == 0)
audit_pass    = (score >= threshold * 0.5) AND (P0_count == 0)
```

### 5d. On PASS

→ advance to next chain step

### 5e. On FAIL

1. Collect suggested commands from P0/P1 findings
2. If no suggestions found → use fallback mapping (see quality_gate_routing)
3. De-duplicate, cap at 3 commands per iteration
4. Sort: P0-suggested first
5. Execute each: `$maestro-impeccable {cmd} {target}`
6. Re-run gate command (critique/audit)
7. Increment loop_count
8. Append to status.json `gate_history`

### 5f. On Max Loops Exceeded

→ force advance to next chain step with warning

## 6. Final Report

Present summary: chain type, critique score with trend, audit score, loop count, commands executed, pass/partial status.

Update status.json: `status: "completed"`, `final_scores`, `completed_at`.

If issues remain → suggest: "Run `$maestro-ui-craft --chain improve {target}` to continue iteration."

</execution>

<quality_gate_routing>

### Finding → Command Fallback Mapping

When critique/audit findings lack explicit "Suggested command", map by category:

| Finding Category | Command |
|-----------------|---------|
| Visual hierarchy, layout, spacing, alignment | layout |
| Color, contrast, palette, monochromatic | colorize |
| Typography, font, readability, hierarchy | typeset |
| Animation, motion, transitions, micro-interaction | animate |
| Copy, labels, error messages, UX writing | clarify |
| Responsive, mobile, breakpoints, touch targets | adapt |
| Performance, loading, speed, bundle, jank | optimize |
| Complexity, overload, clutter, cognitive load | distill |
| Bland, safe, generic, lacks personality | bolder |
| Aggressive, overwhelming, loud, overstimulating | quieter |
| Onboarding, empty state, first-run, activation | onboard |
| Edge cases, i18n, error handling, overflow | harden |
| Personality, memorability, joy, delight | delight |

### Commands Never Auto-Selected

| Command | Reason |
|---------|--------|
| teach | Project setup (run in S_SETUP only) |
| shape | Requires user interview |
| craft | Full build with multiple gates |
| live | Interactive browser mode |
| document | Generates DESIGN.md (setup) |
| extract | Design system extraction (setup) |
| overdrive | Requires explicit user vision |
| critique | Gate command, not a fix |
| audit | Gate command, not a fix |
| explore | Design system exploration (setup, has own user interaction) |

</quality_gate_routing>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | maestro-impeccable skill not found |
| E002 | error | No intent or target specified |
| E003 | error | Invalid --chain type |
| E004 | error | Invalid --enhance command |
| E005 | error | Resume session not found |
| W001 | warning | PRODUCT.md missing, prepending teach to chain |
| W002 | warning | Max quality gate loops exceeded, forcing continue |
| W003 | warning | Could not parse score from critique/audit output |
| E006 | error | Python 3 not available for design system generation |
| E007 | error | ui-search scripts not found at expected path |
| W004 | warning | Design system generation failed, skipping design+bridge |
| W005 | warning | Bridge transformation failed, continuing without DESIGN.md |
| W008 | warning | Node.js not available for prototype rendering, falling back to text-only variant comparison |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain type selected
- [ ] Context loaded (PRODUCT.md present or taught)
- [ ] Session dir created with status.json before execution
- [ ] All chain steps executed via $maestro-impeccable
- [ ] Quality gate evaluated with parsed scores
- [ ] Refine loop executed when gate failed (if applicable)
- [ ] Gate history and scores persisted to status.json
- [ ] Final report with scores and trend presented
</success_criteria>
