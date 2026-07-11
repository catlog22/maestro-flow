---
name: team-lifecycle-v4
description: Full lifecycle team -- plan, develop, test, review
orchestration_kind: terminal_pipeline
argument-hint: "[task description] [-y|--yes] [-c|--concurrency N] [--continue] [--pipeline spec-only|impl-only|full-lifecycle]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based lifecycle orchestration via `spawn_agents_on_csv`. Fixed roles with pre-defined pipelines: specification → planning → implementation → testing → review.

**Core workflow**: Select Pipeline → Build CSV from Pipeline Definition → Wave-by-Wave Execution → Aggregate Results

**Nested Execution**: When nested inside maestro-player, this skill behaves as a solo terminal barrier, claiming lifecycle_owner and checkpoint_owner ownership, and outer orchestrators must not run redundant stages (plan/execute/test/review) on the same scope.

```
+-------------------------------------------------------------------+
|                LIFECYCLE V4 CSV WAVE WORKFLOW                       |
+-------------------------------------------------------------------+
|                                                                     |
|  Phase 1: Pipeline Selection + CSV Generation                      |
|     +-- Detect pipeline from keywords or --pipeline flag           |
|     +-- Load pipeline definition from specs/pipelines.md           |
|     +-- Build tasks.csv with wave assignments                      |
|     +-- User validates (skip if -y)                                |
|                                                                     |
|  Phase 2: Wave Execution Engine                                    |
|     +-- For each wave N (sequential):                              |
|     |   +-- Build prev_context from upstream findings              |
|     |   +-- spawn_agents_on_csv(wave-N.csv)                        |
|     |   +-- Each agent reads its role.md for domain logic          |
|     |   +-- Merge results → master tasks.csv                       |
|     |   +-- CHECKPOINT waves: supervisor verifies quality          |
|     |   +-- User approval at checkpoints (skip if -y)              |
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
$team-lifecycle-v4 "build user authentication system"
$team-lifecycle-v4 -y --pipeline spec-only "design payment module"
$team-lifecycle-v4 --pipeline impl-only "implement auth from existing spec"
$team-lifecycle-v4 --continue "20260518-tlv4-auth-system"
```

**Flags**:
- `-y, --yes`: Skip confirmations and checkpoint approvals
- `-c, --concurrency N`: Max concurrent agents per wave (default: 3)
- `--continue`: Resume existing session
- `--pipeline`: Force pipeline (spec-only, impl-only, full-lifecycle)
- `--no-supervision`: Skip CHECKPOINT tasks (opt-out from supervisor quality gates)

### Role Registry (Fixed)

| Role | Path | Prefix |
|------|------|--------|
| analyst | [roles/analyst/role.md](roles/analyst/role.md) | RESEARCH-* |
| writer | [roles/writer/role.md](roles/writer/role.md) | DRAFT-* |
| planner | [roles/planner/role.md](roles/planner/role.md) | PLAN-* |
| executor | [roles/executor/role.md](roles/executor/role.md) | IMPL-* |
| tester | [roles/tester/role.md](roles/tester/role.md) | TEST-* |
| reviewer | [roles/reviewer/role.md](roles/reviewer/role.md) | REVIEW-*, QUALITY-* |
| supervisor | [roles/supervisor/role.md](roles/supervisor/role.md) | CHECKPOINT-* |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-tlv4-{slug}/
+-- tasks.csv              (master state)
+-- results.csv            (final export)
+-- discoveries.ndjson     (cross-wave shared)
+-- context.md             (human-readable report)
+-- spec/                  (spec phase outputs)
+-- plan/                  (implementation plan)
+-- artifacts/             (all deliverables)
+-- wave-{N}.csv           (temporary)
+-- wave-{N}-results.csv   (temporary)
```

**Output**: tasks.csv, results.csv, discoveries.ndjson, context.md, spec/, plan/, artifacts/

### Specs Reference

| Spec | Purpose |
|------|---------|
| [specs/pipelines.md](specs/pipelines.md) | Pipeline definitions, task registry, wave assignments |
| [specs/quality-gates.md](specs/quality-gates.md) | Quality thresholds and scoring dimensions |

### Templates Reference

| Template | Used By |
|----------|---------|
| [templates/product-brief.md](templates/product-brief.md) | writer (DRAFT-001) |
| [templates/requirements.md](templates/requirements.md) | writer (DRAFT-002) |
| [templates/architecture.md](templates/architecture.md) | writer (DRAFT-003) |
| [templates/epics.md](templates/epics.md) | writer (DRAFT-004) |
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,role,pipeline_phase,deps,context_from,wave
"RESEARCH-001","Domain research","PURPOSE: Research domain, competitors, constraints | Success: Discovery context packaged\nTASK:\n  - Analyze problem space\n  - Explore codebase patterns\n  - Package context\nEXPECTED: spec/discovery-context.json\nCONSTRAINTS: Read-only","analyst","research","","","1"
"DRAFT-001","Product brief","PURPOSE: Create product brief | Success: Self-validated document\nTASK:\n  - Apply templates/product-brief.md\n  - Define vision, problem, users, goals\n  - Self-validate against quality-gates.md §3.1\nEXPECTED: spec/product-brief.md\nCONSTRAINTS: Follow template","writer","product-brief","RESEARCH-001","RESEARCH-001","2"
```

