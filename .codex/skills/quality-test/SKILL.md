---
name: quality-test
description: Conversational UAT with session persistence, CSV-parallel debug diagnosis via spawn_agents_on_csv, severity inference, and gap-plan closure loop.
argument-hint: "<phase> [-y] [--smoke] [--auto-fix] [--session ID]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Conversational UAT: present expected behavior one test at a time, user confirms or describes issues. Severity inferred from natural language (never asked). Session persists in `uat.md` across context resets. Failed tests trigger CSV-parallel diagnosis via `spawn_agents_on_csv` and optional gap-fix closure.

**Philosophy**: Show expected, ask if reality matches.

```
+---------------------------------------------------------------------------+
|                     UAT CSV DIAGNOSIS PIPELINE                            |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Setup & Scenario Design                                        |
|     +-- Resolve target (phase / scratch)                                 |
|     +-- Check active sessions (resume or new)                            |
|     +-- Smoke tests (if --smoke)                                         |
|     +-- Load verification context + quality artifacts                    |
|     +-- Design test scenarios from user-observable outcomes              |
|     +-- Create uat.md with all tests pending                             |
|                                                                           |
|  Phase 2: Interactive Testing (one at a time)                            |
|     +-- Present test: show expected behavior                             |
|     +-- User responds: pass / skip / describe issue                      |
|     +-- Severity inferred (never asked)                                  |
|     +-- Issues auto-created in issues.jsonl                              |
|     +-- Batched writes to uat.md                                         |
|                                                                           |
|  Phase 3: Diagnosis (if issues found)                                    |
|     +-- Cluster gaps by component/module                                 |
|     +-- Build diagnosis.csv from gap clusters                            |
|     +-- Diagnose in parallel via spawn_agents_on_csv                     |
|     +-- Each agent: find root cause, fix direction, affected files       |
|     +-- Merge results into uat.md gaps                                   |
|                                                                           |
|  Phase 4: Gap Closure & Report                                           |
|     +-- If --auto-fix: plan --gaps -> execute -> re-verify (max 2)       |
|     +-- Otherwise: present options (auto-fix / debug / plan / manual)    |
|     +-- Issue lifecycle sync throughout                                  |
|     +-- Report with pass/fail counts and next steps                      |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$quality-test "3"                       # test phase 3
$quality-test "3 --smoke"               # smoke tests first, then UAT
$quality-test "3 --auto-fix"            # auto-trigger gap-fix loop on failures
$quality-test "-y 3"                    # implies --auto-fix, skip gap closure prompt
$quality-test "--session 04-comments"   # resume specific session
```

**Flags**:
- `<phase>`: Phase number or scratch task ID
- `--smoke`: Run cold-start smoke tests before UAT
- `--auto-fix`: Auto-trigger gap-fix loop (plan --gaps -> execute -> re-verify) on failures
- `--session ID`: Resume a specific UAT session

`-y` implies `--auto-fix`. UAT itself remains interactive (present expected → user confirms). `-y` only automates the gap closure loop.

**Output**:
- `{target_dir}/uat.md` — session file (persistent)
- `{target_dir}/.tests/test-plan.json` — scenario definitions
- `{target_dir}/.tests/test-results.json` — pass/fail results
- `{target_dir}/.tests/coverage-report.json` — requirement coverage
- `.tests/.csv-session/diagnosis.csv` + `diagnosis-results.csv` — diagnosis artifacts
</context>

<csv_schema>

### diagnosis.csv (Gap Diagnosis Phase)

