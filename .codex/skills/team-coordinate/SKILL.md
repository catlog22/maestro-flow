---
name: team-coordinate
description: Universal team coordination with dynamic role generation
argument-hint: "[task description] [-y|--yes] [-c|--concurrency N] [--continue]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-role coordination via `spawn_agents_on_csv`. Dynamic role generation + linear wave execution with per-wave evaluation gates.

**Core difference from other team skills**: Roles are NOT predefined — they are dynamically generated from task analysis at runtime. Each role's behavioral instructions are encoded directly into the CSV `description` column, eliminating the need for role-spec files.

**Core workflow**: Analyze Task → Generate Dynamic Roles → Build CSV → Wave-by-Wave Execution with Evaluation → Aggregate Results

```
+-------------------------------------------------------------------+
|                  TEAM-COORDINATE CSV WAVE WORKFLOW                  |
+-------------------------------------------------------------------+
|                                                                     |
|  Phase 1: Task Analysis + CSV Generation                           |
|     +-- Parse task description (text-level only)                   |
|     +-- Signal detection → capability inference                    |
|     +-- Dynamic role generation (max 5 roles)                      |
|     +-- Wave assignment (4-tier linear topology)                   |
|     +-- Evaluation criteria per task                               |
|     +-- Build tasks.csv with role instructions in description      |
|     +-- User validates (skip if -y)                                |
|                                                                     |
|  Phase 2: Wave Execution Engine                                    |
|     +-- For each wave N (sequential):                              |
|     |   +-- EVALUATE: check evaluation_criteria vs findings        |
|     |   +-- Skip wave if all tasks evaluated out                   |
|     |   +-- Build prev_context from upstream findings              |
|     |   +-- spawn_agents_on_csv(wave-N.csv)                        |
|     |   +-- Merge results → master tasks.csv                       |
|     |   +-- Cascading skip on failure                              |
|     |   +-- Cleanup temp files                                     |
|     +-- discoveries.ndjson shared across all waves                 |
|                                                                     |
|  Phase 3: Results Aggregation                                      |
|     +-- Export results.csv                                         |
|     +-- Generate context.md                                        |
|     +-- Display summary with deliverables                          |
|                                                                     |
+-------------------------------------------------------------------+
```

</purpose>

<context>
```bash
$team-coordinate "design and implement auth module"
$team-coordinate -y -c 3 "analyze performance bottlenecks"
$team-coordinate --continue "20260518-team-auth-system"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 5)
- `--continue`: Resume existing session

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-team-{slug}/`
**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md

### Pre-load specs (optional)

1. `maestro spec load --category arch` — architecture constraints
2. `maestro search "<topic>"` — relevant knowhow
3. Proceed without if unavailable.

### Specs Reference

