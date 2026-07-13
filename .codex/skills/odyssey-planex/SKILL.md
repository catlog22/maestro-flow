---
name: odyssey-planex
description: Requirement-driven iterative cycle — plan, execute, strict verify,
  fix loop until acceptance criteria met
argument-hint: <requirement> [--max-iterations N] [--skip-generalize] [--auto]
  [--method agent|cli|auto] [--executor <tool>] [--skip-verify] [--heartbeat]
  [-y] [-c]
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
version: 0.5.50
---

<base>@~/.maestro/workflows/odyssey-base-codex.md</base>

<required_reading>
Required reading: base (`odyssey-base-codex.md`) before any actions. Load and apply base invariants, execution discipline, and shared actions before proceeding.
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

<purpose>
Requirement-to-delivery closed loop: parse requirement -> define acceptance criteria ->
plan -> execute -> verify -> fix gaps -> iterate until ALL criteria pass.
</purpose>

<boundary>
**In scope:** Single requirement full loop — from parsing to all acceptance criteria passing + generalization.
**Out of scope:** Multi-requirement orchestration -> `/maestro-roadmap` | Deep debugging -> `$odyssey-debug` | Code review -> `$odyssey-review-test-fix` | UI optimization -> `$odyssey-ui`

**`--template <name>`:**

| Template | Preset criteria pattern | Use case |
|----------|------------------------|----------|
| `feature` | User story acceptance + boundary tests + UI verification | New feature development |
| `bugfix` | Regression tests + root cause confirmation + boundary coverage | Bug fixing |
| `refactor` | Behavior-unchanged verification + perf baseline + API compat | Refactoring |
| `migration` | Data consistency + rollback verification + perf comparison | Data/API migration |
| `api-endpoint` | Request/response contract + error handling + auth checks | API development |
</boundary>

<context>
$ARGUMENTS

**Flags:**
| Flag | Description | Default |
|------|-------------|---------|
| `--template <name>` | Predefined requirement template | -- |
| `--max-iterations N` | Max verify->fix cycles before escalation | 3 |
| `--skip-generalize` | Skip S_GENERALIZE + S_DISCOVER | false |
| `--auto` | CLI delegate calls without confirmation | false |
| `--method agent\|cli\|auto` | Execution method: Agent tool, CLI delegate, or auto-select | `auto` |
| `--executor <tool>` | Explicit executor tool for CLI delegate mode | First enabled in config |
| `--skip-verify` | Skip execution post-validation gate | false |
| `--heartbeat` | Enable periodic progress heartbeat | false |
| `-y` | Auto-confirm -- decisions recorded as `deferred` | false |
| `-c` | Resume most recent session | -- |

**Session**: `{run_dir}/outputs/`
**Output**: `session.json` | `evidence.ndjson` | `understanding.md`

**Output boundary**: ALL session artifacts MUST target the session directory (`{run_dir}/outputs/`) or `.workflow/state.json` only. Source code modifications during S_EXECUTE and S_FIX are in-scope but MUST be committed per action. NEVER write session artifacts outside these paths.

**session.json -- planex-specific fields:**
```json
{ "requirement": "",
  "acceptance_criteria": [{"id":"AC1","criterion":"","verify_method":"test|grep|cli-review|manual","status":"pending","evidence":"","passed_at":null}],
  "plan": {"tasks":[{"id":"T1","title":"","description":"","criteria_refs":["AC1"],"status":"pending","files_modified":[],"domain":"general","executor":"agent"}],"created_at":""},
  "execution_config": {"method":"auto","default_executor":"","domain_routing":{"frontend":"","backend":"","default":"agent"},"code_review_tool":"Skip","verification_tool":"Auto","confirmed":false},
  "iterations": [{"iteration":1,"started_at":"","completed_at":"","criteria_before":{"passed":0,"total":0},"criteria_after":{"passed":0,"total":0},"gaps_fixed":[],"files_modified":[]}],
  "current_iteration": 0,
  "patterns": [], "generalization_stats": null }
```

**evidence.ndjson phases:** `planning|execution|verification|fix|decision|generalization|discovery|self-iteration`

