---
name: maestro-plan
description: Use when creating, revising, or verifying an execution plan for a phase or task
argument-hint: "[-y|--yes] [--concurrency N] [-c|--continue] \"<phase> [--dir <path>] [--from <source>] [--gaps] [--spec SPEC-xxx] [--collab]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based planning via `spawn_agents_on_csv`. Wave 1 explores codebase in parallel across multiple angles, Wave 2 generates verified execution plan consuming all exploration findings.

Supports: Create (default), Revise (`--revise`), Check (`--check`), Gaps (`--gaps`), TDD (`--tdd`).
</purpose>

<tdd_mode>

## TDD Mode (`--tdd`)

When `--tdd` is active, the planning agent in Wave 2 decomposes each behavior into RED-GREEN-REFACTOR triplets.

### Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.** Write code before the test? Delete it. Start over.

### Task Chain Structure

For each behavior B:
- **TASK-{N}a (RED)**: Write failing test. Verify it FAILS (not errors). type=test, tdd_phase=red.
- **TASK-{N}b (GREEN)**: Write minimal code to pass. Verify ALL tests pass. type=feature, tdd_phase=green, depends_on=[TASK-{N}a].
- **TASK-{N}c (REFACTOR)**: Clean up. Keep tests green. No new behavior. type=refactor, tdd_phase=refactor, depends_on=[TASK-{N}b]. Skip if GREEN code already clean.

### Wave Assignment
```
Wave 1: TASK-1a, TASK-2a (RED — parallel if independent)
Wave 2: TASK-1b, TASK-2b (GREEN — parallel)
Wave 3: TASK-1c, TASK-2c (REFACTOR — parallel)
```
Within a group: `{N}a → {N}b → {N}c` (strict dependency).

### plan.json Output
```json
{ "tdd_mode": true, "tdd_groups": [{ "group": 1, "behavior": "...", "tasks": ["TASK-1a","TASK-1b","TASK-1c"] }] }
```
Standard plan.json + .task/TASK-*.json — consumable by maestro-execute without modification.

### Execution Enforcement
- RED task: verify test exists AND fails. If passes → BLOCKED "wrong test".
- GREEN task: verify ALL tests pass. If RED test still fails → BLOCKED.
- REFACTOR task: verify ALL tests still pass. If fails → undo.

### Red Flags — These Thoughts Mean STOP
- "Too simple to need TDD" / "I'll write tests after" / "Let me explore first, then add tests"
- "Tests after achieve the same goals" / "TDD will slow me down"
All mean: **follow the cycle anyway**.

### Rationalization Table
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Need to explore first" | Fine. Throw away exploration, start fresh with TDD. |
| "Test hard = design unclear" | Listen to the test. Hard to test = hard to use. |

</tdd_mode>

<context>
$ARGUMENTS — phase number/text and optional flags.

**Flags**: `-y` (auto), `--concurrency N` (default 4), `-c`/`--continue` (resume), `--dir <path>`, `--from <source>` (load upstream context directly: analyze:ANL-xxx, blueprint:BLP-xxx, brainstorm:ID, @file, path), `--gaps` (issue-linked), `--spec SPEC-xxx`, `--collab`, `--revise`, `--check`, `--tdd` (RED-GREEN-REFACTOR task chains)

**Scope routing** (priority, per redesign §5.2):
1. `--from analyze:ANL-xxx` → CONTEXT_DIR = ANL artifact path; scope=`standalone`
2. `--from blueprint:BLP-xxx` → CONTEXT_DIR = BLP path; scope=`standalone`
3. `--dir <path>` → CONTEXT_DIR = path; scope=`standalone`
4. Numeric arg + roadmap → scope=`phase`; D-007 reverse-lookup milestone via `state.json.milestones[].phase_slugs`
5. No args + roadmap → scope=`milestone` (plans all pending phases in current milestone)
6. No args + no roadmap → search `state.json.artifacts[]` for latest `type=="analyze"` (DESC by created_at). Found → scope=`standalone`, CONTEXT_DIR = artifact.path. None → ERROR E001.
7. Text arg + no upstream → scope=`adhoc/standalone`

