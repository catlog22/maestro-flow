# Test Workflow (UAT)

Validate built features through conversational UAT testing with persistent state, auto-diagnosis via parallel debug agents, and gap-fix closure loop.

User tests, Claude records. One test at a time. Plain text responses.
Severity inferred from natural language -- never ask "how severe is this?"

**Philosophy: Show expected, ask if reality matches.**

Claude presents what SHOULD happen. User confirms or describes what's different.
- "yes" / "y" / "next" / empty / "pass" -> pass
- "skip" / "can't test" / "n/a" -> skipped
- Anything else -> logged as issue, severity inferred

No Pass/Fail buttons. No severity questions. Just: "Here's what should happen. Does it?"

---

### Step 1: Resolve Target

Determine test target from $ARGUMENTS:

**If phase number provided** (e.g., "3"):
- Set `$TARGET_TYPE = "phase"`
- Resolve phase dir:
  ```
  Read .workflow/state.json → state
  artifacts = state.artifacts ?? []
  art = artifacts.find(a => a.type === 'execute' && a.phase === phaseNum)
  IF art:
    PHASE_DIR = ".workflow/" + art.path
  ELSE:
    ERROR "Phase {phaseNum} not found in artifact registry"
  ```
- Load `$PHASE_DIR/index.json` for context

**If scratch task ID provided:**
- Set `$TARGET_TYPE = "scratch"`
- Set `$SCRATCH_DIR = ".workflow/scratch/{id}/"`
- Load `$SCRATCH_DIR/index.json` for context

**If nothing provided:**
- Check for active UAT sessions (see Step 2)
- If none found, prompt user for phase number or scratch task

**Flags:**
- `--smoke` -- Run cold-start smoke tests before UAT
- `--auto-fix` -- Auto-trigger gap-fix loop on failures

Validate target exists and has been verified (verification.json present). (E002)

---

### Step 2: Check Active Sessions

```bash
# Check scratch dirs (resolved via artifact registry) for active UAT sessions
find .workflow/scratch -name "uat.md" -type f 2>/dev/null | head -5
```

Read each file's frontmatter (status, target) and Current Test section.

**If active sessions exist AND no $ARGUMENTS:**

Display inline:
```
## Active UAT Sessions

| # | Target | Status | Current Test | Progress |
|---|--------|--------|--------------|----------|
| 1 | 04-comments | testing | 3. Reply to Comment | 2/6 |
| 2 | quick-fix-nav | testing | 1. Nav Links | 0/4 |

Reply with a number to resume, or provide a phase/task to start new.
```

Wait for user response.
- Number -> resume that session (go to Step 9: Resume From File)
- Phase/task ID -> new session (go to Step 4: Find Testables)

**If active sessions exist AND $ARGUMENTS provided:**
Check if session exists for that target. If yes, offer resume or restart.

**If no active sessions AND no $ARGUMENTS:**
Prompt: "No active UAT sessions. Provide a phase number or scratch task ID to start testing."

**If no active sessions AND $ARGUMENTS:**
Continue to Step 3 or Step 4.

---

### Step 3: Run Smoke Tests (if --smoke)

Skip if --smoke not set.

Inject basic sanity tests BEFORE UAT scenarios:

| Smoke Test | Check | Method |
|------------|-------|--------|
| App starts | Process runs without crash | `bash: start command, check exit code` |
| Routes respond | Key endpoints return non-error | `bash: curl/fetch main routes` |
| Build clean | No build errors | `bash: build command succeeds` |
| Dependencies | No missing deps | `bash: install check` |

Record smoke results in uat.md under `## Smoke Tests` section.
If any smoke test fails: abort UAT, report as blocker, suggest Skill({ skill: "quality-debug" }). (E003)

---

### Step 4: Load Verification Context

Read from target directory:
- verification.json -- must_haves with truth/artifact/wiring status
- validation.json -- requirement-to-test mapping
- index.json -- success_criteria
- plan.json -- task overview
- All `.summaries/TASK-*.md` -- execution results