**understanding.md -- 8 sections:**
1. Requirement & Criteria <- S_INTAKE | 2. Plan <- S_PLAN | 3. Execution <- S_EXECUTE
4. Verification (per iter) <- S_VERIFY | 5. Fix Log (per iter) <- S_FIX | 6. Generalization <- S_GENERALIZE
7. Discoveries <- S_DISCOVER | 8. Learnings <- S_RECORD

**phase_goals[]:**
| ID | Goal | Done When | Phase | Skip When |
|----|------|-----------|-------|-----------|
| G1 | Acceptance criteria defined | >=1 criterion in acceptance_criteria[] | S_INTAKE | -- |
| G2 | Plan created | session.json.plan populated | S_PLAN | -- |
| G3 | Implementation complete | all plan tasks executed | S_EXECUTE | -- |
| G4 | All criteria pass | all acceptance_criteria[].status == passed | S_VERIFY | -- |
| G5 | Pattern generalized | patterns[] >=1 entry | S_GENERALIZE | skip_generalize |
| G6 | Discoveries triaged | all scan hits classified | S_DISCOVER | skip_generalize |
| G7 | Learnings persisted | spec entries created OR no actionable | S_RECORD | -- |

**Knowledge Persistence (S_RECORD writes to understanding.md S8):**

| Category | Content | Follow-up |
|----------|---------|-----------|
| Multi-round fix cycle pattern | Problem scenario + fix iterations + final approach | `/spec-add debug` |
| Reusable implementation pattern | Pattern description + applicable scope + code template | `/spec-add coding` |
| Acceptance criteria template | Criteria template + verify_method recommendations | `/spec-add review` |
| Generalization pattern | Pattern signature + risk + fix template | `/spec-add coding` |
</context>

<invariants>
Base invariants apply. Additionally:
6. **Acceptance criteria are sacred** -- no "close enough", no manual override without explicit escalation
7. **Max-iteration failure is ESCALATED** -- when max iterations reached with failing criteria, status MUST be `ESCALATED` or `PARTIAL`, NEVER `ALL_PASSED`. Under `-y`, criteria remain `failed` with `deferred` decision, session status is `ESCALATED`. Lowering acceptance standards requires explicit user confirmation with original criteria, change reason, and `incomplete` marker recorded.
</invariants>

<self_iteration>
Applies to: **S_PLAN, S_VERIFY, S_GENERALIZE**. Logic in base.
</self_iteration>

<csv_schema>

### Shared Output Schema

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "findings":      { "type": "string", "maxLength": 500 },
    "evidence":      { "type": "string" },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

**Termination Contract:** You MUST call `report_agent_job_result` EXACTLY ONCE before exiting. Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv.

### tasks.csv

```csv
id,title,description,task_type,criterion_refs,deps,wave,status,findings,evidence,error
```

**Waves:**
- Wave 1: Verification agents (one per `cli-review` criterion) -- parallel
- Wave 2: Generalization agents (syntax-grep, semantic-scan, structural-match, historical-grep) -- parallel
</csv_schema>

<execution>
Follow base execution discipline completely. Actions defined in state_machine below.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: INTAKE → PLAN**
- REQUIRED: Requirement parsed, >=1 acceptance criterion defined with verify_method assigned.
- REQUIRED: session.json initialized, understanding.md §1 written, G1 marked done.
- BLOCKED if: no requirement provided (E001) or zero criteria derived (W001).

**GATE 2: PLAN → EXECUTE**
- REQUIRED: Plan tasks decomposed with criteria_refs mapping each task to acceptance criteria.
- REQUIRED: session.json.plan populated, understanding.md §2 updated, G2 marked done.
- BLOCKED if: plan has zero tasks or unmapped criteria.

**GATE 3: EXECUTE → VERIFY**
- REQUIRED: All plan tasks executed (or marked blocked after 3 retries per deviation rule).
- REQUIRED: execution_config confirmed, per-task evidence logged, understanding.md §3 updated, G3 marked done.
- BLOCKED if: tasks still pending execution.

**GATE 4: VERIFY → FIX / GENERALIZE**
- REQUIRED: Every acceptance criterion verified by its assigned method (test/grep/cli-review/manual).
- REQUIRED: Per-criterion evidence logged with pass/fail status and iteration count.
- BLOCKED if: verification incomplete — all criteria must be checked before routing decision.

**GATE 5: FIX → VERIFY**
- REQUIRED: current_iteration incremented, targeted fixes applied for each failed criterion.
- REQUIRED: Fix evidence logged, understanding.md §5 updated.
- BLOCKED if: no fix attempted for failing criteria.

