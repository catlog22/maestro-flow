---
name: quality-test
description: Conversational UAT with session persistence, auto-diagnosis, and gap-plan closure loop. Interactive testing flow with severity inference and parallel debug agents.
argument-hint: "<phase> [--auto-fix] [--session ID]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

<purpose>
Conversational UAT: present expected behavior one test at a time, user confirms or describes issues. Severity inferred from natural language (never asked). Session persists in `uat.md` across context resets. Failed tests trigger parallel debug agent diagnosis and optional gap-fix closure.

**Philosophy**: Show expected, ask if reality matches.
</purpose>

<context>
$ARGUMENTS -- phase number or scratch task ID, plus optional flags.

**Usage**:

```bash
$quality-test "3"                    # test phase 3
$quality-test "3 --smoke"            # smoke tests first, then UAT
$quality-test "3 --auto-fix"         # auto-trigger gap-fix loop on failures
$quality-test "--session 04-comments"  # resume specific session
```

**Flags**:
- `<phase>`: Phase number or scratch task ID
- `--smoke`: Run cold-start smoke tests before UAT
- `--auto-fix`: Auto-trigger gap-fix loop (plan --gaps -> execute -> re-verify) on failures
- `--session ID`: Resume a specific UAT session

No auto mode -- UAT is inherently interactive. `--auto-fix` only automates gap closure, not test execution.

**Output**: `{target_dir}/uat.md` + `.tests/test-plan.json` + `.tests/test-results.json` + `.tests/coverage-report.json`
</context>

<invariants>
1. **One test at a time** -- never batch-present tests
2. **Never ask severity** -- always infer from natural language
3. **Session persistence** -- uat.md survives context resets, resume from any point
4. **Batched writes** -- minimize file I/O (on issue, every 5 passes, completion)
5. **Gap-fix loop max 2 iterations** -- prevent infinite loops
6. **Agent calls use `run_in_background: false`** for synchronous execution
7. **Auto-create issues** in `.workflow/issues/issues.jsonl` for every failed test
</invariants>

<execution>

### Step 1: Resolve Target

1. Parse `$ARGUMENTS` for phase number, scratch task ID, or flags
2. **Phase mode**: set `PHASE_DIR = .workflow/phases/{NN}-{slug}/`
3. **Scratch mode**: set `SCRATCH_DIR = .workflow/scratch/{id}/`
4. Validate target exists and has `verification.json` -- if missing: **E002**

### Step 2: Check Active Sessions

```bash
find .workflow/phases -name "uat.md" -type f 2>/dev/null | head -5
find .workflow/scratch -name "uat.md" -type f 2>/dev/null | head -5
```

- If active sessions exist and no target specified: display session table, ask user to resume or start new
- If `--session ID` specified: resume that session directly (skip to Step 9)
- If session exists for target: offer resume or restart

### Step 3: Smoke Tests (if --smoke)

Run basic sanity checks (app starts, routes respond, build clean, deps installed).
If any smoke fails: **E003** -- abort, suggest Skill({ skill: "quality-debug" })

### Step 4: Load Verification Context

Read from target directory: verification.json, validation.json, index.json, plan.json, `.summaries/TASK-*.md`. Build testable list from user-observable outcomes.

### Step 5: Design Test Scenarios

Create scenarios from testables (id T-001, name, category, expected behavior, requirement_ref). Focus on USER-OBSERVABLE outcomes. Write `{target_dir}/.tests/test-plan.json`.

### Step 6: Create UAT File

Archive previous `uat.md` to `.history/` if exists.
Write `{target_dir}/uat.md` with frontmatter (status, target, started), Current Test section, Tests section (all pending), Summary counters, empty Gaps section.

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
- "crashes", "error", "fails completely" -> blocker
- "doesn't work", "wrong behavior", "broken" -> major
- "works but...", "slow", "minor issue" -> minor
- "color", "spacing", "typo" -> cosmetic
- Default: major

**On issue**: auto-create issue in `.workflow/issues/issues.jsonl` with back-reference.

**Batched writes**: write to file on issue, every 5 passes, or completion.

If more tests: update Current Test, loop to Step 7.
If done: go to Step 10.

### Step 9: Resume From File

Read `uat.md`, find first `result: [pending]` test, announce progress, continue from there (go to Step 7).

### Step 10: Complete Session

1. Update `uat.md` frontmatter: status -> "complete"
2. Archive previous result artifacts to `.history/`
3. Write `.tests/test-results.json` and `.tests/coverage-report.json`
4. Update `index.json` with UAT results
5. If no issues: go to Step 13
6. If issues found: go to Step 11

### Step 11: Auto-Diagnose

Cluster related gaps by component/area. Spawn one debug Agent per cluster:

```
Agent({
  subagent_type: "general-purpose",
  description: "Diagnose UAT gap cluster: {cluster_name}",
  prompt: "Investigate UAT failures. Gaps: {gap list}. Find root cause, fix direction, affected files, evidence (file:line).",
  run_in_background: false
})
```

Update `uat.md` gaps with diagnosis results (root_cause, fix_direction, affected_files).

### Step 12: Gap Closure Decision

**If `--auto-fix`**: execute gap-fix loop directly.

**Otherwise**: present diagnosis summary and offer options:
1. Auto-fix (plan --gaps -> execute -> re-verify, max 2 iterations)
2. Debug deep -- Skill({ skill: "quality-debug" })
3. Plan fixes -- Skill({ skill: "maestro-plan", args: "--gaps" })
4. Manual fix

Update issue lifecycle during gap-fix loop (registered -> planning -> executing -> completed/failed).

### Step 13: Report

```
=== UAT RESULTS ===
Target:      {target}
Smoke Tests: {smoke_count} run, {smoke_pass} passed
UAT Tests:   {total} total
  Passed:    {passed}
  Issues:    {issues} ({blocker_count} blockers, {major_count} major)
  Skipped:   {skipped}
Diagnosis:   {diagnosed_count}/{issues} gaps diagnosed
Auto-fix:    {fixed_count} gaps resolved

Next steps:
  {suggested_next_command}
```
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase or task target required | Prompt user for phase number |
| E002 | error | Phase not verified (no verification.json) | Suggest Skill({ skill: "maestro-verify" }) |
| E003 | error | Smoke test failed (app won't start) | Suggest Skill({ skill: "quality-debug" }) |
| W001 | warning | Test scenarios failed | Auto-diagnose, suggest fix options |
| W002 | warning | Coverage below threshold | Suggest Skill({ skill: "quality-test-gen" }) |
</error_codes>

<success_criteria>
- [ ] Target resolved and verification context loaded
- [ ] Test scenarios designed from user-observable outcomes
- [ ] UAT file created with session persistence
- [ ] Tests presented one at a time, severity inferred (never asked)
- [ ] Issues auto-created for all failures
- [ ] Diagnosis completed for failed test clusters
- [ ] Gap closure offered (auto-fix or manual options)
- [ ] Final report with pass/fail counts and next steps
</success_criteria>
