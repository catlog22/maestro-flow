<!-- session-mode: inherited -->
# Quick Task Workflow

## Run Mode Contract

This workflow executes inside the Run created by its command. The command-provided `run_id`, `run_dir`, and resolved `upstream` are authoritative. Formal outputs belong in `{run_dir}/outputs/`, evidence in `{run_dir}/evidence/`, and narrative/handoff in `{run_dir}/report.md`. Protocol JSON is CLI-owned.

### Legacy Compatibility Mapping

Legacy references to `scratch/`, hidden command directories, milestone/phase artifact folders, `context-package.json`, `understanding.md`, `evidence.ndjson`, or secondary `status.json` describe old semantics only. Do not create those formal paths; map them to the active Run boundary and finish with `maestro run check` plus `maestro run complete`.

## Prerequisites

- `.workflow/state.json` must exist (project initialized)
- Quick tasks can run mid-phase -- validation only checks project exists, not phase status

---

### Step 1: Parse Arguments

**Parse $ARGUMENTS for flags and description:**

Extract:
- `--full` flag -> store as `$FULL_MODE` (true/false)
- `--discuss` flag -> store as `$DISCUSS_MODE` (true/false)
- Remaining text -> use as `$DESCRIPTION`

If `$DESCRIPTION` is empty after parsing:
```
AskUserQuestion(
  header: "Quick Task",
  question: "What do you want to do?",
  followUp: null
)
```

Store response as `$DESCRIPTION`.
If still empty, re-prompt: "Please provide a task description."

Display banner: `WORKFLOW > QUICK TASK` with active flag suffix:

| Flags | Banner Suffix | Subtitle |
|-------|--------------|----------|
| --discuss + --full | `(DISCUSS + FULL)` | Discussion + plan checking + verification enabled |
| --discuss only | `(DISCUSS)` | Discussion phase enabled -- surfacing gray areas before planning |
| --full only | `(FULL MODE)` | Plan checking + verification enabled |
| none | _(no suffix)_ | _(no subtitle)_ |

---

### Step 2: Validate Project

**Validate project state:**

Check .workflow/ exists and has state.json:
```bash
test -f .workflow/state.json && echo "exists" || echo "missing"
```

If missing: Error -- "Quick mode requires an initialized project. Run /workflow:init first."

Quick tasks can run mid-phase -- validation only checks project exists, not phase status.

---

### Step 3: Create Scratch Directory

**Create scratch directory:**

Generate slug from $DESCRIPTION (lowercase, hyphens, max 40 chars).
Set date to current date (YYYYMMDD).

```bash
QUICK_DIR=".workflow/scratch/${date}-quick-${slug}"
mkdir -p "$QUICK_DIR/.task"
mkdir -p "$QUICK_DIR/.summaries"
```

Write index.json:
```json
{
  "id": "{YYYYMMDD}-quick-{slug}",
  "type": "quick",
  "title": "{$DESCRIPTION}",
  "status": "active",
  "created_at": "{ISO timestamp}",
  "updated_at": "{ISO timestamp}",
  "flags": {
    "discuss": {$DISCUSS_MODE},
    "full": {$FULL_MODE}
  },
  "plan": {
    "task_ids": [],
    "task_count": 0
  },
  "execution": {
    "method": "agent",
    "tasks_completed": 0,
    "tasks_total": 0
  }
}
```

Report: "Creating quick task: {$DESCRIPTION}\nDirectory: {$QUICK_DIR}"

---

### Step 4: Discussion Phase (only when $DISCUSS_MODE)

**Lightweight discussion:**

Skip entirely if NOT $DISCUSS_MODE.

```
------------------------------------------------------------
  WORKFLOW > DISCUSSING QUICK TASK
------------------------------------------------------------
Surfacing gray areas for: {$DESCRIPTION}
```

**4a. Identify gray areas:**

Analyze $DESCRIPTION to identify 2-4 gray areas -- implementation decisions that would change the outcome. Use domain-aware heuristic:
- Something users **SEE** -> layout, density, interactions, states
- Something users **CALL** -> responses, errors, auth, versioning
- Something users **RUN** -> output format, flags, modes, error handling
- Something users **READ** -> structure, tone, depth, flow
- Something being **ORGANIZED** -> criteria, grouping, naming, exceptions

**4b. Present gray areas:**

```
AskUserQuestion(
  header: "Gray Areas",
  question: "Which areas need clarification before planning?",
  options: [
    { label: "{area_1}", description: "{why_it_matters}" },
    { label: "{area_2}", description: "{why_it_matters}" },
    { label: "{area_3}", description: "{why_it_matters}" },
    { label: "All clear", description: "Skip discussion -- I know what I want" }
  ],
  multiSelect: true
)
```

If user selects "All clear" -> skip to Step 5 (no context.md written).

**4c. Discuss selected areas:**