**Input columns** (present in initial tasks.csv and wave-N.csv):

| Column | Description |
|--------|-------------|
| `id` | Task ID: `{PREFIX}-{NNN}` |
| `title` | Short task title |
| `description` | Task instructions (PURPOSE/TASK/EXPECTED/CONSTRAINTS) |
| `role` | Fixed role name from registry |
| `pipeline_phase` | Phase identifier (research, product-brief, requirements, etc.) |
| `deps` | Semicolon-separated dependency task IDs |
| `context_from` | Semicolon-separated task IDs for context |
| `wave` | Wave number |

**Lifecycle columns** (initialized with defaults, updated during execution):

| Column | Initial Value | Description |
|--------|--------------|-------------|
| `status` | `pending` | Task lifecycle: pending → completed/failed/blocked/skipped |
| `findings` | `""` | Populated from output_schema `result_findings` during merge |
| `files_modified` | `""` | Populated from output_schema `result_files_modified` during merge |
| `quality_score` | `""` | Populated from output_schema `result_quality_score` during merge |
| `error` | `""` | Populated from output_schema `result_error` during merge |

**Dynamic column** (added to wave-N.csv only, not in initial tasks.csv):

| Column | Description |
|--------|-------------|
| `prev_context` | Concatenated findings from context_from tasks, format: `--- TASK-ID: {id} ---\n{findings}` |

**Output columns** (via `output_schema` only, NOT in any CSV input):

| Column | Description |
|--------|-------------|
| `result_status` | completed / failed / blocked (maps to master `status`) |
| `result_findings` | Key findings (max 500 chars) → maps to master `findings` |
| `result_files_modified` | Semicolon-separated paths → maps to master `files_modified` |
| `result_quality_score` | Numeric quality score (0-100) → maps to master `quality_score` |
| `result_error` | Error message if failed → maps to master `error` |

**Column separation rule**: Input/lifecycle columns and output_schema MUST NOT share names. Merge mapping: `result_status` → `status`, `result_findings` → `findings`, `result_files_modified` → `files_modified`, `result_quality_score` → `quality_score`, `result_error` → `error`.

### Pipeline Wave Assignments

#### spec-only (8 waves)

| Wave | Task | Role | Notes |
|------|------|------|-------|
| 1 | RESEARCH-001 | analyst | Domain research |
| 2 | DRAFT-001 | writer | Product brief |
| 3 | DRAFT-002 | writer | Requirements PRD |
| 4 | CHECKPOINT-001 | supervisor | Brief↔PRD consistency |
| 5 | DRAFT-003 | writer | Architecture |
| 6 | DRAFT-004 | writer | Epics & stories |
| 7 | CHECKPOINT-002 | supervisor | Full spec consistency |
| 8 | QUALITY-001 | reviewer | Readiness gate |

#### impl-only (5 waves)

| Wave | Task | Role | Notes |
|------|------|------|-------|
| 1 | PLAN-001 | planner | Implementation planning |
| 2 | CHECKPOINT-003 | supervisor | Plan↔input alignment |
| 3 | IMPL-001(~N) | executor | Implementation (parallel if multiple) |
| 4 | TEST-001 + REVIEW-001 | tester + reviewer | Validation (parallel) |
| 5 | (reserved) | — | For IMPROVE tasks if review finds issues |

