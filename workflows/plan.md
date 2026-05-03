# Plan Workflow

5-phase pipeline: Context Collection -> Clarification -> Planning -> Plan Checking -> Confirmation.

Produces two-layer plan output: `plan.json` (overview with task_ids[] and waves[]) + `.task/TASK-{NNN}.json` (individual task definitions).

All output goes to `.workflow/scratch/plan-{slug}-{date}/`.

---

## Prerequisites

- None for standalone operation (state.json auto-bootstraps)
- For milestone/phase scope: init + roadmap required

---

## Scope Resolution

```
Input: [phase] argument OR --dir <path>

Worktree guard: reject if phase not in .workflow/worktree-scope.json owned_phases
Auto-bootstrap: create minimal state.json if missing

Resolution priority:
  --dir <path>   → CONTEXT_DIR = path, scope from state.json artifact or "standalone"
  no arguments   → scope = "milestone", CONTEXT_DIR = latest analyze artifact for current_milestone
                   (ERROR E001 if no roadmap)
  numeric arg    → scope = "phase", resolve PHASE_SLUG from roadmap.md,
                   CONTEXT_DIR = latest analyze artifact for phase
                   (ERROR if no init + roadmap)

OUTPUT_DIR = .workflow/scratch/plan-{PHASE_SLUG or milestone_slug}-{date}/
```

---

## Flag Processing

| Flag | Effect |
|------|--------|
| `--collab` | Use collaborative multi-planner mode in P3 |
| `--spec SPEC-xxx` | Load task-spec as requirements source |
| `--auto` | Skip P2 (clarification), proceed directly to P3 |
| `--gaps` | Load verification.json gaps, skip P1 exploration, plan only gap fixes |
| `--dir <path>` | Use arbitrary directory instead of phase resolution (skip roadmap validation) |
| `--revise [instructions]` | Revise existing plan (skip P1-P3, load → modify → P4). Auto-discovers latest plan or use `--dir` |
| `--check <plan-dir>` | Standalone plan verification (P4 only, read-only) |

---

## Mode Routing

```
--check <plan-dir>  → Check Mode (P4 only, read-only)
--revise            → Revise Mode (load → modify → P4)
default             → Create Mode: P1 → P2 → P3 → P4 → P4.5 → P5
```

---

## P1: Context Collection

**Purpose:** Gather all available context before planning.

### Steps

1. **Load user decisions**
   - Read `${CONTEXT_DIR}/context.md` if exists, else warn (no upstream analyze)

2. **Load spec reference** (if `--spec` flag or index.json has spec_ref)
   - Read from `.workflow/.spec/${spec_ref}/`: spec-summary.md, requirements/_index.md, epics/_index.md

3. **Load project specs**
   ```
   specs_content = maestro spec load --category arch
   ```
   Pass to planner agent as project constraints context.

4. **Load codebase context**
   - Read `.workflow/codebase/doc-index.json` if exists → extract relevant features, components, requirements

4b. **Load design reference** (if available)
   - If `${PHASE_DIR}/design-ref/MASTER.md` exists: load MASTER.md, design-tokens.json, animation-tokens.json (optional), layout-templates/layout-*.json
     - Every UI task must include in `read_first[]`: design-tokens.json, animation-tokens.json, relevant layout-*.json, MASTER.md
   - Else if phase goal matches UI keywords (`landing|page|dashboard|frontend|UI|component|界面`): suggest running `maestro-ui-design` (non-blocking)

5. **Load upstream analysis** (if available)
   - If `${PHASE_DIR}/conclusions.json` exists with non-empty status: load as explorationContext (conclusions + explorations.json + perspectives.json)
     - If `conclusions.implementation_scope` exists: use as primary planner input:
       - `scope.objective` → task title/description
       - `scope.acceptance_criteria` → convergence.criteria (grep-verifiable)
       - `scope.target_files` → files[] + read_first[]
       - `scope.priority` → task/wave ordering
     - Skip parallel exploration

5. **Parallel exploration** (skip if `--gaps` or upstream analysis loaded)
   - Exploration angles (1-4 based on complexity): architecture, implementation, integration, risk
   - Spawn 1-4 `cli-explore-agent` in parallel, each with phase goal + success_criteria + one angle
   - Output: `.process/exploration-{angle}.json`, `.process/explorations-manifest.json`, `.process/context-package.json`

