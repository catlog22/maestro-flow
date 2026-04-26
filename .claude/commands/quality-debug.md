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
Debug issues using scientific method with subagent isolation and persistent debug state. Three entry modes (standalone, from-UAT, parallel) and structured root cause collection with UAT feedback loop. Full algorithm defined in workflow debug.md.
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

**Output**: `DEBUG_DIR = .workflow/scratch/{YYYYMMDD}-debug-P{N}-{slug}/` (P{N} = phase number when phase-scoped; omit for standalone). Output directory rules defined in workflow debug.md Step 4.
</context>

<execution>
Follow '~/.maestro/workflows/debug.md' completely.

**Register artifact on completion (phase-scoped only):**
```
Append to state.json.artifacts[]:
{
  id: nextArtifactId(artifacts, "debug"),  // DBG-001
  type: "debug",
  milestone: current_milestone,
  phase: target_phase,
  scope: "phase",
  path: "scratch/{YYYYMMDD}-debug-P{N}-{slug}",
  status: all_diagnosed ? "completed" : "failed",
  depends_on: triggering_review_id || exec_art.id,
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```

### Post-debug Knowledge Inquiry

After root cause is confirmed, evaluate inquiry triggers:

1. **Recurring pattern**: If root cause matches a recurring pattern (similar to prior debug sessions):
   → Ask: "This root cause pattern has appeared before. Should it be documented in `debug-notes.md` to prevent recurrence? (`/spec-add debug`)"

2. **Non-obvious fix**: If fix involved a non-obvious approach or workaround:
   → Ask: "This fix used a non-obvious strategy. Should it be recorded as a learning? (`/spec-add learning`)"

3. **Architectural gap**: If root cause traces to architectural boundary violation or missing constraint:
   → Ask: "Root cause points to an architectural gap. Should `architecture-constraints.md` be updated? (`/spec-add arch`)"

If user confirms, invoke `Skill({ skill: "spec-add", args: "<category> <content>" })`.

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