#### full-lifecycle (13 waves)

spec-only waves 1-8 + user approval checkpoint + impl-only waves shifted.

| Wave | Task | Role |
|------|------|------|
| 1-8 | (spec-only pipeline) | (see above) |
| 9 | PLAN-001 | planner |
| 10 | CHECKPOINT-003 | supervisor |
| 11 | IMPL-001(~N) | executor |
| 12 | TEST-001 + REVIEW-001 | tester + reviewer |
| 13 | (reserved) | — |
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization
2. **Wave Order is Sacred**: Execute waves sequentially
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Column Separation Rule**: Input and output_schema columns MUST NOT share names
5. **Context Propagation**: prev_context from master CSV findings
6. **Discovery Board is Append-Only**: Never clear/modify discoveries.ndjson
7. **Cascading Skip on Failure**: Failed tasks cascade to dependents
8. **Cleanup Temp Files**: Delete wave-N.csv and wave-N-results.csv after merge
9. **Checkpoint Pause**: After CHECKPOINT waves, pause for user approval (skip if -y). Record approval decision in master tasks.csv (`status=approved|revision_requested|aborted`) and persist gate state to `{sessionFolder}/gate-{checkpoint_id}.json`
10. **DO NOT STOP**: Continuous execution between checkpoints
11. **Role Files are Authoritative**: Agents read roles/{role}/role.md for domain logic
</invariants>

<state_machine>

<states>
S_PARSE      — Parse arguments, detect pipeline               PERSIST: —
S_PIPELINE   — Select and validate pipeline                    PERSIST: —
S_CSV_GEN    — Generate tasks.csv from pipeline definition     PERSIST: tasks.csv
S_WAVE_{N}   — Execute wave N                                  PERSIST: findings in master CSV
S_CHECKPOINT — User approval after checkpoint wave             PERSIST: —
S_AGGREGATE  — Generate report, export results                 PERSIST: context.md, results.csv
</states>

<transitions>
S_PARSE → S_PIPELINE      WHEN: new session
S_PARSE → S_WAVE_{N}      WHEN: --continue (resume at first pending wave)
S_PIPELINE → S_CSV_GEN
S_CSV_GEN → S_WAVE_1

S_WAVE_{N} → S_CHECKPOINT     WHEN: wave N was a CHECKPOINT task
S_WAVE_{N} → S_WAVE_{N+1}     WHEN: wave N not checkpoint, more waves
S_WAVE_{N} → S_AGGREGATE      WHEN: last wave complete

S_CHECKPOINT → S_WAVE_{N+1}   WHEN: user approves or -y (persist: set CHECKPOINT task status=approved in tasks.csv, write gate-{id}.json)
S_CHECKPOINT → S_WAVE_{N}     WHEN: user requests revision (persist: set CHECKPOINT task status=revision_requested in tasks.csv, write gate-{id}.json with feedback)
S_CHECKPOINT → S_AGGREGATE    WHEN: user aborts (persist: set CHECKPOINT task status=aborted in tasks.csv, write gate-{id}.json)
</transitions>

<actions>

### Session Initialization (S_PARSE)

```
Parse from $ARGUMENTS:
  AUTO_YES        ← --yes | -y
  continueMode    ← --continue
  maxConcurrency  ← --concurrency | -c N  (default: 3)
  pipelineFlag    ← --pipeline spec-only|impl-only|full-lifecycle
  noSupervision   ← --no-supervision (skip CHECKPOINT tasks)
  taskDescription ← remaining text

Derive:
  dateStr        ← UTC+8 YYYYMMDD
  slug           ← first 3 meaningful words, kebab-case
  sessionId      ← "{dateStr}-tlv4-{slug}"
  sessionFolder  ← ".workflow/.csv-wave/{sessionId}"
  skillRoot      ← resolve path to this skill directory

mkdir -p {sessionFolder}/{spec,plan,artifacts}
```

### Pipeline Selection (S_PIPELINE)

