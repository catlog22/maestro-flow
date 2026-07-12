---
name: team-quality-assurance
description: Team QA combining issue discovery and testing
argument-hint: "[scope] [-y|--yes] [-c|--concurrency N] [--continue] [--mode
  discovery|testing|full]"
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

<run_mode>
**Session mode:** `run`. This boundary is mandatory and overrides legacy Codex session-path examples below.

1. Before domain work, call `maestro run create team-quality-assurance -- $ARGUMENTS` and retain the returned `run_id`, `run_dir`, and `upstream`.
2. Formal deliverables go to `{run_dir}/outputs/`; evidence and worker traces go to `{run_dir}/evidence/`; synthesis and handoff go to `{run_dir}/report.md`.
3. Do not edit protocol JSON or append to project `state.json.artifacts[]`.
4. Finish with `maestro run check {run_id}` and `maestro run complete {run_id}`.

**Legacy Compatibility Mapping:** Later references to scratch, hidden command/team directories, milestones, phases, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` are semantic labels only. Map them into the active Run and never create a second formal truth source.
</run_mode>

<purpose>
Wave-based QA pipeline via `spawn_agents_on_csv`. Progressive test coverage through scout → strategy → generate → execute → analyze cycle with GC loops for coverage convergence.

```
+-------------------------------------------------------------------+
|                   QA CSV WAVE WORKFLOW                              |
+-------------------------------------------------------------------+
|  Phase 1: Mode Selection + CSV Generation                          |
|     +-- Detect mode (discovery/testing/full)                       |
|     +-- Build tasks.csv from pipeline definition                   |
|                                                                     |
|  Phase 2: Wave Execution Engine                                    |
|     +-- Sequential waves, parallel tasks within wave               |
|     +-- GC Loop: after QARUN wave, check coverage targets          |
|     |   +-- Coverage < target → add QAGEN+QARUN waves (max 3)     |
|     +-- discoveries.ndjson shared across waves                     |
|                                                                     |
|  Phase 3: Results Aggregation                                      |
+-------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$team-quality-assurance "src/auth module"
$team-quality-assurance -y --mode testing "src/payments"
$team-quality-assurance --continue "20260518-qa-auth"
```

**Flags**: `-y` (auto), `-c N` (concurrency, default 3), `--continue` (resume), `--mode discovery|testing|full`

### Role Registry (Fixed)

| Role | Path | Prefix |
|------|------|--------|
| scout | [roles/scout/role.md](roles/scout/role.md) | SCOUT-* |
| strategist | [roles/strategist/role.md](roles/strategist/role.md) | QASTRAT-* |
| generator | [roles/generator/role.md](roles/generator/role.md) | QAGEN-* |
| executor | [roles/executor/role.md](roles/executor/role.md) | QARUN-* |
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | QAANA-* |

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-qa-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md

### Scan Perspectives (scout)
bug, security, test-coverage, code-quality, ux
</context>

<csv_schema>

### tasks.csv (Input columns)

```csv
id,title,description,role,test_layer,deps,context_from,wave
```

| Column | Description |
|--------|-------------|
| `id` | Task ID: `{PREFIX}-{NNN}` or `{PREFIX}-L{layer}-{NNN}` |
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
| `coverage_score` | Test coverage % (0-100, for QARUN tasks) |
| `error` | Error message |

**Column separation rule**: Input and Output MUST NOT share names.

### Pipeline Wave Assignments

#### discovery (5 waves, serial)

| Wave | Task | Role |
|------|------|------|
| 1 | SCOUT-001 | scout |
| 2 | QASTRAT-001 | strategist |
| 3 | QAGEN-001 | generator |
| 4 | QARUN-001 | executor |
| 5 | QAANA-001 | analyst |

#### testing (6+ waves, GC loops)

| Wave | Task | Role |
|------|------|------|
| 1 | QASTRAT-001 | strategist |
| 2 | QAGEN-L1-001 | generator |
| 3 | QARUN-L1-001 | executor |
| 4+ | GC: QAGEN-L2 + QARUN-L2 if coverage < target | generator, executor |
| N | QAANA-001 | analyst |

#### full (8+ waves, parallel + GC)

| Wave | Task | Role |
|------|------|------|
| 1 | SCOUT-001 | scout |
| 2 | QASTRAT-001 | strategist |
| 3 | QAGEN-L1-001; QAGEN-L2-001 | generator (parallel) |
| 4 | QARUN-L1-001; QARUN-L2-001 | executor (parallel) |
| 5+ | GC loops if coverage < target | generator, executor |
| N-1 | QAANA-001 | analyst |
| N | SCOUT-002 | scout (regression) |

**Coverage Targets**: L1≥80%, L2≥60%, L3≥40%. **Max GC Rounds**: 3 per layer.
</csv_schema>

<invariants>
1. **Wave Order Sacred**: Sequential wave execution
2. **CSV Source of Truth**: Master tasks.csv
3. **Column Separation Rule**: Input ≠ Output column names
4. **GC Loop Max 3**: Per-layer generator-executor rounds
5. **Coverage Targets**: L1≥80%, L2≥60%, L3≥40%
6. **Discovery Board Append-Only**
7. **Cleanup Temp Files**: Both wave-N.csv and wave-N-results.csv
8. **DO NOT STOP**: Continuous until complete
9. **Role Files Authoritative**: Agents read roles/{role}/role.md
</invariants>

<state_machine>

<states>
S_PARSE      — Parse arguments, detect mode
S_CSV_GEN    — Generate tasks.csv
S_WAVE_{N}   — Execute wave N
S_GC_CHECK   — Coverage check after QARUN wave
S_AGGREGATE  — Generate report
</states>

<transitions>
S_PARSE → S_CSV_GEN
S_CSV_GEN → S_WAVE_1
S_WAVE_{N} → S_GC_CHECK      WHEN: wave was QARUN
S_WAVE_{N} → S_WAVE_{N+1}    WHEN: not GC-eligible
S_GC_CHECK → S_WAVE_{N+1}    WHEN: coverage >= target (converged)
S_GC_CHECK → S_WAVE_{N+1}    WHEN: coverage < target, gc_rounds < 3 (add QAGEN+QARUN rows)
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
  modeFlag       ← --mode discovery|testing|full
  scopeTarget    ← remaining text (file/module path)

Derive:
  dateStr       ← UTC+8 YYYYMMDD
  slug          ← first 3 meaningful words, kebab-case
  sessionId     ← "{dateStr}-qa-{slug}"
  sessionFolder ← ".workflow/.csv-wave/{sessionId}"
  skillRoot     ← resolve path to this skill directory

mkdir -p {sessionFolder}
```