**GATE 6: GENERALIZE → DISCOVER**
- REQUIRED: ALL 3 layers (syntax/semantic/structural) attempted with evidence logged.
- REQUIRED: generalization_stats written with by_layer entries for all 3 layers, G5 marked done.
- BLOCKED if: any layer not attempted (thoroughness floor violation).

**GATE 7: DISCOVER → RECORD**
- REQUIRED: All hits triaged with per-item classification and reason.
- REQUIRED: remaining_actionable == 0 OR loops >= max_loops with per-item reasons logged, G6 marked done.
- BLOCKED if: unclassified hits remain.

</execution>

<state_machine>

<states>
S_INTAKE      -- parse requirement, define acceptance criteria
S_PLAN        -- decompose tasks, generate execution plan
S_EXECUTE     -- implement tasks
S_VERIFY      -- iron gate: check every acceptance criterion
S_FIX         -- targeted fix for failing criteria (loops to VERIFY)
S_GENERALIZE  -- extract patterns, 4-agent scan
S_DISCOVER    -- triage scan hits, route decisions
S_RECORD      -- persist learnings, final summary
</states>

<transitions>
S_INTAKE -> S_INTAKE      : -c + session found (resume)
S_INTAKE -> S_PLAN        : requirement + criteria defined
S_INTAKE -> S_INTAKE      : no requirement -> request_user_input

S_PLAN -> S_EXECUTE
S_EXECUTE -> S_VERIFY

S_VERIFY -> S_GENERALIZE  : all passed AND NOT skip_generalize
S_VERIFY -> S_RECORD      : all passed AND skip_generalize
S_VERIFY -> S_FIX         : some failed AND iteration < max
S_VERIFY -> S_PLAN        : fundamental plan flaw discovered, loops < max_loops -> cross_phase_loops++ (replan)
S_VERIFY -> S_RECORD      : some failed AND iteration >= max (escalate)

S_FIX -> S_VERIFY (loop)

S_GENERALIZE -> S_DISCOVER  : hits found
S_GENERALIZE -> S_RECORD    : no hits

S_DISCOVER -> S_EXECUTE     : discovery finds area needing same implementation -> cross_phase_loops++
S_DISCOVER -> S_RECORD      : triage complete AND remaining_actionable == 0
S_DISCOVER -> S_RECORD      : loops >= max_loops -> MUST log per-item reasons

S_RECORD -> END
</transitions>

<actions>

### A_INTAKE
1. Parse requirement and flags, generate slug, create SESSION_DIR
2. **Define acceptance criteria** -- analyze requirement -> derive testable criteria. Each gets `verify_method`: test | grep | cli-review | manual
   - **Normal**: request_user_input to confirm/edit
   - **`-y`**: auto-derive, record `{"phase":"decision","type":"criteria-confirmation","status":"deferred"}`
3. Search prior knowledge: `maestro search`, related sessions
4. Write session.json + understanding.md S1. Mark G1 done. call `create_goal` with phase_goals as success_criteria

Commit: `"odyssey-planex({slug}): INTAKE -- requirement parsed"`

### A_PLAN
1. Decompose requirement into ordered tasks mapped to acceptance criteria
2. CLI-assisted planning (optional):
   ```bash
   maestro delegate "PURPOSE: Create implementation plan for: {requirement}
   TASK: Decompose into subtasks | Map to acceptance criteria | Identify dependencies
   MODE: analysis
   CONTEXT: @**/* | Criteria: {criteria_summary}
   EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]
   " --to claude --mode analysis
   ```
   Execute with `run_in_background: true`, wait for callback.
3. Write session.json.plan, append evidence (planning), update understanding.md S2. Mark G2 done.

Commit: `"odyssey-planex({slug}): PLAN -- tasks decomposed"`

### A_EXECUTE

#### Step 1: Execution Options Confirmation

**Skip if** `-y` flag OR `--method` explicitly set OR `execution_config.confirmed == true` (resume).

Load available tools: `maestro delegate-config show --json` -> extract enabled tools and domain tags.

