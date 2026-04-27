# Refactor Workflow

Systematically reduce tech debt through scope analysis, task planning, and reflection-driven execution. Each refactoring round records strategy, outcome, and adjustments. Existing tests must pass after every change.

Output: scratch/refactor-{slug}-{date}/ with index.json + reflection-log.md + .task/ + .summaries/

---

## Prerequisites

- `.workflow/` directory initialized
- Test suite available for affected scope (E002 if missing)

---

### Step 1: Parse Scope

**Parse scope from $ARGUMENTS:**

- Module path (e.g., "src/auth") -> scan that directory
- Feature area (e.g., "authentication") -> search for related files
- "all" -> full codebase scan
- Empty -> prompt user:

Prompt user for scope type: module path, feature area, or full codebase.

Generate slug from scope (lowercase, hyphens, max 40 chars). Set date = YYYY-MM-DD.

---

### Step 2: Create Scratch Directory

Create `REFACTOR_DIR=".workflow/scratch/refactor-${slug}-${date}"` with `.task/` and `.summaries/` subdirs.

Write index.json: id, type="refactor", title, status="active", scope, plan (empty task_ids), execution (method=agent, counts=0), reflection (rounds=0).

---

### Step 2.5: Load Project Specs

```
specs_content = maestro spec load --category coding
```

Used in Step 3 to detect pattern violations against project conventions.

---

### Step 3: Scope Analysis

**Analyze scope for tech debt:**

Read all files in scope. Use specs_content to detect convention violations. Categorize issues:

1. **Duplication** - copy-paste patterns
2. **Complexity** - long functions, deep nesting, high cyclomatic complexity
3. **Naming** - inconsistent or unclear names
4. **Dependencies** - circular deps, tight coupling, god objects
5. **Dead code** - unused functions, unreachable branches
6. **Pattern violations** - inconsistent with specs/ conventions

Present category/count/severity summary table. Confirm with user before planning.

---

### Step 4: Plan Refactoring

Write plan.json (scope, total_tasks, strategy="incremental", task IDs).

For each issue, create `.task/TASK-{NNN}.json`: id, title, status=pending, type=refactor, category, description, read_first (files), files (path/action/target/change), convergence criteria, implementation steps, risk level.

Order: quick wins first, high risk last, dependencies respected. Update index.json plan fields.

Present plan to user: affected files, risk areas, dependency impacts. Ask approval/modifications/rejection.

---

### Step 5: Execute with Reflection

**Execute each task with reflection tracking:**

Initialize reflection-log.md (scope, timestamp).

For each task:
- **5a.** Implement the refactoring change.
- **5b.** Run test suite (npm test / pytest / go test).
- **5c.** Record in reflection-log.md: strategy, result, test status, adjustment needed, files changed.
- **5d.** On test failure: revert, record, retry with adjusted strategy (max 2 retries). If still failing: mark "blocked", continue.
- **5e.** Update task status (completed/blocked), write summary, update index.json execution and reflection fields.

---

### Step 6: Final Verification

Run full test suite. Record final state in reflection-log.md: test results, tasks completed/blocked, key learnings.

---

### Step 7: Complete

Update index.json: status="completed", execution counts, reflection rounds + strategy_adjustments.

Present summary: tasks completed/blocked, reflection rounds, strategy adjustments, test status, key learnings.
List artifacts: reflection-log.md, .summaries/.

If regressions found: list affected tests and suggest quality-debug.

