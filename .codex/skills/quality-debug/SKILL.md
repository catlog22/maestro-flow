---
name: quality-debug
description: Use when bugs, test failures, or unexpected behavior need systematic root cause investigation
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"[bug description] [--from-uat <phase>] [--parallel]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based hypothesis-driven debugging using `spawn_agents_on_csv`. Wave 1 explores hypotheses in parallel, Wave 2 attempts fixes on confirmed hypotheses in parallel.

**Core workflow**: Gather Symptoms -> Generate Hypotheses -> Parallel Investigation -> Parallel Fix Attempts -> Unify Results

## Iron Law

**NO FIX PROPOSALS WITHOUT ROOT CAUSE EVIDENCE.** Before proposing any fix, you MUST have reproduced/confirmed the symptom, gathered evidence, and identified the root cause with file:line references.

## Red Flags — These Thoughts Mean STOP
- "Quick fix for now, investigate later" / "I don't fully understand but this might work"
- "The fix is obvious, I don't need to reproduce it" / "Multiple changes at once will be faster"
- "I already know what the problem is" (without evidence)
All mean: **return to evidence gathering**.

## Escalation Rule
After **3 failed hypotheses**, STOP. Summarize failures, question architecture, present to user.

## Backward Tracing
Find where incorrect value appears → trace backward through call chain → fix at source, not symptom.

```
+---------------------------------------------------------------------------+
|                    DEBUG CSV WAVE WORKFLOW                                 |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Input Resolution -> CSV                                         |
|     +-- Parse mode: standalone / --from-uat / --parallel                  |
|     +-- Gather symptoms (interactive) or load UAT gaps (pre-filled)       |
|     +-- Cluster gaps by component (if from-uat)                           |
|     +-- Generate 3-5 hypotheses per cluster/issue                         |
|     +-- Generate tasks.csv with one row per hypothesis                    |
|     +-- User validates hypothesis breakdown (skip if -y)                  |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Hypothesis Investigation (parallel)                       |
|     |   +-- Each agent investigates one hypothesis                        |
|     |   +-- Agent searches code, logs evidence, confirms/refutes          |
|     |   +-- Discoveries shared via board (code patterns, root causes)     |
|     |   +-- Results: evidence_for + evidence_against per hypothesis       |
|     +-- Wave 2: Fix Attempts (parallel, confirmed hypotheses only)        |
|     |   +-- Filter: only hypotheses with status=confirmed from wave 1     |
|     |   +-- Each agent attempts fix for its confirmed root cause          |
|     |   +-- Agent applies fix, runs verification, logs result             |
|     |   +-- Results: fix_applied + verified per fix task                  |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv with all investigation + fix outcomes           |
|     +-- Generate understanding.md with diagnosis summary                        |
|     +-- Update UAT gaps with diagnosis (if --from-uat)                    |
|     +-- Update issues.jsonl with diagnosis results                        |
|     +-- Display summary with next steps                                   |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$quality-debug "Login button throws 500 error on click"
$quality-debug -y "JWT token not refreshed --from-uat 3"
$quality-debug -c 4 "Navigation crash --from-uat 3 --parallel"
$quality-debug -y "--from-auto-test 3"
$quality-debug --continue "20260318-debug-P3-jwt-expiry"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 5)
- `--continue`: Resume existing session
- `--from-uat <phase>`: Load gaps from UAT uat.md as pre-filled symptoms
- `--from-auto-test <phase>`: Load code_defect failures from auto-test report.json as pre-filled symptoms
- `--parallel`: One agent per gap cluster (implies from-uat or from-auto-test)

When `--yes` or `-y`: Auto-confirm hypothesis selection, skip interactive symptom gathering (require bug description in args), use defaults for mode detection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `understanding.md` (human-readable report)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,hypothesis,deps,context_from,wave,status,findings,evidence_for,evidence_against,fix_applied,verified,error
"H1","Null pointer in login handler","Investigate whether login handler crashes due to null user object after failed DB lookup","User object is null when DB returns empty result; login.ts:42 dereferences without null check","","","1","pending","","","","","",""
"H2","Missing error boundary","Investigate whether unhandled promise rejection in auth middleware propagates to 500","Auth middleware catches DB errors but not validation errors; middleware.ts:78 has no catch block","","","1","pending","","","","","",""
"H3","Stale session token","Investigate whether expired session tokens bypass refresh logic","Session refresh only triggers on 403 but server returns 401 for expired tokens; session.ts:15","","","1","pending","","","","","",""
"FIX-H1","Fix null pointer in login","Apply null check before user object dereference in login handler","","H1","H1","2","pending","","","","","",""
"FIX-H3","Fix session token refresh","Update refresh trigger to also handle 401 status codes","","H3","H3","2","pending","","","","","",""
```