**D-007 milestone reverse lookup** (numeric scope only):
```
resolve_milestone(phase_number):
  for ms in state.json.milestones[]:
    if str(phase_number) in ms.phase_slugs: return ms.id
  return state.json.current_milestone   # fallback
```
Write resolved milestone into PLN artifact registration and `plan.json.milestone`; NEVER read `current_milestone` directly for phase-scoped runs.

**Session**: `.workflow/.csv-wave/{YYYYMMDD}-plan-P{N}-{slug}/`
**Scratch**: `.workflow/scratch/{YYYYMMDD}-plan-P{N}-{slug}/` (.task/ subdir)

**Pre-load** (optional): context-package.json (via `--from`, takes precedence), context.md (prior analyze), conclusions.json, codebase ARCHITECTURE.md, `maestro search`, `maestro load --type spec --category arch`, team preflight `maestro collab preflight`.

**D-008 Ad-hoc Milestone Auto-Creation**: When scope resolves to `standalone` via standard resolution (routes 6 or 7, NOT via `--from`), and `state.json.current_milestone == null`, auto-create an adhoc milestone:
```
milestone_id = "ADH-{YYYYMMDD}-{slug}"
state.json.milestones.push({ id: milestone_id, name: "{intent slug}", type: "adhoc", status: "active", phase_slugs: [] })
state.json.current_milestone = milestone_id
```
**Exception**: `--from analyze:ANL-xxx` or `--from blueprint:BLP-xxx` → skip adhoc creation (upstream artifact provides milestone context or is intentionally milestone-free).
</context>

<csv_schema>
```csv
id,title,description,angle,deps,context_from,wave,status,findings,output_path,error
"1","Explore: Architecture","Map module boundaries and dependencies","architecture","","","1","","","",""
"2","Explore: Patterns","Find existing similar implementations","patterns","","","1","","","",""
"3","Explore: Tests","Map test infrastructure and conventions","tests","","","1","","","",""
"4","Generate Plan","Consume explorations, produce plan.json + TASK files","planning","1;2;3","1;2;3","2","","","",""
```
Wave 1: N exploration rows (parallel). Wave 2: 1 planning row (sequential).
</csv_schema>

<invariants>
1. **Wave order sacred**: Explorations (W1) before planning (W2)
2. **CSV source of truth**: Master tasks.csv holds all state
3. **Discovery board append-only**: Never modify/delete
4. **Skip on failure**: If all explorations fail, planner proceeds with available context
5. **DO NOT STOP**: Continuous until all waves complete
6. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation.
7. **Verifiable convergence criteria required** — every task MUST have convergence.criteria[] with grep-verifiable conditions (no subjective language like "well-structured" or "properly implemented"). If any task lacks verifiable criteria: DO NOT report completion — fix the criteria first.
8. **Artifact verification before completion** — plan.json and .task/TASK-*.json files MUST exist. PLN artifact MUST be registered in state.json. If any missing: DO NOT report completion.
</invariants>

<state_machine>

<states>
S_PARSE       — 解析参数、确定 scope                       PERSIST: —
S_RESUME      — 恢复已有 session（--continue）              PERSIST: —
S_CONTEXT     — 加载上下文（context.md, specs, wiki）       PERSIST: —
S_CSV_GEN     — 确定探索角度、生成 tasks.csv                PERSIST: tasks.csv
S_WAVE_1      — Parallel Exploration (spawn)                PERSIST: discoveries.ndjson
S_WAVE_2      — Plan Generation (spawn single agent)        PERSIST: plan.json + .task/
S_CHECK       — Plan checking (max 3 iterations)            PERSIST: plan updates
S_CONFIRM     — 用户确认（-y 跳过）                         PERSIST: —
S_REGISTER    — 注册 PLN artifact、更新 index.json           PERSIST: state.json
</states>