5b. **CLI supplementary context** (runs in parallel with step 5, skip if `--gaps` or no CLI tools enabled)
   ```
   IF no CLI tools enabled: skip

   Bash({
     command: 'maestro delegate "PURPOSE: Gather implementation context for planning phase
   TASK: Identify existing patterns for similar features | Map dependency graph of target modules | Find potential conflict points with other recent changes
   MODE: analysis
   CONTEXT: @**/*
   EXPECTED: JSON { patterns: [{ name, files, description }], dependencies: [{ module, depends_on[] }], conflict_risks: [{ file, reason }] }
   CONSTRAINTS: Focus on ${phase_goal} scope | Max 10 entries per category
   " --role explore --mode analysis',
     run_in_background: true
   })
   ```
   **On callback:** Parse result, merge into explorationContext as `cli_context` field. Planner uses patterns for task `read_first[]`, dependencies for wave ordering, conflict_risks for collision detection.

6. **Gap-mode context** (if `--gaps`)

   Gap sources (in priority order, first non-empty wins, then additionals merged):
   - **Primary**: `.workflow/issues/issues.jsonl` — filter by phase_ref + status in ["registered","diagnosed"], mark as "planning"
   - **Fallback**: `${PHASE_DIR}/verification.json` gaps (when no issues found)
   - **Additional**: `${PHASE_DIR}/uat.md` "Gaps" section — deduplicate against existing gaps
   - **Enrichment**: `${PHASE_DIR}/.debug/*/understanding.md` — enrich matched gaps with root_cause, fix_direction, affected_files

   Each gap: `{ issue_id, description, fix_direction, severity, source, context }`

   ERROR if all sources empty. Set `explorationContext = all_gaps` (skip exploration agents).

### Output
- `.process/exploration-{angle}.json` (1-4 files, skipped if upstream analysis loaded)
- `.process/explorations-manifest.json` (skipped if upstream analysis loaded)
- `.process/context-package.json` (skipped if upstream analysis loaded)
- In-memory: explorationContext (from upstream analysis or parallel exploration)

---

## P2: Clarification (Interactive)

**Purpose:** Resolve ambiguities before planning. Skipped with `--auto` flag.

### Steps

1. **Aggregate clarification needs**
   - Extract `clarification_needs[]` from each exploration, deduplicate, sort by priority (blocking > important > nice-to-have)

2. **Interactive clarification rounds** (max 3 rounds, max 4 questions each)
   - Present via AskUserQuestion, record answers, check for follow-ups

3. **Build clarification context** → `{ questions_asked, answers, decisions_made }`

### Output
- In-memory: clarificationContext

---

## P3: Planning

**Purpose:** Generate the execution plan.

### Standard Mode (default)

Spawn `workflow-planner` agent with: context.md, spec-ref, doc-index.json, explorationContext (incl. implementationScope), clarificationContext, phase goal + success_criteria, templates (plan.json, task.json).

**Task count guard**: Before spawning, assess scope complexity:
- Single feature / simple change → expect **1-2 tasks** max
- Medium feature (multiple files, one module) → expect **2-4 tasks** max
- Large feature (cross-module) → expect **4-8 tasks** max
- If planner outputs more tasks than these thresholds, re-prompt with explicit instruction to merge.

Agent responsibilities:
1. Decompose goal into tasks (when implementationScope exists: 1 scope item → 1 task)
2. Assign task IDs (TASK-001, TASK-002, ...), determine dependencies
3. Group into execution waves (implementationScope: order by scope.priority)
4. Estimate complexity/time
5. Set grep-verifiable `convergence.criteria` (from scope.acceptance_criteria when available)
6. Identify files per task (from scope.target_files when available), populate `read_first[]`

Output: `plan.json` (summary, approach, task_ids[], task_count, complexity, waves[]) + `.task/TASK-{NNN}.json` per task.

**Anti-splitting rules** (pass to planner; re-prompt if violated):
- One feature = one task (even if 3-5 files); never split a feature into per-file tasks
- Group simple unrelated changes into a batch task to minimize agent spawns
- depends_on only for genuine output dependencies; most tasks should be parallel
- Each task must be substantial (15-60 min); sub-5-min changes must be merged

### Deep Work Rules (MANDATORY for all modes)

Every TASK-*.json MUST include these fields — they are NOT optional:

