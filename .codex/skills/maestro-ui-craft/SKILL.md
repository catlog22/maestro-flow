---
name: maestro-ui-craft
description: Chain maestro-impeccable commands with intelligent routing and quality gate loops for automated UI production
argument-hint: "<intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [--skip-design] [--styles <N>] [--stack <stack>] [-y] [-c]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, request_user_input
---
<purpose>
Orchestrate maestro-impeccable skill commands via intelligent intent routing + quality gate auto-iteration.
Chain: Build → Evaluate → Auto-Refine → Re-evaluate → Verify.

Core innovation: critique/audit scores drive automatic command selection and iteration loops.
maestro-impeccable has 23 commands across 6 categories -- this command chains them into automated pipelines
with quality gates that loop until design quality meets the threshold.

Includes integrated design system generation (via ui-search BM25 engine + CSV knowledge base)
with automatic bridge to impeccable's DESIGN.md format. Replaces the former maestro-ui-design command.

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
- `--skip-design` -- Skip design system generation and bridge (use existing DESIGN.md or full shape interview)
- `--styles <N>` -- Number of design system variants to generate (2-5, default 3). Only used in build chain design step
- `--stack <stack>` -- Tech stack for supplementary guidelines (default: html-tailwind). Passed to ui-search
</context>

<chains>

### Chain Definitions

| Chain | Sequence | Gate Condition |
|-------|----------|----------------|
| **build** | teach? → **design?** → **bridge?** → shape → craft → **critique** → [refine loop] → audit → polish | critique >= threshold AND P0 == 0 |
| **improve** | **critique** → [refine loop] → polish → audit | critique >= threshold AND P0 == 0 |
| **enhance** | {cmd} → **critique** → polish (if needed) | critique >= threshold |
| **harden** | harden → **audit** → polish | audit >= threshold*0.5 |
| **live** | live | -- (interactive, no gate) |

- `teach?` -- conditional: only if PRODUCT.md missing/placeholder
- `design?` -- conditional: only if DESIGN.md missing AND `--skip-design` not set
- `bridge?` -- conditional: only if design step ran (MASTER.md produced but no DESIGN.md yet)
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
S_DESIGN     -- design system generation (ui-search BM25 + CSV)           PERSIST: variants, selection
S_BRIDGE     -- MASTER.md → DESIGN.md format conversion                   PERSIST: bridge status
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
  → S_DESIGN     WHEN: current step is 'design' AND DESIGN.md missing AND --skip-design not set
  → S_BRIDGE     WHEN: current step is 'bridge' AND design step produced MASTER.md
  → S_GATE       WHEN: current step is gate command (critique/audit)
  → S_CHAIN      WHEN: step is design/bridge but skip conditions met → advance
  → S_CHAIN      WHEN: step is normal command → execute → advance
  → S_REPORT     WHEN: all steps complete

S_DESIGN:
  → S_BRIDGE     WHEN: design system generated (MASTER.md ready)     DO: A_GENERATE_DESIGN_SYSTEM
  → S_CHAIN      WHEN: generation failed → W004 → skip bridge        DO: advance to shape

S_BRIDGE:
  → S_CHAIN      WHEN: DESIGN.md written → advance to shape          DO: A_BRIDGE_TO_DESIGN_MD
  → S_CHAIN      WHEN: bridge failed → W005 → continue without       DO: advance to shape

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

### A_GENERATE_DESIGN_SYSTEM

1. Read `.workflow/impeccable/PRODUCT.md`, extract: register, brand_personality, anti_references, industry
2. Resolve script: `workflows/impeccable/ui-search/search.py` (project-local) or `~/.maestro/workflows/impeccable/ui-search/search.py` (installed)
3. Verify Python available (E006 if not), script exists (E007 if not)
4. Read deferred: `~/.maestro/workflows/impeccable/design.md`, execute Phase A (variant generation + selection)
5. Persist selected variant to `.workflow/impeccable/design-system/{project}/MASTER.md`
6. Update status.json with design selection metadata

### A_BRIDGE_TO_DESIGN_MD

1. Read deferred: `~/.maestro/workflows/impeccable/design.md`, execute Phase B (bridge transformation)
2. Transform MASTER.md → `.workflow/impeccable/DESIGN.md` (Google Stitch format with YAML frontmatter + 6 canonical sections)
3. Register: `maestro spec add ui "Design System: {project}" "{style_name}" --keywords design,colors,typography --ref .workflow/impeccable/DESIGN.md`
4. Refresh: `maestro impeccable load-context`

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

### 4a. Design step (build chain only)

When current step is `design`:

1. Check if `.workflow/impeccable/DESIGN.md` already exists → skip design + bridge, advance to shape
2. Check if `--skip-design` is set → skip design + bridge, advance to shape
3. Otherwise → execute A_GENERATE_DESIGN_SYSTEM:
   - Read `.workflow/impeccable/PRODUCT.md` for register, brand personality, anti-references, industry
   - Resolve `workflows/impeccable/ui-search/search.py` (project-local) or `~/.maestro/workflows/impeccable/ui-search/search.py` (installed)
   - Verify Python available (E006), script exists (E007)
   - Read deferred: `~/.maestro/workflows/impeccable/design.md`, execute **Phase A** (variant generation + selection)
   - Persist selected variant to `.workflow/impeccable/design-system/{project}/MASTER.md`
4. On failure → W004, skip bridge, advance to shape (full interview fallback)

### 4b. Bridge step (build chain only, after design)

When current step is `bridge`:

1. Check if design step was skipped or failed → skip bridge, advance to shape
2. Otherwise → execute A_BRIDGE_TO_DESIGN_MD:
   - Read deferred: `~/.maestro/workflows/impeccable/design.md`, execute **Phase B** (bridge transformation)
   - Transform MASTER.md → `.workflow/impeccable/DESIGN.md` (Google Stitch format: YAML frontmatter + 6 canonical sections)
   - Register via `maestro spec add ui`
   - Refresh via `maestro impeccable load-context`
3. On failure → W005, continue without DESIGN.md
4. After bridge completes → shape will auto-skip visual direction questions already answered by DESIGN.md

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
| design | Design system generation (setup) |
| bridge | Format bridging (setup) |

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
