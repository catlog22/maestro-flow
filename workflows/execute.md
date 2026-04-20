# Execute Workflow

Wave-based parallel execution with atomic commits, breakpoint resume, and optional sync/reflection.

Core principle: **Execute per-plan, not per-phase.** Each plan's wave DAG runs independently. Multiple plans execute sequentially.

---

## Prerequisites

- Plan exists in scratch directory: `plan.json` + `.task/TASK-*.json`
- OR: executionContext handoff received from `/workflow:plan`

---

## Plan Resolution

```
Input: [phase] argument OR --dir <path>

# Worktree scope check
IF file_exists(".workflow/worktree-scope.json"):
  scope = read(".workflow/worktree-scope.json")
  IF <phase> is a number AND <phase> NOT IN scope.owned_phases:
    ERROR "Phase {phase} not owned by this worktree. Owned: {scope.owned_phases}"
    EXIT

# Auto-bootstrap state.json if missing
IF NOT file_exists(".workflow/state.json"):
  mkdir -p .workflow/scratch/
  Write minimal state.json

IF --dir <path> is provided:
  1. Set PLAN_DIRS = [<path>]  // single plan
  2. Validate directory exists and contains plan.json

ELSE IF no arguments:
  // Find all pending plans for current milestone
  1. Read state.json.artifacts
  2. Filter: milestone == current_milestone, type == "plan", status == "completed"
  3. Exclude plans that already have a corresponding EXC artifact (same path)
  4. Sort by phase order (from roadmap), adhoc plans last
  5. Set PLAN_DIRS = filtered plan paths
  6. If empty: ERROR E001 "No pending plans found"

ELSE IF argument is a number:
  // Find pending plans for specific phase
  1. Read state.json.artifacts
  2. Filter: milestone == current_milestone, type == "plan", status == "completed", phase == arg
  3. Exclude plans with existing EXC artifacts
  4. Set PLAN_DIRS = filtered plan paths

// Execute plans sequentially
FOR each PLAN_DIR IN PLAN_DIRS:
  execute_single_plan(PLAN_DIR)
  register_exc_artifact(PLAN_DIR)
  extract_incremental_learnings(PLAN_DIR)
```

---

## Flag Processing

| Flag | Effect |
|------|--------|
| `--auto-commit` | Override config: commit after each task completion |
| `--method agent\|cli\|auto` | Override execution method (default: config.json.execution.method) |
| `--executor <tool>` | Default CLI tool: gemini\|codex\|qwen\|opencode\|claude (default: first enabled in cli-tools.json) |
| `--dir <path>` | Use arbitrary directory instead of phase resolution (skip roadmap validation) |

---

## E1: Load Plan (per PLAN_DIR)

**Purpose:** Build or receive the execution queue for a single plan.

### From executionContext handoff (preferred, first plan only)

```
If executionContext is available in memory:
  planObject = executionContext.planObject
  explorations = executionContext.explorations
  clarifications = executionContext.clarifications
  executionMethod = --method flag || executionContext.executionMethod
  defaultExecutor = --executor flag || executionContext.defaultExecutor
  executorAssignments = executionContext.executorAssignments || {}
  Skip disk reload
```

### From disk (fallback / resume / subsequent plans)

```
Read ${PLAN_DIR}/plan.json

executionMethod = --method flag || config.json.execution.method || "agent"
defaultExecutor = --executor flag || config.json.execution.default_executor || "gemini"
executorAssignments = plan.json.executor_assignments || {}
```

### Detect completed tasks (breakpoint resume)

```
completed_tasks = []
For each task_id in plan.json.task_ids:
  Read ${PLAN_DIR}/.task/${task_id}.json
  If status == "completed":
    completed_tasks.push(task_id)

If completed_tasks.length > 0:
  Log "Resuming: {completed_tasks.length}/{total} tasks already completed"
  Filter completed tasks out of wave execution queue
  Set current_wave = first wave with pending tasks
```

### Build wave execution queue