```csv
id,test_id,cluster,test_name,expected,reported,severity,target_files,issue_id,source_context,root_cause,fix_direction,affected_files,evidence,error
"DX-001","T-003","auth","Login validation","Valid login returns dashboard","Clicking login does nothing, no error","major","src/auth/login.ts;src/routes/auth.ts","ISS-20260503-001","login.ts calls authService.verify, auth.ts exports POST /login","","","","",""
"DX-002","T-005","events","Event cleanup on logout","Events unsubscribed after logout","Memory leak warning in console after logout","blocker","src/events/manager.ts","ISS-20260503-002","manager.ts has subscribe() but no unsubscribe in logout flow","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Diagnosis ID (DX-NNN) |
| `test_id` | Input | Reference to T-NNN test |
| `cluster` | Input | Gap cluster name (component/area) |
| `test_name` | Input | Human-readable test name |
| `expected` | Input | Expected behavior from test scenario |
| `reported` | Input | User's issue description (verbatim) |
| `severity` | Input | Inferred severity (blocker/major/minor/cosmetic) |
| `target_files` | Input | Semicolon-separated source files to investigate |
| `issue_id` | Input | Back-reference to issues.jsonl entry |
| `source_context` | Input | Relevant code context (imports, exports, call chains) |
| `root_cause` | Output | Diagnosed root cause |
| `fix_direction` | Output | Suggested fix approach |
| `affected_files` | Output | Semicolon-separated files that need changes |
| `evidence` | Output | file:line references supporting diagnosis |
| `error` | Output | Agent error if diagnosis failed |

### Session Structure

```
{target_dir}/.tests/.csv-session/
+-- diagnosis.csv           (diagnosis input)
+-- diagnosis-results.csv   (diagnosis output)
```
</csv_schema>

<invariants>
1. **One test at a time** — never batch-present tests
2. **Never ask severity** — always infer from natural language
3. **Session persistence** — uat.md survives context resets, resume from any point
4. **Batched writes** — minimize file I/O (on issue, every 5 passes, completion)
5. **Gap-fix loop max 2 iterations** — prevent infinite loops
6. **CSV parallel diagnosis** — spawn_agents_on_csv for gap clusters, not sequential
7. **Auto-create issues** — every failed test creates entry in `.workflow/issues/issues.jsonl`
8. **Issue lifecycle sync** — track issues through registered → planning → executing → completed/failed
</invariants>

<execution>

### Step 1: Resolve Target

1. Parse `$ARGUMENTS` for phase number, scratch task ID, or flags
2. **Phase mode**: resolve `PHASE_DIR` via artifact registry in `state.json` (`type='execute'`, matching phase)
3. **Scratch mode**: set `SCRATCH_DIR = .workflow/scratch/{id}/`
4. Validate target exists and has `verification.json` — if missing: **E002**

### Step 2: Check Active Sessions

Scan `.workflow/scratch` for existing `uat.md` files with `status: testing` in frontmatter.

- If active sessions exist and no target specified: display session table, ask user to resume or start new:
  ```
  ## Active UAT Sessions
  | # | Target | Status | Current Test | Progress |
  |---|--------|--------|--------------|----------|
  | 1 | 04-comments | testing | 3. Reply to Comment | 2/6 |
  Reply with a number to resume, or provide a phase/task to start new.
  ```
- If `--session ID` specified: resume that session directly (skip to Step 9)
- If session exists for target: offer resume or restart

### Step 3: Smoke Tests (if --smoke)

Skip if `--smoke` not set.

| Smoke Test | Check | Method |
|------------|-------|--------|
| App starts | Process runs without crash | Run start command, check exit code |
| Routes respond | Key endpoints return non-error | curl/fetch main routes |
| Build clean | No build errors | Build command succeeds |
| Dependencies | No missing deps | Install check |

Record in `uat.md` under `## Smoke Tests`. If any fails: **E003** — abort, suggest `$quality-debug`.

### Step 4: Load Verification Context

Read from target directory: `verification.json`, `validation.json`, `index.json`, `plan.json`, `.summaries/TASK-*.md`. Build testable list from user-observable outcomes.

### Step 4.5: Load Quality Context (Cross-Artifact Integration)

Query `state.json.artifacts[]` for all artifacts matching current phase and milestone:

**Review findings integration**:
- For `type: "review"` artifacts: read `review.json`, extract critical/high findings
- Generate additional test scenarios marked `source: "review_finding"`
- If review verdict is "BLOCK" and review-finding tests fail → auto-enter gap-fix loop

**Debug root cause integration**:
- For `type: "debug"` artifacts: read `understanding.md`, extract confirmed root causes
- Generate regression test scenarios marked `source: "debug_root_cause"`

### Step 5: Design Test Scenarios

Create scenarios from testables:
- `id`: T-001, T-002, ...
- `name`: Brief test name
- `category`: "e2e" | "integration" | "unit"
- `expected`: Specific observable behavior
- `requirement_ref`: Which success criterion this covers
- `source`: "verification" | "review_finding" | "debug_root_cause"

Write `{target_dir}/.tests/test-plan.json`:
```json
{
  "target": "{phase or scratch ID}",
  "generated_at": "{ISO}",
  "tests": [...],
  "coverage": {
    "requirements_mapped": ["SC-001"],
    "requirements_unmapped": ["SC-003"]
  }
}
```

Focus on USER-OBSERVABLE outcomes. Skip internal/non-observable items.

### Step 6: Create UAT File

Archive previous `uat.md` to `.history/` if exists.

Write `{target_dir}/uat.md`:
```markdown
---
status: testing
target: {phase slug or scratch ID}
source: [list of summary files]
started: {ISO}
updated: {ISO}
---

## Current Test
number: 1
name: {first test name}
expected: |
  {what user should observe}
awaiting: user response

## Smoke Tests
{results if ran, otherwise omitted}

## Tests
### 1. {Test Name}
expected: {observable behavior}
result: [pending]

## Summary
total: {N}  passed: 0  issues: 0  pending: {N}  skipped: 0

## Gaps
[none yet]
```