<transitions>
S_PARSE → S_RESUME     WHEN: --continue
S_PARSE → S_CONTEXT    WHEN: phase/dir/--from resolved (D-007 reverse lookup for numeric)
S_PARSE → S_CONTEXT    WHEN: no args + no roadmap AND latest analyze artifact found in state.json (scope=standalone)
S_PARSE → ERROR        WHEN: no args + no roadmap + no analyze artifact

S_RESUME → S_WAVE_1    WHEN: W1 incomplete    DO: load session, resume
S_RESUME → S_WAVE_2    WHEN: W1 done, W2 pending
S_RESUME → S_CHECK     WHEN: W2 done, check pending

S_CONTEXT → S_CSV_GEN  DO: if --from: resolve context-package.json (precedence over context.md); load context.md, conclusions.json, specs, wiki, codebase docs

S_CSV_GEN → S_WAVE_1   DO: pre-flight (`maestro collab preflight --phase N`; exit 1 → warn + ask), determine exploration angles, generate tasks.csv, user validates (skip -y)

S_WAVE_1 → S_WAVE_2    DO: spawn parallel explorations, merge results, build prev_context

S_WAVE_2 → S_CHECK     DO: spawn planning agent, merge results

S_CHECK → S_BOUNDARY_GRILL  WHEN: plan passes or max 3 iterations    DO: A_PLAN_CHECK
S_CHECK → S_WAVE_2         WHEN: plan fails check, iterations < 3   DO: feed checker feedback back

S_BOUNDARY_GRILL:
  → S_CONFIRM    WHEN: no boundary conflicts detected     DO: —
  → S_CONFIRM    WHEN: conflicts detected + resolved      DO: A_BOUNDARY_GRILL
  GUARD: max 3 conflicts × 3 questions; non-blocking (see boundary-grill.md)

S_CONFIRM → S_REGISTER WHEN: -y OR user confirms
S_CONFIRM → S_CSV_GEN  WHEN: user wants to modify
S_CONFIRM → END        WHEN: user cancels

S_REGISTER → END       DO: A_REGISTER
</transitions>

<actions>

### Shared Spawn Contract (W1 and W2)

Every `spawn_agents_on_csv` call MUST filter `wave==N AND status=="pending"` rows from master tasks.csv, use the strict JSON Schema below, and embed the termination contract.