1. **`read_first`** — Files the executor MUST read before touching anything. Always include:
   - The file being modified (so executor sees current state, not assumptions)
   - Any "source of truth" file referenced in context.md (reference implementations, existing patterns, config files, schemas)
   - Any file whose patterns, signatures, types, or conventions must be replicated or respected

2. **`convergence.criteria`** — Verifiable conditions that prove the task was done correctly. Rules:
   - Every criterion must be checkable with grep, file read, test command, or CLI output
   - NEVER use subjective language ("looks correct", "properly configured", "consistent with")
   - ALWAYS include exact strings, patterns, values, or command outputs that must be present
   - Examples:
     - Code: `auth.ts contains export function verifyToken(` / `test exits 0`
     - Config: `.env.example contains DATABASE_URL=` / `Dockerfile contains HEALTHCHECK`
     - Docs: `README.md contains '## Installation'` / `API.md lists all endpoints`

3. **`action`** — Must include CONCRETE values, not references. Rules:
   - NEVER say "align X with Y", "match X to Y", "update to be consistent" without specifying the exact target state
   - ALWAYS include the actual values: config keys, function signatures, class names, import paths, etc.
   - If context.md has a comparison table or expected values, copy them into the action verbatim
   - The executor should be able to complete the task from the action + implementation text alone

4. **`implementation`** steps — Each step must contain concrete values:
   - Bad: "Update the config to match production"
   - Good: "Add DATABASE_URL=postgresql://..., set POOL_SIZE=20, add REDIS_URL=redis://..."

**Why this matters:** Executor agents work from the task JSON. Vague instructions produce shallow one-line changes. Concrete instructions produce complete work.

### Collaborative Mode (`--collab`)

- Pre-allocate TASK ID ranges per planner (2-5 planners based on scope): TASK-001..010, TASK-011..020, etc.
- Create `plan-note.md` for coordination (shared context, ID ranges, no-overlap rules)
- Spawn N `workflow-collab-planner` agents in parallel, each writing `.task/TASK-{NNN}.json` within assigned range
- Merge: collect all task files, build unified plan.json with merged waves, resolve cross-planner dependencies

### Gap Mode (`--gaps`)

For each gap from explorationContext (P1 Step 6), create `TASK-{NNN}.json`:
- `type: "fix"`, `description`, `action` (concrete fix_direction), `read_first` (affected files), `convergence.criteria` (grep-verifiable), `issue_id` (if source == "issue")

Bidirectional linking: update matching issues in `.workflow/issues/issues.jsonl` → `status: "planned"`. Build plan.json with gap-fix tasks.

### Output
- `plan.json` in PHASE_DIR
- `.task/TASK-{NNN}.json` files in PHASE_DIR/.task/
- `plan-note.md` (collab mode only)

---

## P4: Plan Checking

**Purpose:** Verify plan quality before execution.

### Steps

1. **Spawn workflow-plan-checker agent**
   - Input: plan.json + all .task/TASK-*.json + index.json (success_criteria)
   - Check dimensions: requirements coverage, feasibility, dependency correctness (no circular deps), convergence criteria quality (grep-verifiable, no subjective language), read_first completeness, action concreteness (no vague references), wave structure (no conflicting files), completeness (no orphan tasks)

2. **Revision loop** (max 3 rounds)
   - Critical issues → re-spawn planner with issues, revise, re-check
   - Warnings only → log and proceed

3. **Update index.json**
   - Set `index.json.plan` = `{ task_ids, task_count, complexity, waves, executor_assignments: {} }`
   - Set `status: "planning"`, `updated_at: now()`

### Output
- Updated plan.json (if revised)
- Updated .task/ files (if revised)
- Updated index.json with plan fields

---

## P4.5: Collision Detection

**Purpose:** Warn if this plan's files overlap with existing plans in the same milestone.

**Skip if:** scope == "standalone" (no milestone context to compare against)

```
1. Collect task.files[] from all completed plans in current milestone
2. Collect task.files[] from new plan
3. Intersect → collisions (non-blocking warning)
   碰撞 → WARN "{file} ← 已在 {plan_ids} 中规划"
   无重叠 → "碰撞检测通过"
```

**Note:** Only checks `task.files[]` (write targets). `task.read_first[]` (read-only references) are excluded.

---

## P5: Confirmation

**Purpose:** Present plan to user and determine next action.

### Steps

1. **Display plan summary** — summary, approach, task count, wave structure, complexity, key dependencies