```
waves = plan.json.waves

execution_queue = []
For each wave in waves:
  pending_tasks = wave.tasks.filter(t => !completed_tasks.includes(t))
  If pending_tasks.length > 0:
    execution_queue.push({ wave: wave.wave, tasks: pending_tasks })
```

### Output
- In-memory: execution_queue, executionMethod, loaded task definitions

---

## E1.5: Load Project Specs

```
specs_content = maestro spec load --category execution
```

Pass specs_content to each executor agent in E2.

---

## E2: Wave Parallel Execution

**Purpose:** Execute tasks wave by wave, parallel within each wave. Supports multi-backend dispatch — tasks route to Agent or CLI tools (via `maestro delegate`) based on executor resolution.

### Executor Resolution

```
# Priority: per-task assignment > global method > auto fallback
function resolveTaskExecutor(task_id):
  If executorAssignments[task_id]:
    return executorAssignments[task_id].executor   # "agent"|"gemini"|"codex"|"qwen"|"opencode"|"claude"
  If executionMethod == "agent":
    return "agent"
  If executionMethod == "cli":
    return defaultExecutor                         # e.g., "gemini"
  # executionMethod == "auto":
  task = loaded task definition
  # Heuristic: tasks with many files or multi-step implementation → agent; otherwise → CLI
  return (task.files.length > 5 || task.implementation.length > 8) ? "agent" : defaultExecutor
```

### Delegate Prompt Builder

```
# Unified prompt for CLI backends (maestro delegate). Same task info as Agent path.
function buildDelegatePrompt(task_def, phase_context, specs_content, prior_summaries):
  return """
PURPOSE: Implement task ${task_def.id}: ${task_def.title}; success = all convergence criteria pass
TASK: ${task_def.action} | Read existing code first | Verify convergence criteria after changes
MODE: write
CONTEXT: @${task_def.scope}/**/* | Phase: ${phase_context.goal}
EXPECTED: Working code changes, all convergence criteria verified, summary of what was done
CONSTRAINTS: Scope limited to task files | Follow project specs

## Task Definition

**Scope**: ${task_def.scope} | **Action**: ${task_def.action}

### Files
${task_def.files.map(f => '- ' + f.path + ' → ' + f.target + ': ' + f.change).join('\n')}

### Read First
${task_def.read_first.map(f => '- ' + f).join('\n')}

### Implementation Steps
${task_def.implementation.map(s => '- ' + s).join('\n')}

### Convergence Criteria
${task_def.convergence.criteria.map(c => '- [ ] ' + c).join('\n')}

### Reference
- Pattern: ${task_def.reference?.pattern || 'N/A'}
- Files: ${task_def.reference?.files?.join(', ') || 'N/A'}

## Phase Context
- Goal: ${phase_context.goal}
- Success criteria: ${phase_context.success_criteria}

## Project Specs
${specs_content}

## Prior Task Summaries
${prior_summaries}
"""
```

### Execution Loop

