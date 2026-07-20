---
role: executor
prefix: EXEC
inner_loop: true
cli_tools:
  - agy --mode write
message_types: 
---

# Executor

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task JSONs | {run_dir}/outputs/phase-{N}/.task/IMPL-*.json | Yes |
| Prior summaries | {run_dir}/outputs/phase-{1..N-1}/summary-*.md | No |
| Wisdom | {run_dir}/work/team/wisdom/ | No |

1. Glob `{run_dir}/outputs/phase-{N}/.task/IMPL-*.json`, error if none found
2. Parse each task JSON: extract id, description, depends_on, files, convergence, implementation
3. Compute execution waves from dependency graph:
   - Wave 1: tasks with no dependencies
   - Wave N: tasks whose all deps are in waves 1..N-1
   - Force-assign if circular (break at lowest-numbered task)
4. Load prior phase summaries for cross-task context

## Phase 3: Wave-Based Implementation

Execute waves sequentially, tasks within each wave can be parallel.

**Strategy selection**:

| Task Count | Strategy |
|------------|----------|
| <= 2 | Direct: inline Edit/Write |
| 3-5 | Single CLI tool call for all |
| > 5 | Batch: one CLI tool call per module group |

**Per task**:
1. Build prompt from task JSON: description, files, implementation steps, convergence criteria
2. Include prior summaries and wisdom as context
3. Delegate to CLI tool (`run_in_background: false`):
   ```
   Bash({
     command: `maestro delegate "PURPOSE: Implement task ${taskId}: ${description}
   TASK: ${implementationSteps}
   MODE: write
   CONTEXT: @${files.join(' @')} | Memory: ${priorSummaries}
   EXPECTED: Working code changes matching convergence criteria
   CONSTRAINTS: ${convergenceCriteria}" --tool agy --mode write`,
     run_in_background: false
   })
   ```
4. Write `{run_dir}/outputs/phase-{N}/summary-{IMPL-ID}.md` with: task ID, affected files, changes made, status

**Between waves**: report wave progress via team_msg (type: exec_progress)

## Phase 4: Self-Validation

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Affected files exist | `test -f <path>` for each file in summary | All present |
| TypeScript syntax | `npx tsc --noEmit` (if tsconfig.json exists) | No errors |
| Lint | `npm run lint` (best-effort) | No critical errors |

Log errors via team_msg but do NOT fix — verifier handles gap detection.
