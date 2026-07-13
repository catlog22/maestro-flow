---
name: team-testing
description: Team testing with progressive coverage and generator-critic loops
argument-hint: "[scope] [-y|--yes] [-c|--concurrency N] [--continue] [--pipeline
  targeted|standard|comprehensive]"
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
Wave-based test pipeline via `spawn_agents_on_csv`. Progressive layer coverage (L1/L2/L3) with Generator-Critic loops for convergence.

```
+-------------------------------------------------------------------+
|                   TESTING CSV WAVE WORKFLOW                         |
+-------------------------------------------------------------------+
|  Phase 1: Pipeline Selection + CSV Generation                      |
|     +-- Detect pipeline (targeted/standard/comprehensive)          |
|     +-- Build tasks.csv with wave assignments                      |
|                                                                     |
|  Phase 2: Wave Execution Engine                                    |
|     +-- Sequential waves, parallel tasks within wave               |
|     +-- GC Loop: after TESTRUN, check pass_rate + coverage         |
|     |   +-- pass_rate < 0.95 OR coverage < target → iterate        |
|     +-- discoveries.ndjson shared across waves                     |
|                                                                     |
|  Phase 3: Results Aggregation                                      |
+-------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$team-testing "src/auth module"
$team-testing -y --pipeline comprehensive "src/"
$team-testing --continue "20260518-tst-auth"
```

**Flags**: `-y` (auto), `-c N` (concurrency, default 3), `--continue` (resume), `--pipeline targeted|standard|comprehensive`

### Role Registry (Fixed)

| Role | Path | Prefix |
|------|------|--------|
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | STRATEGY-* |
| generator | [roles/generator/role.md](roles/generator/role.md) | TESTGEN-* |
| executor | [roles/executor/role.md](roles/executor/role.md) | TESTRUN-* |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | TESTANA-* |

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-tst-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md

### Pipeline Selection

| Scope | Pipeline |
|-------|----------|
| ≤3 files, ≤1 module | targeted |
| ≤10 files, ≤3 modules | standard |
| >10 files or >3 modules | comprehensive |
</context>

<csv_schema>

### tasks.csv (Input columns)

```csv
id,title,description,role,test_layer,deps,context_from,wave
```

| Column | Description |
|--------|-------------|
| `id` | Task ID: `{PREFIX}-{NNN}` |
| `title` | Short task title |
| `description` | PURPOSE/TASK/EXPECTED/CONSTRAINTS |
| `role` | Fixed role name |
| `test_layer` | L1/L2/L3 or empty |
| `deps` | Semicolon-separated dependency IDs |
| `context_from` | Semicolon-separated context source IDs |
| `wave` | Wave number |

**Output columns** (via `output_schema` only):

| Column | Description |
|--------|-------------|
| `result_status` | completed / failed / blocked |
| `findings` | Key findings (max 500 chars) |
| `files_modified` | Semicolon-separated paths |
| `pass_rate` | Test pass rate (0.0-1.0, for TESTRUN tasks) |
| `coverage_score` | Coverage % (0-100, for TESTRUN tasks) |
| `error` | Error message |

**Column separation rule**: Input and Output MUST NOT share names.

### Pipeline Wave Assignments

#### targeted (3 waves)

| Wave | Task | Role |
|------|------|------|
| 1 | STRATEGY-001 | strategist |
| 2 | TESTGEN-001 | generator |
| 3 | TESTRUN-001 | executor |

#### standard (6+ waves, GC loops)

| Wave | Task | Role |
|------|------|------|
| 1 | STRATEGY-001 | strategist |
| 2 | TESTGEN-001 | generator (L1) |
| 3 | TESTRUN-001 | executor (L1) |
| 4 | TESTGEN-002 | generator (L2) |
| 5 | TESTRUN-002 | executor (L2) |
| 6 | TESTANA-001 | analyst |

GC: After TESTRUN, if pass_rate < 0.95 or coverage < target → iterate (max 3).

#### comprehensive (8+ waves, parallel + GC)

| Wave | Task | Role |
|------|------|------|
| 1 | STRATEGY-001 | strategist |
| 2 | TESTGEN-001; TESTGEN-002 | generator (L1+L2 parallel) |
| 3 | TESTRUN-001; TESTRUN-002 | executor (L1+L2 parallel) |
| 4 | TESTGEN-003 | generator (L3) |
| 5 | TESTRUN-003 | executor (L3) |
| 6 | TESTANA-001 | analyst |

**Coverage Targets**: L1≥80%, L2≥60%, L3≥40%. **Max GC Rounds**: 3 per layer.
</csv_schema>

<invariants>
1. **Wave Order Sacred**
2. **CSV Source of Truth**
3. **Column Separation Rule**
4. **GC Loop Max 3**: Per-layer, triggered by pass_rate < 0.95 OR coverage < target
5. **Coverage Targets**: L1≥80%, L2≥60%, L3≥40%
6. **Discovery Board Append-Only**
7. **Cleanup Temp Files**
8. **DO NOT STOP**
9. **Role Files Authoritative**
</invariants>

<state_machine>

<states>
S_PARSE      — Parse arguments, detect pipeline
S_CSV_GEN    — Generate tasks.csv
S_WAVE_{N}   — Execute wave N
S_GC_CHECK   — Check pass_rate + coverage after TESTRUN
S_AGGREGATE  — Generate report
</states>