```
For each wave in execution_queue (sequential):

  Log "=== Wave {wave.wave}: {wave.tasks.length} tasks ==="

  Update index.json:
    execution.current_wave = wave.wave
    execution.started_at = execution.started_at || now()

  # State tracking (once, on first wave entry)
  If first_wave_entry (current_wave == execution_queue[0].wave):
    Read .workflow/state.json
    If state.json.status != "executing":
      state.json.status = "executing"
      # Worktree mode: skip phases_summary (reconciled on merge)
      IF NOT file_exists(".workflow/worktree-scope.json"):
        state.json.phases_summary.in_progress += 1
      state.json.last_updated = now()
      Write .workflow/state.json

  For each task_id in wave.tasks (parallel):

    # --- Per-task execution ---

    # Note: parallel tasks will overwrite; last-write-wins is acceptable for an advisory field
    0. Mark task active in state.json
       Read .workflow/state.json
       state.json.current_task_id = task_id
       state.json.last_updated = now()
       Write .workflow/state.json

    1. Load task definition
       Read .task/${task_id}.json (lazy loading)

    2. Resolve executor and dispatch
       executor = resolveTaskExecutor(task_id)

       IF executor == "agent":
         # --- Agent path (existing) ---
         Spawn workflow-executor agent (fresh 200k context)
         Input:
           - Task definition (.task/${task_id}.json)
           - Phase context (index.json goal, success_criteria)
           - Relevant summaries from prior waves (.summaries/ of deps)
           - Project specs (specs_content from E1.5)
           - Phase context decisions (context.md)
           - Phase analysis scores (analysis.md)

         Agent responsibilities:
           a. Read task definition (read_first, files, action, convergence.criteria)
           b. Implement the task (create/modify files per task.files)
           c. Verify convergence.criteria pass
           d. If verification fails: auto-fix (max 3 attempts)
           e. If auto-fix fails: write checkpoint, mark task as "blocked"
           f. Atomic commit (if auto-commit enabled):
              git add <task files>
              git commit -m "{type}({slug}): {task.title}"
           g. Write .summaries/${task_id}-summary.md
           h. Update .task/${task_id}.json:
              status = "completed" | "blocked"

       ELSE:
         # --- CLI path (via maestro delegate) ---
         fixedId = "${PHASE_NUM || 'scratch'}-${PHASE_SLUG}-${task_id}"
         prompt = buildDelegatePrompt(task_def, phase_context, specs_content, prior_summaries)

         # Store delegate ID for resume tracking
         index.json.execution.delegate_ids[task_id] = fixedId

         # Dispatch — synchronous, returns when done
         Bash("maestro delegate \"${prompt}\" --to ${executor} --mode write --id ${fixedId}")

         # Post-dispatch processing (CLI tools don't do this internally):
         a. Verify convergence criteria against actual file state
            For each criterion in task_def.convergence.criteria:
              Check file contents / grep / test command
         b. Determine status:
            If all criteria pass: status = "completed"
            Else: status = "blocked", log which criteria failed
         c. Write .summaries/${task_id}-summary.md (from delegate output + verification result)
         d. Update .task/${task_id}.json: status = status
         e. Auto-commit (if --auto-commit and status == "completed"):
            git add <task files>
            git commit -m "{type}({slug}): {task.title}"

    3. Collect result
       result = { task_id, status, executor, summary_path, commit_hash, delegate_id }

    4. Clear current_task_id in state.json
       Read .workflow/state.json
       state.json.current_task_id = null
       state.json.last_updated = now()
       Write .workflow/state.json

    # --- End per-task ---

  Wait for all tasks in wave to complete

  # Post-wave processing
  For each result in wave_results:
    Update index.json.execution:
      tasks_completed += (completed count)
      commits.push({ hash, task, message }) for each commit

  If any task blocked:
    Log "Wave {wave.wave}: {blocked_count} tasks blocked"
    AskUserQuestion:
      "Tasks blocked: {blocked_list}. Continue to next wave or stop?"
      Options: [Continue (skip blocked), Stop and review]
    If stop: break execution loop

  Log "=== Wave {wave.wave} complete ==="
```

### Parallel Dispatch Rules

```
Within a wave, tasks execute in parallel regardless of executor type:
- Agent tasks: multiple Agent() calls in single message (run_in_background: false)
- CLI tasks: multiple Bash("maestro delegate ...") calls in single message (run_in_background: true)
- Mixed: Agent() + Bash() calls together in single message
- Each task = one independent dispatch (never merge tasks into one delegate prompt)
```

### Deviation Rule

```
Per task, max 3 auto-fix attempts:

Agent path: auto-fix handled internally by workflow-executor agent.

CLI path: auto-fix via session resume:
  Attempt 1: Re-dispatch with --resume ${fixedId}
  Attempt 2: Re-dispatch with simplified prompt (reduce to core action + criteria)
  Attempt 3: Fallback to agent executor for this task

If all 3 fail:
  Mark task as "blocked" with checkpoint data:
    .task/${task_id}.json.meta.checkpoint = {
      attempt: 3,
      last_error: "...",
      partial_files: [...],
      executor: executor,
      delegate_id: fixedId
    }
  Continue wave (other tasks unaffected)
```

