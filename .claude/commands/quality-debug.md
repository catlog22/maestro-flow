---
name: quality-debug
description: Use when bugs, test failures, or unexpected behavior need systematic root cause investigation
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

### Pre-load (optional, proceed without)
- Codebase docs: `.workflow/codebase/ARCHITECTURE.md` → module boundaries
- Wiki: `maestro search "<symptom keywords>" --json` → prior investigations
- Specs: `maestro load --type spec --category debug --keyword "<symptom>"` → known issues/workarounds
- Role knowledge: `maestro search --category debug` → select relevant → `maestro load --type knowhow --id`

**Output**: `DEBUG_DIR = .workflow/scratch/{YYYYMMDD}-debug-P{N}-{slug}/` (P{N} = phase number when phase-scoped; omit for standalone). Output directory rules defined in workflow debug.md Step 4.
</context>

<execution>
Follow '~/.maestro/workflows/debug.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Input → Investigation**
- REQUIRED: Symptoms gathered (interactive) or loaded from UAT (--from-uat).
- REQUIRED: Debug output directory created.
- BLOCKED if missing: cannot investigate without symptom baseline.

**GATE 2: Investigation → Diagnosis**
- REQUIRED: Debug agent(s) spawned with full symptom context.
- REQUIRED: evidence.ndjson written with structured entries.
- REQUIRED: understanding.md tracks evolving understanding.
- BLOCKED if incomplete: continue investigation before declaring root cause.

**GATE 3: Diagnosis → Completion**
- REQUIRED: Root causes collected with fix_direction and affected_files.
- REQUIRED: Multi-factor confidence scored per gap.
- REQUIRED: Readiness gate checked and pressure pass completed.
- BLOCKED if inconclusive: resume session or escalate.

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

| Condition | Ask | Route |
|-----------|-----|-------|
| Recurring root cause pattern (seen in prior debug) | "Document in debug-notes.md?" | spec-add debug |
| Non-obvious fix / workaround | "Record as learning?" | spec-add learning |
| Root cause = architectural boundary violation | "Update architecture-constraints.md?" | spec-add arch |

On confirm → `Skill("spec-add", "<category> <content> --description \"<summary>\"")`.

</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY
CONCERNS: {description if applicable}
--- END STATUS ---
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Root cause found, fix needed | `/maestro-plan {phase} --gaps` |
| Root cause found (from UAT), auto-fix | `/quality-test {phase} --auto-fix` |
| Inconclusive, need more info | `/quality-debug {issue} -c` (resume) |
| Standalone fix already applied | `/maestro-execute {phase}` |
</completion>

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
- [ ] Multi-factor confidence scored per gap (Step 7.0) replacing simple high/medium/low
- [ ] Readiness gate checked before ROOT CAUSE declaration
- [ ] Pressure pass completed on confirmed hypothesis
- [ ] Confidence table appended to understanding.md
- [ ] If --from-uat: uat.md gaps updated with diagnosis artifacts
- [ ] Results unified into diagnosis summary with confidence section
- [ ] Next step routed (plan --gaps + execute if fix needed, verify if fix applied, resume if inconclusive)
</success_criteria>
