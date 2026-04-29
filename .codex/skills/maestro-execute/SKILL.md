---
name: maestro-execute
description: Wave-based parallel task execution via CSV wave pipeline. Reads plan.json to build CSV with pre-computed waves, executes tasks in parallel per wave with cross-wave context propagation. Core execution engine replacing maestro-execute command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--auto-commit] [--method agent|cli] [--dir <path>]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based parallel task execution using `spawn_agents_on_csv`. Reads plan.json to build a CSV where waves are pre-computed from the plan. Each wave runs tasks in parallel, with cross-wave context propagation via `prev_context`. This is the core execution engine of the maestro pipeline.

**Core workflow**: Load Plan -> Build CSV from Tasks -> Wave-by-Wave Parallel Execution -> Aggregate Results

**Topology**: Custom (waves inherited from plan.json -- no Kahn's algorithm needed)

```
+---------------------------------------------------------------------------+
|                    TASK EXECUTION CSV WAVE WORKFLOW                        |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Plan Resolution -> CSV                                          |
|     +-- Resolve phase directory (or --dir path)                           |
|     +-- Read plan.json + .task/TASK-*.json definitions                    |
|     +-- Detect completed tasks (breakpoint resume)                        |
|     +-- Build tasks.csv with one row per pending task                     |
|     +-- Waves inherited from plan.json (pre-computed)                     |
|     +-- Load project specs for executor context                           |
|     +-- User validates task breakdown (skip if -y)                        |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- For each wave (sequential):                                       |
|     |   +-- Wave N: Task Execution (parallel within wave)                 |
|     |   |   +-- Each agent implements one task                            |
|     |   |   +-- Agent reads task definition + convergence criteria        |
|     |   |   +-- Agent creates/modifies files per task.files               |
|     |   |   +-- Agent verifies convergence.criteria (max 3 fix attempts)  |
|     |   |   +-- Agent writes .summaries/TASK-{NNN}-summary.md             |
|     |   |   +-- Atomic commit if --auto-commit                            |
|     |   |   +-- Discoveries shared via board (patterns, blockers)         |
|     |   +-- Merge wave results into master tasks.csv                      |
|     |   +-- Build prev_context for next wave from completed findings      |
|     |   +-- If blocked tasks: prompt user (skip if -y: auto-continue)     |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv                                                |
|     +-- Update .task/TASK-*.json statuses                                 |
|     +-- Update index.json execution progress                             |
|     +-- Update state.json project progress                               |
|     +-- Generate context.md with execution report                        |
|     +-- Auto-sync codebase docs (if configured)                          |
|     +-- Display summary with next steps                                  |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$maestro-execute "3"
$maestro-execute -c 4 "3 --auto-commit"
$maestro-execute -y "3 --method cli"
$maestro-execute "3 --dir .workflow/scratch/quick-fix"
$maestro-execute --continue "20260318-execute-P3-phase3"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 5)
- `--continue`: Resume existing session

**Inner flags** (passed inside quotes):
- `--auto-commit`: Atomic git commit after each task completion
- `--method agent|cli`: Override execution method (default: from config.json)
- `--dir <path>`: Use arbitrary directory instead of phase resolution (scratch mode)

When `--yes` or `-y`: Auto-confirm task breakdown, skip blocked-task prompts, auto-continue through all waves.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,scope,convergence_criteria,hints,execution_directives,deps,context_from,wave,status,findings,files_modified,tests_passed,error
"TASK-001","Setup auth module","Create authentication module with JWT token generation and verification. Export verifyToken and generateToken functions.","src/auth/","auth.ts contains export function verifyToken(; auth.ts contains export function generateToken(","Reference existing middleware pattern in src/middleware/auth.ts","npm test -- --grep auth","","","1","","","","",""
"TASK-002","Create user model","Define User interface and database schema with email, passwordHash, role fields. Use existing Result type pattern.","src/models/","user.ts contains export interface User; user.ts contains email: string","See src/models/session.ts for existing model pattern","npm test -- --grep user","","","1","","","","",""
"TASK-003","Auth middleware","Create Express middleware that validates JWT from Authorization header. Use verifyToken from auth module. Return 401 on invalid token.","src/middleware/","auth-middleware.ts contains export function authMiddleware(; auth-middleware.ts contains verifyToken","Follows existing middleware pattern in src/middleware/logging.ts","npm test -- --grep middleware","TASK-001","TASK-001","2","","","","",""
"TASK-004","Login endpoint","Implement POST /api/login endpoint. Validate credentials against user model, return JWT on success. Use generateToken from auth module.","src/routes/","login.ts contains router.post('/api/login'; login.ts contains generateToken(","Wire into existing Express app in src/app.ts","curl -X POST localhost:3000/api/login","TASK-001;TASK-002","TASK-001;TASK-002","2","","","","",""
"TASK-005","Integration tests","Write integration tests for full auth flow: register, login, access protected route, token refresh.","tests/","tests/auth.test.ts exists; npm test exits with code 0","Use existing test setup in tests/setup.ts","npm test","TASK-003;TASK-004","TASK-003;TASK-004","3","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Task ID (TASK-NNN format, from plan.json) |
| `title` | Input | Short task title from task definition |
| `description` | Input | Full task description from TASK-*.json |
| `scope` | Input | Target file/directory glob from task.files |
| `convergence_criteria` | Input | Grep-verifiable completion criteria (semicolon-separated) |
| `hints` | Input | Implementation hints + reference files from task definition |
| `execution_directives` | Input | Verification commands to run after implementation |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number from plan.json wave assignment |
| `status` | Output | `pending` -> `completed` / `failed` / `blocked` / `skipped` |
| `findings` | Output | Implementation notes and observations (max 500 chars) |
| `files_modified` | Output | Semicolon-separated list of created/modified files |
| `tests_passed` | Output | Test pass/fail status from execution_directives |
| `error` | Output | Error message if failed or blocked |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column populated from predecessor task findings.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `wave-{N}-results.csv` | Per-wave output | Created by spawn_agents_on_csv |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable execution report | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-execute-P{N}-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- config.json
+-- wave-{N}.csv (temporary)
+-- wave-{N}-results.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave N+1 before wave N completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all execution state
4. **Context Propagation**: prev_context built from master CSV findings, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Cascading Skip on Failure**: If a task fails/blocks, all dependent tasks are skipped
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **Max 3 Fix Attempts**: Per task, auto-fix convergence failures up to 3 times, then mark blocked
9. **Breakpoint Resume**: Always detect completed tasks and skip them on re-run
10. **DO NOT STOP**: Continuous execution until all waves complete or user explicitly stops
</invariants>

<execution>

### Session Initialization

```
Parse from $ARGUMENTS:
  AUTO_YES        ← --yes | -y
  continueMode    ← --continue
  maxConcurrency  ← --concurrency | -c N  (default: 5)
  autoCommit      ← --auto-commit
  executionMethod ← --method agent|cli  (default: from config.json)
  scratchDir      ← --dir <path>  (default: null)
  phaseArg        ← remaining text after flag removal

Derive:
  dateStr        ← UTC+8 YYYYMMDD
  sessionId      ← scratchDir ? "{dateStr}-execute-scratch" : "{dateStr}-execute-P{phaseArg}-{phaseSlug}"
  sessionFolder  ← ".workflow/.csv-wave/{sessionId}"

mkdir -p {sessionFolder}
```

### Phase 1: Plan Resolution -> CSV

**Objective**: Resolve phase, load plan + task definitions, detect resume point, generate tasks.csv.

**Decomposition Rules**:

1. **Plan resolution** (per scratch-milestone-architecture):

| Input | Resolution |
|-------|------------|
| `--dir <path>` | Use path directly (scratch plan dir) |
| No args | Find all pending plans for current milestone from state.json.artifacts[] |
| Number (e.g., `3`) | Find pending plans for phase N from state.json.artifacts[] |

   For multi-plan: execute sequentially. Each plan is a full CSV session.

2. **Load plan**: Read `{PLAN_DIR}/plan.json` for wave structure and task assignments

3. **Detect completed tasks (breakpoint resume)**: Read `.task/TASK-{NNN}.json` for each task; exclude completed ones from CSV. Log resume count.

4. **Build tasks.csv**: For each pending task per wave, read `.task/TASK-{NNN}.json` and extract: title, description, scope (from files), convergence.criteria, hints, execution_directives. Set `deps` from task dependency, `context_from` = deps, `wave` from plan.json.

5. **Load project specs**: Read `.workflow/specs/` for coding conventions and architecture constraints (passed to all agents)

6. **User validation**: Display task/wave breakdown. Skip if AUTO_YES.

### Phase 2: Wave Execution Engine

**Objective**: Execute tasks wave-by-wave via spawn_agents_on_csv with cross-wave context propagation.

#### Per-Wave Execution Loop

For each wave N in ascending order:

1. Extract wave N pending rows from master `tasks.csv` (skip wave if none)
2. Build `prev_context` per task from completed predecessor findings
3. Write `wave-{N}.csv` with `prev_context` column, then execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-${N}.csv`,
  id_column: "id",
  instruction: buildExecutorInstruction(sessionFolder, phaseDir, autoCommit, specsContent),
  max_concurrency: maxConcurrency, max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-${N}-results.csv`,
  output_schema: { id, status: [completed|failed|blocked], findings, files_modified, tests_passed, error }
})
```

4. Merge results into master `tasks.csv`, delete `wave-{N}.csv`

#### Blocked Task Handling

After each wave: if blocked tasks exist, prompt user to continue or stop (AUTO_YES: auto-continue). Skip tasks whose deps are blocked/failed.

#### Cascading Skip

Blocked/failed tasks cascade: mark all downstream dependents as `skipped` with error "Dependency {dep_id} blocked/failed".

### Phase 3: Results Aggregation

**Objective**: Update all state files and generate execution report.

1. Export final `tasks.csv` as `results.csv`

2. **Update task files**: Write each task's status from CSV back to `.task/{id}.json`

3. **Issue status sync**: For tasks with `issue_id`, update `.workflow/issues/issues.jsonl`:
   - All task_refs completed -> `issue.status = "resolved"`; any failed -> `"in_progress"`
   - Append history entry: `{ action: "executed", at: <ISO>, by: "maestro-execute", summary: "TASK-{NNN} {status}" }`

4. **Register EXC artifact in state.json**: Find matching plan artifact, create `{ id: "EXC-{next_id}", type: "execute", milestone, phase, scope, path, status: "completed", depends_on: plan_artifact.id, harvested: false, created_at, completed_at }`

5. **Extract incremental learnings**: Read `.summaries/`, dedup against existing specs, append to `.workflow/specs/learnings.md` as `<spec-entry>` (category=learning), mark artifact `harvested: true`

6. **Post-task Knowledge Inquiry**: Prompt user to capture knowledge when:
   - Execution deviation detected (plan change) -> `/spec-add arch`
   - Retry success (>=2 retries) -> `/spec-add debug`
   - Implicit design rationale found -> `/spec-add learning`

7. **Generate context.md**: Execution report with summary (tasks/blocked/waves/auto-commit), per-wave result table (task, status, files, tests), blocked tasks, discovery board summary, next steps.

8. **Auto-sync** (if config.json.codebase.auto_sync_after_execute == true): detect changed files, trigger codebase doc update.

9. **Display completion report**: Phase, completed/blocked counts, wave progress, paths to `.summaries/` and `.task/`, next step suggestions (`maestro-verify`, `manage-status`).

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found during implementation |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point discovered |
| `convention` | singleton | `{naming, imports, formatting}` | Project coding conventions observed |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue encountered |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack detail confirmed |
| `test_command` | `data.command` | `{command, scope, result}` | Working test command discovered |

#### Protocol

Read `discoveries.ndjson` before implementation. Append-only: dedup by type+key before writing, never modify/delete.

```bash
echo '{"ts":"<ISO>","worker":"TASK-001","type":"code_pattern","data":{"name":"Result type","file":"src/types/result.ts","description":"All functions return Result<T,E> for error handling"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| plan.json not found | Abort with error: "No plan found -- run plan first" |
| No pending tasks (all completed) | Abort with info: "All tasks already completed" |
| Task file (.task/TASK-*.json) missing | Skip task, log error, mark as failed |
| Agent spawn fails | Retry once, then mark task as blocked with checkpoint |
| Convergence criteria not met after 3 attempts | Mark task as blocked, write checkpoint |
| Git commit fails (--auto-commit) | Log warning, continue (task still marked completed) |
| All tasks in wave blocked | Stop execution, report blocked wave |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines, continue |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All waves executed in order with cross-wave context propagation
- [ ] Completed tasks have .summaries/TASK-{NNN}-summary.md
- [ ] .task/TASK-*.json statuses updated to match execution results
- [ ] state.json updated with EXC artifact
- [ ] context.md produced with execution report
- [ ] Blocked tasks have checkpoint info for resume
- [ ] Cascading skip applied for dependent tasks
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
