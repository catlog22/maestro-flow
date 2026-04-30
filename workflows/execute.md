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

Worktree scope check: if .workflow/worktree-scope.json exists, reject <phase> not in scope.owned_phases
Auto-bootstrap: create .workflow/state.json if missing

Resolve PLAN_DIRS:
  --dir <path>    → single plan, validate plan.json exists
  no arguments    → all pending plans: state.json artifacts where type=plan, status=completed,
                    current milestone, no matching EXC artifact; sorted by phase order, adhoc last
  <phase number>  → pending plans for that phase only (same filter + phase match)
  If empty: ERROR E001 "No pending plans found"

For each PLAN_DIR in PLAN_DIRS (sequential):
  Execute plan, register EXC artifact, extract incremental learnings
```

---

## Flag Processing

| Flag | Effect |
|------|--------|
| `--auto-commit` | Override config: commit after each task completion |
| `--method agent\|codex\|gemini\|cli\|auto` | Override execution method (default: config.json.execution.method) |
| `--executor <tool>` | Default CLI tool: gemini\|codex\|qwen\|opencode\|claude (default: first enabled in cli-tools.json) |
| `--dir <path>` | Use arbitrary directory instead of phase resolution (skip roadmap validation) |
| `-y` | Auto-approve execution options (skip confirmation prompt) |

---

## E0.5: Execution Options Confirmation

**Purpose:** Let user choose how tasks execute. Reads available tools from `delegate-config show --json` to build dynamic options. Supports both menu selection and natural language intent. Skipped when `-y` flag or executionContext already confirmed.

### Skip conditions

- `-y` flag → use resolved defaults, skip prompt
- `executionContext.executionMethod` already set → skip (confirmed in /maestro-plan)

### Pre-step: Load tool config

```
Run: maestro delegate-config show --json
Parse: { tools, roles } — extract enabled tool names and domain tags
Build dynamic options from enabled tools (exclude agent which is always available)
```

### Tool Call

Build AskUserQuestion dynamically from enabled tools:

```
// availableTools = enabled tools from delegate-config (e.g. ["gemini", "claude", "codex"])
// frontendTool = first tool with "frontend" tag, fallback first enabled
// backendTool = first tool with "backend" tag, fallback first enabled

AskUserQuestion({
  questions: [
    {
      question: "How should tasks be executed? Select one, or choose Other to specify per-domain rules (e.g. '前端gemini 后端codex 其余agent')",
      header: "Executor",
      multiSelect: false,
      options: [
        { label: "Auto (Recommended)", description: `Per-task domain routing: frontend→${frontendTool}, backend→${backendTool}, general→agent` },
        { label: "Agent", description: "Claude Code agent for all tasks (fastest)" },
        // One option per enabled CLI tool:
        ...availableTools.map(t => ({ label: t, description: `${t} CLI for all tasks` }))
      ]
    },
    {
      question: "Run code review after execution?",
      header: "Review",
      multiSelect: false,
      options: [
        { label: "Skip (Recommended)", description: "No code review, proceed to verification" },
        // One option per enabled CLI tool with review capability:
        ...availableTools.map(t => ({ label: `${t} Review`, description: `${t} CLI: git diff quality review` }))
      ]
    }
  ]
})
```

### Parse response

**Question 1 (Executor):**

| Answer | executionMethod | domainRouting |
|--------|----------------|---------------|
| "Auto" | `"auto"` | `{ frontend: frontendTool, backend: backendTool, default: "agent" }` |
| "Agent" / tool name | that value | not used |
| Other text with domain rules | `"auto"` | Parse from user text |

Other text parsing — match tool names dynamically from enabled tools:

| User types | domainRouting |
|------------|---------------|
| `前端gemini 后端codex` | `{ frontend: "gemini", backend: "codex", default: "agent" }` |
| `backend agent, frontend gemini` | `{ frontend: "gemini", backend: "agent", default: "agent" }` |
| `all codex` | `{ default: "codex" }` |

**Question 2 (Review):** store as `codeReviewTool`

Store: `executionMethod`, `domainRouting`, `codeReviewTool`

---

## E1: Load Plan (per PLAN_DIR)

**Purpose:** Build or receive the execution queue for a single plan.

### From executionContext handoff (preferred, first plan only)

```
If executionContext is available in memory:
  planObject = executionContext.planObject
  explorations = executionContext.explorations
  clarifications = executionContext.clarifications
  executionMethod = E0.5 selection || --method flag || executionContext.executionMethod
  defaultExecutor = --executor flag || executionContext.defaultExecutor
  executorAssignments = executionContext.executorAssignments || {}
  domainRouting = E0.5 domainRouting || executionContext.domainRouting || {}
  codeReviewTool = E0.5 selection || executionContext.codeReviewTool || "Skip"
  Skip disk reload