**Output Schema**:

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "files_modified":{ "type": "string", "description": "Semicolon-separated paths (W2 writes plan.json + .task/*)" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge: `result_status` → master `status`; copy `findings`, `files_modified`, `error`.

**Termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed (W2: plan.json AND .task/* MUST exist on disk before reporting completed)
- Failure → result_status=failed with error message
- Blocked → upstream context insufficient → result_status=blocked
- Timeout → near max_runtime_seconds → result_status=blocked, error="timeout"
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
Do NOT write to tasks.csv, wave-*.csv, results.csv, state.json. Do NOT call spawn_agents_on_csv (no recursion).
```

### Exploration agent responsibilities (W1)
Each explores one angle: architecture (module boundaries, deps), patterns (similar implementations), tests (framework, conventions), risks (complexity, blockers). Reads files, maps dependencies, shares via discoveries.ndjson. Read-only — does NOT write plan.json.

### Planning agent responsibilities (W2)
Consumes all exploration findings + context.md + specs. Produces:
- `plan.json`: summary, approach, task_ids, waves (with phase labels), confidence section
- `.task/TASK-*.json`: each with read_first[], convergence.criteria[] (grep-verifiable), concrete action/implementation

**Deep Work Rules** (MANDATORY for every task):
1. `read_first[]`: MUST contain the file being modified + source-of-truth files (tests, interfaces, schemas)
2. `convergence.criteria[]`: MUST be grep-verifiable (e.g., `"src/auth.ts contains export function verifyToken("`) — no subjective language ("well-structured", "properly implemented")
3. `action`: concrete implementation verb (create/modify/delete/refactor) + target path
4. `implementation[]`: ordered steps with file:change pairs — each step < 60 min
- Anti-pattern: `"Implement the feature"` (vague). Correct: `"Create src/auth.ts with verifyToken() and generateToken() functions using jsonwebtoken"`
- Anti-pattern: `read_first: []` (empty). Every file change requires reading the target first.

**Anti-splitting Rules**:
1. One feature = one task (don't split "create auth module" into "create file" + "add exports")
2. Group trivial changes (< 5 min each) into a single task
3. `depends_on` only for genuine data/API dependencies, not arbitrary sequencing
4. Task count guards: simple scope → 1-2 tasks, medium → 2-4, complex → 4-8

**UI-observable criteria**: If plan touches UI paths (components/, pages/, styles/) or frontend keywords, at least 1 convergence criterion per delivery wave MUST be UI-observable (e.g., `"page renders without console errors"`, `"button click triggers API call"`).

Verifies plan.json and every .task/*.json exists on disk before reporting completed; else report blocked.

### A_BOUNDARY_GRILL

Run boundary grill per `~/.maestro/workflows/boundary-grill.md` after plan-checker pass.
Input: plan.json tasks + convergence criteria + upstream context. Scope guard: "only plan scope; do not re-analyze or re-scope".
IF conflicts → results to plan.json `boundary_grill` section + affected TASK files. DEC conflicts add `boundary_warning` to confidence.
Non-blocking: warnings, not hard stops.

### A_PLAN_CHECK
Run plan-checker: coverage, dependency validity, criteria quality, pressure pass on highest-complexity task.
Confidence: 5-dimension factor model + readiness gate.
Collision detection against same-milestone plans.

### A_REGISTER
1. Register PLN artifact in state.json (scope, milestone, phase, depends_on)
2. Update index.json with plan metadata
3. If --gaps: link TASK files back to issues bidirectionally (task_refs[], task_plan_dir in issues.jsonl)
4. Display: phase, task count, wave count, check status, confidence, next steps

</actions>
</state_machine>

<discovery_board>
| Type | Dedup Key | Data |
|------|-----------|------|
| existing_pattern | name | {name, file, description, usage} |
| dependency_map | module | {module, imports[], exports[], dependents[]} |
| risk_factor | risk | {risk, severity, mitigation, affected_files[]} |
| convention | singleton | {naming, imports, formatting} |
| test_command | command | {command, scope, framework} |
</discovery_board>

<error_codes>
| Condition | Recovery |
|-----------|----------|
| No args and no roadmap and no analyze artifact in state.json | Provide phase number, topic, or run analyze first |
| --gaps but no gap source | Run maestro-execute first |
| Planning agent fails | Retry once with simplified context |
| Plan-checker exceeds 3 rounds | Accept with warnings |
</error_codes>

<success_criteria>
- [ ] Parallel explorations + sequential planning via spawn_agents_on_csv
- [ ] plan.json with summary, approach, task_ids, waves (with phase labels), confidence section
- [ ] .task/TASK-*.json with read_first[] (file being modified + source of truth files)
- [ ] Every task has convergence.criteria[] with grep-verifiable conditions (no subjective language)
- [ ] Every task action and implementation contain concrete values (no "align X with Y")
- [ ] Boundary grill executed after plan-checker pass (skip if no conflicts detected)
- [ ] Boundary grill results written to plan.json `boundary_grill` section (if conflicts found)
- [ ] DEC conflicts reflected in confidence `boundary_warning` factor
- [ ] Plan confidence scored with 5-dimension factor model
- [ ] Readiness gate checked before collision detection
- [ ] Pressure pass completed on highest-complexity task
- [ ] Collision detection against same-milestone plans (non-blocking)
- [ ] Plan-checker passed (or minor issues acknowledged, max 3 iterations)
- [ ] PLN artifact registered in state.json (numeric scope: milestone resolved via D-007 `phase_slugs` reverse lookup, NOT direct `current_milestone` read)
- [ ] No-args fallback honored: latest analyze artifact auto-discovered when roadmap absent (§5.2 priority 6)
- [ ] If --gaps: issues linked bidirectionally (task_refs[], task_plan_dir in issues.jsonl)
</success_criteria>
