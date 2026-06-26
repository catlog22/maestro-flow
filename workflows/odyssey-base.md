# Odyssey Shared Base

Shared by all Odyssey commands (debug, improve, planex, review-test-fix, ui).

<execution_discipline>

1. **Phase auto-commit** — auto `git commit` after each phase
   - Code changes + understanding.md → `git add` → `git commit -m "{command}({slug}): {phase} — {summary}"`
   - session.json / evidence.ndjson are runtime state, excluded from commits

2. **Confident edits only, but must attempt** — edit when confident; record decision only when human judgment truly needed
   - Confident → edit + commit
   - Needs decision → `evidence.ndjson {"phase":"decision","status":"pending"}`, no code change
   - **Decision gate** — only these qualify: cross-module architecture tradeoffs needing human direction | business semantics ambiguity where fix may change intent | new dependency or breaking API required
   - "Unsure how to fix", "Too large scope", "Pre-existing issue" are NOT valid decision reasons

3. **Multi-CLI assist** — `maestro delegate` for cross-angle verification
   - Different `--role` per phase (analyze / review / explore)
   - All delegate calls `run_in_background: true`, wait for callback

4. **Never abort for context exhaustion** — harness auto-compresses context; aborting due to "insufficient context" or "already ran N phases" is a discipline violation. Must complete through S_RECORD → END.

**Zero-residual:** Every finding must have an action (fix / issue / decision). "Report only" and "pre-existing skip" are forbidden.
</execution_discipline>

<shared_schemas>

### session.json standard fields

```json
{
  "session_id": "{type}-odyssey-{YYYYMMDD-HHmmss}",
  "current_state": "S_INTAKE",
  "flags": { "skip_fix": false, "skip_generalize": false, "auto": false, "auto_confirm": false },
  "phase_goals": [], "phase_goals_all_done": false,
  "self_iteration_log": [],
  "cross_phase_loops": 0, "max_loops": 5,
  "created_at": "", "updated_at": ""
}
```

Each command adds its own fields (e.g. `issue`, `target`, `requirement`).

### evidence.ndjson base schema

```json
{"ts":"","phase":"","type":"","source":"","content":"","note":""}
```

Each command defines phase-specific extension fields (e.g. `hypothesis`, `severity`, `dimension`).

### generalization_stats schema

```json
{
  "patterns_extracted": 0, "total_hits": 0,
  "cross_layer_confirmed": 0, "regression_risks": 0,
  "by_layer": {"syntax": 0, "semantic": 0, "structural": 0},
  "deepening_triggered": false
}
```

</shared_schemas>

<anti_stall>

### progress_metrics fields

```json
{
  "progress_metrics": {
    "phase_stats": {},
    "stale_count": 0,
    "last_productive_phase": "",
    "convergence_trend": "unknown"
  },
  "directions_tried": []
}
```

### Progress Tracking

After each analytical phase:
1. Count `new_findings` (deduplicated) and `repeated` (matching existing evidence)
2. Write to `progress_metrics.phase_stats[state_name]`
3. `new == 0` → `stale_count++`, `convergence_trend = "stalling"`
4. `new > 0` → `stale_count = 0`, update `last_productive_phase`
5. 2 consecutive phases with declining new → `convergence_trend = "diminishing"`

### Direction Diversity

```json
{
  "phase": "S_DIAGNOSE", "round": 1,
  "strategy_type": "scope_widen|perspective_shift|tool_switch|structural_pivot",
  "strategy_desc": "expand search to utils/", "result": "2 new findings"
}
```

**Dedup rule:** Check same-phase history before self-iteration → new strategy must differ in `strategy_type` or `strategy_desc` → all 4 types tried → force stale_count upgrade

### Stall Escalation Ladder

| stale_count | Strategy |
|-------------|----------|
| 0 | Normal advance |
| 1 | **Shift perspective** — different CLI tool, reverse trace, manual read. Must differ from directions_tried |
| 2 | **Structural pivot** — redefine search dimensions, switch analysis framework, decompose sub-problems. Not parameter tuning |
| 3 | **Human escalation** — AskUserQuestion / `-y` auto INCONCLUSIVE and advance |

### /loop Heartbeat (optional, `--heartbeat`)

Suggest `/loop 270s`. Each phase updates `session.json.updated_at`. >15 min without update → alert + stale_count. 2 consecutive no-update → suggest `-c` resume.
</anti_stall>

<self_iteration>

### Quality Gate

| Dimension | Sufficient | Insufficient |
|-----------|-----------|-------------|
| Coverage | All known related files/modules analyzed | Missed targets discoverable via grep/git log |
| Depth | ≥80% findings have file:line evidence | Most findings lack specifics |
| Actionability | Each conclusion has concrete next action | "Consider reviewing" without action |

**Progress-aware iteration:**
- Phase complete → evaluate 3 dimensions + check `progress_metrics`
- Any insufficient AND `stale_count < 3` → re-enter with expansion strategy (must pass directions_tried dedup)
- Follow Stall Escalation Ladder for strategy selection

