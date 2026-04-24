---
name: quality-debug
description: Parallel hypothesis-driven debugging with UAT integration and structured root cause collection
argument-hint: "[issue description] [--from-uat <phase>] [--parallel]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Debug issues using scientific method with subagent isolation and persistent debug state. Supports three entry modes:

1. **Standalone**: User describes an issue, gather symptoms interactively
2. **From UAT**: `--from-uat` reads uat.md gaps as pre-filled symptoms (skip gathering)
3. **Parallel**: `--parallel` spawns one debug agent per gap cluster concurrently

When root causes are found, updates the originating uat.md with diagnosis artifacts (root_cause, fix_direction, affected_files) so the UAT -> debug -> fix pipeline stays connected.

Key mechanisms from GSD diagnose-issues:
- **Pre-filled symptoms from UAT**: Skip 5-question gathering when gaps already documented
- **Parallel debug agents**: One agent per gap cluster for concurrent investigation
- **Structured root cause collection**: Standardized output format across all agents
- **UAT feedback loop**: Auto-update uat.md gaps with diagnosis results
</purpose>

<required_reading>
@~/.maestro/workflows/debug.md
</required_reading>

<context>
User's issue: $ARGUMENTS

**Flags:**
- `--from-uat <phase>` -- Read gaps from phase's uat.md as pre-filled symptoms
- `--parallel` -- Spawn parallel debug agents (one per gap cluster)

**All context via state.json.artifacts[]:**

```
related = artifacts.filter(a =>
  a.phase === target_phase && a.milestone === current_milestone
).sort_by(completed_at asc)
```

Each artifact's type determines its outputs at `.workflow/{a.path}/`:
- **execute** → .summaries/, .task/ (source of code changes)
- **review** → review.json (findings guide hypothesis formation)
- **debug** → understanding.md, evidence.ndjson (prior investigations, avoid re-investigation)
- **test** → uat.md (--from-uat gap source), .tests/

Extract conclusions from related artifacts that may affect this debug session — review findings guide investigation direction, prior debug avoids redundant work.

**Output**: `DEBUG_DIR = .workflow/scratch/{YYYYMMDD}-debug-P{N}-{slug}/` (P{N} = phase number when phase-scoped; omit for standalone)
</context>

<execution>
Follow '~/.maestro/workflows/debug.md' completely.

**Output writes to DEBUG_DIR** (`scratch/{YYYYMMDD}-debug-P{N}-{slug}/`):
- understanding.md, evidence.ndjson, diagnosis-summary.json

**Register artifact on completion (phase-scoped only):**
```
Append to state.json.artifacts[]:
{
  id: nextArtifactId(artifacts, "debug"),  // DBG-001
  type: "debug",
  milestone: current_milestone,
  phase: target_phase,
  scope: "phase",
  path: "scratch/{YYYYMMDD}-debug-P{N}-{slug}",  // or {YYYYMMDD}-debug-{slug} for standalone
  status: all_diagnosed ? "completed" : "failed",
  depends_on: triggering_review_id || exec_art.id,
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```

**Next-step routing on completion:**
- Root cause found, fix needed → `/maestro-plan {phase} --gaps`
- Root cause found (from UAT), auto-fix → `/quality-test {phase} --auto-fix`
- Inconclusive, need more info → `/quality-debug {issue} -c` (resume session)
- Standalone fix already applied → `/maestro-verify {phase}`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Issue description required (no arguments, no active sessions) | Check arguments format, re-run with correct input |
| E002 | error | UAT file not found for --from-uat phase | Verify UAT file exists for specified phase |
| W001 | warning | Existing debug session found, offer resume | Review existing sessions, choose resume or new |
| W002 | warning | Checkpoint reached, user input needed | Provide requested input to continue |
| W003 | warning | Some gaps inconclusive, partial diagnosis | Review partial results, retry inconclusive gaps |
</error_codes>

<success_criteria>
- [ ] Input parsed: standalone, --from-uat, or --parallel mode determined
- [ ] Active sessions checked and resume offered if applicable
- [ ] Symptoms gathered (interactive) or loaded from UAT (pre-filled)
- [ ] Debug output directory created (phase .debug/ or scratch/)
- [ ] Debug agent(s) spawned with full symptom context
- [ ] If --parallel: one agent per gap cluster, all concurrent
- [ ] evidence.ndjson written with structured NDJSON entries
- [ ] understanding.md tracks evolving understanding per cluster
- [ ] Root causes collected with fix_direction and affected_files
- [ ] If --from-uat: uat.md gaps updated with diagnosis artifacts
- [ ] Results unified into diagnosis summary
- [ ] Next step routed (plan --gaps + execute if fix needed, verify if fix applied, resume if inconclusive)
</success_criteria>