| Spec | Purpose |
|------|---------|
| [specs/role-catalog.md](specs/role-catalog.md) | Signal detection, role definitions, wave tiers, evaluation criteria, quality gates |
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,role,deps,context_from,wave,evaluation_criteria
"RESEARCH-001","Explore auth patterns","PURPOSE: Investigate authentication patterns in codebase | Success: Documented patterns with file references\nTASK:\n  - Scan src/ for existing auth implementations\n  - Identify JWT/session/OAuth patterns\n  - Document integration points\nCONTEXT:\n  - Key files: src/auth/**, src/middleware/**\nEXPECTED: Research findings with evidence\nCONSTRAINTS: Read-only analysis","researcher","","","1","always"
"DESIGN-001","Design auth architecture","PURPOSE: Design authentication module architecture | Success: Architecture doc with data model and API design\nTASK:\n  - Design token lifecycle\n  - Define middleware chain\n  - Specify error handling\nCONTEXT:\n  - Upstream: RESEARCH-001 findings\nEXPECTED: Architecture document\nCONSTRAINTS: Follow existing patterns","designer","RESEARCH-001","RESEARCH-001","2","if wave_1 findings indicate architecture decisions needed"
"IMPL-001","Implement auth module","PURPOSE: Implement authentication module | Success: Working auth with tests\nTASK:\n  - Create auth middleware\n  - Implement JWT utilities\n  - Add integration tests\nCONTEXT:\n  - Upstream: DESIGN-001 architecture\nEXPECTED: Source files + test coverage\nCONSTRAINTS: Follow design spec","developer","DESIGN-001","DESIGN-001","3","if wave_2 produced design artifacts"
"TEST-001","Validate auth implementation","PURPOSE: Validate auth module quality | Success: All tests pass, security checks clear\nTASK:\n  - Run full test suite\n  - Security audit on auth paths\n  - Verify error handling\nCONTEXT:\n  - Upstream: IMPL-001 files_modified\nEXPECTED: Test report + security findings\nCONSTRAINTS: No code modifications","tester","IMPL-001","IMPL-001","4","if wave_3 produced testable artifacts (files_modified non-empty)"
```

**Input columns** (present in initial tasks.csv and wave-N.csv):

| Column | Description |
|--------|-------------|
| `id` | Task ID: `{PREFIX}-{NNN}` (dynamic prefix from role catalog) |
| `title` | Short task title |
| `description` | **Full role-specific instructions** — PURPOSE, TASK steps, CONTEXT, EXPECTED, CONSTRAINTS. This replaces role-spec files. |
| `role` | Dynamic role name (from Phase 1 signal detection) |
| `deps` | Semicolon-separated dependency task IDs |
| `context_from` | Semicolon-separated task IDs whose findings needed as context |
| `wave` | Wave number (1-4) |
| `evaluation_criteria` | Condition: `always` or conditional expression |

**Lifecycle columns** (initialized in tasks.csv Phase 1, updated during execution):

| Column | Initial Value | Description |
|--------|--------------|-------------|
| `status` | `pending` | Task lifecycle: pending → completed/failed/blocked/skipped |
| `findings` | `""` | Populated from output_schema `result_status` merge |
| `files_modified` | `""` | Populated from output_schema merge |
| `error` | `""` | Populated from output_schema merge |

**Output columns** (returned exclusively via `output_schema`, NOT in wave CSV):

| Column | Description |
|--------|-------------|
| `result_status` | completed / failed / blocked (maps to master `status` during merge) |
| `findings` | Key findings summary (max 500 chars) |
| `files_modified` | Semicolon-separated file paths |
| `error` | Error message if failed |

**Column separation rule**: Input columns and output_schema MUST NOT share names. Wave CSV contains Input columns + `prev_context` (dynamic, built from upstream findings). Output columns returned via `output_schema` using `result_status` (not `status`). Merge mapping: `result_status` → master `status`.

**prev_context format** (added to wave-N.csv only):
```
--- TASK-ID: RESEARCH-001 ---
{findings from RESEARCH-001}
--- TASK-ID: DESIGN-001 ---
{findings from DESIGN-001}
```

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with Input columns + `prev_context` (populated from upstream task findings).

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state — all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `wave-{N}-results.csv` | Per-wave output (uses `result_status`) | Created by spawn_agents_on_csv, deleted after merge |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only across waves |
| `context.md` | Human-readable report | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-team-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- wave-{N}.csv (temporary)
+-- wave-{N}-results.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave N+1 before wave N completes and results merge
3. **CSV is Source of Truth**: Master tasks.csv holds all execution state
4. **Column Separation Rule**: Input columns and output_schema MUST NOT share names
5. **Context Propagation**: prev_context built from master CSV findings, not from memory
6. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
7. **Evaluate Before Execute**: Wave 2+ tasks MUST pass evaluation gate before inclusion
8. **Cascading Skip on Failure**: Failed/blocked tasks cascade skip to all dependents
9. **Cleanup Temp Files**: Delete `wave-{N}.csv` AND `wave-{N}-results.csv` after merge
10. **DO NOT STOP**: Continuous execution until all waves complete or user stops
11. **Max 5 Roles**: Dynamic role count capped at 5; merge overlapping if exceeded
12. **Dynamic Roles in CSV**: Role instructions encoded in `description` column, not in separate files
</invariants>

<state_machine>

<states>
S_PARSE      — Parse arguments, detect mode (new/continue)       PERSIST: —
S_ANALYZE    — Signal detection, role generation, task decomp     PERSIST: —
S_CSV_GEN    — Generate tasks.csv with dynamic roles              PERSIST: tasks.csv
S_EVAL_W1    — Evaluate Wave 1 (always passes)                    PERSIST: —
S_WAVE_1     — Execute Wave 1 (Analysis/Research)                 PERSIST: findings in master CSV
S_EVAL_W2    — Evaluate Wave 2 participation                      PERSIST: skipped tasks if any
S_WAVE_2     — Execute Wave 2 (Design/Planning)                   PERSIST: findings in master CSV
S_EVAL_W3    — Evaluate Wave 3 participation                      PERSIST: skipped tasks if any
S_WAVE_3     — Execute Wave 3 (Implementation)                    PERSIST: findings in master CSV
S_EVAL_W4    — Evaluate Wave 4 participation                      PERSIST: skipped tasks if any
S_WAVE_4     — Execute Wave 4 (Validation/Testing)                PERSIST: findings in master CSV
S_AGGREGATE  — Generate report, export results                    PERSIST: context.md, results.csv
</states>

<transitions>
S_PARSE → S_ANALYZE       WHEN: new session
S_PARSE → S_EVAL_W{N}     WHEN: --continue (resume at first pending wave)
S_ANALYZE → S_CSV_GEN
S_CSV_GEN → S_EVAL_W1

S_EVAL_W{N} → S_WAVE_{N}      WHEN: tasks qualify after evaluation
S_EVAL_W{N} → S_EVAL_W{N+1}   WHEN: all tasks skipped or no tasks in wave
S_WAVE_{N} → S_EVAL_W{N+1}    WHEN: wave complete, N < 4

S_EVAL_W4 → S_AGGREGATE       WHEN: after Wave 4 eval (regardless of skip)
S_WAVE_4 → S_AGGREGATE        WHEN: Wave 4 complete
</transitions>

<actions>

### Session Initialization (S_PARSE)

```
Parse from $ARGUMENTS:
  AUTO_YES        ← --yes | -y
  continueMode    ← --continue
  maxConcurrency  ← --concurrency | -c N  (default: 5)
  taskDescription ← remaining text after flag removal