1. If `--pipeline` flag → use specified pipeline
2. Else scan task description keywords against [specs/pipelines.md](specs/pipelines.md) §1:
   - spec/design/document/requirements → `spec-only`
   - implement/build/fix/code → `impl-only`
   - full/lifecycle/end-to-end → `full-lifecycle`
   - Ambiguous → `request_user_input`
3. Validate pipeline selection

### CSV Generation (S_CSV_GEN)

1. Load pipeline definition from [specs/pipelines.md](specs/pipelines.md)
2. **Supervision opt-out**: if `--no-supervision`, filter out all CHECKPOINT-* tasks from pipeline. Adjust deps: tasks that depended on CHECKPOINT tasks now depend on the CHECKPOINT's upstream instead.
3. For each task in pipeline, build CSV row:
   - `id`: from task registry (RESEARCH-001, DRAFT-001, etc.)
   - `description`: PURPOSE/TASK/EXPECTED/CONSTRAINTS with session-specific context
   - `role`: from registry
   - `pipeline_phase`: from registry
   - `deps`: from pipeline dependency chain
   - `context_from`: same as deps (upstream findings needed)
   - `wave`: from pipeline wave assignment table (recalculate if checkpoints removed)
4. Initialize lifecycle columns: `status=pending`, empty `findings`/`files_modified`/`quality_score`/`error`
5. Write `tasks.csv`
6. Write empty `discoveries.ndjson`
7. User validation (skip if `-y`): display pipeline, task count, wave structure

### Wave Execution Engine (S_WAVE_{N})

For each wave N:

#### Step 1: Skip check
- If all tasks in wave N are already completed/skipped → skip to next wave
- If any dep is failed/blocked → cascade skip

#### Step 2: Build prev_context
For each task in wave N:
- Read `context_from` task IDs → extract their `findings` from master CSV
- Concatenate as `prev_context`

#### Step 3: Write wave-{N}.csv
Extract wave N rows + add `prev_context` column.

#### Step 4: Execute

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-${N}.csv`,    // only rows where wave==N AND status=="pending"
  id_column: "id",
  instruction: buildLifecycleInstruction(sessionFolder, skillRoot),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-${N}-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:                    { type: "string" },
      result_status:         { type: "string", enum: ["completed", "failed", "blocked"] },
      result_findings:       { type: "string", maxLength: 500 },
      result_files_modified: { type: "string", description: "Semicolon-separated paths" },
      result_quality_score:  { type: "string", description: "0-100" },
      result_error:          { type: "string" }
    },
    required: ["id", "result_status", "result_findings"]
  }
})
```

#### Step 5: Merge + Cleanup
1. Map `result_status` → master `status`
2. Map `result_findings` → master `findings`, `result_files_modified` → master `files_modified`, `result_quality_score` → master `quality_score`, `result_error` → master `error`
3. Delete `wave-{N}.csv` AND `wave-{N}-results.csv`
4. Cascade skip failed task dependents

#### Step 6: Checkpoint handling
If wave N was a CHECKPOINT task:
- Read supervisor's `result_findings` and `result_quality_score`
- If quality_score >= 80 (pass) → continue
- If 60-79 (review) → display warnings, continue (or pause if not -y)
- If < 60 (fail) → pause for user: Revise / Override / Abort
- **Persist approval decision**:
  1. Update CHECKPOINT task `status` in master tasks.csv to `approved` / `revision_requested` / `aborted`
  2. Write `{sessionFolder}/gate-{checkpoint_id}.json`:
     ```json
     {"checkpoint_id":"<id>","decision":"approved|revision_requested|aborted","quality_score":<N>,"feedback":"<user feedback if any>","timestamp":"<ISO>"}
     ```
  3. On `--continue` resume, read gate files to restore checkpoint state

### Instruction Builder

