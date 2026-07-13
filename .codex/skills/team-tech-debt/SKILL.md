---
name: team-tech-debt
description: Team tech debt identification and remediation
argument-hint: "[scope] [-y|--yes] [-c|--concurrency N] [--continue] [--mode
  scan|remediate|targeted]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Wave-based tech debt pipeline via `spawn_agents_on_csv`. Scan → Assess → Plan → Fix → Validate with user-gated remediation plan and fix-verify GC loops.

```
+-------------------------------------------------------------------+
|                 TECH DEBT CSV WAVE WORKFLOW                         |
+-------------------------------------------------------------------+
|  Phase 1: Mode Selection + CSV Generation                          |
|     +-- Detect mode (scan/remediate/targeted)                      |
|     +-- Build tasks.csv from pipeline definition                   |
|                                                                     |
|  Phase 2: Wave Execution Engine                                    |
|     +-- Sequential waves                                           |
|     +-- User approval after TDPLAN (plan gate)                     |
|     +-- Fix-Verify GC loop (max 3 rounds on regression)            |
|                                                                     |
|  Phase 3: Results Aggregation                                      |
+-------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$team-tech-debt "src/"
$team-tech-debt -y --mode remediate "src/auth"
$team-tech-debt --mode targeted "high-priority debt items"
$team-tech-debt --continue "20260518-td-auth"
```

**Flags**: `-y` (auto), `-c N` (concurrency, default 3), `--continue` (resume), `--mode scan|remediate|targeted`

### Role Registry (Fixed)

| Role | Path | Prefix |
|------|------|--------|
| scanner | [roles/scanner/role.md](roles/scanner/role.md) | TDSCAN-* |
| assessor | [roles/assessor/role.md](roles/assessor/role.md) | TDEVAL-* |
| planner | [roles/planner/role.md](roles/planner/role.md) | TDPLAN-* |
| executor | [roles/executor/role.md](roles/executor/role.md) | TDFIX-* |
| validator | [roles/validator/role.md](roles/validator/role.md) | TDVAL-* |

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-td-{slug}/`

### Scan Dimensions
code, architecture, testing, dependency, documentation
</context>

<csv_schema>

### tasks.csv (Input columns)

```csv
id,title,description,role,scan_dimension,deps,context_from,wave
```

| Column | Description |
|--------|-------------|
| `id` | Task ID: `{PREFIX}-{NNN}` |
| `title` | Short task title |
| `description` | PURPOSE/TASK/EXPECTED/CONSTRAINTS |
| `role` | Fixed role name |
| `scan_dimension` | code/arch/testing/deps/docs or empty |
| `deps` | Semicolon-separated dependency IDs |
| `context_from` | Context source IDs |
| `wave` | Wave number |

**Output columns** (via `output_schema` only):

| Column | Description |
|--------|-------------|
| `result_status` | completed / failed / blocked |
| `findings` | Key findings (max 500 chars) |
| `files_modified` | Semicolon-separated paths |
| `debt_count` | Number of debt items found/fixed (string type, e.g. "5") |
| `regression_detected` | true/false (for TDVAL tasks) |
| `error` | Error message |

**Column separation rule**: Input and Output MUST NOT share names.

### Pipeline Wave Assignments

#### scan (2 waves)

| Wave | Task | Role |
|------|------|------|
| 1 | TDSCAN-001 | scanner |
| 2 | TDEVAL-001 | assessor |

#### remediate (5+ waves, with plan gate + GC)

| Wave | Task | Role |
|------|------|------|
| 1 | TDSCAN-001 | scanner |
| 2 | TDEVAL-001 | assessor |
| 3 | TDPLAN-001 | planner |
| — | User plan approval gate | — |
| 4 | TDFIX-001 | executor |
| 5 | TDVAL-001 | validator |
| 5+ | GC: TDFIX+TDVAL if regression_detected (max 3) | executor, validator |

#### targeted (3+ waves, skip scan)

| Wave | Task | Role |
|------|------|------|
| 1 | TDPLAN-001 | planner |
| — | User plan approval gate | — |
| 2 | TDFIX-001 | executor |
| 3 | TDVAL-001 | validator |
| 3+ | GC if regression_detected (max 3) | executor, validator |
</csv_schema>

<invariants>
1. **Wave Order Sacred**
2. **CSV Source of Truth**
3. **Column Separation Rule**
4. **Plan Approval Gate**: User must approve remediation plan (skip if -y)
5. **Fix-Verify GC Max 3**: On regression detection
6. **Discovery Board Append-Only**
7. **Cleanup Temp Files**
8. **DO NOT STOP**: Continuous between gates
9. **Role Files Authoritative**
</invariants>

<state_machine>

<states>
S_PARSE       — Parse arguments, detect mode
S_CSV_GEN     — Generate tasks.csv
S_WAVE_{N}    — Execute wave N
S_PLAN_GATE   — User approval of remediation plan
S_GC_CHECK    — Regression check after TDVAL
S_DEGRADED_AGGREGATE — Aggregate partial results after GC exhaustion (regression persists)
S_AGGREGATE   — Generate report
</states>

<transitions>
S_PARSE → S_CSV_GEN
S_CSV_GEN → S_WAVE_1
S_WAVE_{N} → S_PLAN_GATE       WHEN: TDPLAN wave complete, TDFIX pending
S_WAVE_{N} → S_GC_CHECK        WHEN: TDVAL wave complete, regression_detected possible
S_WAVE_{N} → S_WAVE_{N+1}      WHEN: more waves
S_WAVE_{N} → S_AGGREGATE       WHEN: last wave
S_PLAN_GATE → S_WAVE_{N+1}     WHEN: user approves
S_PLAN_GATE → S_WAVE_{N}       WHEN: user requests revision (re-run TDPLAN with feedback)
S_PLAN_GATE → S_AGGREGATE      WHEN: user aborts
S_GC_CHECK → S_AGGREGATE           WHEN: no regression (clean pass)
S_GC_CHECK → S_WAVE_{N+1}          WHEN: regression AND gc_rounds < 3 (add TDFIX+TDVAL rows)
S_GC_CHECK → S_DEGRADED_AGGREGATE  WHEN: regression AND gc_rounds >= 3 (aggregate partial results with regression warning)
</transitions>

<actions>

### Session Initialization (S_PARSE)

```
Parse from $ARGUMENTS:
  AUTO_YES       ← --yes | -y
  continueMode   ← --continue
  maxConcurrency ← --concurrency | -c N  (default: 3)
  modeFlag       ← --mode scan|remediate|targeted
  scopeTarget    ← remaining text (file/module path)