Derive:
  dateStr        ← UTC+8 YYYYMMDD
  slug           ← first 3 meaningful words, kebab-case
  sessionId      ← "{dateStr}-team-{slug}"
  sessionFolder  ← ".workflow/.csv-wave/{sessionId}"

mkdir -p {sessionFolder}
```

### Session Resume (S_PARSE → S_EVAL_W{N})

When `--continue`:
1. Scan `.workflow/.csv-wave/*-team-*/tasks.csv` for sessions with pending tasks
2. Single match → resume. Multiple → `request_user_input` for selection.
3. Read master tasks.csv → find first wave with pending tasks → jump to S_EVAL_W{N}

### Phase 1: Task Analysis + CSV Generation (S_ANALYZE → S_CSV_GEN)

**TEXT-LEVEL analysis only. No codebase reading.**

1. **Parse task description**

2. **Clarify if ambiguous** (skip if `-y`):
   - Scope? (specific files, module, project-wide)
   - Deliverables? (documents, code, reports)
   - Constraints? (technology, style)

3. **Signal detection** — scan keywords against `specs/role-catalog.md` §1 Signal Detection Table:
   - Match keywords → capabilities → roles
   - No match → single `general` role

4. **Role minimization**:
   - Merge overlapping capabilities (e.g., "research + analysis" → single analyst)
   - Cap at 5 roles
   - Compute complexity score (§9 of role-catalog.md)

5. **Task decomposition** — for each role, create 1-3 tasks:
   - Generate structured `description` with PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS
   - This description IS the role instruction — no separate role-spec file
   - Infer key files from keywords (§8 of role-catalog.md)

6. **Wave assignment** — map roles to waves via §2 Wave Tier Mapping

7. **Evaluation criteria** — assign per task:
   - Wave 1: `"always"`
   - Wave 2+: conditional from §3 Evaluation Criteria Templates

8. **Dependency + context_from** — tasks in wave N depend on relevant tasks in wave N-1

9. **Write `tasks.csv`** with all rows (Input columns only, no status/findings)

10. **Write empty `discoveries.ndjson`**

11. **User validation** (skip if `-y`):
    - Display: role count, task count per wave, evaluation criteria summary
    - `request_user_input`: Proceed / Revise / Abort

### Phase 2: Wave Execution Engine (S_EVAL_W{N} → S_WAVE_{N})

For each wave N in ascending order (1 through 4):

#### Step 1: Evaluate (S_EVAL_W{N})

For each task in wave N with status=pending:
1. **Cascading check first**: if any task in `deps` OR `context_from` is failed/blocked/skipped → skip this task too
2. Read `evaluation_criteria` from master tasks.csv
3. If `"always"` → include
4. If conditional → read accumulated `findings` + `files_modified` from completed tasks in master CSV:
   - Evaluate condition as a natural language check against accumulated context
   - The coordinator interprets conditions semantically (e.g., "if wave_1 findings indicate design needed" → check if Wave 1 findings mention design/architecture keywords)
   - Condition met → include
   - Not met → set `status=skipped`, `error="evaluation: {criteria} not met"`

If no tasks qualify → skip to S_EVAL_W{N+1}. If ALL wave 1 tasks fail → abort pipeline, jump to S_AGGREGATE.

#### Step 2: Build prev_context

For each qualifying task:
- Read `context_from` task IDs
- Extract their `findings` from master CSV
- Concatenate as `prev_context` string

#### Step 3: Write wave-{N}.csv

Extract qualifying rows from master CSV. Add `prev_context` column.

#### Step 4: Execute (S_WAVE_{N})

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-${N}.csv`,    // only rows where wave==N AND status=="pending"
  id_column: "id",
  instruction: TEAM_COORDINATE_INSTRUCTION,       // see "Instruction Builder" section below
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-${N}-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:             { type: "string" },
      result_status:  { type: "string", enum: ["completed", "failed", "blocked"] },
      findings:       { type: "string", maxLength: 500 },
      files_modified: { type: "string", description: "Semicolon-separated paths" },
      error:          { type: "string" }
    },
    required: ["id", "result_status", "findings"]
  }
})
```

#### Step 5: Merge results

1. Read `wave-{N}-results.csv`
2. For each row: map `result_status` → master `status`, copy `findings`, `files_modified`, `error`
3. Update master `tasks.csv`

#### Step 6: Cascading skip

For each failed/blocked task in this wave:
- Find all downstream tasks (any task with this task in `deps`)
- Set their `status=skipped`, `error="upstream {id} failed"`

#### Step 7: Cleanup

Delete `wave-{N}.csv` AND `wave-{N}-results.csv`.

#### Step 8: Continue

Proceed to S_EVAL_W{N+1} (or S_AGGREGATE if N=4).

### Phase 3: Results Aggregation (S_AGGREGATE)

1. **Export results.csv** — copy master tasks.csv as final results

2. **Generate context.md**:
```markdown
# Team Coordinate Report: {taskDescription}

