---
name: quality-refactor
description: Use when accumulated tech debt needs systematic identification and safe reduction
argument-hint: "<phase|--dir path> [--max-iterations N]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Iterative refactoring cycle via `spawn_agents_on_csv`: analyze scope for tech debt -> plan refactoring tasks -> execute each as single-row CSV wave with test verification -> reflect on strategy per round -> repeat if needed. Every change is verified against existing tests. Failed changes are reverted and retried with adjusted strategy.

**Core workflow**: Parse Scope -> Analyze -> Plan -> CSV Wave-by-Wave Execution -> Reflect -> Verdict
</purpose>

<context>
$ARGUMENTS -- module path, feature area, or "all", plus optional flags.

**Usage**:

```bash
$quality-refactor "src/auth"                    # module path scope
$quality-refactor "authentication"              # feature area scope
$quality-refactor "all"                         # full codebase scan
$quality-refactor "src/api --max-iterations 5"  # limit iteration rounds
$quality-refactor "--dir .workflow/scratch/refactor-auth-2026-03-18"  # resume existing
```

**Flags**:
- `<phase|scope>`: Module path, feature area, or "all"
- `--dir path`: Resume existing refactor scratch directory
- `--max-iterations N`: Max refactoring rounds (default: 3)

**Output**: `.workflow/scratch/refactor-{slug}-{date}/` with index.json, plan.json, reflection-log.md, .task/, .summaries/

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-refactor-{slug}/`
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,category,scope,convergence_criteria,read_first,verification_cmd,risk,deps,wave,status,retry_count,strategy_adjustment
"TASK-001","Extract shared validation","Extract duplicated email/phone validation logic into shared utils module","duplication","src/auth/login.ts;src/auth/register.ts","src/utils/validation.ts contains export function validateEmail(; grep -r 'validateEmail' shows single import source","src/auth/login.ts;src/auth/register.ts;src/utils/","npm test","low","","1","pending","0",""
"TASK-002","Simplify token refresh","Reduce cyclomatic complexity in token refresh handler from 12 to <6","complexity","src/auth/token.ts","src/auth/token.ts function refreshToken has no more than 2 levels of nesting","src/auth/token.ts;src/auth/types.ts","npm test -- --grep token","medium","","2","pending","0",""
"TASK-003","Remove dead session code","Remove unused session cleanup functions identified in analysis","dead_code","src/session/","grep -r 'cleanupExpired' returns 0 matches outside test files","src/session/cleanup.ts","npm test","low","","1","pending","0",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Task ID (TASK-NNN, from plan.json) |
| `title` | Input | Short refactoring task title |
| `description` | Input | What to refactor and why |
| `category` | Input | Tech debt category: duplication / complexity / naming / dependencies / dead_code / pattern_violations |
| `scope` | Input | Semicolon-separated target files/directories |
| `convergence_criteria` | Input | Grep-verifiable completion criteria (semicolon-separated) |
| `read_first` | Input | Files to read before implementing (context) |
| `verification_cmd` | Input | Test command to run after change |
| `risk` | Input | `low` / `medium` / `high` |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `wave` | Computed | Wave number — same-risk independent tasks can share a wave |
| `status` | Input | Task lifecycle state in master CSV: `pending` / `completed` / `failed` / `blocked` / `skipped` |
| `retry_count` | State | Current retry count (max 2) |
| `strategy_adjustment` | State | Strategy change note for retry |

**Output columns** (returned exclusively via `output_schema`, NOT in wave CSV):

| Column | Description |
|--------|-------------|
| `result_status` | `completed` / `failed` / `blocked` — wave execution result |
| `findings` | Implementation notes (max 500 chars) |
| `files_modified` | Semicolon-separated list of changed files |
| `tests_passed` | `true` / `false` — verification result |
| `error` | Error message if failed |

**Column separation rule**: Input columns and Output columns MUST NOT share names. Wave CSV only contains Input columns. Output columns are returned exclusively via output_schema.

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column populated from predecessor task findings.

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-refactor-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- reflection-log.md
+-- wave-{N}.csv (temporary)
+-- wave-{N}-results.csv
```
</csv_schema>

<invariants>
1. **Test after every change** -- zero regressions tolerated
2. **Revert on failure** -- never leave broken state
3. **Max 2 retries per task** with strategy adjustment
4. **Reflection-driven** -- every round records strategy, outcome, adjustment
5. **User approval required** before execution (Step 4)
6. **Quick wins first** -- order by risk (low first) and dependency
7. **CSV waves execute synchronously** — each refactoring task dispatched as single-row wave, wait for completion before next
8. **Incremental safety** -- each task is independently safe to apply or revert
</invariants>

<execution>

### Step 1: Parse Scope

1. Parse `$ARGUMENTS` for scope and flags
2. If `--dir` provided: resume existing scratch directory (skip to Step 5)
3. Scope types:
   - Module path (e.g., "src/auth") -> scan that directory
   - Feature area (e.g., "authentication") -> search for related files
   - "all" -> full codebase scan
4. If empty: prompt user via AskUserQuestion with options (Module path / Feature area / Full codebase)
5. Detect `--max-iterations N` (default: 3)

### Step 2: Create Scratch Directory

Create `.workflow/scratch/refactor-{slug}-{date}/` with `.task/` and `.summaries/` subdirectories. Write `index.json` with type "refactor", scope, status "active", plan/execution/reflection counters.

### Step 3: Scope Analysis

