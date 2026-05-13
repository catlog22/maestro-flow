---
name: maestro-ui-craft
description: Chain impeccable commands with intelligent routing and quality gate loops for automated UI production
argument-hint: "<intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, request_user_input
---
<purpose>
Orchestrate impeccable skill commands via intelligent intent routing + quality gate auto-iteration.
Chain: Build → Evaluate → Auto-Refine → Re-evaluate → Verify.

Core innovation: critique/audit scores drive automatic command selection and iteration loops.
Impeccable has 23 commands across 6 categories -- this command chains them into automated pipelines
with quality gates that loop until design quality meets the threshold.

Prerequisite: impeccable skill available (auto-discovered by harness).
</purpose>

<context>
$ARGUMENTS -- intent description or target path, with optional flags.

**Usage**:

```bash
$maestro-ui-craft "create a landing page"
$maestro-ui-craft "improve the dashboard" --chain improve
$maestro-ui-craft "add animations" --chain enhance --enhance animate
$maestro-ui-craft "production ready" --chain harden
$maestro-ui-craft -y "create pricing page --chain build"
```

**Flags:**
- `--chain <type>` -- Force chain type: build, improve, enhance, harden, live
- `--enhance <cmd>` -- Specific enhance command (animate|colorize|typeset|layout|delight|overdrive|bolder)
- `--threshold <score>` -- Critique pass threshold (default: 26/40). Audit threshold auto-computed as threshold*0.5
- `--max-loops <n>` -- Maximum quality gate iterations (default: 3)
- `-y` -- Auto mode: auto-select at ambiguous routing, skip confirmations where impeccable allows
</context>

<chains>

### Chain Definitions

| Chain | Sequence | Gate Condition |
|-------|----------|----------------|
| **build** | teach? → shape → craft → **critique** → [refine loop] → audit → polish | critique >= threshold AND P0 == 0 |
| **improve** | **critique** → [refine loop] → polish → audit | critique >= threshold AND P0 == 0 |
| **enhance** | {cmd} → **critique** → polish (if needed) | critique >= threshold |
| **harden** | harden → **audit** → polish | audit >= threshold*0.5 |
| **live** | live | -- (interactive, no gate) |

- `teach?` -- conditional: only if PRODUCT.md missing/placeholder
- `[refine loop]` -- quality gate loop: extract suggested commands from critique → execute → re-critique

### Intent → Chain Routing

| Intent Pattern | Chain |
|---------------|-------|
| create, build, new, landing, feature, page | build |
| improve, fix, iterate, better, optimize | improve |
| animate, color, type, bold, delight, enhance | enhance |
| production, harden, ship, edge case, i18n | harden |
| live, browser, variant | live |

Explicit `--chain` overrides routing. Ambiguous + no `-y` → `request_user_input`.

</chains>

<execution>

## 1. Parse & Route

1. If `--chain` present → use directly
2. Otherwise → match $ARGUMENTS against intent patterns
3. If `--enhance` present → chain = enhance, cmd = --enhance value
4. For enhance chain without `--enhance` → infer from intent
5. Ambiguous + no `-y` → `request_user_input`:
   ```json
   { "questions": [{ "id": "chain_select", "header": "Chain", "question": "Which workflow?", "options": [
     { "label": "Build (Recommended)", "description": "New UI from scratch: shape → craft → critique → refine → audit" },
     { "label": "Improve", "description": "Iterate existing: critique → refine → polish → audit" },
     { "label": "Enhance", "description": "Targeted improvement: specific command → critique → polish" },
     { "label": "Harden", "description": "Production-ready: harden → audit → polish" }
   ]}] }
   ```

## 2. Setup Context

1. If chain starts with `teach` → execute it first, impeccable handles context loading internally
2. Otherwise → invoke `$impeccable` with no args to trigger setup (context + register)
3. If impeccable reports PRODUCT.md missing → prepend teach, execute, then resume

## 3. Execute Chain

For each step in chain, sequentially:

```
Step {n}/{total}: $impeccable {command} {target}
```

**Rules:**
- `teach`, `shape`, `craft` are interactive -- do NOT suppress their user gates
- After `teach` completes → re-run context loader for fresh PRODUCT.md
- After `craft` completes → the build exists, ready for evaluation
- Gate steps (critique/audit) → transition to quality gate logic

## 4. Quality Gate

When chain reaches a gate step (critique or audit):

### 5a. Execute Gate Command

```
$impeccable critique {target}
```
or
```
$impeccable audit {target}
```

### 5b. Parse Score

From critique output, extract:
- **score**: Nielsen's total (N/40) -- from "**Total** | | **N/40**" row
- **P0_count**: count of `[P0]` tagged findings
- **P1_count**: count of `[P1]` tagged findings
- **suggested_commands**: list of "/impeccable <cmd>" from "Suggested command" fields

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
5. Execute each: `$impeccable {cmd} {target}`
6. Re-run gate command (critique/audit)
7. Increment loop_count

### 5f. On Max Loops Exceeded

→ force advance to next chain step with warning

## 5. Final Report

Present summary: chain type, critique score with trend, audit score, loop count, commands executed, pass/partial status.

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

</quality_gate_routing>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | Impeccable skill not found |
| E002 | error | No intent or target specified |
| E003 | error | Invalid --chain type |
| E004 | error | Invalid --enhance command |
| W001 | warning | PRODUCT.md missing, prepending teach to chain |
| W002 | warning | Max quality gate loops exceeded, forcing continue |
| W003 | warning | Could not parse score from critique/audit output |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain type selected
- [ ] Context loaded (PRODUCT.md present or taught)
- [ ] All chain steps executed via $impeccable
- [ ] Quality gate evaluated with parsed scores
- [ ] Refine loop executed when gate failed (if applicable)
- [ ] Final report with scores and trend presented
</success_criteria>