### Step 7: Present Test (Interactive Loop)

Present one test at a time:
```
------------------------------------------------------------
  TEST {number}/{total}: {name}
------------------------------------------------------------

Expected behavior:
{expected}

------------------------------------------------------------
> Type "pass" or describe what's wrong
------------------------------------------------------------
```

Wait for user response (plain text).

### Step 8: Process Response

| Response | Action |
|----------|--------|
| empty, "yes", "y", "ok", "pass", "next" | Mark as pass |
| "skip", "can't test", "n/a" | Mark as skipped |
| Anything else | Log as issue, infer severity |

**Severity inference** (never ask):

| User says | Infer |
|-----------|-------|
| "crashes", "error", "exception", "fails completely", "can't use" | blocker |
| "doesn't work", "nothing happens", "wrong behavior", "broken" | major |
| "works but...", "slow", "weird", "minor issue", "inconsistent" | minor |
| "color", "spacing", "alignment", "looks off", "typo" | cosmetic |

Default: **major** if unclear.

**On issue**: auto-create issue in `.workflow/issues/issues.jsonl`:
```json
{
  "id": "ISS-{YYYYMMDD}-{NNN}",
  "title": "UAT: {test.name} - {response truncated 100 chars}",
  "status": "registered",
  "priority": "{from severity}",
  "severity": "{inferred}",
  "source": "uat",
  "phase_ref": "{phase}",
  "gap_ref": "{test.id}",
  "description": "Expected: {expected}. Reported: {verbatim}",
  "tags": ["uat"]
}
```

Back-reference: set `gap.issue_id = issue_id` in uat.md gap entry.

**Batched writes**: write to file on issue, every 5 passes, or completion.

If more tests → update Current Test, loop to Step 7.
If done → go to Step 10.

### Step 9: Resume From File

Read `uat.md`, find first `result: [pending]` test, announce progress, continue from there (go to Step 7).

### Step 10: Complete Session

1. Update `uat.md` frontmatter: `status → "complete"`, update timestamp
2. Archive previous result artifacts to `.history/`
3. Write `.tests/test-results.json`:
   ```json
   { "target": "...", "completed_at": "...", "results": [...], "summary": { "total": N, "passed": N, "issues": N, "skipped": N } }
   ```
4. Write `.tests/coverage-report.json`:
   ```json
   { "target": "...", "requirements_covered": [...], "requirements_uncovered": [...], "coverage_percentage": 66.7 }
   ```
5. Update `index.json` with UAT results
6. **Register artifact** in `state.json.artifacts[]`:
   ```json
   { "id": "TST-NNN", "type": "test", "milestone": "current", "phase": "target_phase", "scope": "phase",
     "path": "scratch/{YYYYMMDD}-test-P{N}-{slug}", "status": "completed|failed", "depends_on": "exec_art.id" }
   ```
7. If no issues → go to Step 13
8. If issues found → go to Step 11

### Step 11: Auto-Diagnose via CSV Parallel

**Cluster gaps and diagnose in parallel via `spawn_agents_on_csv`.**

#### 11a. Cluster Gaps

Group issues by affected component/area:
- Same file/module → one cluster
- Same feature/flow → one cluster
- Unrelated → separate clusters

#### 11b. Build diagnosis.csv

```
mkdir -p {target_dir}/.tests/.csv-session

For each gap in uat.md:
  Resolve target_files from gap context (test expected behavior → source files)
  Gather source_context (imports, exports, call chains from target files)
  Create one diagnosis.csv row with: id, test_id, cluster, test_name, expected, reported, severity, target_files, issue_id, source_context
```

#### 11c. Parallel Diagnosis via spawn_agents_on_csv

```javascript
spawn_agents_on_csv({
  csv_path: `${targetDir}/.tests/.csv-session/diagnosis.csv`,
  id_column: "id",
  instruction: `
    You are a UAT failure diagnostician. Investigate ONE gap cluster.

    ## Task
    - Read all target_files to understand the relevant code
    - Analyze: why does the expected behavior not match what user reported?
    - Find the root cause (not the symptom)
    - Suggest a fix direction (what needs to change, not exact code)
    - List all files that would need modification

    ## Output
    - root_cause: Concise explanation of why the issue occurs
    - fix_direction: Suggested approach to fix (e.g., "Add null check before accessing user.email")
    - affected_files: Semicolon-separated list of files needing changes
    - evidence: file:line references supporting your diagnosis

    ## Rules
    - Do NOT modify any files — diagnosis only
    - Focus on root cause, not symptoms
    - Reference issue_id in your findings for traceability
    - If multiple gaps in same cluster share a root cause, note the shared cause
  `,
  max_concurrency: 5,
  max_runtime_seconds: 1200,
  output_csv_path: `${targetDir}/.tests/.csv-session/diagnosis-results.csv`,
  output_schema: { id, root_cause, fix_direction, affected_files, evidence, error }
})
```

