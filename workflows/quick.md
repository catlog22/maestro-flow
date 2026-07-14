# Workflow: Quick

## Prerequisites

- `.workflow/state.json` must exist (project initialized)
- Quick tasks can run mid-phase — validation only checks project exists, not phase status

---

## Step 1: Parse Arguments

Parse `$ARGUMENTS` for flags and description:

- `--full` flag → `$FULL_MODE` (true/false)
- `--discuss` flag → `$DISCUSS_MODE` (true/false)
- Remaining text → `$DESCRIPTION`

If `$DESCRIPTION` is empty after parsing:
```
AskUserQuestion(header: "Quick Task", question: "What do you want to do?", followUp: null)
```
Store response as `$DESCRIPTION`. If still empty, re-prompt: "Please provide a task description."

Display banner `WORKFLOW > QUICK TASK` with active flag suffix:

| Flags | Banner Suffix | Subtitle |
|-------|--------------|----------|
| --discuss + --full | `(DISCUSS + FULL)` | Discussion + plan checking + verification enabled |
| --discuss only | `(DISCUSS)` | Discussion phase enabled — surfacing gray areas before planning |
| --full only | `(FULL MODE)` | Plan checking + verification enabled |
| none | _(no suffix)_ | _(no subtitle)_ |

---

## Step 2: Validate Project

Check `.workflow/` exists and has state.json:
```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```
If missing: Error E002 — "Quick mode requires an initialized project. Run init first." Quick tasks can run mid-phase — validation only checks project exists, not phase status.

---

## Step 3: Resolve Run Output Directory

Runtime handles session resolution, artifact registration, and state updates. The Run directory (`$QUICK_DIR = {run_dir}/outputs/`) and its scaffolding (`.task/`, `.summaries/`) are created and injected by the runtime via `maestro run create`.

Generate the task slug from `$DESCRIPTION` (lowercase, hyphens, max 40 chars) for use in the task ID and commit message.

Report: "Creating quick task: {$DESCRIPTION}\nDirectory: {$QUICK_DIR}"

---

## Step 4: Discussion Phase (only when $DISCUSS_MODE)

Skip entirely if NOT `$DISCUSS_MODE`.

```
------------------------------------------------------------
  WORKFLOW > DISCUSSING QUICK TASK
------------------------------------------------------------
Surfacing gray areas for: {$DESCRIPTION}
```

**4a. Identify gray areas** — analyze `$DESCRIPTION` for 2-4 gray areas (implementation decisions that change the outcome). Domain-aware heuristic:
- Something users **SEE** → layout, density, interactions, states
- Something users **CALL** → responses, errors, auth, versioning
- Something users **RUN** → output format, flags, modes, error handling
- Something users **READ** → structure, tone, depth, flow
- Something being **ORGANIZED** → criteria, grouping, naming, exceptions

**4b. Present gray areas:**
```
AskUserQuestion(
  header: "Gray Areas",
  question: "Which areas need clarification before planning?",
  options: [
    { label: "{area_1}", description: "{why_it_matters}" },
    { label: "{area_2}", description: "{why_it_matters}" },
    { label: "{area_3}", description: "{why_it_matters}" },
    { label: "All clear", description: "Skip discussion — I know what I want" }
  ],
  multiSelect: true
)
```
If user selects "All clear" → skip to Step 5 (no context.md written).

**4c. Discuss selected areas** — for each selected area, ask 1-2 focused questions:
```
AskUserQuestion(
  header: "{area_name}",
  question: "{specific question}",
  options: [
    { label: "{choice_1}", description: "{what this means}" },
    { label: "{choice_2}", description: "{what this means}" },
    { label: "You decide", description: "Claude's discretion" }
  ]
)
```
Max 2 questions per area. Collect all decisions.

**4d. Classify decisions:**
- **Locked**: firm decisions that cannot be changed during implementation
- **Free**: open for implementation discretion
- **Deferred**: postponed (captured but not acted on in this quick task)

**4e. Write context.md** to `${QUICK_DIR}/context.md`:
```markdown
# Quick Task: {$DESCRIPTION} - Context

**Gathered:** {date}
**Status:** Ready for planning

## Task Boundary
{$DESCRIPTION}

## Constraints
### Locked
{decisions that are final and must be followed}
### Free
{decisions left to implementer discretion, including "You decide" areas}
### Deferred
{ideas captured but out of scope for this quick task}

## Code Context
{relevant code references from discussion, if any}
```
Report: "Context captured: ${QUICK_DIR}/context.md"

---

## Step 4.5: Load Project Specs

```
specs_content = maestro spec load --category coding
```
Passed inline to planner agent in Step 5.

---