```
You are a team-lifecycle-v4 agent executing a software development task.

## Your Identity
- Role: read from your CSV row 'role' column
- Task: read from your CSV row 'description' column (PURPOSE/TASK/EXPECTED/CONSTRAINTS)
- Phase: read from your CSV row 'pipeline_phase' column

## Role Definition
Read your detailed role instructions from:
  {skillRoot}/roles/{role}/role.md

Follow the execution protocol defined in your role.md (Phase 2-4 structure).

For roles with commands/ subdirectory, load the relevant command file based on your task type.

## Context
- Session: {sessionFolder}
- Discovery board: {sessionFolder}/discoveries.ndjson (read before work, append findings)
- Previous context: read your CSV row 'prev_context' column
- Templates: {skillRoot}/templates/ (for writer role)
- Quality gates: {skillRoot}/specs/quality-gates.md

## Quality Contract
1. Verify all outputs exist before reporting completed
2. Include quality_score (0-100) based on specs/quality-gates.md criteria
3. Retry on verification failure (max 2 retries)
4. Report blocked if still failing after retries

## Termination Contract (MANDATORY)
You MUST call report_agent_job_result EXACTLY ONCE before exiting. NO exceptions.
- Success → result_status=completed after all verifications pass
- Failure → result_status=failed with error message (build error, file write fail)
- Blocked → result_status=blocked when upstream missing OR after retries exhausted
- Timeout → near max_runtime_seconds → revert partial unsafe work → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

## Hard Constraints
- Do NOT write to tasks.csv, wave-*.csv, results.csv (orchestrator owns those).
- Do NOT call spawn_agents_on_csv (no recursion).

## Discovery Protocol
Write task output to {sessionFolder}/discoveries/{task_id}.json:
{
  "task_id": "<id>", "role": "<role>", "status": "<result_status>",
  "findings": "<summary>", "quality_score": <N>,
  "artifacts_produced": ["<paths>"], "files_modified": ["<paths>"]
}

Append to {sessionFolder}/discoveries.ndjson:
{"ts":"<ISO>","worker":"<id>","type":"<pipeline_phase>","data":{...}}

## Output
Return via output_schema:
- result_status: completed | failed | blocked
- result_findings: key findings (max 500 chars)
- result_files_modified: semicolon-separated paths
- result_quality_score: 0-100 per quality-gates.md
- result_error: error message if not completed
```

### Results Aggregation (S_AGGREGATE)

1. Export `results.csv`
2. Generate `context.md`:
   - Pipeline type, task count, completed/failed/skipped
   - Per-wave results with quality scores
   - Checkpoint verdicts
   - Files modified
   - Discovery summary
   - Next steps (if spec-only: suggest impl-only; if impl: suggest deploy)
3. Display completion report

</actions>
</state_machine>

<discovery_board>

| Type | Dedup Key | Data |
|------|-----------|------|
| research_finding | topic | {topic, evidence, implications} |
| spec_artifact | doc_type | {doc_type, path, summary, quality_score} |
| architecture_decision | subject | {subject, choice, rationale, alternatives[]} |
| implementation_note | module | {module, pattern, files[], notes} |
| test_result | suite | {suite, pass_rate, failures[], coverage} |
| review_finding | dimension | {dimension, severity, location, recommendation} |
| checkpoint_verdict | checkpoint_id | {id, score, checks[], verdict} |

Protocol: read before work, append-only, dedup by type+key.
</discovery_board>

<error_codes>

| Condition | Recovery |
|-----------|----------|
| Pipeline detection ambiguous | request_user_input for pipeline selection |
| RESEARCH-001 failed | Abort spec pipeline (no context for drafting) |
| DRAFT task failed | Skip subsequent DRAFTs, proceed to checkpoint |
| CHECKPOINT verdict: block | Pause for user (Revise/Override/Abort) |
| PLAN-001 failed | Abort impl pipeline |
| IMPL task failed | Cascade skip to TEST + REVIEW |
| Session not found (--continue) | Error with available sessions |
| Role file missing | Error with role registry |
| Quality score < 60 after revision | Escalate to user |
</error_codes>

<success_criteria>
- [ ] Pipeline selected and validated
- [ ] tasks.csv generated with correct wave assignments
- [ ] Each wave executed via spawn_agents_on_csv
- [ ] Agents read role.md for domain-specific logic
- [ ] Column separation rule maintained
- [ ] wave-N.csv and wave-N-results.csv deleted after merge
- [ ] Checkpoint waves pause for user approval (unless -y)
- [ ] Quality scores reported per task
- [ ] discoveries.ndjson append-only
- [ ] results.csv and context.md generated
- [ ] Session resumable via --continue
- [ ] Spec artifacts written to spec/ directory
- [ ] Plan artifacts written to plan/ directory
</success_criteria>
