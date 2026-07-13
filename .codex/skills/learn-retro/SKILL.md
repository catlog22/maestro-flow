---
name: learn-retro
description: Retrospective of git activity and decision quality
argument-hint: "[--lens git|decision|all] [--days N] [--author <name>] [--area
  <path>] [--phase N] [--compare] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
version: 0.5.50
---

<purpose>
Unified retrospective combining git activity analysis and decision quality evaluation.
Two lenses, usable independently or together:
- **git**: Commit metrics, session detection, per-author breakdown, file hotspots, trends
- **decision**: Decision tracing across wiki/specs/git, multi-perspective evaluation via 3 parallel agents
</purpose>

<context>
$ARGUMENTS — lens selection and scope flags.

**Lens:** `--lens git` | `--lens decision` | `--lens all` (default)

**Git flags:** `--days N` (default: 7), `--author <name>`, `--area <path>`, `--compare`
**Decision flags:** `--phase N`, `--tag <tag>`, `--id <id>`

**Output**: `.workflow/knowhow/KNW-retro-{date}.md` + `KNW-retro-{date}.json`

**Output boundary**: ALL file writes MUST target `.workflow/knowhow/KNW-retro-{date}.md`, `.workflow/knowhow/KNW-retro-{date}.json`, and `.workflow/specs/learnings.md` only. NEVER modify source code, git history, or files outside these paths.
</context>

<invariants>
1. **Read-only analysis** — NEVER modify source code, git history, or wiki entries; all writes go to `.workflow/` only
2. **Git data integrity** — git commands MUST be read-only (`git log`, `git diff --stat`); NEVER run `git commit`, `git reset`, or any write-mode git operation
3. **Confirmation before agents** — unless `-y` is set, MUST prompt user via `request_user_input` before spawning decision evaluation agents; NEVER auto-spawn without confirmation
4. **Append-only learnings** — `.workflow/specs/learnings.md` MUST be appended, NEVER overwritten or truncated
5. **Confirmation before persist** — unless `-y` is set, MUST prompt user via `request_user_input` before appending insights to learnings.md
6. **Lens contract** — MUST execute exactly the selected lens(es); `--lens git` SHALL NOT trigger decision evaluation and vice versa
7. **Prior retro preservation** — existing `KNW-retro-*.json` files MUST NOT be modified; only new files created for current retro
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Lens Execution**
- REQUIRED: Lens selection parsed (git/decision/all).
- REQUIRED: Git repo validated if git lens selected (E001).
- BLOCKED if: not inside git repo for git lens, or no commits in window (E002).

**GATE 2: Git Lens → Decision Lens**
- REQUIRED: Git metrics computed (commits, LOC, sessions, hotspots).
- BLOCKED if: git data gathering failed entirely — skip git lens, continue with decision lens only.

**GATE 3: Decision Collection → Decision Evaluation**
- REQUIRED: Decisions collected from wiki/specs/git/phase.
- REQUIRED: User confirmation obtained via `request_user_input` before spawning evaluation agents (unless `-y`).
- BLOCKED if: no decisions found (E003) or user declines agent spawn.

**GATE 4: Report → Persist**
- REQUIRED: Unified report written to KNW-retro-{date}.md + KNW-retro-{date}.json.
- REQUIRED: User confirmation obtained via `request_user_input` before learnings append (unless `-y`).
- BLOCKED if: user declines — display summary only, skip persistence.

### Phase 1: Parse + Select Lenses

### Phase 2: Git Lens (skip if --lens decision)
**Sequential data gathering** (parallel git commands):
- Commit stats with shortstat
- Per-commit numstat for test/production LOC split
- Timestamps for session detection (>2hr gap clustering)
- File hotspots (most frequently changed)
- Per-author commit counts

**Compute**: commits, LOC, test ratio, churn rate, active days, sessions, per-author breakdown.
**Trend comparison** if prior `retro-*.json` exists.

### Phase 3: Decision Lens (skip if --lens git)
**3a: Collect decisions** from wiki, specs, git log, phase context, .workflow/specs/learnings.md.
**3b: Build decision registry** per decision (id, title, source, rationale, alternatives, evidence).

**3c: Multi-perspective evaluation** — **Confirmation gate**: unless `-y` is set, prompt user via `request_user_input` before spawning wave: "Spawn 3 perspective agents for decision evaluation? (y/n)". On `n`, skip to Phase 4 with decisions listed but unevaluated.

Via spawn_agents_on_csv (3 parallel agents; filter `wave==1 AND status=="pending"`):

| id | perspective | focus |
|----|------------|-------|
| 1 | technical | Implementation vs intent, context drift. Grade: sound/degraded/violated |
| 2 | cost | Complexity added, coupling, tech debt. Grade: low-cost/acceptable/expensive |
| 3 | hindsight | Right call with current knowledge? Grade: confirmed/questionable/should-revisit |

**output_schema**:

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "perspective":   { "type": "string", "enum": ["technical", "cost", "hindsight"] },
    "grade":         { "type": "string" },
    "findings":      { "type": "string", "maxLength": 500 },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "grade", "findings"]
}
```

Merge: `result_status` → master `status`; copy `perspective`, `grade`, `findings`, `error`.

**Shared termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed with concrete grade
- Failure → result_status=failed with error message
- Timeout → near max_runtime_seconds → result_status=failed, error="timeout (partial)"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
- Read-only analysis. Do NOT modify source files.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
```

**3d: Classify lifecycle**: Validated / Aging / Questionable / Stale / Reversed.

### Phase 4: Unified Report
Write `KNW-retro-{date}.md` + `KNW-retro-{date}.json` with metrics, sessions, hotspots, decision health, combined insights, recommended actions.

### Phase 5: Persist (confirmation-gated)
**Confirmation gate**: unless `-y` is set, prompt user via `request_user_input` — "Append retro insights to learnings.md? (y/n)"
- `y` → append insights to `.workflow/specs/learnings.md` (source: "retro-git" or "retro-decision")
- `n` → skip append, display summary only
Display summary.

**Next steps:** `$learn-follow <path>`, `$quality-auto-test <area>`, `$learn-investigate <question>`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Not inside git repo (git lens) | Navigate to git repo |
| E002 | error | No commits in time window | Increase --days |
| E003 | error | No decisions found (decision lens) | Check wiki/specs content |
| W001 | warning | .workflow/knowhow/ not found | Auto-bootstrap |
| W002 | warning | No prior retro for comparison | First retro establishes baseline |
| W003 | warning | Decision perspective agent failed | Proceed with partial evaluation |
</error_codes>

<success_criteria>
- [ ] Lens selection parsed correctly
- [ ] Git lens: metrics computed, sessions detected, hotspots identified
- [ ] Decision lens: decisions collected, user confirmed before wave spawn, 3 agents spawned in parallel (if confirmed), lifecycle classified
- [ ] Unified report written to KNW-retro-{date}.md + KNW-retro-{date}.json
- [ ] User confirmation obtained before learnings append (unless `-y`)
- [ ] .workflow/specs/learnings.md appended with insights (stable INS-ids, if confirmed)
</success_criteria>