```
request_user_input({
  questions: [
    {
      question: "How should tasks be executed? Choose a method, or Other to specify domain routing (e.g. 'frontend agy backend codex rest agent')",
      header: "Executor",
      options: [
        { label: "Auto (Recommended)", description: "Domain routing: frontend->{frontendTool}, backend->{backendTool}, general->agent" },
        { label: "Agent", description: "Claude Code Agent executes all tasks (fastest)" },
        ...availableTools.map(t => ({ label: t, description: `${t} CLI executes all tasks` }))
      ]
    },
    {
      question: "Run code review after execution?",
      header: "Review",
      options: [
        { label: "Skip", description: "No review" },
        ...availableTools.map(t => ({ label: `${t} Review`, description: `${t} CLI: git diff quality review` }))
      ]
    },
    {
      question: "Verification gate? (external model checks convergence + structure + anti-patterns)",
      header: "Verify",
      options: [
        { label: "Auto (Recommended)", description: `Delegate to ${availableTools[0]} for convergence+structure+anti-pattern check` },
        ...availableTools.map(t => ({ label: t, description: `${t}: verification gate` })),
        { label: "Skip", description: "No verification" }
      ]
    }
  ]
})
```

Parse response -> write `execution_config` to session.json, set `confirmed: true`.
`--skip-verify` flag overrides verification to `"Skip"`.

#### Step 2: Executor Resolution

Per-task domain routing (when method == "auto"):

| Domain | Keywords / Patterns | File Extensions |
|--------|-------------------|-----------------|
| frontend | UI, component, page, style, layout, CSS, view | .tsx/.jsx/.vue/.css/.html/.svelte |
| backend | API, server, database, service, algorithm, worker | .go/.rs/.java/.py/.sql/.proto |
| general | mixed, config, tests, unclear | .ts/.js/other |

Resolution: `execution_config.domain_routing[domain]` -> fallback `domain_routing.default` ("agent").

#### Step 3: Task Execution

Execute tasks per plan order. Independent tasks (no cross-dependency) may run in parallel.

**Agent path:**
```
Spawn Agent with:
  task definition, acceptance criteria refs, prior task summaries, specs_content
Agent implements -> verifies convergence criteria -> auto-fix (max 3) -> returns result
```

**CLI path (via maestro delegate):**
```bash
maestro delegate "PURPOSE: Implement task ${task_id}: ${title}; success = criteria ${criteria_refs} satisfied
TASK: ${description} | Read existing code first | Verify convergence criteria after changes
MODE: write
CONTEXT: @${scope}/**/* | Criteria: ${criteria_summary}
EXPECTED: Working code changes, convergence evidence, summary of what was done
CONSTRAINTS: Scope limited to task files | Follow project specs

## Acceptance Criteria (must satisfy)
${criteria_refs.map(ref => criteria[ref].criterion).join('\n')}

## Implementation Steps
${task.description}

## Project Specs
${specs_content}

## Prior Task Summaries
${prior_summaries}
" --to ${resolved_executor} --mode write --id planex-${slug}-${task_id}
```

Execute with `run_in_background: true`, wait for callback.

**Deviation Rule** -- max 3 auto-fix attempts per task:
1. First attempt: normal dispatch
2. Retry: `--resume planex-${slug}-${task_id}` with simplified prompt
3. Final: fallback to Agent path
4. All 3 fail -> mark task `blocked`, record checkpoint, continue remaining tasks. Blocked tasks make G3 `incomplete` — related acceptance criteria are marked `blocked`, and S_VERIFY/S_RECORD propagate the incomplete status.

#### Step 4: Per-Task Evidence

Per completed task:
- Record evidence: `{"phase":"execution","type":"task-completed","task_id":"T1","executor":"agent|agy|...","files_modified":[],"summary":"","attempt":1}`
- Update task status in session.json plan

#### Step 5: Post-Execution Validation

**Skip if** `execution_config.verification_tool == "Skip"` OR `--skip-verify` OR no completed tasks.

**Check 1: Summary Consistency** -- cross-check task status vs actual file changes (git diff).