```bash
ls "$OUTPUT_DIR/.summaries/"*summary*.md 2>/dev/null
```

Build testable list: user-observable outcomes from success_criteria + must_haves + task accomplishments.

---

### Step 5: Design Test Scenarios

For each testable item, create a scenario:
- **id**: T-001, T-002, ...
- **name**: Brief test name
- **category**: "e2e" | "integration" | "unit"
- **expected**: Specific observable behavior (what user should see)
- **requirement_ref**: Which success criterion this covers

Write test-plan.json to `.tests/`:
```json
{
  "target": "{phase or scratch ID}",
  "generated_at": "{ISO timestamp}",
  "tests": [...],
  "coverage": {
    "requirements_mapped": ["SC-001"],
    "requirements_unmapped": ["SC-003"]
  }
}
```

```bash
mkdir -p "$OUTPUT_DIR/.tests"
```

Focus on USER-OBSERVABLE outcomes, not implementation details.
Skip internal/non-observable items (refactors, type changes).

---

### Step 6: Create UAT File

**Archive previous UAT artifacts** before writing:
```
ARCHIVE_TARGETS = ["uat.md"]
IF file exists "$OUTPUT_DIR/uat.md":
  mkdir -p "$OUTPUT_DIR/.history"
  TIMESTAMP = current timestamp formatted as "YYYY-MM-DDTHH-mm-ss"
  mv "$OUTPUT_DIR/uat.md" "$OUTPUT_DIR/.history/uat-${TIMESTAMP}.md"
```

Build test list from test-plan.json. Create file at `$OUTPUT_DIR/uat.md`:

```markdown
---
status: testing
target: {phase slug or scratch ID}
source: [list of summary files]
started: {ISO timestamp}
updated: {ISO timestamp}
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

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

### 2. {Test Name}
expected: {observable behavior}
result: [pending]

...

## Summary

total: {N}
passed: 0
issues: 0
pending: {N}
skipped: 0

## Gaps

[none yet]
```

Proceed to Step 7.

---

### Step 7: Present Test

Present current test to user (one at a time):

Read Current Test section from uat.md.

Display:

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

Wait for user response (plain text, no AskUserQuestion).

---

### Step 8: Process Response

**If response indicates pass:**
- Empty response, "yes", "y", "ok", "pass", "next"

**If response indicates skip:**
- "skip", "can't test", "n/a"

**If response is anything else (issue):**
- Treat as issue description
- Infer severity from description (see Severity Inference section)

For issues, update Tests section:
```yaml
### {N}. {name}
expected: {expected}
result: issue
reported: "{verbatim user response}"
severity: {inferred}
```

Append to Gaps section:
```yaml
- test: {N}
  truth: "{expected behavior}"
  status: failed
  reason: "User reported: {verbatim}"
  severity: {inferred}
  requirement_ref: {if mapped}
```

**Auto-create Issue from UAT Gap:**
```
IF result == "issue":
  mkdir -p ".workflow/issues"
  existing_ids = []
  IF file exists ".workflow/issues/issues.jsonl":
    Read .workflow/issues/issues.jsonl
    Extract all id fields matching today's date prefix ISS-YYYYMMDD-*
    existing_ids = collected IDs

  today = format(now(), "YYYYMMDD")
  counter = max sequence number from existing_ids for today + 1 (start at 1 if none)

  issue_id = "ISS-{today}-{counter padded to 3 digits}"
  issue = {
    id: issue_id,
    title: "UAT: " + test.name + " - " + user_response (truncated to 100 chars),
    status: "registered",
    priority: severity_to_priority(inferred_severity),
    severity: inferred_severity,
    source: "uat",
    phase_ref: TARGET_TYPE == "phase" ? PHASE_NUM : null,
    gap_ref: test.id,
    description: "UAT test failed: " + test.name + ". Expected: " + test.expected + ". Reported: " + user_response,
    fix_direction: "",
    context: { location: "", suggested_fix: "", notes: "requirement_ref: " + test.requirement_ref },
    tags: ["uat"],
    affected_components: [],
    feedback: [],
    issue_history: [],
    created_at: now(),
    updated_at: now(),
    resolved_at: null,
    resolution: null
  }
  Append JSON line to .workflow/issues/issues.jsonl
  gap.issue_id = issue_id   // back-reference in gap YAML entry
```

