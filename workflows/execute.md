# Execute Workflow

Wave-based parallel execution with atomic commits, breakpoint resume, built-in verification gate, and optional sync/reflection. Execute per-plan, not per-phase.

---

## Iron Law

NEVER mark a task "completed" without running convergence criteria checks. Every completion requires:
1. Run convergence criteria checks
2. Confirm output matches task definition
3. Evidence of verification in the task summary

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
| `--skip-verify` | Skip E2.7 verification gate (trust execution output) |
| `-y` | Auto mode — skip ALL interactive questions (E0.5 options, inter-wave confirmations, blocked-task prompts) |

---

## E0.5: Execution Options Confirmation

### Skip conditions

- `-y` flag → use resolved defaults, skip prompt (applies to ALL interactive questions throughout execution, not just E0.5)
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
        { label: "Skip", description: "No code review" },
        ...availableTools.map(t => ({ label: `${t} Review`, description: `${t} CLI: git diff quality review` }))
      ]
    },
    {
      question: "Verification gate? (external model checks convergence + structure + anti-patterns)",
      header: "Verify",
      multiSelect: false,
      options: [
        { label: "Auto (Recommended)", description: `Delegate to ${availableTools[0] || 'first enabled tool'} for convergence + 3-layer structure + anti-pattern check` },
        ...availableTools.map(t => ({ label: t, description: `${t}: verification gate` })),
        { label: "Skip", description: "No verification gate" }
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

**Question 3 (Verify):**

| Answer | verificationTool |
|--------|-----------------|
| "Auto" | First enabled tool from config |
| Tool name | That tool |
| "Skip" | `"Skip"` |

`--skip-verify` flag overrides to `"Skip"`.

Store: `executionMethod`, `domainRouting`, `codeReviewTool`, `verificationTool`

---

## E1: Load Plan (per PLAN_DIR)

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
  verificationTool = E0.5 selection || executionContext.verificationTool || "Auto"
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
verificationTool = E0.5 selection || "Auto"
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
# MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
specs_content = maestro spec load --category coding
```

Pass specs_content to each executor agent in E2.

---

## E2: Wave Parallel Execution

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
      Agent internally handles full lifecycle:
        implement → verify convergence → auto-fix (max 3) → commit → write .summaries/${task_id}-summary.md → update .task/${task_id}.json status
        (checkpoint if blocked)
      Main flow: verify agent wrote summary + updated status, collect result

    ELSE (CLI path via maestro delegate):
      fixedId = "${PHASE_NUM || 'scratch'}-${PHASE_SLUG}-${task_id}"
      Store fixedId in index.json.execution.delegate_ids[task_id]
      Dispatch: maestro delegate "${prompt}" --to ${executor} --mode write --id ${fixedId}
      Main flow post-dispatch: verify convergence criteria against file state
      Main flow writes: .summaries/${task_id}-summary.md, update .task/${task_id}.json status, auto-commit if enabled

    Collect result: { task_id, status, executor, summary_path, commit_hash, delegate_id }
    Clear state.json.current_task_id

  Wait for all wave tasks; update index.json (tasks_completed, commits)
  If any blocked AND NOT -y flag: prompt user to continue or stop
  Else: continue to next wave automatically (NEVER ask for confirmation between waves)
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
  CLI path: 1) --resume ${fixedId} → 2) simplified prompt → 3) fallback to agent; flag task as [LOW CONFIDENCE] (agent fallback used)

If all 3 fail: mark "blocked" with checkpoint in .task/${task_id}.json.meta.checkpoint
  { attempt: 3, last_error, partial_files, executor, delegate_id: fixedId }
Continue wave (other tasks unaffected)
```

---

## E2.5: Post-Wave Validation

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

### Check 4: CLI Supplementary Validation (optional)

```
IF no CLI tools enabled OR completed_tasks.length == 0: skip

modified_files = collect all files modified by completed tasks

Bash({
  command: 'maestro delegate "PURPOSE: Validate execution output for semantic issues
TASK: Check for circular dependency introduction | Detect dead code / unused exports | Verify public API consistency (no breaking changes to existing exports)
MODE: analysis
CONTEXT: @${modified_files as glob}
EXPECTED: JSON { circular_deps: [{ cycle: [file...] }], dead_code: [{ file, line, symbol }], breaking_changes: [{ file, export_name, change_type }] }
CONSTRAINTS: Only check modified files and their direct importers | severity = critical for breaking_changes, warning for others
" --role analyze --mode analysis',
  run_in_background: true
})
```

**On callback:** Parse result. Append critical-severity items to violations list. Log warnings separately.

### Gate Logic

```
Log all warnings; log all critical violations
If any critical: set index.json.status = "blocked" with blocked_reason and violations, abort
If none critical: log "passed" and continue to E2.6
```

---

## E2.6: Code Review (Optional)

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

## E2.7: Verification Gate

**Skip if** `verificationTool == "Skip"` OR `--skip-verify` flag OR no completed tasks.

### Step 1: Collect Verification Inputs

```
modified_files = collect all files changed by completed tasks (from .summaries/ + git diff)
convergence_criteria = collect convergence.criteria from all completed .task/*.json
success_criteria = index.json.success_criteria (if exists)
must_haves = success_criteria || convergence_criteria aggregated
summaries_content = concatenate all .summaries/TASK-*-summary.md
```

### Step 2: Resolve Verification Tool

```
IF verificationTool == "Auto": resolve to first enabled tool from delegate-config
ELSE: use specified tool name
```

### Step 3: Dispatch Verification (external model)

Single delegate call covers convergence review + structure verify + anti-pattern scan:

```
Bash({
  command: 'maestro delegate "PURPOSE: Verify execution output meets all convergence criteria and structural integrity; success = all criteria verified with file:line evidence
TASK:
1. CONVERGENCE: For each criterion below, check if the actual code satisfies it — read the files, verify the behavior exists, report status with evidence
2. STRUCTURE Layer 1 (Existence): Verify all expected output files exist on disk
3. STRUCTURE Layer 2 (Substance): Verify files have real implementation — flag stubs, placeholders, TODO-only, empty returns
4. STRUCTURE Layer 3 (Wiring): Verify files are imported and used by the system — flag orphaned files
5. ANTI-PATTERNS: Scan modified files for TODO/FIXME/HACK, placeholder content, console.log/print debug statements, disabled tests
MODE: analysis
CONTEXT: @${modified_files as glob patterns}
EXPECTED: JSON {
  convergence: [{ criterion: string, status: \"verified\"|\"failed\"|\"uncertain\", evidence: string }],
  structure: {
    existence: [{ path: string, status: \"exists\"|\"missing\" }],
    substance: [{ path: string, status: \"real\"|\"stub\", evidence: string }],
    wiring: [{ path: string, status: \"wired\"|\"orphaned\", importers: string[] }]
  },
  anti_patterns: [{ type: string, file: string, line: number, severity: \"blocker\"|\"warning\"|\"info\" }],
  gaps: [{ id: string, type: string, severity: \"critical\"|\"high\"|\"medium\"|\"low\", description: string, fix_direction: string }],
  overall: \"passed\"|\"gaps_found\"
}
CONSTRAINTS: Read-only | Check ALL criteria exhaustively | Evidence must be file:line references | Do NOT assume — verify by reading code

## Convergence Criteria (verify each one)
${must_haves.map((c, i) => (i+1) + \". \" + c).join(\"\\n\")}

## Modified Files
${modified_files.join(\"\\n\")}

## Task Summaries (executor self-reports — verify independently)
${summaries_content}
" --to ${verificationTool} --mode analysis',
  run_in_background: true
})
```

### Step 4: Process Results

```
On callback:
  Parse JSON result from delegate output

  // Write verification.json (downstream compatibility for quality-review, quality-test, etc.)
  Write ${PLAN_DIR}/verification.json:
  {
    "phase": PHASE_NUM,
    "status": result.overall,
    "verified_at": ISO_timestamp,
    "verifier": verificationTool,
    "must_haves": {
      "truths": result.convergence,
      "artifacts": [...result.structure.existence, ...result.structure.substance],
      "key_links": result.structure.wiring
    },
    "gaps": result.gaps,
    "antipatterns": result.anti_patterns,
    "coverage_score": verified_count / total_count
  }

  IF result.overall == "passed":
    Log "✓ Verification Gate: PASSED — all criteria verified by ${verificationTool}"
    Continue to E3

  IF result.overall == "gaps_found":
    Log verification report with per-criterion status

    // Auto-create issues from critical/high gaps
    For each gap with severity critical|high:
      Create issue in .workflow/issues/issues.jsonl:
        id: "ISS-{YYYYMMDD}-{NNN}", status: "registered",
        priority: severity_to_priority(gap.severity), source: "verification-gate",
        phase_ref: PHASE_NUM, gap_ref: gap.id

    // Gate decision
    IF any critical gaps:
      Set index.json.status = "verification_failed"
      Log: "✗ Verification Gate: FAILED — {N} critical gaps. Run /maestro-plan --gaps to fix."
      STOP pipeline (do not proceed to E3)
    ELSE (medium/low only):
      Log warnings, continue to E3
```

### Step 5: Register VRF Artifact

```
IF verification ran (not skipped):
  Create VRF artifact in state.json:
    { id: "VRF-{next_id}", type: "verify", milestone, phase,
      path: "${PLAN_DIR}/verification.json", status: result.overall == "passed" ? "completed" : "gaps_found",
      depends_on: EXC_artifact.id, created_at, completed_at }
```

---

## E3: Auto Sync

```
If config.json.codebase.auto_sync_after_execute == true:
  Trigger /workflow:sync logic:
    1. Detect changed files (git diff from execution start)
    2. Map changes to doc-index.json components/features
    3. Update affected entries
    4. Refresh tech-registry and feature-maps as needed
Else:
  Log "Auto-sync disabled. MUST run /workflow:sync manually."
```

---

## E4: Reflection (Optional)

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
If all tasks completed AND verification passed (or skipped):
  index.json.status = "verified", set completed_at
Elif all tasks completed AND verification failed:
  index.json.status = "verification_failed", set completed_at
Else:
  index.json.status = "executing" (partial) → "Re-run /workflow:execute to resume"

Update index.json.updated_at
If NOT SCRATCH_MODE: sync state.json (status, clear current_task_id)
```

---

## E5: Register Artifact & Extract Learnings (per PLAN_DIR)

```
// Register EXC artifact
Find matching plan artifact in state.json; create EXC artifact:
  { id: "EXC-{next_id padded to 3}", type: "execute", milestone, phase, scope,
    path: plan_artifact.path, status: "completed", depends_on: plan_artifact.id,
    harvested: false, created_at, completed_at }
Append to state.json.artifacts (atomic write)

// Incremental learning extraction
Read all .summaries/TASK-*-summary.md; extract strategy adjustments, patterns, pitfalls
Deduplicate against existing learnings (maestro spec load --category coding)
Append unique entries to .workflow/specs/learnings.md using <spec-entry> closed-tag format:
  category="learning", keywords (3-5 terms), date, source="execute"

Mark artifact.harvested = true; write state.json (atomic)

// Domain knowledge note:
// E5 仅提取 incremental learnings (spec category=learning)。
// 完整的知识提取（constraints → spec, decisions → knowhow, terminology → domain glossary）
// 由 chain 末尾的 manage-harvest --auto 触发 finish-work 统一处理。
// Domain compact/expanded 注入是 hook 自动行为，execute 期间无需手动加载——
// 已注册术语通过 keyword-spec-injector 自动注入到 agent context 中。
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No pending plans found | Abort: "No pending plans. Run /workflow:plan first." |
| Plan directory not found | Abort: "Plan dir not found." |
| Task file missing | Skip task, log error, continue wave |
| Agent spawn fails | Retry once, then mark task as "blocked" |
| Delegate fails | Resume with `--resume ${fixedId}`, then fallback to agent; flag task as [LOW CONFIDENCE] (fallback agent) |
| Git commit fails | Log W0xx, mark task [LOW CONFIDENCE] (commit failed); do NOT mark fully completed until commit succeeds |
| All tasks in wave blocked | Stop execution, report blocked wave |

---

## Breakpoint Resume

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