Derive:
  dateStr       ← UTC+8 YYYYMMDD
  slug          ← first 3 meaningful words, kebab-case
  sessionId     ← "{dateStr}-td-{slug}"
  sessionFolder ← ".workflow/.csv-wave/{sessionId}"
  skillRoot     ← resolve path to this skill directory

mkdir -p {sessionFolder}
```

When `--continue`: scan `.workflow/.csv-wave/*-td-*/tasks.csv` for sessions with pending tasks. Single match → resume. Multiple → `request_user_input`. Read master tasks.csv → find first pending wave → jump to S_WAVE_{N}.

### Mode Selection + CSV Generation (S_CSV_GEN)

1. Select mode: `--mode` flag, or detect from scope (no existing scan → scan, existing scan results → remediate, specific debt items → targeted)
2. Load pipeline wave assignments from csv_schema section above
3. For each task, build CSV row with PURPOSE/TASK/EXPECTED/CONSTRAINTS in description
4. Initialize lifecycle columns: `status=pending`, empty `findings`/`files_modified`/`debt_count`/`regression_detected`/`error`
5. Write `tasks.csv` and empty `discoveries.ndjson`
6. User validation (skip if `-y`): display mode, task count, wave structure

### Wave Execution (S_WAVE_{N})

1. Skip check: if all tasks in wave N completed/skipped → next wave
2. Cascading skip: if any dep is failed/blocked → skip dependents
3. Build `prev_context` from upstream findings
4. Write `wave-{N}.csv` with qualifying rows + `prev_context` column
5. `spawn_agents_on_csv` with output_schema (see below)
6. Merge results: `result_status` → master `status`
7. Cascade skip failed task dependents
8. Delete `wave-{N}.csv` and `wave-{N}-results.csv`
9. If TDPLAN wave complete → transition to S_PLAN_GATE
10. If TDVAL wave complete → transition to S_GC_CHECK

### Plan Gate

After TDPLAN wave:
1. Read planner's `findings` (remediation plan)
2. Display: debt items, priority, estimated effort
3. `request_user_input`: Approve / Revise / Abort
4. Approve → continue to TDFIX wave
5. Revise → re-run TDPLAN with feedback
6. Abort → aggregate with scan+assess results only

### Fix-Verify GC Loop

After TDVAL wave:
1. Read `regression_detected` from results
2. No regression → S_AGGREGATE (clean pass)
3. Regression AND gc_rounds < 3 → add TDFIX+TDVAL rows to tasks.csv, increment wave, iterate
4. Regression AND gc_rounds >= 3 → S_DEGRADED_AGGREGATE (aggregate partial results with regression warning, escalate to user)

### Instruction Builder

```
You are a team-tech-debt agent.
Role: read 'role' column. Task: read 'description' column.

## Role Definition
Read: {skillRoot}/roles/{role}/role.md

## Context
Session: {sessionFolder}
Discovery board: {sessionFolder}/discoveries.ndjson
Previous context: 'prev_context' column

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting. NO exceptions.
- Success → result_status=completed after verification
- Failure → result_status=failed with error message
- Blocked → cannot proceed without upstream fix → result_status=blocked
- Timeout → near max_runtime_seconds → revert partial unsafe work → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output (must match output_schema)
Return JSON:
{
  "id": "<your CSV row id>",
  "result_status": "completed" | "failed" | "blocked",
  "findings": "<key findings, max 500 chars>",
  "files_modified": "<semicolon-separated paths or empty>",
  "debt_count": "<integer as string or empty>",
  "regression_detected": "true" | "false" | "" (TDVAL only),
  "error": "<message if not completed>"
}

## Hard Constraints
- Do NOT write to tasks.csv, wave-*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).
```

### Spawn output_schema

When the coordinator dispatches a wave via `spawn_agents_on_csv`, it MUST use the strict JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "id":                  { "type": "string" },
    "result_status":       { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":            { "type": "string", "maxLength": 500 },
    "files_modified":      { "type": "string" },
    "debt_count":          { "type": "string" },
    "regression_detected": { "type": "string", "enum": ["true", "false", ""] },
    "error":               { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge maps `result_status` → master `status`.

</actions>
</state_machine>

<error_codes>

| Condition | Recovery |
|-----------|----------|
| Scanner found 0 debt items | Skip to aggregate, report clean |
| Regression persists after 3 GC rounds | Escalate to user |
| Plan rejected by user | Aggregate with scan results only |
| Fix introduces new debt | Log warning, continue to validation |
</error_codes>

<success_criteria>
- [ ] Mode selected and CSV generated
- [ ] Scan → Assess → Plan → Fix → Validate pipeline
- [ ] User approval gate for remediation plan
- [ ] Fix-Verify GC loop on regression (max 3)
- [ ] Column separation maintained
- [ ] results.csv and context.md generated
</success_criteria>
