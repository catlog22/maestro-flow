---
name: maestro-plan
description: Exploration-driven planning via CSV wave pipeline. Wave 1 runs parallel codebase exploration agents, Wave 2 synthesizes explorations into plan.json + TASK-*.json. Replaces maestro-plan command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--auto] [--dir <path>] [--gaps] [--spec SPEC-xxx] [--collab]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based planning using `spawn_agents_on_csv`. Wave 1 explores codebase context in parallel across multiple angles, Wave 2 consumes all exploration findings to generate a verified execution plan.

**Core workflow**: Resolve Phase -> Determine Explorations -> Parallel Exploration -> Sequential Planning -> Check + Confirm

```
+---------------------------------------------------------------------------+
|                    PLAN CSV WAVE WORKFLOW                                  |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Phase Resolution -> CSV                                         |
|     +-- Resolve phase directory from arguments (or --dir)                 |
|     +-- Load context.md, index.json, spec-ref, codebase docs             |
|     +-- Check for upstream analysis (conclusions.json)                    |
|     +-- If --gaps: load gaps from issues/verification/uat                 |
|     +-- Determine exploration angles (architecture, implementation, etc.) |
|     +-- Generate tasks.csv with one row per exploration + planning row    |
|     +-- User validates exploration breakdown (skip if -y)                 |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Codebase Exploration (parallel)                           |
|     |   +-- Each agent explores one angle of the codebase                 |
|     |   +-- Agent reads files, discovers patterns, maps dependencies      |
|     |   +-- Discoveries shared via board (patterns, conventions, risks)   |
|     |   +-- Results: findings per exploration angle                       |
|     +-- Wave 2: Plan Generation (sequential)                              |
|     |   +-- Single planning agent consumes all exploration findings       |
|     |   +-- Generates plan.json with waves, dependencies, estimates       |
|     |   +-- Generates .task/TASK-*.json for each task                     |
|     |   +-- Applies Deep Work Rules (read_first, convergence.criteria)    |
|     |   +-- Results: plan.json path + task count                          |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Plan Checking + Confirmation                                    |
|     +-- Validate plan quality (coverage, feasibility, deps, criteria)     |
|     +-- Revision loop (max 3 rounds) if critical issues found             |
|     +-- Update index.json with plan metadata                              |
|     +-- Display plan summary + options (execute/modify/view)              |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$maestro-plan "3"
$maestro-plan -y "3 --auto"
$maestro-plan -c 4 "3 --spec SPEC-001"
$maestro-plan "3 --gaps"
$maestro-plan "3 --dir .workflow/scratch/quick-nav-fix"
$maestro-plan --continue "20260318-plan-P3-auth"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 4)
- `--continue`: Resume existing session

When `--yes` or `-y`: Auto-confirm exploration angles, skip interactive clarification (P2), use defaults for complexity detection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `plan.json` + `.task/TASK-*.json`
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,exploration_focus,deps,context_from,wave,status,findings,error
"E1","Architecture Exploration","Explore how the target feature fits into existing architecture. Map module boundaries, dependency graph, and integration points. Identify existing patterns that should be followed.","architecture","","","1","","",""
"E2","Implementation Exploration","Explore implementation patterns: libraries in use, coding conventions, error handling patterns, type definitions. Find 3+ similar features as reference.","implementation","","","1","","",""
"E3","Integration Exploration","Explore integration points: what existing code needs modification, API contracts, shared state, event flows. Map all touch points.","integration","","","1","","",""
"E4","Risk Exploration","Explore risks: what could go wrong, backward compatibility concerns, performance implications, security surface changes, test coverage gaps.","risk","","","1","","",""
"P1","Plan Generation","Consume all exploration findings. Decompose phase goal into concrete tasks with waves, dependencies, convergence criteria. Generate plan.json + TASK-*.json files following Deep Work Rules.","planning","E1;E2;E3;E4","E1;E2;E3;E4","2","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier: `E{N}` for explorations (wave 1), `P1` for planning (wave 2) |
| `title` | Input | Short exploration or planning title |
| `description` | Input | Detailed exploration/planning instructions |
| `exploration_focus` | Input | Focus area: architecture/implementation/integration/risk/planning |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = exploration, 2 = plan generation) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable planning report | Created in Phase 3 |
| `plan.json` | Execution plan (in phase directory) | Created by wave 2 agent |
| `.task/TASK-*.json` | Individual task definitions (in phase directory) | Created by wave 2 agent |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-plan-P{N}-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- wave-{N}.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Failure**: If all exploration agents failed, planning agent proceeds with available context
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
</invariants>

<execution>

### Session Initialization

```javascript
// Parse from $ARGUMENTS:
//   AUTO_YES      <- --yes | -y
//   continueMode  <- --continue
//   maxConcurrency <- --concurrency N | -c N  (default: 4)
//   autoMode      <- --auto
//   gapsMode      <- --gaps
//   dirMatch      <- --dir <path>
//   specMatch     <- --spec SPEC-xxx
//   collabMode    <- --collab
//   phaseArg      <- remaining text after stripping all flags