## Summary
- Roles: {role list with prefixes}
- Tasks: {completed}/{total} ({percent}%)
- Waves executed: {list of non-skipped waves}

## Wave Results
### Wave {N}: {stage name}
| Task | Role | Status | Findings |
|------|------|--------|----------|
| {id} | {role} | {status} | {findings} |

## Files Modified
{aggregated files_modified across all tasks}

## Discovery Board Summary
{key entries from discoveries.ndjson}

## Next Steps
{suggestions based on findings}
```

3. **Display completion report** with session path and deliverable locations

### Instruction Builder

The `instruction` parameter for `spawn_agents_on_csv` — shared behavioral contract:

```
You are a team-coordinate agent. Your role is specified in your CSV row's 'role' column.

## Your Task
Read your CSV row's 'description' column for full task instructions (PURPOSE, TASK, CONTEXT, EXPECTED, CONSTRAINTS).

## Context
- Session: {sessionFolder}
- Discovery board: {sessionFolder}/discoveries.ndjson (read before work, append findings)
- Previous wave context: read your CSV row's 'prev_context' column

## Role Behavior
Adopt the perspective and expertise matching your role:
- researcher: systematic investigation, evidence-based findings, hypothesis testing
- developer: implementation, code modification, testing, convergence verification
- analyst: multi-dimensional evaluation, scoring, gap identification
- designer: architecture, data models, interface design, component structure
- tester: validation, test creation, regression checking, security scanning
- planner: decomposition, sequencing, risk assessment, prioritization
- writer: documentation, content creation, clarity, consistency
- general: adapt to task requirements

