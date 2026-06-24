# Dispatch

Create the issue resolution task chain with correct dependencies and structured task descriptions based on selected pipeline mode.

## Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From session.json mode | Yes |
| Issue IDs | From session.json issue_ids | Yes |
| Execution method | From session.json execution_method | Yes |
| Code review | From session.json code_review | No |

1. Load requirement, pipeline mode, issue IDs, and execution method from session.json
2. Determine task chain from pipeline mode

## Task Description Template

Every task description uses structured format:

```
TaskCreate({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <completion criteria>
TASK:
  - <step 1>
  - <step 2>
  - <step 3>
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
  - Upstream artifacts: <artifact-list>
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: false
execution_method: <method>
code_review: <setting>"
})
TaskUpdate({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

## Pipeline Router

| Mode | Action |
|------|--------|
| quick | Create 4 tasks (EXPLORE → SOLVE → MARSHAL → BUILD) |
| full | Create 5 tasks (EXPLORE → SOLVE → AUDIT → MARSHAL → BUILD) |
| batch | Create N+N+1+1+M tasks (EXPLORE-001..N → SOLVE-001..N → AUDIT-001 → MARSHAL-001 → BUILD-001..M) |

---

### Quick Pipeline

**EXPLORE-001** (explorer):
```
TaskCreate({
  subject: "EXPLORE-001",
  description: "PURPOSE: Analyze issue context and map codebase impact | Success: Context report with relevant files and dependencies
TASK:
  - Load issue details via ccw issue status
  - Explore codebase for relevant files and patterns
  - Assess complexity and impact scope
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
EXPECTED: <session>/explorations/context-<issueId>.json with relevant files, dependencies, and impact assessment
CONSTRAINTS: Exploration and analysis only, no solution design
---
InnerLoop: false"
})
TaskUpdate({ taskId: "EXPLORE-001", owner: "explorer" })
```

**SOLVE-001** (planner):
```
TaskCreate({
  subject: "SOLVE-001",
  description: "PURPOSE: Design solution and decompose into implementation tasks | Success: Bound solution with task decomposition
TASK:
  - Load explorer context report
  - Generate solution plan via CLI
  - Bind solution to issue
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
  - Upstream artifacts: explorations/context-<issueId>.json
EXPECTED: <session>/solutions/solution-<issueId>.json with solution plan and task list
CONSTRAINTS: Solution design only, no code implementation
---
InnerLoop: false"
})
TaskUpdate({ taskId: "SOLVE-001", addBlockedBy: ["EXPLORE-001"], owner: "planner" })
```

**MARSHAL-001** (integrator):
```
TaskCreate({
  subject: "MARSHAL-001",
  description: "PURPOSE: Form execution queue with conflict detection and ordering | Success: Execution queue file with resolved conflicts
TASK:
  - Verify all issues have bound solutions
  - Detect file conflicts between solutions
  - Produce ordered execution queue with DAG-based parallel groups
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
  - Upstream artifacts: solutions/solution-<issueId>.json
EXPECTED: .workflow/issues/queue/execution-queue.json with queue, conflicts, parallel groups
CONSTRAINTS: Queue formation only, no implementation
---
InnerLoop: false"
})
TaskUpdate({ taskId: "MARSHAL-001", addBlockedBy: ["SOLVE-001"], owner: "integrator" })
```

**BUILD-001** (implementer):
```
TaskCreate({
  subject: "BUILD-001",
  description: "PURPOSE: Implement solution plan and verify with tests | Success: Code changes committed, tests pass
TASK:
  - Load bound solution and explorer context
  - Route to execution backend (Auto/Codex/Agy)
  - Run tests and verify implementation
  - Commit changes
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
  - Upstream artifacts: explorations/context-<issueId>.json, solutions/solution-<issueId>.json, queue/execution-queue.json
EXPECTED: <session>/builds/ with implementation results, tests passing
CONSTRAINTS: Follow solution plan, no scope creep
---
InnerLoop: false
execution_method: <execution_method>
code_review: <code_review>"
})
TaskUpdate({ taskId: "BUILD-001", addBlockedBy: ["MARSHAL-001"], owner: "implementer" })
```

---

### Full Pipeline

Creates 5 tasks. EXPLORE-001 and SOLVE-001 same as Quick, then AUDIT gate before MARSHAL and BUILD.

**AUDIT-001** (reviewer):
```
TaskCreate({
  subject: "AUDIT-001",
  description: "PURPOSE: Review solution for technical feasibility, risk, and completeness | Success: Clear verdict (approved/concerns/rejected) with scores
TASK:
  - Load explorer context and bound solution
  - Score across 3 dimensions: technical feasibility (40%), risk (30%), completeness (30%)
  - Produce verdict: approved (>=80), concerns (60-79), rejected (<60)
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issue-id-list>
  - Upstream artifacts: explorations/context-<issueId>.json, solutions/solution-<issueId>.json
EXPECTED: <session>/audits/audit-report.json with per-issue scores and overall verdict
CONSTRAINTS: Review only, do not modify solutions
---
InnerLoop: false"
})
TaskUpdate({ taskId: "AUDIT-001", addBlockedBy: ["SOLVE-001"], owner: "reviewer" })
```

**MARSHAL-001**: Same as Quick, but `addBlockedBy: ["AUDIT-001"]`.

**BUILD-001**: Same as Quick, `addBlockedBy: ["MARSHAL-001"]`.

---

### Batch Pipeline

Creates tasks in parallel batches. Issue count = N, BUILD tasks = M (from queue parallel groups).

**EXPLORE-001..N** (explorer, parallel):

For each issue in issue_ids (up to 5), create an EXPLORE task with distinct owner:

| Issue Count | Owner Assignment |
|-------------|-----------------|
| N = 1 | owner: "explorer" |
| N > 1 | owner: "explorer-1", "explorer-2", ..., "explorer-N" (max 5) |

```
TaskCreate({
  subject: "EXPLORE-<NNN>",
  description: "PURPOSE: Analyze issue <issueId> context and map codebase impact | Success: Context report for <issueId>
TASK:
  - Load issue details for <issueId>
  - Explore codebase for relevant files
  - Assess complexity and impact scope
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issueId>
EXPECTED: <session>/explorations/context-<issueId>.json
CONSTRAINTS: Single issue scope, exploration only
---
InnerLoop: false"
})
TaskUpdate({ taskId: "EXPLORE-<NNN>", owner: "explorer-<N>" })
```

**SOLVE-001..N** (planner, sequential after all EXPLORE):

```
TaskCreate({
  subject: "SOLVE-<NNN>",
  description: "PURPOSE: Design solution for <issueId> | Success: Bound solution with tasks
TASK:
  - Load explorer context for <issueId>
  - Generate solution plan
  - Bind solution
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issueId>
  - Upstream artifacts: explorations/context-<issueId>.json
EXPECTED: <session>/solutions/solution-<issueId>.json
CONSTRAINTS: Solution design only
---
InnerLoop: false"
})
TaskUpdate({ taskId: "SOLVE-<NNN>", addBlockedBy: ["EXPLORE-001", ..., "EXPLORE-<N>"], owner: "planner" })
```

**AUDIT-001** (reviewer, batch review):
```
TaskCreate({
  subject: "AUDIT-001",
  description: "PURPOSE: Batch review all solutions | Success: Verdict for each solution
TASK:
  - Load all explorer contexts and bound solutions
  - Score each solution across 3 dimensions
  - Produce per-issue verdicts and overall verdict
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <all-issue-ids>
  - Upstream artifacts: explorations/*.json, solutions/*.json
EXPECTED: <session>/audits/audit-report.json with batch results
CONSTRAINTS: Review only
---
InnerLoop: false"
})
TaskUpdate({ taskId: "AUDIT-001", addBlockedBy: ["SOLVE-001", ..., "SOLVE-<N>"], owner: "reviewer" })
```

**MARSHAL-001** (integrator): `addBlockedBy: ["AUDIT-001"]`.

**BUILD-001..M** (implementer, DAG parallel):

> Note: In Batch mode, BUILD task count M is not known at dispatch time (depends on MARSHAL queue output). Defer BUILD task creation to handleCallback when MARSHAL completes. Coordinator creates BUILD tasks dynamically after reading execution-queue.json.

When M is known (deferred creation after MARSHAL), assign distinct owners:

| Build Count | Owner Assignment |
|-------------|-----------------|
| M <= 2 | owner: "implementer" |
| M > 2 | owner: "implementer-1", ..., "implementer-M" (max 3) |

```
TaskCreate({
  subject: "BUILD-<NNN>",
  description: "PURPOSE: Implement solution for <issueId> | Success: Code committed, tests pass
TASK:
  - Load bound solution and explorer context
  - Execute implementation via <execution_method>
  - Run tests, commit
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <issueId>
  - Upstream artifacts: explorations/context-<issueId>.json, solutions/solution-<issueId>.json, queue/execution-queue.json
EXPECTED: <session>/builds/ with results
CONSTRAINTS: Follow solution plan
---
InnerLoop: false
execution_method: <execution_method>
code_review: <code_review>"
})
TaskUpdate({ taskId: "BUILD-<NNN>", addBlockedBy: ["MARSHAL-001"], owner: "implementer-<M>" })
```

---

### Review-Fix Cycle (Full/Batch modes)

When AUDIT rejects a solution, coordinator creates fix tasks dynamically in handleCallback — NOT at dispatch time.

**SOLVE-fix-001** (planner, revision):
```
TaskCreate({
  subject: "SOLVE-fix-001",
  description: "PURPOSE: Revise solution addressing reviewer feedback (fix cycle <round>) | Success: Revised solution addressing rejection reasons
TASK:
  - Read reviewer feedback from audit report
  - Design alternative approach addressing concerns
  - Re-bind revised solution
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <rejected-issue-ids>
  - Upstream artifacts: audits/audit-report.json
  - Reviewer feedback: <rejection-reasons>
EXPECTED: <session>/solutions/solution-<issueId>.json (revised)
CONSTRAINTS: Address reviewer concerns specifically
---
InnerLoop: false"
})
TaskUpdate({ taskId: "SOLVE-fix-001", addBlockedBy: ["AUDIT-001"], owner: "planner" })
```

**AUDIT-002** (reviewer, re-review):
```
TaskCreate({
  subject: "AUDIT-002",
  description: "PURPOSE: Re-review revised solution (fix cycle <round>) | Success: Verdict on revised solution
TASK:
  - Load revised solution
  - Re-evaluate previously rejected dimensions
  - Produce updated verdict
CONTEXT:
  - Session: <session-folder>
  - Issue IDs: <rejected-issue-ids>
  - Upstream artifacts: solutions/solution-<issueId>.json (revised), audits/audit-report.json
EXPECTED: <session>/audits/audit-report.json (updated)
CONSTRAINTS: Focus on previously rejected dimensions
---
InnerLoop: false"
})
TaskUpdate({ taskId: "AUDIT-002", addBlockedBy: ["SOLVE-fix-001"], owner: "reviewer" })
```

## Validation

1. Verify all tasks created with `TaskList()`
2. Check dependency chain integrity:
   - No circular dependencies
   - All blockedBy references exist
   - First task(s) have empty blockedBy (EXPLORE tasks)
3. Log task count and pipeline mode
4. Verify mode-specific constraints:

| Mode | Constraint |
|------|-----------|
| quick | Exactly 4 tasks, no AUDIT |
| full | Exactly 5 tasks, includes AUDIT |
| batch | N EXPLORE + N SOLVE + 1 AUDIT + 1 MARSHAL + deferred BUILD |