---

## E2.5: Post-Wave Validation

**Purpose:** Validate execution integrity after all waves complete, before sync and reflection. Catches missing summaries, status inconsistencies, and tech stack constraint violations early.

### Check 1: Summary Existence

```
For each task_id in index.json.plan.task_ids:
  Read .task/${task_id}.json
  If status == "completed":
    If NOT file exists .summaries/${task_id}-summary.md:
      violations.push({
        type: "missing_summary",
        severity: "warning",
        task_id: task_id,
        message: "Completed task ${task_id} has no summary file at .summaries/${task_id}-summary.md"
      })
```

### Check 2: Task Status Consistency

```
For each task_id in index.json.plan.task_ids:
  Read .task/${task_id}.json
  task_status = task.status

  # Verify completed tasks were actually in the execution results
  If task_status == "completed":
    If task_id NOT in wave_results (collected from E2):
      violations.push({
        type: "status_mismatch",
        severity: "warning",
        task_id: task_id,
        message: "Task ${task_id} status is 'completed' but was not part of execution results"
      })

  # Verify tasks that ran successfully are marked completed
  If task_id in wave_results AND wave_results[task_id].status == "completed":
    If task_status != "completed":
      violations.push({
        type: "status_mismatch",
        severity: "critical",
        task_id: task_id,
        message: "Task ${task_id} completed execution but .task/${task_id}.json status is '${task_status}'"
      })
```

### Check 3: Tech Stack Constraint Compliance

```
# Load specs constraints from E1.5 specs_content (already loaded)
tech_constraints = extract tech_stack constraints from specs_content
  # e.g., allowed_languages, disallowed_imports, required_patterns

If tech_constraints is not empty:
  # Collect files modified during execution
  modified_files = []
  For each task_id in completed_tasks:
    Read .task/${task_id}.json
    For each file in task.files:
      modified_files.push(file.path)

  # Scan modified files for disallowed imports
  For each file_path in modified_files:
    If file exists ${file_path}:
      file_content = Read ${file_path}
      For each constraint in tech_constraints.disallowed_imports:
        If file_content matches constraint.pattern:
          violations.push({
            type: "tech_stack_violation",
            severity: "critical",
            task_id: associated_task_id,
            file: file_path,
            message: "File ${file_path} contains disallowed import matching '${constraint.pattern}': ${constraint.reason}"
          })
```

### Gate Logic

```
critical_violations = violations.filter(v => v.severity == "critical")
warnings = violations.filter(v => v.severity == "warning")

If warnings.length > 0:
  Log "Post-wave validation: {warnings.length} warning(s)"
  For each warning in warnings:
    Log "  WARN: ${warning.message}"

If critical_violations.length > 0:
  Log "Post-wave validation: {critical_violations.length} critical violation(s)"
  For each violation in critical_violations:
    Log "  CRITICAL: ${violation.message}"

  # Block execution
  index.json.status = "blocked"
  index.json.execution.blocked_reason = "Post-wave validation failed with critical violations"
  index.json.execution.violations = violations
  index.json.updated_at = now()
  Write index.json

  Abort: "Post-wave validation failed. Fix critical violations before proceeding."

# No critical violations — continue to E3
Log "Post-wave validation passed ({warnings.length} warnings, 0 critical)"
```

---

## E3: Auto Sync

**Purpose:** Update codebase documentation after execution.

```
If config.json.codebase.auto_sync_after_execute == true:
  Trigger /workflow:sync logic:
    1. Detect changed files (git diff from execution start)
    2. Map changes to doc-index.json components/features
    3. Update affected entries
    4. Refresh tech-registry and feature-maps as needed
Else:
  Log "Auto-sync disabled. Run /workflow:sync manually if needed."
```

---

## E4: Reflection (Optional)

**Purpose:** Record strategy observations for future iterations.