```

### From disk (fallback / resume / subsequent plans)

```
Read ${PLAN_DIR}/plan.json

executionMethod = E0.5 selection || --method flag || config.json.execution.method || "auto"
defaultExecutor = --executor flag || config.json.execution.default_executor || first enabled tool from delegate-config
executorAssignments = plan.json.executor_assignments || {}
domainRouting = E0.5 domainRouting || built from delegate-config domain tags (frontend→tag match, backend→tag match, default→"agent")
codeReviewTool = E0.5 selection || "Skip"
```

### Detect completed tasks (breakpoint resume)

```
Scan .task/${task_id}.json for each task in plan.json.task_ids
Collect completed tasks; if any found, log resume status and advance to first wave with pending tasks
```

### Build wave execution queue

```
Build execution_queue from plan.json.waves, including only waves with pending (non-completed) tasks
```

### Output
- In-memory: execution_queue, executionMethod, loaded task definitions

---

## E1.5: Load Project Specs

```
specs_content = maestro spec load --category coding
```

Pass specs_content to each executor agent in E2.

---

## E2: Wave Parallel Execution

**Purpose:** Execute tasks wave by wave, parallel within each wave. Supports multi-backend dispatch — tasks route to Agent or CLI tools (via `maestro delegate`) based on executor resolution.

### Executor Resolution

Resolution priority: per-task assignment > explicit method > auto domain routing.

**Single executor mode** (executionMethod is agent/codex/gemini/cli): all tasks use that executor.

**Auto mode** (executionMethod is "auto"): route each task by domain using `domainRouting` map from E0.5.

For each task, judge its domain from the task definition (scope, file paths, action description):
- **frontend** — UI components, pages, styles, layouts, templates (.tsx/.jsx/.vue/.css/.html, scope contains ui/frontend/component/style/page/view)
- **backend** — API, server, database, services, algorithms (.go/.rs/.java/.py/.sql/.proto, scope contains api/backend/server/database/service/worker)
- **general** — mixed, .ts/.js only, config, tests, or unclear domain

Then look up `domainRouting[domain]`, falling back to `domainRouting.default` (which is "agent" if unset).

Log the routing decision per task before dispatch:

```
TASK-001 [frontend] → gemini
TASK-002 [backend]  → codex
TASK-003 [general]  → agent
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
  Log wave start; update index.json (current_wave, started_at)
  On first wave: set state.json.status = "executing" if not already

  For each task_id in wave.tasks (parallel):
    Mark task active in state.json (last-write-wins for parallel tasks)
    Load .task/${task_id}.json; resolve executor

    IF executor == "agent":
      Spawn workflow-executor agent (fresh 200k context) with:
        task definition, phase context, prior wave summaries, specs_content, context.md, analysis.md
      Agent: implement task → verify convergence → auto-fix (max 3) → checkpoint if blocked
      On success: atomic commit (if auto-commit), write .summaries/${task_id}-summary.md
      Update .task/${task_id}.json: status = "completed" | "blocked"

    ELSE (CLI path via maestro delegate):
      fixedId = "${PHASE_NUM || 'scratch'}-${PHASE_SLUG}-${task_id}"
      Store fixedId in index.json.execution.delegate_ids[task_id]
      Dispatch: maestro delegate "${prompt}" --to ${executor} --mode write --id ${fixedId}
      Post-dispatch: verify convergence criteria against file state
      Write summary, update task status, auto-commit if enabled

    Collect result: { task_id, status, executor, summary_path, commit_hash, delegate_id }
    Clear state.json.current_task_id

  Wait for all wave tasks; update index.json (tasks_completed, commits)
  If any blocked: prompt user to continue or stop