**Check 2: CLI Verification Gate:**
```bash
maestro delegate "PURPOSE: Verify execution output meets acceptance criteria; success = all criteria verified with file:line evidence
TASK:
1. CONVERGENCE: For each criterion, read actual code, verify behavior exists, report status with evidence
2. EXISTENCE: Verify all expected files exist on disk
3. SUBSTANCE: Verify real implementation -- flag stubs, placeholders, TODO-only
4. ANTI-PATTERNS: Scan for TODO/FIXME/HACK, console.log debug, disabled tests
MODE: analysis
CONTEXT: @${modified_files}
EXPECTED: JSON { convergence: [{criterion, status, evidence}], issues: [{type, file, line, severity}], overall: passed|gaps_found }
CONSTRAINTS: Read-only | Check ALL criteria exhaustively | Evidence must be file:line

## Acceptance Criteria (verify each)
${acceptance_criteria.map(c => c.criterion).join('\n')}

## Modified Files
${modified_files.join('\n')}
" --to ${execution_config.verification_tool} --mode analysis
```

Execute with `run_in_background: true`, wait for callback.

On result:
- `overall == "passed"` -> proceed to S_VERIFY with boosted confidence
- `overall == "gaps_found"` -> log findings, proceed to S_VERIFY (criteria will catch failures)

**Check 3: Code Review** (if `execution_config.code_review_tool != "Skip"`):
```bash
maestro delegate "Review git diff for correctness, style, bugs" --to ${code_review_tool} --mode analysis --rule analysis-review-code-quality
```

#### Step 6: Completion

Update understanding.md S3. Mark G3 done.

Commit: `"odyssey-planex({slug}): EXECUTE -- implementation complete"`

### A_VERIFY

Iron gate -- every acceptance criterion checked objectively.

**Verify each criterion by method:**
| Method | Action |
|--------|--------|
| `test` | Run relevant tests, check pass/fail |
| `grep` | Grep for expected pattern |
| `cli-review` | `spawn_agents_on_csv` Wave 1 (see csv_schema) |
| `manual` | **Normal**: request_user_input / **`-y`**: record `deferred` |

**Wave 1 -- cli-review verification via spawn_agents_on_csv:**
```csv
"verify-AC1","Verify AC1","Review against criterion: {AC1.criterion}","verification","AC1","","1","pending","","",""
```
```javascript
spawn_agents_on_csv({ csv_path: "tasks.csv", id_column: "id",
  instruction: VERIFICATION_INSTRUCTION + TERMINATION_CONTRACT,
  max_concurrency: 4, max_runtime_seconds: 300,
  output_csv_path: "wave-1-results.csv", output_schema: SHARED_OUTPUT_SCHEMA })
```

Record per criterion: `{"phase":"verification","type":"criterion-check","criterion_id":"AC1","method":"","result":"passed|failed","evidence":"","iteration":N}`. Update acceptance_criteria[].status. Append to iterations[].

Update understanding.md S4 with pass/fail table.

**Route:** all passed -> mark G4 done -> next state. Some failed + iteration < max -> S_FIX. Some failed + iteration >= max -> **Normal**: request_user_input (continue/lower bar/accept) / **`-y`**: `deferred`, proceed S_RECORD.

Commit: `"odyssey-planex({slug}): VERIFY -- acceptance check"`

### A_FIX
1. Increment current_iteration
2. For each failed criterion: diagnose gap -> targeted code fix
3. CLI fix review (optional):
   ```bash
   maestro delegate "PURPOSE: Review fixes for failing criteria
   TASK: Check fix correctness | Verify no regressions on passing criteria
   MODE: analysis
   CONTEXT: @{modified_files} | Passing: {passing} | Fixed: {fixed}
   EXPECTED: JSON {verdict, regression_risk, concerns}
   " --to claude --mode analysis
   ```
4. Append evidence (fix), update understanding.md S5 -> S_VERIFY

Commit: `"odyssey-planex({slug}): FIX -- targeted repair"`

### A_GENERALIZE
Base shared_actions. Planex overrides:
- Pattern source: implementation patterns
- **Wave 2 -- 4-agent scan via spawn_agents_on_csv:**
```csv
"gen-syntax","Syntax Grep","Grep patterns across project","generalization","syntax","","2","pending","","",""
"gen-semantic","Semantic Scan","Check related modules for anti-pattern","generalization","semantic","","2","pending","","",""
"gen-structural","Structural Match","Find files needing same treatment","generalization","structural","","2","pending","","",""
"gen-historical","Historical Grep","git log -S for similar patterns","generalization","historical","","2","pending","","",""
```

Mark G5 done. Commit: `"odyssey-planex({slug}): GENERALIZE -- pattern scan"`