## Step 5: Spawn Planner

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-planner` agent in quick mode with:

- **Context**: mode (`quick` or `quick-full`), directory, description, state.json, CLAUDE.md, specs, context.md (if discuss mode)
- **Constraints**: single plan with 1-3 atomic tasks, no research phase. Full mode: ~40% context usage + require files/action/convergence.criteria/implementation per task. Default: ~30% context usage.
- **Output**: `${QUICK_DIR}/plan.json`, `${QUICK_DIR}/.task/TASK-{NNN}.json`. Return `## PLANNING COMPLETE` with plan path.

After planner returns:
1. Verify plan.json exists at `${QUICK_DIR}/plan.json`
2. Report: "Plan created: ${QUICK_DIR}/plan.json"

If plan not found: "Planner failed to create plan.json"

---

## Step 6: Plan Checker (only when $FULL_MODE)

Skip entirely if NOT `$FULL_MODE`.

```
------------------------------------------------------------
  WORKFLOW > CHECKING PLAN
------------------------------------------------------------
Spawning plan checker...
```

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-plan-checker` agent to verify plan.json and TASK-*.json:
- **Check dimensions**: requirement coverage, task completeness (files/action/convergence.criteria/implementation), scope sanity (1-3 tasks), context compliance (if discuss mode)
- **Return**: `## VERIFICATION PASSED` or `## ISSUES FOUND` with structured issue list

**Handle checker return:**
- **VERIFICATION PASSED:** Continue to Step 7.
- **ISSUES FOUND:** Enter revision loop.

**Revision loop (max 2 iterations):**
- If iteration_count < 2: display "Sending back to planner for revision... (iteration {N}/2)", spawn planner with revision context + checker issues, re-check, increment.
- If iteration_count >= 2: display "Max iterations reached. {N} issues remain." Offer 1) Force proceed, 2) Abort; if Force proceed, flag plan as [LOW CONFIDENCE] (remaining issues).

**GATE Step 6→7**: REQUIRED plan.json verified by plan-checker BEFORE execution; BLOCKED if plan.json not verified.

---

## Step 7: Spawn Executor

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-executor` agent:
- **Read**: plan.json, TASK-*.json, state.json, CLAUDE.md
- **Constraints**: execute all tasks, atomic commits per task, write summaries to `${QUICK_DIR}/.summaries/TASK-{NNN}-summary.md`

After executor returns:
1. Verify summaries exist
2. Report completion status

---

## Step 8: Verification (only when $FULL_MODE)

Skip entirely if NOT `$FULL_MODE`.

```
------------------------------------------------------------
  WORKFLOW > VERIFYING RESULTS
------------------------------------------------------------
Spawning verifier...
```

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-verifier` agent: check plan objectives against actual codebase using plan.json and summaries. Write result to `${QUICK_DIR}/verification.json`.

| Status | Action |
|--------|--------|
| passed | Store "Verified", continue |
| gaps_found | Display gaps, offer 1) Re-run executor, 2) Accept as-is; if Accept as-is, flag execution as [LOW CONFIDENCE] (gaps unresolved) |

---

## Step 9: Complete

Artifact registration and state updates are handled by `maestro run complete`.

---

## Step 10: Commit and Complete

Commit quick task artifacts — stage ONLY files modified by the task (from `.summaries/TASK-*-summary.md` "Files modified" list) plus the Run artifacts and state.json; confirm with `AskUserQuestion` showing staged files and proposed commit message (unless `-y`, then auto-commit):
```bash
git add "${QUICK_DIR}/" .workflow/state.json
git commit -m "quick({slug}): ${DESCRIPTION}"
```

Display completion banner `WORKFLOW > QUICK TASK COMPLETE` (with `(FULL MODE)` suffix if applicable):
- Show: Quick Task name, Summary path (`${QUICK_DIR}/.summaries/`), Directory path
- Full mode also shows: Verification path + status (`${QUICK_DIR}/verification.json`)
- Footer: `Ready for next task: quick`

---

## Artifact Verification (before completion)

```
REQUIRED_ARTIFACTS = [
  "plan.json",                               // Task definitions
  ".summaries/TASK-*-summary.md" (per task)  // Execution results
]
```
If any artifact is missing: DO NOT report completion. Complete the missing step first. Task summaries MUST include concrete evidence (files changed, tests run, commands executed) — not just "task completed successfully."

---

## Error Codes

| Code | Condition | Recovery |
|------|-----------|----------|
| E001 | Task description required (no text provided) | Check arguments, re-run with correct input |
| E002 | Run output directory creation failed / project not initialized | Check disk space and .workflow/ permissions |
| W001 | Verification found minor gaps | Review gaps and determine if they need fixing |

---

## Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Task done, --full verification passed | `manage-status` |
| Task done, verification found gaps | `debug {issue}` |
| Task done, want to sync docs | `sync` |
| Need a full phase workflow instead | `plan {milestone}` |