```

### Parallel Dispatch Rules

```
All tasks in a wave dispatch in parallel (Agent + CLI mixed in single message).
Agent tasks: run_in_background: false | CLI tasks: run_in_background: true
Each task = one independent dispatch (never merge tasks into one delegate prompt)
```

### Deviation Rule

```
Max 3 auto-fix attempts per task:
  Agent path: handled internally by workflow-executor agent
  CLI path: 1) --resume ${fixedId} → 2) simplified prompt → 3) fallback to agent

If all 3 fail: mark "blocked" with checkpoint in .task/${task_id}.json.meta.checkpoint
  { attempt: 3, last_error, partial_files, executor, delegate_id: fixedId }
Continue wave (other tasks unaffected)
```

---

## E2.5: Post-Wave Validation

**Purpose:** Validate execution integrity after all waves complete, before sync and reflection. Catches missing summaries, status inconsistencies, and tech stack constraint violations early.

### Check 1: Summary Existence

```
For each completed task: flag warning if .summaries/${task_id}-summary.md missing
  → violation: { type: "missing_summary", severity: "warning", task_id, message }
```

### Check 2: Task Status Consistency

```
Cross-check task status against wave_results from E2:
  - Completed in .task/ but not in wave_results → warning "status_mismatch"
  - Completed in wave_results but not in .task/ → critical "status_mismatch"
```

### Check 3: Tech Stack Constraint Compliance

```
Extract tech_stack constraints from specs_content (allowed_languages, disallowed_imports, required_patterns)
If constraints exist:
  Collect all files modified by completed tasks
  Scan each for disallowed import patterns → critical "tech_stack_violation" per match
```

### Gate Logic

```
Log all warnings; log all critical violations
If any critical: set index.json.status = "blocked" with blocked_reason and violations, abort
If none critical: log "passed" and continue to E2.6
```

---

## E2.6: Code Review (Optional)

**Purpose:** Run code review on execution output if selected in E0.5.

```
If codeReviewTool == "Skip": continue to E3

Dispatch review via maestro delegate (run_in_background: true):
  --to ${codeReviewTool} --mode analysis
  Prompt: review git diff (execution start → HEAD) for correctness, style, bugs
  Rule: analysis-review-code-quality
  Expected: severity-ranked issues with file:line references and fix suggestions

Wait for completion, log findings summary
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
If all tasks completed:
  index.json.status = "verifying", set completed_at → "Run /workflow:verify"
Else:
  index.json.status = "executing" (partial) → "Re-run /workflow:execute to resume"

Update index.json.updated_at
If NOT SCRATCH_MODE: sync state.json (status, clear current_task_id)
```

---

## E5: Register Artifact & Extract Learnings (per PLAN_DIR)

**Purpose:** Register execution completion and extract incremental learnings.

```
// Register EXC artifact
Find matching plan artifact in state.json; create EXC artifact:
  { id: "EXC-{next_id padded to 3}", type: "execute", milestone, phase, scope,
    path: plan_artifact.path, status: "completed", depends_on: plan_artifact.id,
    harvested: false, created_at, completed_at }
Append to state.json.artifacts (atomic write)

// Incremental learning extraction
Read all .summaries/TASK-*-summary.md; extract strategy adjustments, patterns, pitfalls
Deduplicate against existing learnings (maestro spec load --category learning)
Append unique entries to .workflow/specs/learnings.md using <spec-entry> closed-tag format:
  category="learning", keywords (3-5 terms), date, source="execute"

Mark artifact.harvested = true; write state.json (atomic)
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
State tracked in index.json.execution:
  tasks_completed, current_wave, commits, method, default_executor,
  delegate_ids: { task_id: fixedId, ... }

Resume behavior (/workflow:execute <phase> re-run):
  Check each .task/TASK-*.json status + delegate status for in-progress CLI tasks
  CLI tasks: retrieve completed output or retry with --resume ${fixedId}
  Build queue of remaining tasks, continue from next pending wave
  No duplicate execution of completed tasks
```