**Batched writes for efficiency:**
Keep results in memory. Write to file only when:
1. **Issue found** -- Preserve the problem immediately
2. **Session complete** -- Final write before artifacts
3. **Checkpoint** -- Every 5 passed tests (safety net for context reset)

If more tests remain -> Update Current Test, go to Step 7
If no more tests -> Go to Step 10

---

### Step 9: Resume From File

Read the full uat.md file.
Find first test with `result: [pending]`.

Announce progress and continue from pending test.
Update Current Test section with the pending test.
Proceed to Step 7.

---

### Step 10: Complete Session

Update uat.md frontmatter: status -> "complete", updated timestamp.

**Archive previous test result artifacts** before writing:
```
RESULT_TARGETS = ["test-results.json", "coverage-report.json"]
has_existing = false
FOR artifact IN RESULT_TARGETS:
  IF file exists "$OUTPUT_DIR/.tests/${artifact}":
    has_existing = true
    break

IF has_existing:
  mkdir -p "$OUTPUT_DIR/.history"
  TIMESTAMP = current timestamp formatted as "YYYY-MM-DDTHH-mm-ss"
  FOR artifact IN RESULT_TARGETS:
    IF file exists "$OUTPUT_DIR/.tests/${artifact}":
      mv "$OUTPUT_DIR/.tests/${artifact}" "$OUTPUT_DIR/.history/${name}-${TIMESTAMP}.${ext}"
```

Write `.tests/test-results.json`:
```json
{
  "target": "{phase or scratch ID}",
  "completed_at": "{ISO timestamp}",
  "results": [
    { "id": "T-001", "name": "...", "status": "pass|issue|skipped", "details": "..." }
  ],
  "summary": { "total": N, "passed": N, "issues": N, "skipped": N }
}
```

Write `.tests/coverage-report.json`:
```json
{
  "target": "{phase or scratch ID}",
  "generated_at": "{ISO timestamp}",
  "requirements_covered": ["SC-001"],
  "requirements_uncovered": ["SC-003"],
  "coverage_percentage": 66.7
}
```

Update index.json with uat results:
```json
{
  "uat": {
    "status": "passed|gaps_found",
    "test_count": N,
    "passed": N,
    "gaps": [...]
  }
}
```

If issues == 0 -> go to Step 13 (report, all pass).
If issues > 0 -> go to Step 11.

---

### Step 11: Auto-Diagnose

**Spawn parallel debug agents for gap clusters.**

1. **Cluster related gaps**: Group issues by affected component/area.
   - Same file/module -> one cluster
   - Same feature/flow -> one cluster
   - Unrelated -> separate clusters

2. **Spawn one debug agent per cluster** (parallel):

For each cluster, spawn workflow-debugger agent with pre-filled symptoms:
```
Agent({
  subagent_type: "general-purpose",
  description: "Diagnose UAT gap cluster: {cluster_name}",
  prompt: "
    Investigate UAT failures for {target}.

    Gaps in this cluster:
    {gap list with test ID, expected, reported, severity}

    Mode: symptoms_prefilled (no user questions needed)
    Goal: find root cause for each gap

    Search relevant source files, trace the behavior,
    identify why expected != actual.

    Return for each gap:
    - root_cause: what's wrong
    - fix_direction: how to fix
    - affected_files: which files need changes
    - evidence: file:line references
  ",
  run_in_background: false
})
```

3. **Collect results** from all agents.

**Pass issue_ids to debug context:**
```
FOR each cluster:
  cluster.issue_ids = []
  FOR each gap IN cluster.gaps:
    IF gap.issue_id exists:
      cluster.issue_ids.push(gap.issue_id)
  // Include issue_ids in the agent prompt context so debug agents
  // can reference and update the corresponding issues
```

