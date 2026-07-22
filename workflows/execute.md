---
name: execute
prepare: execute
commands: [maestro-execute]
session-mode: inherited
---

# Workflow: Execute

Wave-based parallel execution — atomic commits, checkpoint resume, built-in smoke self-check. Artifacts unified as `execution.json`; implementation scope and evidence handed to verify.

## Iron Law

Never mark a task `completed` without running its convergence criteria. Every completion requires:

1. Run the convergence criteria check
2. Confirm output matches the task definition
3. Have a re-computable verification record in the task evidence

---

## Step 0: Plan availability & degradation routing

Check whether `current-plan` was injected by create (present in `upstream` map).

**Plan present** → proceed to Step 1 (parse execution options).

**Plan absent** → degradation mode. Inspect available upstream artifacts:

```
IF latest-review (review-findings) is available:
  count findings with actionable fix scope
  IF ≤3 findings AND each touches ≤2 files:
    → Companion path: write report.md with degradation note,
      run `maestro run complete <run_id> --verdict needs-retry`,
      then surface: /maestro-companion "<finding summaries as intent>"
  ELSE:
    → Odyssey planex path: write report.md with degradation note,
      run `maestro run complete <run_id> --verdict needs-retry`,
      then surface: /odyssey-planex "<review findings as requirement>"

ELSE IF latest-debug (diagnosis) is available AND fix-directions present:
  IF fix scope ≤2 files:
    → Companion path (same as above)
  ELSE:
    → Odyssey planex path (same as above)

ELSE:
  → E001: No plan and no alternative upstream. Abort.
    Write report.md with verdict: blocked, summary: "No current-plan; run plan first"
    run `maestro run complete <run_id> --verdict blocked`
```

**Degradation seal protocol**: the run is sealed as `needs-retry` (not `done`) to preserve the audit trail without faking completion. report.md MUST note: (1) why degradation was triggered, (2) which upstream was available, (3) the target command. The `next` field in report frontmatter points to the degradation target.

**Never proceed to Step 1+ without a plan.** The wave/DAG execution machinery below requires plan structure that only `current-plan` provides.

---

## Step 1: Parse execution options

With `-y`, use the parsed defaults and skip all interactive questions (throughout the entire execution, not just this step); also skip when the plan already carries executionMethod.

Otherwise build the option prompts from the enabled tools:

```
available tools = enabled tools from maestro delegate-config show --json (excluding agent, which is always available)
frontendTool = first tool with the "frontend" tag, fall back to first enabled
backendTool  = first tool with the "backend" tag, fall back to first enabled
```

| Question | Resolution |
|------|------|
| Executor (how to execute tasks) | Auto → `domainRouting {frontend, backend, default:"agent"}`; tool name → single executor; Other text → parse by domain rules (e.g. `frontend gemini backend codex`) |
| Review (code-review after execution?) | store as `codeReviewTool`, Skip means no review |
| Verify (smoke self-check tool?) | Auto → first enabled; tool name → that tool; Skip → do nothing |

Store `executionMethod`, `domainRouting`, `codeReviewTool`, `verificationTool`.

---

## Step 2: Load plan

Read the plan from the `current-plan` path injected by create.

```
executionMethod = Step 1 choice || --method || plan default || "auto"
defaultExecutor = --executor || first enabled tool
domainRouting   = Step 1 || build from delegate-config domain tags (frontend/backend match tag, default "agent")
```

**Checkpoint resume**: scan each task's status, collect completed tasks; if any exist record resume state and jump to the first wave containing an incomplete task.

**Build wave queue**: build the execution queue from the plan's waves, keeping only waves that contain incomplete tasks.

---

## Step 3: Load project specs

```
# Mandatory, cannot be substituted with manual Read/Grep
specs_content = maestro spec load --category coding
```

Pass to each executor in Step 4. When a task involves UI, additionally append `--category ui`.

---

## Step 4: Wave parallel execution

### Executor resolution

Priority: per-task explicit assignment > explicit method > auto domain routing.

- **Single mode** (method is agent/cli/a specific tool): all tasks use that executor.
- **auto mode**: determine domain per task, look up `domainRouting[domain]`, fall back to `domainRouting.default`.

Determine domain from the task definition (scope, file paths, action):

```
frontend — UI component/page/style/layout (.tsx/.jsx/.vue/.css/.html, scope contains ui/component/style/page/view)
backend  — API/server/database/service/algorithm (.go/.rs/.java/.py/.sql/.proto, scope contains api/server/database/service/worker)
general  — mixed, only .ts/.js, config, tests, or domain unclear
```