When `--continue`: scan `.workflow/.csv-wave/*-qa-*/tasks.csv` for sessions with pending tasks. Single match → resume. Multiple → `request_user_input`. Read master tasks.csv → find first pending wave → jump to S_WAVE_{N}.

### CSV Generation (S_CSV_GEN)

1. Select mode: `--mode` flag, or detect from scope (single module → discovery, test files exist → testing, else → full)
2. Load pipeline wave assignments from csv_schema section above
3. For each task, build CSV row with PURPOSE/TASK/EXPECTED/CONSTRAINTS in description
4. Initialize lifecycle columns: `status=pending`, empty `findings`/`files_modified`/`coverage_score`/`error`
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
9. If wave was QARUN → transition to S_GC_CHECK

### GC Loop

After each QARUN wave:
1. Read `coverage_score` from results
2. coverage >= target → continue
3. coverage < target AND gc_rounds < 3 → add QAGEN+QARUN rows, increment wave, continue
4. gc_rounds >= 3 → proceed with warning

### Instruction Builder

```
You are a team-quality-assurance agent.
Role: read 'role' column. Task: read 'description' column.

## Role Definition
Read: {skillRoot}/roles/{role}/role.md

## Context
Session: {sessionFolder}
Discovery board: {sessionFolder}/discoveries.ndjson
Previous context: 'prev_context' column

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting. NO exceptions.
- Success → result_status=completed
- Failure → result_status=failed with error message
- Blocked → result_status=blocked when upstream missing
- Timeout → near max_runtime_seconds → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output (must match output_schema)
{
  "id": "<your CSV row id>",
  "result_status": "completed" | "failed" | "blocked",
  "findings": "<key findings, max 500 chars>",
  "files_modified": "<semicolon-separated paths or empty>",
  "coverage_score": "<0-100 or empty>" (QARUN only),
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
| Scout found 0 issues | Skip to analyst, report clean |
| Coverage never converges | After 3 GC rounds, proceed with warning |
| Generator produces 0 tests | Mark blocked, skip executor |
</error_codes>

<success_criteria>
- [ ] Mode selected and CSV generated
- [ ] Waves executed via spawn_agents_on_csv
- [ ] GC loops converge or hit max 3
- [ ] Coverage tracked per layer
- [ ] Column separation maintained
- [ ] Temp files cleaned
- [ ] results.csv and context.md generated
</success_criteria>