**Expansion strategies:**
- `scope_widen`: more directories, git log depth ×2, additional delegate angles
- `perspective_shift`: different CLI tool, reverse trace, manual reading
- `tool_switch`: switch to unused analysis tool
- `structural_pivot`: redefine problem framework, decompose sub-problems

**Exit:** all sufficient → advance | `stale_count >= 3` → log gaps, advance

**Log:** `evidence.ndjson {"phase":"self-iteration"}` + `session.json.self_iteration_log[]` + `directions_tried[]`
</self_iteration>

<shared_actions>

### A_GENERALIZE

3-layer pattern extraction → 4-agent concurrent scan → cross-layer dedup → iterative deepening.

**Pattern source:** specified by each command (root cause / audit findings / implementation patterns).

**3-layer extraction:**

| Layer | Method | Example |
|-------|--------|---------|
| Syntax | Regex → Grep | `eval(`, missing `await`, inline styles |
| Semantic | Agent understands anti-pattern → scan | Unhandled async errors, missing validation |
| Structural | File/module structure similarity | Same import structure, missing override |

Write `session.json.patterns[]`: `[{id, source, layer, signature, description, risk, fix_template, confidence}]`

**4-agent concurrent scan (single message):**

| Agent | Strategy | Scope |
|-------|----------|-------|
| Syntax grep | Grep regex | Full project |
| Semantic scan | Anti-pattern check | Related modules |
| Structural match | Structurally similar files | Full project |
| Historical grep | `git log -S` | Git history |

**Cross-layer dedup:** multi-layer hit → boost | single-layer → `needs_review` | historically fixed → `regression_risk`

**Iterative deepening:** module ≥3 hits → targeted deep scan (max 1 round)

**Persist:** understanding.md generalization section + `session.json.generalization_stats`

Commit: `"...({slug}): GENERALIZE — generalization scan complete"`

### A_DISCOVER

1. **Triage** each hit ±10 lines context → classify `bug` / `risk` / `safe`
2. **Route:**
   - bug + fix_template applicable → immediate fix → back to S_FIX
   - bug + needs cross-module decision or no fix_template → create issue (with fix suggestion + impact analysis)
   - risk → assess if guard can be added directly; yes → fix; no → create issue
   - safe → skip
   Normal: AskUserQuestion | `-y`: auto-fix bugs with fix_template, create issue for rest
3. **Cross-phase loops:** `cross_phase_loops++`. `loops >= max_loops` → must log per-item reasons (blanket "pre-existing" forbidden)
4. Append evidence + update understanding.md

Commit: `"...({slug}): DISCOVER — discovery triage complete"`

### A_RECORD

1. Finalize understanding.md final section — learnings structured by each command's category table
2. Mark record goal done. Pending decisions: Normal → AskUserQuestion | `-y` → skip (show deferred count)
3. **Goal audit:** all `completion_confirmed` → `phase_goals_all_done = true`. Incomplete: Normal → AskUserQuestion | `-y` → auto accept
4. `current_state = "COMPLETED"`, emit completion summary (format defined by each command)

Commit: `"...({slug}): RECORD — summary and knowledge persistence"`

</shared_actions>

<shared_appendix>

### Goal Prompt

**Timing guard: display ONCE after INTAKE completes. Never re-display at RECORD.**

```
{Command} Odyssey session created. Copy the /goal below to set termination criteria:

/goal Complete these goals:
{for each G in phase_goals where status != "skipped":}
- {G.id}: {G.goal} — done when: {G.done_when}
{end for}
{command-specific convergence rules}
Pending phase=decision items must use AskUserQuestion, never self-resolve.
```

Continue execution after output, do not block.

### `-y` generic rules

- Decision pending → best-effort continue, record `deferred`
- 3-strike escalation → auto INCONCLUSIVE
- Discovery routing → auto-fix bugs with fix_template, create issue for rest
- Record pending → skip, show deferred count
- Record goal audit → auto accept

`deferred` items shown in completion summary; recoverable via `-c`. Each command lists its own specific decision points.

### Phase Goal Lifecycle

`pending → done (confirmed=true)` | `pending → skipped (confirmed=true)` | `pending → failed (confirmed=false)`

`phase_goals_all_done = true` only when ALL goals have `completion_confirmed == true`.

### Pre-load (optional, missing does not block)

| Layer | Command |
|-------|---------|
| Codebase docs | Read `.workflow/codebase/ARCHITECTURE.md` |
| Wiki search | `maestro search "<keywords>" --json` (top 5) |
| Specs | `maestro load --type spec --category <cat>` |
| Role knowledge | `maestro search --category <cat>` → `maestro load --type knowhow --id <id>` |
| Prior sessions | `Glob(".workflow/scratch/*-{type}-odyssey-*")` |

### Common Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E003 | error | Resume but no session found | Start new |
| E004 | error | Delegate failed | Retry or proceed without |
| W003 | warning | Generalization 0 hits | Skip discovery |
| W004 | warning | Delegate parse failed | Use raw output |

</shared_appendix>