#### 11d. Merge Results

Update `uat.md` gaps with diagnosis:
```yaml
- test: {N}
  truth: "..."
  status: failed
  reason: "..."
  severity: {inferred}
  issue_id: ISS-YYYYMMDD-NNN
  root_cause: "{diagnosed cause}"
  fix_direction: "{suggested approach}"
  affected_files: ["{file1}", "{file2}"]
```

### Step 12: Gap Closure Decision

**If `--auto-fix` or `-y`**: execute gap-fix loop directly.

**Otherwise**: present diagnosis summary and offer options:
```
### Diagnosis Complete

| Gap | Severity | Root Cause | Fix Direction |
|-----|----------|------------|---------------|
| T-3 | major    | Missing null check | Add guard clause |
| T-5 | blocker  | Event not cleaned  | Add cleanup logic |

Options:
1. Auto-fix — Plan and execute fixes, then re-verify
2. Debug deep — $quality-debug per issue
3. Plan fixes — $maestro-plan "--gaps"
4. Manual fix — Address issues yourself
```

| Choice | Action |
|--------|--------|
| 1 / "auto-fix" | Execute gap-fix loop |
| 2 / "debug" | Suggest `$quality-debug "--from-uat {phase}"` |
| 3 / "plan" | Suggest `$maestro-plan "{phase} --gaps"` |
| 4 / "manual" | Done, report results |

**Gap-fix closure loop** (max 2 iterations):
1. `$maestro-plan "{phase} --gaps"` — generate fix tasks from gaps
2. `$maestro-execute "{phase}"` — execute fix tasks
3. `$maestro-verify "{phase}"` — re-verify

**Issue lifecycle sync during loop:**
- Before plan: `registered` → `planning`
- Before execute: `planning` → `executing`
- After re-verify: resolved gaps → `completed` (resolution: "auto-fixed via gap-fix loop"), unresolved → `failed`

If re-verify passes: update uat.md gaps as resolved, report success.
If gaps remain after 2 iterations: report remaining, suggest manual intervention.

### Step 13: Report

```
=== UAT RESULTS ===
Target:      {target}

Smoke Tests: {smoke_count} run, {smoke_pass} passed (if ran)
UAT Tests:   {total} total
  Passed:    {passed}
  Issues:    {issues} ({blocker_count} blockers, {major_count} major)
  Skipped:   {skipped}

Diagnosis:   {diagnosed_count}/{issues} gaps diagnosed
Auto-fix:    {fixed_count} gaps resolved (if ran)

Files:
  {target_dir}/uat.md
  {target_dir}/.tests/test-results.json
  {target_dir}/.tests/coverage-report.json
  {target_dir}/.tests/.csv-session/diagnosis-results.csv (if diagnosed)
```

**Next-step routing:**

| Result | Next Step |
|--------|-----------|
| All passed, no gaps | `$maestro-milestone-audit` |
| Auto-fix ran and succeeded | `$maestro-verify "{phase}"` |
| Auto-fix ran but gaps remain | `$quality-debug "--from-uat {phase}"` |
| Issues found, manual fix needed | `$quality-debug "--from-uat {phase}"` |
| Coverage below threshold | `$quality-auto-test "{phase}"` |
| Need integration tests | `$quality-auto-test "{phase}"` |

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or task target required (no active sessions) | Prompt user for phase number |
| E002 | error | Phase not verified (no verification.json) | Suggest `$maestro-verify` |
| E003 | error | Smoke test failed (app won't start) | Suggest `$quality-debug` |
| W001 | warning | Test scenarios failed | Auto-diagnose, suggest fix options |
| W002 | warning | Coverage below threshold | Suggest `$quality-auto-test` |
</error_codes>

<success_criteria>
- [ ] Target resolved and verification context loaded
- [ ] Quality artifacts loaded (review findings → extra tests, debug root causes → regression tests)
- [ ] Test scenarios designed from user-observable outcomes
- [ ] UAT file created with session persistence
- [ ] Tests presented one at a time, severity inferred (never asked)
- [ ] Issues auto-created in issues.jsonl for all failures
- [ ] Batched writes: on issue, every 5 passes, or completion
- [ ] test-results.json and coverage-report.json written
- [ ] index.json uat fields updated
- [ ] Artifact registered in state.json
- [ ] If issues: diagnosis.csv built, spawn_agents_on_csv executed per gap cluster
- [ ] Gaps updated with root_cause, fix_direction, affected_files
- [ ] Gap-fix loop triggered if --auto-fix (max 2 iterations)
- [ ] Issue lifecycle synced through gap-fix loop
- [ ] Next step routed based on result
</success_criteria>