**Columns**:

| Column | Layer | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier: `H{N}` for hypotheses (wave 1), `FIX-H{N}` for fixes (wave 2) |
| `title` | Input | Short hypothesis or fix title |
| `description` | Input | Detailed investigation/fix instructions |
| `hypothesis` | Input | The hypothesis being tested (wave 1) or empty (wave 2) |
| `deps` | Input | Semicolon-separated dependency task IDs (wave 2 depends on wave 1) |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Input | Wave number (1 = investigation, 2 = fix attempt) |
| `status` | Lifecycle | `pending` (initial) → `completed`/`failed`/`skipped` (set by merge step from worker's `result_status`) |
| `hypothesis_verdict` | Lifecycle | Wave 1 only: `confirmed`/`refuted`/`inconclusive` (merged from worker output) |
| `fix_result` | Lifecycle | Wave 2 only: `fixed`/`fix_failed` (merged from worker output) |
| `findings` | Lifecycle | Key findings summary (max 500 chars; merged from worker output) |
| `evidence_for` | Lifecycle | Evidence supporting the hypothesis (wave 1; merged) |
| `evidence_against` | Lifecycle | Evidence refuting the hypothesis (wave 1; merged) |
| `fix_applied` | Lifecycle | Description of fix applied (wave 2 only; merged) |
| `verified` | Lifecycle | `true` / `false` — whether fix was verified to work (wave 2 only; merged) |
| `error` | Lifecycle | Error message if failed (merged) |

**Column separation rule**: Wave CSV (input to `spawn_agents_on_csv`) contains Input columns + `prev_context` only. Lifecycle columns are NEVER passed to workers. Workers return Output columns exclusively via `output_schema` — those output column names MUST NOT collide with Input column names. During merge: `result_status` → master `status`; other output columns copied as-is into matching lifecycle columns.

**Initial state**: All rows are written with `status="pending"` and empty lifecycle columns. Each wave selects rows where `wave == N AND status == "pending"` from the master CSV.

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with Input columns + `prev_context` only. Output columns (`result_status`, `findings`, etc.) are NEVER included in wave CSV — they come from `output_schema` in the results CSV.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Deleted after merge |
| `wave-{N}-results.csv` | Per-wave output (temporary) | Deleted after merge into tasks.csv |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `understanding.md` | Human-readable diagnosis report | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-debug-P{N}-{slug}/
+-- tasks.csv              (master state, persisted)
+-- results.csv            (final export, persisted)
+-- discoveries.ndjson     (shared board, persisted)
+-- understanding.md       (diagnosis report, persisted)
+-- wave-{N}.csv           (temporary, deleted after merge)
+-- wave-{N}-results.csv   (temporary, deleted after merge)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Refuted**: Wave 2 fix tasks skip if their hypothesis was refuted or inconclusive
7. **Cleanup Temp Files**: Remove wave-{N}.csv AND wave-{N}-results.csv after results are merged into master tasks.csv
8. **DO NOT STOP**: Continuous execution until all waves complete
</invariants>

<execution>

### Session Initialization

```
Parse from $ARGUMENTS:
  AUTO_YES       ← --yes | -y
  continueMode   ← --continue
  maxConcurrency ← --concurrency | -c N  (default: 5)
  fromUat        ← --from-uat <phase>  (default: null)
  fromAutoTest   ← --from-auto-test <phase>  (default: null)
  parallelMode   ← --parallel
  bugDescription ← remaining text after flag removal

Derive:
  phaseRef       ← fromUat || fromAutoTest || null
  sourceType     ← fromAutoTest ? "auto-test" : fromUat ? "uat" : "standalone"
  slug           ← bugDescription kebab-cased, max 40 chars
  dateStr        ← UTC+8 YYYYMMDD
  sessionId      ← phaseRef ? "{dateStr}-debug-P{phaseRef}-{slug}" : "{dateStr}-debug-{slug}"
  sessionFolder  ← ".workflow/.csv-wave/{sessionId}"

mkdir -p {sessionFolder}
```

### Phase 1: Input Resolution -> CSV

**Objective**: Parse mode, gather symptoms or load UAT gaps, generate hypotheses, build tasks.csv.

**Decomposition Rules**:

1. **Mode detection**:

| Condition | Mode |
|-----------|------|
| `--from-uat` flag present | from-uat (load gaps from uat.md) |
| `--from-auto-test` flag present | from-auto-test (load code_defects from report.json) |
| `--parallel` flag present | parallel (implies from-uat or from-auto-test, one agent per gap cluster) |
| Neither flag | standalone (gather symptoms interactively) |

2. **Related session discovery**: Query `state.json.artifacts[]` for matching phase+milestone. Extract relevant outputs by type: execute -> .summaries/.task/, review -> review.json (guide hypotheses), debug -> understanding.md (avoid re-investigation), test -> uat.md + .tests/auto-test/report.json.

2b. **Load codebase + wiki context** (optional, informs hypothesis generation):
   - If `.workflow/codebase/ARCHITECTURE.md` exists: read module boundaries to scope impact analysis
   - Run `maestro search "<symptom keywords>" --json 2>/dev/null`; if results: check for prior investigations on similar issues
   - Run `maestro spec load --category debug --keyword "<symptom keywords>"`; if tools found: extract known issues, workarounds, and root-cause notes to inform hypotheses
   - All are optional — proceed without if unavailable

3. **Symptom collection**:

| Mode | Source | Action |
|------|--------|--------|
| standalone | User input | Ask 5 questions: expected, actual, errors, timeline, reproduction |
| from-uat | test artifact's uat.md (via registry) | Parse Gaps section, cluster by component |
| from-auto-test | test artifact's `.tests/auto-test/report.json` (via registry) | Parse `failures[]` where `classification == "code_defect"`, cluster by target module |
| parallel | test artifact's uat.md or report.json (via registry) | Same as from-uat/from-auto-test, one investigation per cluster |

**from-auto-test specifics**: Each `code_defect` failure provides: `scenario_id`, `req_ref`, `description`, `expected`, `actual`, `fix_suggestion.file`, `fix_suggestion.line`, `fix_suggestion.direction`. Map these to symptoms: expected=failure.expected, actual=failure.actual, location=fix_suggestion.file:line, context=fix_suggestion.direction.

3. **Hypothesis generation**: Per symptom cluster, analyze affected code and generate 3-5 ranked hypotheses (each becomes a wave 1 row).

4. **Fix task generation**: Pre-generate wave 2 fix row per hypothesis (`deps`/`context_from` -> hypothesis ID). Only executes if hypothesis confirmed.

5. **CSV generation**: Hypothesis rows (wave 1) + fix rows (wave 2).

**Wave computation**: Simple 2-wave -- all hypothesis tasks = wave 1, all fix tasks = wave 2.

**User validation**: Display hypothesis breakdown (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Investigate hypotheses wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Hypothesis Investigation (Parallel)

1. **Extract wave-1 input**: filter master `tasks.csv` rows where `wave == 1 AND status == "pending"` → write `wave-1.csv` containing ONLY input columns (id, title, description, hypothesis, deps, context_from, wave). No lifecycle columns, no prev_context (wave 1 has no upstream).
2. **Execute**:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: WAVE1_INVESTIGATION_INSTRUCTION,  // see "Wave 1 Worker Contract" below
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:                  { type: "string" },
      result_status:       { type: "string", enum: ["completed", "failed"] },
      hypothesis_verdict:  { type: "string", enum: ["confirmed", "refuted", "inconclusive"], description: "Investigation outcome" },
      findings:            { type: "string", maxLength: 500 },
      evidence_for:        { type: "string" },
      evidence_against:    { type: "string" },
      error:               { type: "string" }
    },
    required: ["id", "result_status", "hypothesis_verdict", "findings"]
  }
})
```

3. **Merge**: for each row in `wave-1-results.csv`, look up master row by `id` and write `master.status = result_status`, then copy `hypothesis_verdict`, `findings`, `evidence_for`, `evidence_against`, `error`. Delete `wave-1.csv` and `wave-1-results.csv`.
4. **Wave 2 gating** (read from MASTER `tasks.csv` after merge, NOT from wave-1-results.csv):
   - For each `FIX-H{N}` row: read its `context_from` hypothesis ID (e.g., `H{N}`) from master; if master `H{N}.hypothesis_verdict != "confirmed"`, set `FIX-H{N}.status = "skipped"` (with findings = "upstream hypothesis_verdict={H{N}.hypothesis_verdict}").
   - Only rows where `status == "pending"` proceed to wave 2.

#### Wave 1 Worker Contract (WAVE1_INVESTIGATION_INSTRUCTION)

The literal `instruction` string passed to `spawn_agents_on_csv` MUST include the following contract (substitute `{sessionFolder}` at build time):

```
You are a hypothesis investigation worker. ONE hypothesis row from wave-1.csv is assigned to you.