```
If config.json.workflow.reflection == true:
  Review execution results:
    - Which tasks completed smoothly?
    - Which required auto-fix attempts?
    - Any blocked tasks?
    - Patterns observed?

  Append to ${PLAN_DIR}/reflection-log.md:
    ## Reflection - Wave Execution {timestamp}
    - Strategy adjustments: [...]
    - Patterns noted: [...]
    - Blocked tasks: [...]

  Update index.json.reflection:
    rounds += 1
    strategy_adjustments.push(new adjustments)
```

---

## Final State Update

```
all_completed = index.json.execution.tasks_completed == index.json.execution.tasks_total

If all_completed:
  index.json.status = "verifying"  (ready for /workflow:verify)
  index.json.execution.completed_at = now()
  Log "All tasks completed. Run /workflow:verify to validate results."
Else:
  index.json.status = "executing"  (partial, can resume)
  Log "{completed}/{total} tasks completed. Re-run /workflow:execute to resume."

index.json.updated_at = now()

# Update project state.json (skip in SCRATCH_MODE)
If NOT SCRATCH_MODE:
  Read .workflow/state.json
  If all_completed:
    state.json.status = "verifying"
  state.json.current_task_id = null  # safety clear: no task is active once the wave loop exits
  state.json.last_updated = now()
  Write .workflow/state.json
```

---

## E5: Register Artifact & Extract Learnings (per PLAN_DIR)

**Purpose:** Register execution completion and extract incremental learnings.

```
// Register EXC artifact
Read .workflow/state.json
plan_artifact = state.json.artifacts.find(a => a.type == "plan" && a.path == PLAN_DIR_relative)
next_id = max(artifacts.filter(a => a.type == "execute").map(a => parseInt(a.id.replace("EXC-","")))) + 1

artifact = {
  id: "EXC-{next_id padded to 3}",
  type: "execute",
  milestone: plan_artifact.milestone,
  phase: plan_artifact.phase,
  scope: plan_artifact.scope,
  path: plan_artifact.path,    // same path — execute writes into plan dir
  status: "completed",
  depends_on: plan_artifact.id,
  harvested: false,
  created_at: execution_start_time,
  completed_at: now()
}

state.json.artifacts.push(artifact)
state.json.last_updated = now()
Write state.json (atomic)

// Incremental learning extraction
Read all ${PLAN_DIR}/.summaries/TASK-*-summary.md
Extract: strategy adjustments, patterns discovered, pitfalls encountered
Append to .workflow/specs/learnings.md under "## Entries"
Mark artifact.harvested = true
Write state.json (atomic)
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No pending plans found | Abort: "No pending plans. Run /workflow:plan first." |
| Plan directory not found | Abort: "Plan dir not found." |
| Task file missing | Skip task, log error, continue wave |
| Agent spawn fails | Retry once, then mark task as "blocked" |
| Delegate fails | Resume with `--resume ${fixedId}`, then fallback to agent |
| Git commit fails | Log warning, continue (task still marked completed) |
| All tasks in wave blocked | Stop execution, report blocked wave |

---

## Breakpoint Resume

The execute workflow is fully resumable:

```
State tracking in index.json.execution:
  tasks_completed: N       # Count of finished tasks
  current_wave: W          # Last active wave
  commits: [...]           # All commits made
  method: "agent"|"cli"|"auto"    # Execution method used
  default_executor: "gemini"|...  # CLI tool used (if method != "agent")
  delegate_ids: { task_id: fixedId, ... }  # CLI task delegate IDs

Re-running /workflow:execute <phase>:
  1. Reads index.json.execution.tasks_completed
  2. Checks each .task/TASK-*.json status
  3. For CLI-dispatched tasks with status "in-progress":
     fixedId = index.json.execution.delegate_ids[task_id]
     Check maestro delegate status ${fixedId}
     If completed: retrieve output, process as completed
     If failed: add to retry queue with --resume ${fixedId}
  4. Builds queue of remaining tasks
  5. Continues from next pending wave
  6. No duplicate execution of completed tasks
```