Record the routing decision per task before dispatch: `TASK-001 [frontend] → gemini`.

### Delegate writing skeleton

The CLI backend (maestro delegate) and the agent path build the prompt from the same task information:

```
PURPOSE: implement ${task.id}: ${task.title}; success = all convergence criteria pass
TASK: ${task.action} | read existing code first | after changes, verify each convergence criterion
MODE: write
CONTEXT: @${task.scope}/**/* | Session goal: ${session.goal}
EXPECTED: runnable code changes + all criteria verified + summary of work done
CONSTRAINTS: scope limited to task files | follow project specs

## Task definition
Scope / Action / Files (path→target: change) / Read First / Implementation steps / Convergence Criteria / Reference
## Session context (goal + success criteria)
## Project specs (specs_content)
## Prior task summaries (prior summaries)
```

### Execution loop

```
for each wave in queue (serial):
  on the first wave, if report status is not marked executing, mark it

  for each task in wave.tasks (parallel):
    load task definition; resolve executor

    IF executor == "agent":
      dispatch workflow-executor agent (fresh 200k context):
        task definition, session context, prior wave summaries, specs_content
      the agent runs the full lifecycle internally:
        implement → verify convergence → auto-fix (up to 3) → commit
        → write {run_dir}/outputs/summaries/${task.id}.md → update task status (checkpoint if blocked)
      the main flow verifies the agent wrote a summary + updated status, collects the result

    ELSE (CLI path maestro delegate):
      fixedId = "${scope_slug}-${task.id}", stored in the execution record
      dispatch: maestro delegate "${prompt}" --to ${executor} --mode write --id ${fixedId}
      after dispatch the main flow verifies convergence criteria against file state
      the main flow writes the summary, updates task status, auto-commits if enabled

    collect result: { task.id, status, executor, summary_path, commit_hash, delegate_id }

  wait for all tasks in the wave to complete
  IF any blocked AND not -y: ask the user to continue/stop
  ELSE: automatically proceed to the next wave (never ask between waves)
```

### Parallel dispatch rules

```
Dispatch all tasks in a wave in parallel in a single message (agent + CLI mixed).
agent tasks: run_in_background false | CLI tasks: run_in_background true
one independent dispatch per task, never merge multiple tasks into one delegate prompt
```

### Failure handling

```
Up to 3 auto-fixes per task:
  agent path: handled internally by workflow-executor
  CLI path: 1) --resume ${fixedId} → 2) simplify prompt → 3) fall back to agent, mark [LOW CONFIDENCE]

All 3 fail: mark "blocked" and write a checkpoint { attempt:3, last_error, partial_files, executor, delegate_id }
continue the current wave (other tasks unaffected)
```

---

## Step 5: Post-wave validation

```
Check 1 summary exists: completed task missing summary → warning "missing_summary"
Check 2 status consistency: cross-check task status against wave_results → mismatch (missing side is critical)
Check 3 tech stack constraints: extract allowed_languages/disallowed_imports/required_patterns from specs,
        scan the files changed by completed tasks, hit on disallowed → critical "tech_stack_violation"
Check 4 CLI supplementary validation (optional, skip if no CLI tool or no completed tasks):
        maestro delegate analysis mode scans changed files for circular deps / dead code / breaking changes,
        critical items merged into violations
```

**Gate logic**: any critical → mark blocked, record blocked_reason + violations, abort; no critical → continue.

---

## Step 6: Code review (optional)

If `codeReviewTool == "Skip"` skip. Otherwise maestro delegate (run_in_background) reviews the git diff (execution start point → HEAD) for correctness/style/bugs, record the findings summary.

---

## Step 7: Smoke Self-Check

If `verificationTool == "Skip"` or there are no completed tasks, skip. **This is only a smoke check, not an acceptance verdict** — formal acceptance is in a separate verify run.

```
1. Collect files changed by completed tasks, each task's convergence.criteria, session success criteria
2. Resolve tool: Auto → first enabled, otherwise the specified tool
3. Dispatch maestro delegate (analysis mode) to do one smoke pass:
   - CONVERGENCE: verify each criterion against the code, with file:line evidence
   - Existence: expected output files exist on disk
   - Substance: files have real implementation, not stub/placeholder/TODO-only/empty return
   - Wiring: files are imported and used by the system, not orphaned
   - Anti-patterns: scan for TODO/FIXME/HACK, placeholder, debug print, disabled tests
4. Write outputs/self-check.json:  # GATE: self-check-passed (smoke executed + no unhandled critical violation, see Step 5 Check 3; gaps_found does NOT block)
   { checks:[{criterion, status:"verified"|"failed"|"uncertain", evidence}],
     structure:{existence[], substance[], wiring[]}, anti_patterns[],
     overall:"passed"|"gaps_found" }
```