For each selected area, ask 1-2 focused questions:
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
- **Free**: open for implementation discretion (implementer can choose)
- **Deferred**: postponed (captured but not acted on in this quick task)

**4e. Write context.md:**

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

Write to `${QUICK_DIR}/context.md`.
Report: "Context captured: ${QUICK_DIR}/context.md"

---

### Step 4.5: Load Project Specs

```
specs_content = maestro spec load --category coding
```

Passed inline to planner agent in Step 5.

---

### Step 5: Spawn Planner

**Spawn workflow-planner in quick mode:**

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-planner` agent with:

- **Context**: mode (`quick` or `quick-full`), directory, description, state.json, CLAUDE.md, specs, context.md (if discuss mode)
- **Constraints**: single plan with 1-3 atomic tasks, no research phase. Full mode: ~40% context usage + require files/action/convergence.criteria/implementation per task. Default: ~30% context usage.
- **Output**: `${QUICK_DIR}/plan.json`, `${QUICK_DIR}/.task/TASK-{NNN}.json`. Return `## PLANNING COMPLETE` with plan path.

After planner returns:
1. Verify plan.json exists at `${QUICK_DIR}/plan.json`
2. Update index.json plan fields
3. Report: "Plan created: ${QUICK_DIR}/plan.json"

If plan not found: "Planner failed to create plan.json"

---

### Step 6: Plan Checker (only when $FULL_MODE)

**Plan-checker loop:**

Skip entirely if NOT $FULL_MODE.

```
------------------------------------------------------------
  WORKFLOW > CHECKING PLAN
------------------------------------------------------------
Spawning plan checker...
```

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-plan-checker` agent to verify plan.json and TASK-*.json:

- **Check dimensions**: requirement coverage, task completeness (files/action/convergence.criteria/implementation), scope sanity (1-3 tasks), context compliance (if discuss mode).
- **Return**: `## VERIFICATION PASSED` or `## ISSUES FOUND` with structured issue list.

**Handle checker return:**

- **VERIFICATION PASSED:** Continue to Step 7.
- **ISSUES FOUND:** Enter revision loop.

**Revision loop (max 2 iterations):**

If iteration_count < 2:
- Display: "Sending back to planner for revision... (iteration {N}/2)"
- Spawn planner with revision context + checker issues
- Re-check with checker
- Increment iteration_count

If iteration_count >= 2:
- Display: "Max iterations reached. {N} issues remain."
- Offer: 1) Force proceed, 2) Abort; if Force proceed, flag plan as [LOW CONFIDENCE] (remaining issues)

---

**GATE Step 6→7**: REQUIRED plan.json verified by plan-checker BEFORE execution; BLOCKED if plan.json not verified

### Step 7: Spawn Executor

**Spawn workflow-executor:**

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-executor` agent:

- **Read**: plan.json, TASK-*.json, state.json, CLAUDE.md
- **Constraints**: execute all tasks, atomic commits per task, write summaries to `${QUICK_DIR}/.summaries/TASK-{NNN}-summary.md`

After executor returns:
1. Verify summaries exist
2. Update index.json execution fields
3. Report completion status

---

### Step 8: Verification (only when $FULL_MODE)

**Post-execution verification:**

Skip entirely if NOT $FULL_MODE.

```
------------------------------------------------------------
  WORKFLOW > VERIFYING RESULTS
------------------------------------------------------------
Spawning verifier...
```

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: Spawn `workflow-verifier` agent: check plan objectives against actual codebase using plan.json and summaries. Write result to `${QUICK_DIR}/verification.json`.

Read verification result:
| Status | Action |
|--------|--------|
| passed | Store "Verified", continue |
| gaps_found | Display gaps, offer: 1) Re-run executor, 2) Accept as-is; if Accept as-is, flag execution as [LOW CONFIDENCE] (gaps unresolved) |

---

### Step 9: Update State

**Update state.json:**

Read state.json. Add quick task to accumulated_context or quick_tasks array.

Record:
```json
{
  "id": "{YYYYMMDD}-quick-{slug}",
  "description": "{$DESCRIPTION}",
  "completed_at": "{ISO timestamp}",
  "directory": "{$QUICK_DIR}",
  "verified": {$FULL_MODE ? verification_status : "skipped"}
}
```

Update last_updated timestamp.

---

### Step 10: Commit and Complete

**Final commit and completion:**

Update index.json status to "completed".

Commit quick task artifacts:
```bash
git add "${QUICK_DIR}/" .workflow/state.json
git commit -m "quick({slug}): ${DESCRIPTION}"
```

Display completion:

Display completion banner `WORKFLOW > QUICK TASK COMPLETE` (with `(FULL MODE)` suffix if applicable):
- Show: Quick Task name, Summary path (`${QUICK_DIR}/.summaries/`), Directory path
- Full mode also shows: Verification path + status (`${QUICK_DIR}/verification.json`)
- Footer: `Ready for next task: /workflow:quick`