4. **Update uat.md** gaps with diagnosis:
```yaml
- test: {N}
  truth: "..."
  status: failed
  reason: "..."
  severity: {inferred}
  root_cause: "{diagnosed cause}"
  fix_direction: "{suggested approach}"
  affected_files: ["{file1}", "{file2}"]
```

Proceed to Step 12.

---

### Step 12: Gap Closure Decision

If AUTO_FIX is set:
- Skip user prompt, go directly to gap-fix loop.

If AUTO_FIX is not set:
- Present diagnosis summary and offer options:

```
### Diagnosis Complete

| Gap | Severity | Root Cause | Fix Direction |
|-----|----------|------------|---------------|
| T-3 | major    | Missing null check | Add guard clause |
| T-5 | blocker  | Event not cleaned  | Add cleanup logic |

Options:
1. Auto-fix -- Plan and execute fixes, then re-verify
2. Debug deep -- Skill({ skill: "quality-debug" }) per issue
3. Plan fixes -- Skill({ skill: "maestro-plan", args: "{phase} --gaps" })
4. Manual fix -- Address issues yourself
```

| Choice | Action |
|--------|--------|
| 1 / "auto-fix" | Go to gap-fix loop |
| 2 / "debug" | Suggest Skill({ skill: "quality-debug" }) |
| 3 / "plan" | Suggest Skill({ skill: "maestro-plan", args: "{phase} --gaps" }) |
| 4 / "manual" | Done, report results |

**Gap-fix closure loop:**

Execute the loop: plan --gaps -> execute -> re-verify.

1. Run Skill({ skill: "maestro-plan", args: "{phase} --gaps" }) -- generates fix tasks from gaps
2. Run Skill({ skill: "maestro-execute", args: "{phase}" }) -- executes fix tasks
3. Run Skill({ skill: "maestro-verify", args: "{phase}" }) -- re-verify

If re-verify passes: update uat.md gaps as resolved, report success.
If re-verify still has gaps: report remaining gaps, suggest manual intervention.

**Issue lifecycle updates during gap-fix loop:**
```
// Before fix execution: transition issues to planning/executing
FOR each gap IN diagnosed_gaps:
  IF gap.issue_id exists:
    Update issue in .workflow/issues/issues.jsonl:
      status: "registered" -> "planning" (before plan --gaps)
      status: "planning" -> "executing" (before execute)

// After re-verify: update based on result
FOR each gap IN diagnosed_gaps:
  IF gap.issue_id exists:
    IF gap resolved by re-verify:
      Update issue: status -> "completed", resolved_at -> now(), resolution -> "auto-fixed via gap-fix loop"
    ELSE:
      Update issue: status -> "failed", updated_at -> now()
```

**Loop limit**: Maximum 2 iterations to prevent infinite loops.

---

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

Next steps:
  {suggested_next_command}
```

**Next step routing:**

| Result | Suggestion |
|--------|------------|
| All passed, no gaps | Skill({ skill: "maestro-milestone-audit" }) |
| Gaps auto-fixed | Skill({ skill: "maestro-milestone-audit" }) |
| Gaps remain, diagnosed | Skill({ skill: "quality-debug" }) or Skill({ skill: "maestro-plan", args: "--gaps" }) |
| Low coverage | Skill({ skill: "quality-test-gen", args: "{phase}" }) to generate missing tests |

---

## Severity Inference

Infer severity from user's natural language:

| User says | Infer |
|-----------|-------|
| "crashes", "error", "exception", "fails completely", "can't use" | blocker |
| "doesn't work", "nothing happens", "wrong behavior", "broken" | major |
| "works but...", "slow", "weird", "minor issue", "inconsistent" | minor |
| "color", "spacing", "alignment", "looks off", "typo" | cosmetic |

Default to **major** if unclear. Never ask "how severe is this?" -- just infer and move on.