The self-check only records the smoke conclusion as supporting evidence for verify, and never issues the final acceptance based on it. gaps_found does not block execute completion, but must be noted as concerns in the report for verify to consume.

---

## Step 8: Write artifacts

Artifact paths and metadata are declared in `prepare/execute.md` contract.

```
outputs/execution.json:
{ "plan_ref":"current-plan", "status":"completed|partial|blocked",
  "waves":[...], "completed_tasks":[...], "blocked_tasks":[...] }

outputs/task-results.json:
  per-task executor, attempt, files changed, commands/tests, criterion evidence, status

outputs/change-manifest.json:
  repo-relative file paths, change type (create/modify/delete), task refs

outputs/self-check.json (Step 7)
```

---

## Step 9: Extract incremental learnings

```
Read all outputs/summaries/*.md, extract strategy adjustments, patterns, pitfalls.
Deduplicate against maestro spec load --category coding.
Append new entries in spec-entry format (category="learning", 3-5 keywords, source="execute").
```

Full knowledge extraction (constraints → spec, decisions → knowhow, terminology → domain glossary) is not done here; it is handled uniformly at session wrap-up.

→ Wrap-up follows ref/finish-work.md

---

## report.md

Write `report.md` with standard frontmatter + fixed sections. frontmatter verdict mapping:

| Situation | verdict |
|------|---------|
| all tasks succeeded | ready |
| some non-critical blocked | ready_with_concerns |
| critical dependency failed | blocked |

next explicitly routes to a separate verify:

```yaml
next:
  - { command: verify, reason: implementation complete, needs: [current-plan, current-execution] }
```

Body contains an execution status summary (completed/failed task counts, blocked reasons) and handoff.

---

## GateRecord

After execution completes, inline-record one entry per declared gate. **GATE: execution-complete**

```json
{ "gate": "execution-complete", "verdict": "ready|ready_with_concerns|blocked", "checked_at": now(),
  "evidence": { "completed": N, "blocked": N },
  "artifact": "outputs/execution.json" }
{ "gate": "self-check-passed", "verdict": "ready|ready_with_concerns|blocked", "checked_at": now(),
  "evidence": { "smoke_ran": true, "self_check": "passed|gaps_found", "critical_violations": N },
  "artifact": "outputs/self-check.json" }
```

BLOCKED conditions: `execution.json` missing, or there are completed tasks but missing summary/status not updated, or Step 5 has an unhandled critical violation.

---

## Success Criteria

- [ ] Execution method selected (agent/cli/auto)
- [ ] All tasks in plan reached terminal state (done/blocked)
- [ ] Each completed task has summary, evidence, and status
- [ ] Atomic commits produced per task (only task's changed files)
- [ ] Self-check smoke (build/test) executed and recorded (gaps_found recorded as concerns for verify)
- [ ] No unhandled tech-stack violations
- [ ] execution.json written with completion status
- [ ] Blocked tasks have checkpoint for resume

---

## Checkpoint resume

```
State recorded in the execution record: completed tasks, current_wave, commits, method,
                                        default_executor, delegate_ids{ task.id: fixedId }

Resume behavior:
  check each task's status + the delegate status of in-progress CLI tasks
  CLI tasks: take completed output, or --resume ${fixedId} to retry
  build the remaining task queue, continue from the next incomplete wave, do not re-run completed tasks
```

---

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | No plan and no alternative upstream | Abort: `current-plan` missing and no review-findings/fix-directions/diagnosis available. Run plan first, or provide review/debug upstream for degradation routing |
| E002 | Entire wave all blocked | Stop execution, report the blocked wave; downstream tasks with unmet dependencies marked upstream_blocked |
| W001 | Task file missing | Skip that task, record error, continue the current wave |
| W002 | Agent dispatch failed | Retry once, mark blocked if still failing |
| W003 | Delegate failed | `--resume ${fixedId}` → fall back to agent, mark [LOW CONFIDENCE] |
| W004 | Git commit failed | Record warning, mark [LOW CONFIDENCE] (commit failed), don't mark fully complete until commit succeeds |