## Quality Contract
1. Files claimed as created → verify they exist (Read)
2. Files claimed as modified → verify content changed (Read)
3. Verification fails → retry execution (max 2 retries)
4. Still fails → report result_status=blocked with error details
5. NEVER report completed without verification

## Discovery Board Protocol
Read {sessionFolder}/discoveries.ndjson before starting work.
Append findings as NDJSON lines:
{"ts":"<ISO>","worker":"<TASK-ID>","type":"<TYPE>","data":{...}}
Types: code_pattern, integration_point, convention, blocker, key_finding, decision

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting. NO exceptions.
- Success path → result_status=completed after verification passes
- Failure path → unrecoverable error (build fails, scope unclear, contract violation) → result_status=failed with error message
- Blocked path → cannot proceed without upstream fix → result_status=blocked with error explaining what is needed
- Timeout path → approaching max_runtime_seconds → revert partial unsafe work, report blocked with error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Output
Return via output_schema (matches schema declared in spawn call):
- id: your CSV row id (mandatory)
- result_status: completed | failed | blocked (mandatory)
- findings: key findings summary (max 500 chars, be specific and actionable)
- files_modified: semicolon-separated paths of created/modified files (empty if none)
- error: error message if result_status is not completed (empty otherwise)

## Hard Constraints
- Do NOT write to tasks.csv, wave-*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).
```

</actions>
</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| code_pattern | pattern_name | {name, location, description, usage} |
| integration_point | endpoint | {endpoint, consumers[], producers[], protocol} |
| convention | name | {name, description, examples[], scope} |
| blocker | issue | {issue, severity, affected_tasks[], workaround} |
| key_finding | topic | {topic, evidence, implications, confidence} |
| decision | subject | {subject, choice, rationale, alternatives[]} |

Protocol: read before work, append-only, dedup by type+key.
</discovery_board>

<error_codes>

| Condition | Recovery |
|-----------|----------|
| No capabilities detected | Default to single `general` role in wave 1 |
| All wave 1 tasks failed | Abort pipeline (downstream has no context) |
| All tasks in wave N failed | Skip subsequent waves, proceed to aggregation |
| Evaluation skipped all tasks in wave | Normal — skip wave, continue to next |
| Task timeout | Mark failed, cascade skip dependents |
| Session not found (--continue) | Error with available session list |
| tasks.csv corrupted | Error, suggest manual recovery or new session |
| Role count exceeds 5 | Auto-merge overlapping roles |
</error_codes>

<success_criteria>
- [ ] Dynamic roles generated from task description keywords
- [ ] tasks.csv created with role instructions in description column
- [ ] Wave 1 executed with at least 1 task
- [ ] Wave 2-4 evaluation gates applied (tasks included, skipped, or wave skipped)
- [ ] prev_context built from upstream findings for each wave
- [ ] Column separation rule maintained (no shared names between input and output)
- [ ] wave-N.csv and wave-N-results.csv deleted after merge
- [ ] discoveries.ndjson append-only throughout
- [ ] results.csv and context.md generated in Phase 3
- [ ] Session resumable via --continue
</success_criteria>
