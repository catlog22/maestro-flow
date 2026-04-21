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

```
AskUserQuestion(
  header: "Refactoring Scope",
  question: "What scope should be refactored?",
  options: [
    { label: "Module path", description: "e.g., src/auth -- specific directory" },
    { label: "Feature area", description: "e.g., authentication -- conceptual scope" },
    { label: "Full codebase", description: "Scan everything for tech debt" }
  ]
)
```

Generate slug from scope (lowercase, hyphens, max 40 chars).
Set date to current date (YYYY-MM-DD).

---

### Step 2: Create Scratch Directory

**Create scratch directory and index.json:**

```bash
REFACTOR_DIR=".workflow/scratch/refactor-${slug}-${date}"
mkdir -p "$REFACTOR_DIR/.task"
mkdir -p "$REFACTOR_DIR/.summaries"
```

Write index.json:
```json
{
  "id": "refactor-{slug}-{date}",
  "type": "refactor",
  "title": "Refactor: {scope description}",
  "status": "active",
  "created_at": "{ISO timestamp}",
  "updated_at": "{ISO timestamp}",
  "scope": "{original scope argument}",
  "plan": {
    "task_ids": [],
    "task_count": 0
  },
  "execution": {
    "method": "agent",
    "tasks_completed": 0,
    "tasks_total": 0
  },
  "reflection": {
    "rounds": 0,
    "strategy_adjustments": []
  }
}
```

---

### Step 2.5: Load Project Specs

```
specs_content = maestro spec load --category coding
```

Used in Step 3 to detect pattern violations against project conventions.

---

### Step 3: Scope Analysis

**Analyze scope for tech debt:**

Read all files in scope. Use specs_content (if loaded) to detect convention violations. Identify and categorize issues:

1. **Duplication** - Repeated code blocks, copy-paste patterns
2. **Complexity hotspots** - Functions too long, deep nesting, high cyclomatic complexity
3. **Naming issues** - Inconsistent naming, unclear variable/function names
4. **Dependency tangles** - Circular deps, tight coupling, god objects
5. **Dead code** - Unused functions, unreachable branches
6. **Pattern violations** - Inconsistent with project conventions (from specs/)

Present analysis summary:
```
## Scope Analysis: {scope}

| Category | Count | Severity |
|----------|-------|----------|
| Duplication | 3 | medium |
| Complexity | 5 | high |
| Naming | 8 | low |
| Dependencies | 2 | high |
| Dead code | 4 | low |

Total issues: 22
Recommended priority: Complexity > Dependencies > Duplication > Naming > Dead code
```

Confirm with user before proceeding to planning.

---

### Step 4: Plan Refactoring

**Generate refactoring plan:**

Write plan.json:
```json
{
  "scope": "{scope}",
  "total_tasks": N,
  "strategy": "incremental -- each task is independently safe",
  "tasks": ["TASK-001", "TASK-002", ...]
}
```

For each identified issue, create .task/TASK-{NNN}.json:
```json
{
  "id": "TASK-{NNN}",
  "title": "{specific refactoring}",
  "status": "pending",
  "type": "refactor",
  "category": "duplication|complexity|naming|dependency|dead_code|pattern",
  "description": "{what to change and why}",
  "read_first": ["path/to/file.ts", "path/to/related.ts"],
  "files": [
    { "path": "path/to/file.ts", "action": "modify", "target": "{function_or_class}", "change": "{concrete_change}" }
  ],
  "action": "{detailed steps with concrete values}",
  "convergence": {
    "criteria": ["{grep-verifiable completion criterion}"],
    "verification": "Run existing tests to confirm no regressions"
  },
  "implementation": ["{step 1 with concrete values}"],
  "risk": "low|medium|high"
}
```

Order tasks by: high risk last, dependencies respected, quick wins first.

Update index.json plan fields.

**Present plan to user via AskUserQuestion:**
- Show affected files with proposed changes
- Highlight risk areas and dependency impacts
- Ask for approval, modifications, or rejection
- Capture any additional constraints or priorities

---

### Step 5: Execute with Reflection

**Execute each task with reflection tracking:**

Initialize reflection-log.md:
```markdown
# Refactoring Reflection Log

Scope: {scope}
Started: {ISO timestamp}

---
```

For each task in order:

**5a. Execute the refactoring:**
Implement the change as described in the task.

**5b. Run existing tests:**
```bash
# Detect and run test suite
npm test 2>&1 || pytest 2>&1 || go test ./... 2>&1 || echo "No test runner detected"
```

**5c. Record in reflection-log.md:**
```markdown
## Round {N}: {task title}

- **Strategy:** {approach taken}
- **Result:** {pass|fail} -- {brief outcome}
- **Tests:** {all pass | N failures}
- **Adjustment:** {what to change in approach for next round, or "none needed"}
- **Files changed:** {list}

---
```

**5d. Handle test failures:**
If tests fail after a refactoring:
1. Revert the change
2. Record failure in reflection-log.md with strategy adjustment
3. Attempt with adjusted strategy (max 2 retries per task)
4. If still failing, mark task as "blocked" and continue to next

**5e. Update task status:**
Update .task/TASK-{NNN}.json status to "completed" or "blocked".
Write .summaries/TASK-{NNN}-summary.md.
Update index.json execution fields.
Update reflection.rounds and strategy_adjustments in index.json.

---

### Step 6: Final Verification

**Run full test suite after all tasks:**

```bash
npm test 2>&1 || pytest 2>&1 || go test ./... 2>&1
```

Record final state in reflection-log.md:
```markdown
## Final Verification

- **Tests:** {all pass | N failures}
- **Tasks completed:** {N}/{total}
- **Tasks blocked:** {N}
- **Key learnings:** {patterns discovered during refactoring}
```

---

### Step 7: Complete

**Update index.json and present summary:**

Update index.json:
```json
{
  "status": "completed",
  "updated_at": "{ISO timestamp}",
  "execution": {
    "tasks_completed": N,
    "tasks_total": M
  },
  "reflection": {
    "rounds": N,
    "strategy_adjustments": ["list of adjustments made"]
  }
}
```

Present completion summary:
```
## Refactoring Complete: {scope}

| Metric | Value |
|--------|-------|
| Tasks completed | {N}/{total} |
| Tasks blocked | {N} |
| Reflection rounds | {N} |
| Strategy adjustments | {N} |
| Tests passing | {yes/no} |

Key learnings:
{from reflection-log.md}

Artifacts:
- Reflection log: {REFACTOR_DIR}/reflection-log.md
- Task results: {REFACTOR_DIR}/.summaries/
```

If regressions found: list affected tests and suggest Skill({ skill: "quality-debug" }).

---

## Success Criteria

- [ ] Scope parsed and validated
- [ ] Scratch directory created with index.json
- [ ] Scope analysis identifies tech debt categories
- [ ] plan.json + .task/TASK-*.json created for each refactoring
- [ ] Each task executed with test verification (no regressions)
- [ ] reflection-log.md tracks strategy per round with adjustments
- [ ] Test failures trigger revert + retry with adjusted strategy
- [ ] Full test suite passes at end
- [ ] index.json updated with final status
- [ ] .summaries/ written for completed tasks
