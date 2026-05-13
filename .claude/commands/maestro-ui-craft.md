---
name: maestro-ui-craft
description: Chain maestro-impeccable commands with intelligent routing and quality gate loops for automated UI production
argument-hint: "<intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y] [-c]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - Skill
  - AskUserQuestion
  - TodoWrite
---
<purpose>
Orchestrate maestro-impeccable skill commands via intelligent intent routing + quality gate auto-iteration.
Chain: Build → Evaluate → Auto-Refine → Re-evaluate → Verify.

Core innovation: critique/audit scores drive automatic command selection and iteration loops.
Impeccable has 23 commands across 6 categories — this command chains them into automated pipelines
with quality gates that loop until design quality meets the threshold.

Prerequisite: maestro-impeccable skill available (auto-discovered by harness).

Session: `.workflow/.maestro/ui-craft-{YYYYMMDD-HHmmss}/status.json`
</purpose>

<invariants>
1. **Session before execution** — status.json created before any chain step runs
2. **All steps via Skill** — every impeccable command dispatched through `Skill({ skill: "maestro-impeccable" })`
3. **Gate scores drive loops** — refine loop auto-selects commands from P0/P1 findings, never from hardcoded lists
4. **Interactive gates respected** — teach, shape, craft retain their user gates; never suppress
</invariants>

<context>
$ARGUMENTS — intent description or target path, with optional flags.

**Keywords:** `continue`/`next` → resume previous session

**Flags:**
- `--chain <type>` — Force chain type: build, improve, enhance, harden, live
- `--enhance <cmd>` — Specific enhance command for enhance chain (animate|colorize|typeset|layout|delight|overdrive|bolder)
- `--threshold <score>` — Critique pass threshold (default: 26/40). Audit threshold auto-computed as threshold×0.5
- `--max-loops <n>` — Maximum quality gate iterations (default: 3)
- `-c` / `--continue` — Resume previous ui-craft session
- `-y` — Auto mode: auto-select at ambiguous routing, skip confirmations where impeccable allows
</context>

<chains>

### Chain Definitions

| Chain | Sequence | Gate Condition |
|-------|----------|----------------|
| **build** | teach? → shape → craft → **critique** → [refine loop] → audit → polish | critique ≥ threshold AND P0 == 0 |
| **improve** | **critique** → [refine loop] → polish → audit | critique ≥ threshold AND P0 == 0 |
| **enhance** | {cmd} → **critique** → polish (if needed) | critique ≥ threshold |
| **harden** | harden → **audit** → polish | audit ≥ threshold×0.5 |
| **live** | live | — (interactive, no gate) |

- `teach?` — conditional: only if PRODUCT.md missing/placeholder
- `[refine loop]` — quality gate loop: extract suggested commands from critique → execute → re-critique

### Intent → Chain Routing

| Intent Pattern | Chain |
|---------------|-------|
| 新建, create, build, new, 从零, landing, feature, page | build |
| 改进, improve, fix, 优化, iterate, better, 迭代 | improve |
| 动画, 颜色, 排版, animate, color, type, bold, delight, enhance | enhance |
| 生产, production, harden, 上线, ship, edge case, i18n | harden |
| 实时, live, browser, 浏览器, variant | live |

Explicit `--chain` overrides routing. Ambiguous + no `-y` → AskUserQuestion.

</chains>

<state_machine>

<states>
S_PARSE      — 解析参数、意图分类、chain 选择                PERSIST: —
S_RESUME     — 扫描已有 ui-craft session、恢复执行           PERSIST: —
S_SETUP      — 加载 context、检查 PRODUCT.md                PERSIST: —
S_CREATE     — 创建 session + status.json                    PERSIST: session (全量)
S_CHAIN      — 按序执行 chain 步骤                           PERSIST: step progress, executed commands
S_GATE       — 质量门控：解析评分、决策                       PERSIST: scores, loop count
S_REFINE     — 执行自动选取的 refine 命令                    PERSIST: refine commands, loop state
S_REPORT     — 最终报告 + 趋势                               PERSIST: final scores, status
</states>

<transitions>

S_PARSE:
  → S_RESUME     WHEN: -c / --continue flag OR keyword "continue"/"next"
  → S_SETUP      WHEN: chain selected (explicit or routed)
  → S_PARSE      WHEN: ambiguous AND not -y          DO: AskUserQuestion
  → END          WHEN: no intent AND no target → E002

S_RESUME:
  → S_CHAIN      WHEN: session found                  DO: A_LOCATE_SESSION
  → S_FALLBACK   WHEN: no session found → E005

S_SETUP:
  → S_CREATE     DO: A_LOAD_CONTEXT

S_CREATE:
  → S_CHAIN      DO: A_CREATE_SESSION

S_CHAIN:
  → S_GATE       WHEN: current step is gate command (critique/audit)
  → S_CHAIN      WHEN: step is normal command → execute → advance
  → S_REPORT     WHEN: all steps complete

S_GATE:
  → S_CHAIN      WHEN: PASS (score ≥ threshold AND P0 == 0) → advance to next step
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