Load project specs if available (`maestro spec load --category coding` for conventions, `maestro spec load --category review` for quality standards). Browse wiki: `maestro wiki list --category coding`, load relevant entries.

Analyze scope for tech debt categories:

| Category | What to Look For |
|----------|-----------------|
| Duplication | Repeated code blocks, copy-paste patterns |
| Complexity | Long functions, deep nesting, high cyclomatic complexity |
| Naming | Inconsistent naming, unclear identifiers |
| Dependencies | Circular deps, tight coupling, god objects |
| Dead code | Unused functions, unreachable branches |
| Pattern violations | Inconsistent with project conventions |

Present analysis summary table with category, count, severity.
Confirm with user before proceeding.

### Step 4: Plan Refactoring

1. Write `plan.json` with scope, total_tasks, strategy ("incremental -- each task independently safe")
2. For each identified issue, create `.task/TASK-{NNN}.json`:
   - id, title, status (pending), type (refactor), category
   - description, read_first files, files with action/target/change
   - convergence.criteria (grep-verifiable), verification command
   - implementation steps, risk level
3. Order: high risk last, dependencies respected, quick wins first
4. Update `index.json` plan fields
5. Present plan to user via AskUserQuestion -- show affected files, risk areas, ask for approval

### Step 5: Execute with Reflection via CSV Waves

Initialize session folder `.workflow/.csv-wave/{dateStr}-refactor-{slug}/`.
Initialize `reflection-log.md` and `discoveries.ndjson` in session folder.
Build `tasks.csv` from plan.json tasks using csv_schema columns.

**Wave computation**: Group independent same-risk tasks into shared waves. Dependent tasks go to later waves. Low-risk tasks wave first, high-risk last.

For each wave N in ascending order:

**5a. Build and spawn wave:**

1. Extract wave N pending rows from master `tasks.csv`
2. Build `prev_context` per task from completed predecessor findings
3. Write `wave-{N}.csv`, then execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-${N}.csv`,
  id_column: "id",
  instruction: `You are a refactoring executor. For each task:
1. Read files listed in read_first to understand context
2. Apply refactoring described in description targeting scope files
3. Verify convergence_criteria via grep (all criteria must pass)
4. Run verification_cmd and report test result
5. If tests fail: revert ALL changes for this task, set result_status=failed
6. Append discoveries to ${sessionFolder}/discoveries.ndjson
Report: files_modified (semicolon-separated), tests_passed (true/false), findings (what was changed and why)`,
  max_concurrency: 1, max_runtime_seconds: 1800,
  output_csv_path: `${sessionFolder}/wave-${N}-results.csv`,
  output_schema: { id, result_status: [completed|failed|blocked], findings, files_modified, tests_passed, error }
})
```

4. Merge results into master `tasks.csv`: map `result_status` -> master `status` column, copy `findings`, `files_modified`, `tests_passed`, `error` into master. Delete temporary `wave-{N}.csv` and `wave-{N}-results.csv`.

**5b. Reflect per wave:**

Append to `reflection-log.md`:
- Wave number, tasks attempted, pass/fail counts
- Per-task: title, strategy, outcome, test result, files changed
- Strategy adjustment notes for failed tasks

**5c. Handle failures (retry loop):**

For each failed task in wave results:
1. Increment `retry_count` in master CSV
2. If `retry_count < 2`:
   - Record failure analysis in `strategy_adjustment` column
   - Re-add to next wave with adjusted description incorporating failure learnings
3. If `retry_count >= 2`: mark task `blocked`, skip dependents

**5d. Update state per wave:**
- `.task/TASK-{NNN}.json` status synced from CSV
- `.summaries/TASK-{NNN}-summary.md` written per completed task
- `index.json` execution and reflection counters updated

### Step 6: Final Verification

Run full test suite. Record final state in reflection-log.md: test result, tasks completed/total, tasks blocked, key learnings.

### Step 7: Complete and Report

Update `index.json`: status -> "completed", final execution/reflection counts.

Display report: scope, tasks completed/blocked, reflection rounds, strategy adjustments, test status, key learnings from reflection-log.md, artifact paths (`{REFACTOR_DIR}/reflection-log.md`, `{REFACTOR_DIR}/.summaries/`).

**Next-step routing:**

| Result | Next Step |
|--------|-----------|
| All tests pass, refactoring complete | `$quality-sync` (update codebase docs) |
| Test failures remain after refactor | `$quality-debug "{scope}"` |
| No test suite available for scope | `$quality-auto-test "{phase}"` |
| Partial completion (some blocked) | `$quality-debug "{scope}"` for blocked tasks |
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Scope/description required | Prompt user for module path, feature area, or "all" |
| E002 | error | Test suite not available | Suggest creating tests first, or proceed with manual verification |
| W001 | warning | Partial test coverage | Note uncovered areas, proceed with extra caution |
</error_codes>

<success_criteria>
- [ ] Scope resolved and scratch directory created
- [ ] Tech debt analysis completed with categorized findings
- [ ] Refactoring plan approved by user
- [ ] tasks.csv built from plan with proper wave assignment
- [ ] Each wave executed via spawn_agents_on_csv with test verification
- [ ] Failed tasks reverted, retried with strategy adjustment (max 2 retries)
- [ ] Reflection log records every wave's strategy and outcome
- [ ] discoveries.ndjson append-only throughout execution
- [ ] Final test suite passes with zero regressions
- [ ] results.csv exported with all task outcomes
- [ ] Completion report with key learnings displayed
</success_criteria>