2. **Present options via AskUserQuestion** (skip if `config.gates.confirm_plan == false`, auto-proceed)
   - Execute now → build executionContext, hand off to /workflow:execute
   - Verify plan quality → re-run P4 with stricter checks
   - Just view → display full plan details, exit
   - Modify → open specific task for editing, return to P4

3. **executionContext handoff** (if "Execute now")
   ```json
   {
     "planObject": { "plan": "plan.json contents", "tasks": { "TASK-001": "..." } },
     "explorations": ["exploration-*.json contents"],
     "clarifications": "clarificationContext",
     "executionMethod": "config.json.execution.method || 'agent'",
     "defaultExecutor": "config.json.execution.default_executor || 'gemini'",
     "executorAssignments": "index.json.plan.executor_assignments || {}",
     "phaseIndex": "index.json contents",
     "specRef": "spec-ref contents (if loaded)"
   }
   ```
   Hand off to /workflow:execute with executionContext in memory.

4. **Register artifact in state.json**
   - Find upstream analyze artifact by CONTEXT_DIR path
   - Create artifact: `{ id: "PLN-{NNN}", type: "plan", milestone, phase, scope, path, status: "completed", depends_on, harvested: false, created_at, completed_at }`
   - Append to `state.json.artifacts`, atomic write

---

## Error Handling

| Error | Action |
|-------|--------|
| E001: No args and no roadmap | Provide phase number or topic, or create roadmap |
| E004: No plan found to revise | Use --dir to specify plan, or create plan first |
| E005: Plan directory not found (--check) | Check path, use --dir |
| Phase directory not found | Abort with message: "Phase {phase} not found. Run /workflow:init first." |
| No context.md | Warn, proceed with exploration only |
| Exploration agent fails | Log error, continue with available explorations |
| Planner produces invalid JSON | Retry once, then abort with error details |
| Plan-checker exceeds 3 rounds | Accept plan with warnings, note in index.json |
| User cancels clarification | Proceed with available context |

---

## State Updates

| When | Field | Value |
|------|-------|-------|
| P1 start | index.json.status | "planning" |
| P3 complete | index.json.plan.* | Plan metadata |
| P4 pass | index.json.updated_at | Current timestamp |
| P5 "Execute now" | (handoff, no write) | executionContext in memory |

---

## Revise Mode (`--revise`)

Incrementally modify an existing plan without rebuilding from scratch.

### Plan Discovery

- `--dir` specified → use directly
- Else → latest completed plan artifact for current phase from state.json
- Not found → ERROR E004

### Execution Flow

1. **Load existing plan**
   - Read `plan.json` + all `.task/TASK-*.json` from PLAN_DIR
   - Show current plan summary: task count, waves, status per task

2. **Obtain revision instructions**
   - If `--revise "instructions"` provided → parse as change directive
   - If `--revise` without instructions → AskUserQuestion for what to change:
     - Add/remove tasks
     - Modify task scope, action, implementation
     - Reorder waves or adjust dependencies
     - Update convergence criteria
   - Parse instructions into concrete changes

3. **Apply targeted changes**
   - Modify affected TASK files in-place
   - If tasks added/removed: re-sequence task IDs, regenerate wave assignments
   - Update plan.json summary (task count, wave structure)
   - Preserve unmodified tasks completely

4. **Re-run plan-checker (P4)**
   - Validate modified plan with same checker as create mode
   - Re-run collision detection against same-milestone plans
   - Present check results for confirmation

5. **Update artifact**
   - Overwrite plan files in existing scratch directory
   - Update artifact timestamp in state.json (no new artifact created)

---

## Check Mode (`--check`)

Read-only plan verification without modification.

### Execution Flow

1. **Load plan** — read plan.json + .task/TASK-*.json from `--check` path (ERROR E005 if not found), plus roadmap.md

2. **Run checks** — plan-checker (task quality, convergence criteria), roadmap consistency, collision detection, dependency integrity

3. **Produce check report**
   ```
   === PLAN CHECK ===
   Plan: {plan_dir}/plan.json
   Tasks: {total} ({completed} done, {pending} pending)
   Checker: {PASS|WARN|FAIL} ({issues} issues)
   Roadmap: {aligned|drift detected}
   Collision: {clear|{N} overlaps}

   Suggested actions:
     /maestro-plan --revise "fix instructions"
     /maestro-execute --dir {plan_dir}
   ```

**No file modifications.** Pure verification + report.