1. Trigger impeccable context loading by invoking: `Skill({ skill: "maestro-impeccable", args: "teach" })`
   - Impeccable's own setup will auto-discover and load PRODUCT.md / DESIGN.md
   - If PRODUCT.md missing/placeholder, impeccable teach handles the interview
2. If teach was not in the chain but PRODUCT.md is missing:
   - Prepend `teach` to chain start
   - Announce: W001
3. Context is now in conversation for subsequent commands

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
5. For enhance chain without `--enhance` → infer from intent ("动画" → animate, "颜色" → colorize, etc.)
6. Ambiguous + no `-y` → ask user to pick chain

Create TodoWrite with chain steps.

## 2. Setup Context

1. If chain starts with `teach` → execute it first, impeccable handles context loading internally
2. Otherwise → invoke `Skill({ skill: "maestro-impeccable" })` with no args to trigger setup (context + register)
3. If impeccable reports PRODUCT.md missing → prepend teach, execute, then resume

## 3. Create Session

Write `.workflow/.maestro/ui-craft-{ts}/status.json` with chain steps before any execution.

## 4. Execute Chain

For each step in chain, sequentially:

```
▸ Step {n}/{total}: /maestro-impeccable {command} {target}
```

Execute via: `Skill({ skill: "maestro-impeccable", args: "{command} {target}" })`

After each step: update status.json `current_step` and step `status`.

**Rules:**
- `teach`, `shape`, `craft` are interactive — do NOT suppress their user gates
- After `teach` completes → re-run context loader for fresh PRODUCT.md
- After `craft` completes → the build exists, ready for evaluation
- Gate steps (critique/audit) → transition to quality gate logic

## 5. Quality Gate

When chain reaches a gate step (critique or audit):

### 5a. Execute Gate Command

```
Skill({ skill: "maestro-impeccable", args: "critique {target}" })
```
or
```
Skill({ skill: "maestro-impeccable", args: "audit {target}" })
```

### 5b. Parse Score

From critique output, extract:
- **score**: Nielsen's total (N/40) — from "**Total** | | **N/40**" row
- **P0_count**: count of `[P0]` tagged findings
- **P1_count**: count of `[P1]` tagged findings
- **suggested_commands**: list of "/maestro-impeccable <cmd>" from "Suggested command" fields

From audit output, extract:
- **score**: dimension total (N/20) — from "**Total** | | **N/20**" row
- **P0_count**: count of `[P0]` findings

### 5c. Evaluate

```
critique_pass = (score >= threshold) AND (P0_count == 0)
audit_pass    = (score >= threshold * 0.5) AND (P0_count == 0)
```

### 5d. On PASS

```
✓ Gate passed: {score}/{max} (P0: 0)
```
→ advance to next chain step

### 5e. On FAIL

```
⟳ Loop {n}/{max_loops}: {score}/{max}, P0={count}
  Running: {command_list}
```

1. Collect suggested commands from P0/P1 findings
2. If no suggestions found → use fallback mapping (see quality_gate_routing)
3. De-duplicate, cap at 3 commands per iteration
4. Sort: P0-suggested first
5. Execute each: `Skill({ skill: "maestro-impeccable", args: "{cmd} {target}" })`
   - Pass issue context: the specific findings that triggered this command are already in conversation
6. Re-run gate command (critique/audit)
7. Increment loop_count
8. Append to status.json `gate_history`

### 5f. On Max Loops Exceeded

```
⚠ Max iterations ({max_loops}) reached. Score: {score}/{max}, P0: {count}
  Continuing chain with remaining issues.
```
→ force advance to next chain step

## 6. Final Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Chain complete: {chain_type}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Critique : {score}/40 (trend: {trend_line})
 Audit    : {score}/20
 Loops    : {total_iterations}
 Commands : {executed_command_list}

 Status   : {PASS | PARTIAL — N issues remain}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Update status.json: `status: "completed"`, `final_scores`, `completed_at`.

If issues remain → suggest: "Run `/maestro-ui-craft --chain improve {target}` to continue iteration."

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

These are structural/interactive — never picked by the refine loop:

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
| E001 | error | Impeccable skill not found in project |
| E002 | error | No intent or target specified |
| E003 | error | Invalid --chain type |
| E004 | error | Invalid --enhance command |
| E005 | error | Resume session not found |
| W001 | warning | PRODUCT.md missing, prepending teach to chain |
| W002 | warning | Max quality gate loops exceeded, forcing continue |
| W003 | warning | Could not parse score from critique/audit output |
</error_codes>

<success_criteria>
- [ ] Intent classified and chain type selected
- [ ] Context loaded (PRODUCT.md present or taught)
- [ ] Session dir created with status.json before execution
- [ ] All chain steps executed via Skill("maestro-impeccable", ...)
- [ ] Quality gate evaluated with parsed scores
- [ ] Refine loop executed when gate failed (if applicable)
- [ ] Gate history and scores persisted to status.json
- [ ] Final report with scores and trend presented
- [ ] Progress tracked via TodoWrite throughout
</success_criteria>
