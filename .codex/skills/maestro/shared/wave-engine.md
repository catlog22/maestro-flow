# Wave Engine Shared Utilities

Standard wave computation and execution patterns for all Tier A maestro skills.

## Session Initialization Template

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue')
const concurrencyMatch = $ARGUMENTS.match(/(?:--concurrency|-c)\s+(\d+)/)
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : DEFAULT_CONCURRENCY

// Clean requirement text
const requirement = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+/g, '')
  .trim()

const slug = requirement.toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .substring(0, 40)
const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `${SKILL_PREFIX}-${slug}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`
```

## Wave Computation (Kahn's BFS)

```
Input:  tasks[] with deps[]
Output: waveAssignment (taskId → wave number)

1. Build in-degree map and adjacency list from deps
2. Enqueue all tasks with in-degree 0 at wave 1
3. BFS: for each dequeued task at wave W:
   - For each dependent task D:
     - Decrement D's in-degree
     - D.wave = max(D.wave, W + 1)
     - If D's in-degree reaches 0, enqueue D
4. Any task without wave assignment → circular dependency error
```

## Wave Execution Loop

For each wave:
1. Read master `tasks.csv`
2. Filter rows where `wave == currentWave` AND `status == pending`
3. Check each task's deps — if any dep is `failed`/`skipped`, mark task as `skipped`
4. Build `prev_context` for each remaining task from `context_from` column
5. Write `wave-{N}.csv` with filtered rows + `prev_context` column
6. Call `spawn_agents_on_csv({ csv_path, instruction, max_concurrency, output_schema })`
7. Read `wave-{N}-results.csv`
8. Merge results into master `tasks.csv` (update status, findings, output columns)
9. Delete temporary `wave-{N}.csv`

## prev_context Building

For each task in current wave:
1. Collect task IDs from `context_from` column
2. For each context ID, look up in master CSV:
   - If `status == completed` and `findings` non-empty → append `[Task {id}: {title}] {findings}`
   - If `status != completed` → skip
3. Join entries with newline
4. If no context → `"No previous context available"`

## Master CSV Merge

After each wave:
1. Read results CSV
2. For each result row:
   - Find matching row in master CSV by `id`
   - Update: `status`, `findings`, all output columns
3. Write updated master CSV

## Wave-Level Retry

After a wave completes, retry failed tasks once before proceeding to the next wave:

1. Read `wave-{N}-results.csv`
2. Collect tasks where `status == failed` AND `error` indicates a transient failure (timeout, connection error, spawn failure)
3. If retryable tasks exist:
   - Write `wave-{N}-retry.csv` with only the failed tasks (reset `status` to `pending`)
   - Call `spawn_agents_on_csv` with the retry CSV
   - Read `wave-{N}-retry-results.csv`
   - Merge retry results into master CSV (overwrite previous failed status)
   - Delete `wave-{N}-retry.csv`
4. If retry also fails, keep the failed status — do NOT retry more than once
5. Proceed to skip-on-failure cascade for the next wave

**Retryable errors** (transient): agent timeout, spawn failure, connection error
**Non-retryable errors** (permanent): invalid input, missing files, logic errors

## Skip-on-Failure Cascade

Before executing a wave:
- For each task in this wave:
  - If any task in `deps` has `status == failed` or `status == skipped`:
    - Set this task's `status = skipped`, `error = "dependency failed/skipped: {dep_id}"`
    - Do NOT include in wave CSV