### A_DISCOVER
Base shared_actions. Mark G6 done. Commit: `"odyssey-planex({slug}): DISCOVER -- triage complete"`

### A_RECORD
Base shared_actions. Learnings per Knowledge Persistence table. **Confirmation gate**: Before writing spec entries, present proposed entries to user via `request_user_input` for confirmation. Skip confirmation only if `-y` flag is set.

**Completion summary:**
```
--- PLANEX ODYSSEY COMPLETE ---
Requirement: {requirement}
Criteria:    {passed}/{total} passed
Iterations:  {N} cycles
Patterns:    {patterns_extracted} ({by_layer} distribution)
Scan hits:   {total_hits} ({cross_layer_confirmed} cross-layer confirmed)
Issues:      {N} created | Decisions: {N} resolved, {M} pending, {K} deferred
Learnings:   {N} spec entries
Self-iter:   {N} rounds across {M} stages
Goals:       {done}/{total} confirmed ({skipped} skipped)
Status:      {ALL_PASSED|PARTIAL|ESCALATED}
---
```

Commit: `"odyssey-planex({slug}): RECORD -- session summary"`

</actions>

<appendix>

### `-y` planex-specific points

| Decision Point | Normal | `-y` |
|----------------|--------|------|
| S_INTAKE criteria confirmation | request_user_input | auto-derive, `deferred` |
| S_EXECUTE execution options | request_user_input (executor/review/verify) | use defaults (auto/Skip/Auto), `confirmed: true` |
| S_EXECUTE task blocked (3 retries) | request_user_input: continue or stop | auto continue, log blocked |
| S_VERIFY manual criterion | request_user_input | `deferred` |
| S_VERIFY max iteration reached | request_user_input (continue/lower bar/accept) | mark status `ESCALATED`, record failing criteria as `deferred`, proceed to S_RECORD with `ESCALATED` status — NEVER mark as `ALL_PASSED` |

### Goal convergence rules

```
Stop when acceptance_criteria[*] all status==passed
AND phase_goals_all_done=true.
verify failure -> auto fix->re-verify loop.
Each fix round re-verifies; new criterion violations continue fixing, up to max_iterations.
phase=decision pending -> must request_user_input, never self-resolve.
No "close enough" -- all criteria must pass.
```

### Iteration Model

```
S_EXECUTE -> S_VERIFY --all pass--> S_GENERALIZE -> S_DISCOVER -> S_RECORD
                |                       |
           some fail + iter < max      no hits -> S_RECORD
                v
             S_FIX --> S_VERIFY (loop)
```

Max iterations (default 3) prevents infinite loops. Each iteration records criteria_before, gaps_fixed, criteria_after.

</appendix>

</state_machine>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No requirement provided | Provide requirement |
| W001 | warning | No acceptance criteria derived | Manual definition needed |
| W002 | warning | Max iterations reached, criteria still failing | Escalate to user |
| W003 | warning | CLI review regression concern | Review before next iteration |
</error_codes>

<success_criteria>
- [ ] Requirement parsed with >=1 acceptance criterion (verify_method assigned)
- [ ] Plan tasks mapped to criteria; execution options confirmed
- [ ] Tasks dispatched via resolved executor with deviation rule (max 3 retries)
- [ ] Post-execution validation gate run (unless --skip-verify)
- [ ] Every criterion verified per method; failing -> targeted fix (not re-implementation)
- [ ] Iteration count tracked and max respected; unfixed criteria individually classified
- [ ] understanding.md S1-S8 updated per phase; phase_goals G1-G7 audited
- [ ] Generalization + discovery completed (unless --skip-generalize)
- [ ] Quality Gate self-iteration triggered when insufficient
- [ ] `create_goal` called once after intake; `-y` mode: no blocking prompts
- [ ] Session resumable via -c; completion summary output
</success_criteria>

<next_step_routing>
<!-- suggest-only — do NOT auto-execute. Present these as suggestions to the user. -->
| Condition | Next step |
|-----------|-----------|
| All criteria passed | `$odyssey-review-test-fix <changed-files>` |
| Max iterations, still failing | `$odyssey-debug "<failing criterion>"` |
| Want formal review | `$quality-review <phase>` |
| Issues from discoveries | `/manage-issue list --source planex-odyssey` |
| Pattern worth documenting | `$learn-decompose <module>` |
</next_step_routing>
