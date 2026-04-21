---
name: quality-refactor
description: Tech debt reduction with reflection-driven iteration. Analyze scope, plan refactoring, execute with test verification, reflect on strategy per round.
argument-hint: "<phase|--dir path> [--max-iterations N]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

<purpose>
Iterative refactoring cycle: analyze scope for tech debt -> plan refactoring tasks -> execute each with test verification -> reflect on strategy per round -> repeat if needed. Every change is verified against existing tests. Failed changes are reverted and retried with adjusted strategy.
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
</context>

<invariants>
1. **Test after every change** -- zero regressions tolerated
2. **Revert on failure** -- never leave broken state
3. **Max 2 retries per task** with strategy adjustment
4. **Reflection-driven** -- every round records strategy, outcome, adjustment
5. **User approval required** before execution (Step 4)
6. **Quick wins first** -- order by risk (low first) and dependency
7. **Agent calls use `run_in_background: false`** for synchronous execution
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

```bash
REFACTOR_DIR=".workflow/scratch/refactor-${slug}-${date}"
mkdir -p "$REFACTOR_DIR/.task"
mkdir -p "$REFACTOR_DIR/.summaries"
```

Write `index.json` with type "refactor", scope, status "active", plan/execution/reflection counters.

### Step 3: Scope Analysis

Load project specs if available (`maestro spec load --category coding`).

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

### Step 5: Execute with Reflection

Initialize `reflection-log.md` if not exists.

For each task in order:

**5a. Execute refactoring:**

Spawn Agent for complex refactoring tasks:
```
Agent({
  subagent_type: "general-purpose",
  description: "Execute refactoring: {task title}",
  prompt: "Implement refactoring as described. Read files in read_first, apply changes to target files. Follow convergence criteria exactly.",
  run_in_background: false
})
```

**5b. Run test suite:**
```bash
npm test 2>&1 || pytest 2>&1 || go test ./... 2>&1
```

**5c. Record in reflection-log.md:**
```markdown
## Round {N}: {task title}

- **Strategy:** {approach taken}
- **Result:** {pass|fail}
- **Tests:** {all pass | N failures}
- **Adjustment:** {what to change next, or "none needed"}
- **Files changed:** {list}
```

**5d. Handle test failures:**
1. Revert the change
2. Record failure + strategy adjustment in reflection-log.md
3. Retry with adjusted strategy (max 2 retries per task)
4. If still failing: mark task "blocked", continue to next

**5e. Update state:**
- `.task/TASK-{NNN}.json` status -> "completed" or "blocked"
- `.summaries/TASK-{NNN}-summary.md` written
- `index.json` execution and reflection fields updated

### Step 6: Final Verification

Run full test suite. Record final state in reflection-log.md:
```markdown
## Final Verification

- **Tests:** {result}
- **Tasks completed:** {N}/{total}
- **Tasks blocked:** {N}
- **Key learnings:** {patterns discovered}
```

### Step 7: Complete and Report

Update `index.json`: status -> "completed", final execution/reflection counts.

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

If regressions: suggest Skill({ skill: "quality-debug" }).
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
- [ ] Each task executed with test verification
- [ ] Failed changes reverted, retried with adjusted strategy
- [ ] Reflection log records every round's strategy and outcome
- [ ] Final test suite passes with zero regressions
- [ ] Completion report with key learnings displayed
</success_criteria>