<transitions>
S_PARSE → S_CSV_GEN
S_CSV_GEN → S_WAVE_1
S_WAVE_{N} → S_GC_CHECK      WHEN: wave was TESTRUN
S_WAVE_{N} → S_WAVE_{N+1}    WHEN: not GC-eligible
S_GC_CHECK → S_WAVE_{N+1}    WHEN: pass_rate >= 0.95 AND coverage >= target (converged)
S_GC_CHECK → S_WAVE_{N+1}    WHEN: not converged, gc_rounds < 3 (add TESTGEN+TESTRUN rows)
S_GC_CHECK → S_WAVE_{N+1}    WHEN: gc_rounds >= 3 (proceed with warning)
S_WAVE_{N} → S_AGGREGATE     WHEN: last wave
</transitions>

<actions>

### Session Initialization (S_PARSE)

```
Parse from $ARGUMENTS:
  AUTO_YES       ← --yes | -y
  continueMode   ← --continue
  maxConcurrency ← --concurrency | -c N  (default: 3)
  pipelineFlag   ← --pipeline targeted|standard|comprehensive
  scopeTarget    ← remaining text (file/module path)

Derive:
  dateStr       ← UTC+8 YYYYMMDD
  slug          ← first 3 meaningful words, kebab-case
  sessionId     ← "{dateStr}-tst-{slug}"
  sessionFolder ← ".workflow/.csv-wave/{sessionId}"
  skillRoot     ← resolve path to this skill directory

mkdir -p {sessionFolder}
```

When `--continue`: scan `.workflow/.csv-wave/*-tst-*/tasks.csv` for sessions with pending tasks. Single match → resume. Multiple → `request_user_input`. Read master tasks.csv → find first pending wave → jump to S_WAVE_{N}.

### Scope Detection + Pipeline Selection (S_CSV_GEN)

1. If `--pipeline` flag → use specified pipeline
2. Else detect from scope:
   - Count files and modules in scopeTarget
   - ≤3 files, ≤1 module → `targeted`
   - ≤10 files, ≤3 modules → `standard`
   - >10 files or >3 modules → `comprehensive`
3. Load pipeline wave assignments from csv_schema section above
4. For each task, build CSV row with PURPOSE/TASK/EXPECTED/CONSTRAINTS in description
5. Initialize lifecycle columns: `status=pending`, empty `findings`/`files_modified`/`pass_rate`/`coverage_score`/`error`
6. Write `tasks.csv` and empty `discoveries.ndjson`
7. User validation (skip if `-y`): display pipeline, task count, layer coverage targets

### Wave Execution (S_WAVE_{N})

1. Skip check: if all tasks in wave N completed/skipped → next wave
2. Cascading skip: if any dep is failed/blocked → skip dependents
3. Build `prev_context` from upstream findings
4. Write `wave-{N}.csv` with qualifying rows + `prev_context` column
5. `spawn_agents_on_csv` with output_schema (see below)
6. Merge results: `result_status` → master `status`
7. Cascade skip failed task dependents
8. Delete `wave-{N}.csv` and `wave-{N}-results.csv`
9. If wave was TESTRUN → transition to S_GC_CHECK

### GC Loop

After each TESTRUN wave:
1. Read `pass_rate` and `coverage_score`
2. pass_rate >= 0.95 AND coverage >= target → converged, continue
3. Not converged AND gc_rounds < 3 → add TESTGEN+TESTRUN rows, iterate
4. gc_rounds >= 3 → proceed with warning

### Instruction Builder

```
You are a team-testing agent.
Role: read 'role' column. Task: read 'description' column.

## Role Definition
Read: {skillRoot}/roles/{role}/role.md

## Context
Session: {sessionFolder}
Discovery board: {sessionFolder}/discoveries.ndjson
Previous context: 'prev_context' column

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting. NO exceptions.
- Success → result_status=completed after tests run / coverage measured
- Failure → result_status=failed with error message
- Blocked → cannot proceed without upstream fix → result_status=blocked
- Timeout → near max_runtime_seconds → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output (must match output_schema)
{
  "id": "<your CSV row id>",
  "result_status": "completed" | "failed" | "blocked",
  "findings": "<key findings, max 500 chars>",
  "files_modified": "<semicolon-separated paths or empty>",
  "pass_rate": "<0.0-1.0 or empty>" (TESTRUN only),
  "coverage_score": "<0-100 or empty>" (TESTRUN only),
  "error": "<message if not completed>"
}

## Hard Constraints
- Do NOT write to tasks.csv, wave-*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).
```

### Spawn output_schema

```json
{
  "type": "object",
  "properties": {
    "id":             { "type": "string" },
    "result_status":  { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":       { "type": "string", "maxLength": 500 },
    "files_modified": { "type": "string" },
    "pass_rate":      { "type": "string", "description": "0.0-1.0 ratio, e.g. 0.95" },
    "coverage_score": { "type": "string" },
    "error":          { "type": "string" }
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
| Strategy produces empty plan | Default to L1 unit tests only |
| Generator produces 0 tests | Mark blocked, skip executor |
| Coverage never converges | After 3 GC rounds, proceed with warning |
| All tests pass on first run | Normal — skip GC iterations |
</error_codes>

<success_criteria>
- [ ] Pipeline selected and CSV generated
- [ ] Waves executed via spawn_agents_on_csv
- [ ] GC loops iterate until converged or max 3
- [ ] pass_rate and coverage_score tracked per TESTRUN
- [ ] Column separation maintained
- [ ] results.csv and context.md generated
</success_criteria>