// Auto-bootstrap .workflow/state.json if missing

// Scope determination from state.json (priority order):
//   --dir given       → scope from parent artifact or 'standalone'
//   phaseArg empty    → 'milestone' (requires current_milestone + roadmap.md) or ERROR E001
//   phaseArg is digit → 'phase', resolve slug from roadmap, find latest completed analyze artifact
//   phaseArg is text  → 'adhoc' (if milestone active) or 'standalone', slugify phaseArg

// Session IDs (UTC+8):
//   sessionId    = {YYYYMMDD}-plan-P{phaseArg}-{phaseSlug}
//   sessionFolder = .workflow/.csv-wave/{sessionId}
//   scratchDir    = .workflow/scratch/{sessionId}

// Create: sessionFolder, scratchDir/.task/
```

### Phase 1: Phase Resolution -> CSV

**Objective**: Resolve phase, load context, determine exploration angles, generate tasks.csv.

**Decomposition Rules**:

1. **Scope resolution**: Already determined in Session Initialization (milestone/phase/adhoc/standalone)

2. **Context loading** (from upstream analyze artifact or --dir):
   - Read `{contextDir}/context.md` (user decisions from analyze) — if contextDir resolved
   - Read `.workflow/project.md` — project vision and constraints
   - Read `.workflow/roadmap.md` — phase structure and dependencies
   - Read spec-ref if `--spec` flag
   - Read `.workflow/codebase/doc-index.json` if exists
   - Find design artifacts from `state.json.artifacts[]` (type=brainstorm with ui-designer) for MASTER.md
   - Load project specs via `maestro spec load --category arch`

3. **Upstream analysis check**:
   - If `{contextDir}/conclusions.json` exists and has content: reuse as exploration context, skip wave 1
   - If `{contextDir}/explorations.json` exists: load as additional context

4. **Gap mode** (if `--gaps`):
   - Load gaps from `.workflow/issues/issues.jsonl` (primary), `verification.json` (fallback), `uat.md` (additional)
   - Enrich with debug diagnosis from `{PHASE_DIR}/.debug/*/understanding.md`
   - Skip wave 1 exploration, generate gap-fix tasks directly in wave 2

5. **Exploration angle determination** (skip if --gaps or upstream analysis loaded):

| Angle | Focus | When Included |
|-------|-------|---------------|
| architecture | Module boundaries, dependency graph, integration points | Always |
| implementation | Coding patterns, libraries, conventions, similar features | Always |
| integration | Existing code modifications, API contracts, shared state | When phase touches existing modules |
| risk | Backward compatibility, performance, security, test gaps | When phase is complex or critical |

6. **CSV generation**: Exploration rows (wave 1) + one planning row (wave 2).

**Wave computation**: Simple 2-wave -- all exploration tasks = wave 1, planning task = wave 2.

**User validation**: Display exploration breakdown (skip if AUTO_YES or `--auto`).

### Phase 2: Wave Execution Engine

**Objective**: Explore codebase then generate plan via spawn_agents_on_csv.

#### Wave 1: Codebase Exploration (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildExplorationInstruction(sessionFolder, phaseDir),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { // required: id, status, findings
    id: "string", status: "completed|failed", findings: "string", error: "string"
  }
})
```

6. Merge `wave-1-results.csv` into master `tasks.csv`, delete `wave-1.csv`

#### Task Count Guard (before Wave 2)

Before generating the planning instruction, assess scope complexity and embed expected task count ceiling:
- Single feature / simple change → expect **1-2 tasks** max
- Medium feature (multiple files, one module) → expect **2-4 tasks** max
- Large feature (cross-module) → expect **4-8 tasks** max

Include this ceiling in `buildPlanningInstruction`. If the planning agent outputs more tasks than the threshold, re-prompt with explicit instruction to merge.

#### Wave 2: Plan Generation (Sequential)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Build `prev_context` from wave 1 findings:
   ```
   [E1: Architecture Exploration] Module boundaries: auth/ is self-contained, shared/ has...
   [E2: Implementation Exploration] Patterns found: Result type for errors, zod for validation...
   [E3: Integration Exploration] Touch points: routes/index.ts needs new route, middleware/auth.ts...
   [E4: Risk Exploration] Risks: No test coverage for auth refresh flow, potential breaking change...
   ```
4. Write `wave-2.csv` with `prev_context` column
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildPlanningInstruction(sessionFolder, phaseDir, {
    contextMd, indexJson, specRef, docIndex, designRef, gapsContext
  }),
  max_concurrency: 1,  // Single planning agent
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { // required: id, status, findings
    id: "string", status: "completed|failed", findings: "string", error: "string"
  }
})
```

6. Merge `wave-2-results.csv` into master `tasks.csv`, delete `wave-2.csv`

**Planning agent responsibilities** (embedded in instruction):
- Group work into feature-level tasks. One feature = one task (even if it touches 3-5 files). Do NOT split a single feature into multiple file-level tasks.
- Apply Deep Work Rules: `read_first[]` includes modified file + source of truth; `convergence.criteria[]` are grep-verifiable; all actions/steps have concrete values
- Write `plan.json` to `{PHASE_DIR}/plan.json` and `.task/TASK-{NNN}.json` to `{PHASE_DIR}/.task/`
- `--gaps`: create fix tasks from gap context, link to issues; `--collab`: pre-allocate ID ranges

**Task Grouping Rules (MANDATORY)** — pass to planning agent, re-prompt if violated:

1. **Group by feature** — All changes for one feature = one task (even if 3-5 files). Never create separate tasks per file.
2. **Group by context** — Related functional changes belong together. Don't split just because changes touch different files.
3. **Minimize agent count** — Group simple unrelated changes into a single "batch" task to reduce overhead. Each agent spawn costs significant tokens.
4. **Substantial tasks only** — Each task should represent 15-60 minutes of real work. If a task takes <5 minutes, merge it into another.
5. **True dependencies only** — `depends_on` only when Task B genuinely needs Task A's output (e.g., "Task A defines the interface that Task B implements"). Sequential execution wastes time.
6. **Prefer parallel** — Most tasks should be independent (no depends_on). Default to parallel waves.
7. **Complexity-based sizing**:
   - **Low** (single file, single concern, zero cross-module): **1 task**
   - **Medium** (multiple files OR integration point): **1-4 tasks**
   - **High** (cross-module, architectural, new subsystem): **4-10 tasks**

**Anti-splitting rules** (re-prompt if violated):
- One feature = one task (even if 3-5 files); never split a feature into per-file tasks
- Group simple unrelated changes into a batch task to minimize agent spawns
- `depends_on` only for genuine output dependencies; most tasks should be parallel
- Each task must be substantial (15-60 min); sub-5-min changes must be merged

### Phase 3: Plan Checking + Confirmation

**Objective**: Validate plan quality, revise if needed, present to user.

1. **Plan checking** (inline, not a separate wave):
   Read `plan.json` + all `.task/TASK-*.json`. Validate: requirements coverage, file feasibility, dependency correctness (no cycles, valid wave order), grep-verifiable convergence criteria, read_first completeness, action concreteness, no parallel file conflicts, **task count within complexity threshold** (reject over-split plans), **no per-file splitting** (each task must be feature-level).

2. **Revision loop** (max 3 rounds): If critical issues found, regenerate affected tasks.

3. **Export results**:
   - Export `results.csv` from master `tasks.csv`
   - Generate `context.md`: summary (phase, task count, wave count, complexity, exploration count), exploration findings per angle, plan overview (approach, task IDs, waves), next steps

4. **Update index.json**: set `status: "planning"`, `plan: { task_ids, task_count, complexity, waves }`, `updated_at`

5. **Issue linking** (if --gaps):
   For each TASK with `issue_id`: update issue in `issues.jsonl` (`task_refs` += TASK-NNN, `task_plan_dir`, `status: "planned"`, `updated_at`) + append history entry. Ensures bidirectional issue-TASK traceability.

6. **Display summary + options** (skip options if AUTO_YES):
   Show phase name, task/wave counts, checker status, output file paths.
   Next steps: `maestro-execute "{phase}"` (execute) or `maestro-plan "{phase}"` (re-plan).

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `existing_pattern` | `data.name` | `{name, file, description, usage}` | Existing feature pattern to follow |
| `dependency_map` | `data.module` | `{module, imports[], exports[], dependents[]}` | Module dependency mapping |
| `risk_factor` | `data.risk` | `{risk, severity, mitigation, affected_files[]}` | Identified risk |
| `test_command` | `data.command` | `{command, scope, framework}` | Test execution command |

#### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own exploration
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"existing_pattern","data":{"name":"Result error handling","file":"src/utils/result.ts","description":"All functions return Result<T,E> instead of throwing","usage":"Used in auth, payments, validation modules"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Phase argument required | Abort with error: "Phase argument required" |
| Phase directory not found | Abort with error: "Phase {N} not found. Run init first." |
| --gaps requires gaps source | Abort with error: "--gaps requires issues.jsonl, verification.json, or uat.md" |
| No context.md found | Warn, proceed with exploration only |
| Exploration agent timeout | Mark as failed, continue with available explorations |
| Planning agent fails | Retry once with simplified context, then abort |
| Plan produces invalid JSON | Retry once, then abort with error details |
| Plan-checker exceeds 3 rounds | Accept plan with warnings, note in index.json |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All waves executed in order
- [ ] plan.json produced in phase directory
- [ ] .task/TASK-*.json files produced for all tasks
- [ ] Plan passes quality checks (coverage, deps, criteria)
- [ ] context.md produced with exploration findings + plan overview
- [ ] index.json updated with plan metadata
- [ ] Issues linked (if --gaps mode)
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
