---
name: learn-retro
description: Retrospective of git activity and decision quality
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"[--lens git|decision|all] [--days N] [--author <name>] [--area <path>] [--phase N] [--compare]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Unified retrospective combining git activity analysis and decision quality evaluation.
Two lenses, usable independently or together:
- **git**: Commit metrics, session detection, per-author breakdown, file hotspots, trends
- **decision**: Decision tracing across wiki/specs/git, multi-perspective evaluation via 3 parallel agents

Works on raw git history and wiki/spec data — does not require completed phase artifacts.
</purpose>

<context>
$ARGUMENTS — lens selection and scope flags.

**Lens:** `--lens git` | `--lens decision` | `--lens all` (default)

**Git flags:** `--days N` (default: 7), `--author <name>`, `--area <path>`, `--compare`
**Decision flags:** `--phase N`, `--tag <tag>`, `--id <id>`

**Output**: `.workflow/knowhow/KNW-retro-{date}.md` + `KNW-retro-{date}.json`
</context>

<execution>

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

**3c: Multi-perspective evaluation** via spawn_agents_on_csv (3 parallel agents; filter `wave==1 AND status=="pending"`):

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

### Phase 5: Persist
Append insights to `.workflow/specs/learnings.md` (source: "retro-git" or "retro-decision"). Display summary.

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
- [ ] Decision lens: decisions collected, 3 agents spawned in parallel, lifecycle classified
- [ ] Unified report written to KNW-retro-{date}.md + KNW-retro-{date}.json
- [ ] .workflow/specs/learnings.md appended with insights (stable INS-ids)
</success_criteria>