INPUT (from your CSV row):
  - id, title, hypothesis, description

REQUIRED STEPS:
  1. Read shared discoveries: {sessionFolder}/discoveries.ndjson (may be empty)
  2. Scan codebase for evidence using Read/Grep/Glob (read-only investigation)
  3. Classify the hypothesis based on evidence collected:
     - confirmed   → strong evidence supports the hypothesis (file:line proof) → result_status=completed, hypothesis_verdict=confirmed
     - refuted     → strong evidence contradicts the hypothesis → result_status=completed, hypothesis_verdict=refuted
     - inconclusive → insufficient evidence within time budget; do NOT guess → result_status=completed, hypothesis_verdict=inconclusive
     - failed      → tool error / cannot read files / blocked by environment → result_status=failed
  4. Append discoveries to {sessionFolder}/discoveries.ndjson if reusable (root_cause / hypothesis_evidence types)
  5. Call report_agent_job_result EXACTLY ONCE with the verdict

TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success path  → result_status=completed, hypothesis_verdict = confirmed | refuted, with evidence
  - Timeout path  → if approaching {max_runtime_seconds}, STOP investigation and report result_status=completed, hypothesis_verdict=inconclusive
  - Failure path  → on any unrecoverable error, result_status=failed with error message
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

OUTPUT (return via report_agent_job_result; must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "hypothesis_verdict": "confirmed" | "refuted" | "inconclusive",
    "findings": "<one-sentence summary, max 500 chars>",
    "evidence_for": "<bullet list of file:line refs supporting, or empty>",
    "evidence_against": "<bullet list of file:line refs refuting, or empty>",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Do NOT modify source code. This is investigation only.
  - Do NOT write to tasks.csv, wave-*.csv, or results.csv (orchestrator owns those).
  - Do NOT call spawn_agents_on_csv (no recursion).
```

#### Wave 2: Fix Attempts (Parallel, Confirmed Only)

1. If no master rows have `wave == 2 AND status == "pending"` after gating, skip wave 2 entirely.
2. **Extract wave-2 input**: filter master `tasks.csv` where `wave == 2 AND status == "pending"`. For each row, build `prev_context` by concatenating findings/evidence_for from each ID in `context_from` (read from master). Write `wave-2.csv` with input columns + `prev_context`.
3. **Execute**:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: WAVE2_FIX_INSTRUCTION,  // see "Wave 2 Worker Contract" below
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:            { type: "string" },
      result_status: { type: "string", enum: ["completed", "failed"] },
      fix_result:    { type: "string", enum: ["fixed", "fix_failed"], description: "Fix attempt outcome" },
      findings:      { type: "string", maxLength: 500 },
      fix_applied:   { type: "string" },
      verified:      { type: "string", enum: ["true", "false"] },
      error:         { type: "string" }
    },
    required: ["id", "result_status", "fix_result", "findings", "verified"]
  }
})
```

4. **Merge**: write `master.status = result_status`, copy `fix_result`, `findings`, `fix_applied`, `verified`, `error`. Delete `wave-2.csv` and `wave-2-results.csv`.

#### Wave 2 Worker Contract (WAVE2_FIX_INSTRUCTION)

```
You are a fix worker. ONE confirmed hypothesis row is assigned to you.

INPUT (from your CSV row):
  - id (FIX-H{N}), title, description, prev_context (confirmed evidence from H{N})

REQUIRED STEPS:
  1. Read prev_context — the confirmed root cause evidence
  2. Apply the minimal fix using Edit / Write
  3. Run verification:
     - If project has tests: run the relevant test suite via Bash
     - If no tests: re-read the modified file and confirm the fix matches the planned change
  4. Append discoveries (type=fix_applied) to {sessionFolder}/discoveries.ndjson if reusable
  5. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory):
  - Success path → fix applied AND verified → result_status=completed, fix_result=fixed, verified="true"
  - Partial path → fix applied but verification failed → result_status=completed, fix_result=fix_failed, verified="false"
  - Timeout path → approaching {max_runtime_seconds} with no fix applied → result_status=completed, fix_result=fix_failed with error="timeout"
  - Failure path → cannot apply fix (file missing, parse error, etc.) → result_status=failed
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

OUTPUT (return via report_agent_job_result; must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "fix_result": "fixed" | "fix_failed",
    "findings": "<one-sentence summary of what was changed, max 500 chars>",
    "fix_applied": "<file:line description of the change>",
    "verified": "true" | "false",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Modify ONLY files implicated by prev_context evidence. No drive-by refactors.
  - Do NOT write to tasks.csv, wave-*.csv, or results.csv.
  - Do NOT call spawn_agents_on_csv (no recursion).
```

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Export final `tasks.csv` as `results.csv`

2. **Generate understanding.md**: Debug report with summary (mode, hypothesis/confirmed/fixed/verified counts), per-hypothesis results (hypothesis, evidence for/against, findings, status), per-fix results (fix applied, verified, findings), aggregated root causes, and next steps.

2b. **Debug confidence scoring**:

   Dimensions (4): hypothesis_quality, evidence_completeness, root_cause_isolation, fix_confidence. Factors (weights): evidence_depth(.30), evidence_strength(.25), coverage_breadth(.20), reproduction(.15), consistency(.10). Map to legacy: <40% = low, 40-70% = medium, >70% = high. Append confidence assessment to understanding.md.

3. **UAT update** (if --from-uat): Update `uat.md` gaps with `root_cause`, `fix_direction`, `affected_files` for confirmed hypotheses.

4. **Issue update**: If `issues.jsonl` exists, update matching issues with status `diagnosed`, add `context.suggested_fix` and `context.notes`.

5. **Register artifact** (phase-scoped only): Append to `state.json.artifacts[]` with `type: "debug"`, `id: DBG-NNN`, `depends_on: triggering_review_id || exec_art.id`.

6. **Post-debug Knowledge Inquiry**: Prompt user to capture knowledge when:
   - Recurring root cause pattern detected -> `$spec-add debug`
   - Non-obvious fix strategy used -> `$spec-add learning`
   - Architectural gap identified -> `$spec-add arch`

8. **Next step routing**:

| Result | Suggestion |
|--------|------------|
| All fixes verified | Run tests: `$quality-test "{phase}"` |
| Fixes applied, not verified | Re-execute: `$maestro-execute "{phase}"` |
| Confirmed but no fix | Plan fixes: `$maestro-plan "{phase} --gaps"` |
| All inconclusive | Resume with more context or manual investigation |
| From UAT, all diagnosed | `$quality-test "{phase} --auto-fix"` |

9. Display summary.

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `root_cause` | `data.location` | `{location, cause, severity, confidence_score, confidence_factors}` | Confirmed root cause |
| `hypothesis_evidence` | `data.hypothesis+data.location` | `{hypothesis, location, type, conclusion}` | Evidence for/against hypothesis |
| `affected_component` | `data.component` | `{component, files[], impact}` | Component affected by bug |
| `reproduction_path` | `data.trigger` | `{trigger, steps[], frequency}` | Bug reproduction path |

#### Protocol

Read `discoveries.ndjson` before investigation. Append-only: dedup by type+key before writing, never modify/delete.

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"root_cause","data":{"location":"src/auth/login.ts:42","cause":"null_dereference","severity":"high","confidence":"confirmed"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| No bug description and no --from-uat/--from-auto-test | Abort with error: "Issue description required" |
| UAT file not found for --from-uat phase | Abort with error: "uat.md not found for phase {N}" |
| Auto-test report not found for --from-auto-test phase | Abort with error: "report.json not found for phase {N}" |
| No gaps in UAT file / no code_defects in report | Abort with error: "No failed gaps/defects found" |
| Hypothesis agent timeout | Mark as inconclusive, continue with remaining |
| All hypotheses refuted | Skip wave 2, suggest manual investigation |
| Fix agent timeout | Mark as fix_failed, report partial results |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| Existing debug session found | Offer resume (skip if AUTO_YES) |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] Wave 1 hypotheses investigated in parallel
- [ ] Refuted/inconclusive hypotheses correctly skip wave 2 fix tasks
- [ ] Wave 2 fixes attempted only for confirmed hypotheses
- [ ] understanding.md produced with diagnosis summary
- [ ] Multi-factor confidence scored per hypothesis replacing simple high/medium/low
- [ ] Confidence assessment appended to understanding.md
- [ ] UAT gaps updated (if --from-uat)
- [ ] Issues updated with diagnosis results
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
