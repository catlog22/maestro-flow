---
name: quality-debug
description: Hypothesis-driven debugging via CSV wave pipeline. Wave 1 generates parallel hypotheses, Wave 2 attempts parallel fixes on confirmed hypotheses. Replaces quality-debug command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"[bug description] [--from-uat <phase>] [--parallel]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based hypothesis-driven debugging using `spawn_agents_on_csv`. Wave 1 explores hypotheses in parallel, Wave 2 attempts fixes on confirmed hypotheses in parallel.

**Core workflow**: Gather Symptoms -> Generate Hypotheses -> Parallel Investigation -> Parallel Fix Attempts -> Unify Results

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
|     +-- Generate context.md with diagnosis summary                        |
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
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,hypothesis,evidence_for,evidence_against,deps,context_from,wave,status,findings,fix_applied,verified,error
"H1","Null pointer in login handler","Investigate whether login handler crashes due to null user object after failed DB lookup","User object is null when DB returns empty result; login.ts:42 dereferences without null check","","","","","1","","","","",""
"H2","Missing error boundary","Investigate whether unhandled promise rejection in auth middleware propagates to 500","Auth middleware catches DB errors but not validation errors; middleware.ts:78 has no catch block","","","","","1","","","","",""
"H3","Stale session token","Investigate whether expired session tokens bypass refresh logic","Session refresh only triggers on 403 but server returns 401 for expired tokens; session.ts:15","","","","","1","","","","",""
"FIX-H1","Fix null pointer in login","Apply null check before user object dereference in login handler","","","","H1","H1","2","","","","",""
"FIX-H3","Fix session token refresh","Update refresh trigger to also handle 401 status codes","","","","H3","H3","2","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier: `H{N}` for hypotheses (wave 1), `FIX-H{N}` for fixes (wave 2) |
| `title` | Input | Short hypothesis or fix title |
| `description` | Input | Detailed investigation/fix instructions |
| `hypothesis` | Input | The hypothesis being tested (wave 1) or empty (wave 2) |
| `evidence_for` | Output | Evidence supporting the hypothesis |
| `evidence_against` | Output | Evidence refuting the hypothesis |
| `deps` | Input | Semicolon-separated dependency task IDs (wave 2 depends on wave 1) |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = investigation, 2 = fix attempt) |
| `status` | Output | `pending` -> `confirmed` / `refuted` / `inconclusive` / `fixed` / `fix_failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `fix_applied` | Output | Description of fix applied (wave 2 only) |
| `verified` | Output | `true` / `false` -- whether fix was verified to work (wave 2 only) |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable diagnosis report | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-debug-P{N}-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- wave-{N}.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Refuted**: Wave 2 fix tasks skip if their hypothesis was refuted or inconclusive
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
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

1. Extract wave 1 pending rows from master `tasks.csv` into `wave-1.csv` (no prev_context needed)
2. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildInvestigationInstruction(sessionFolder),
  max_concurrency: maxConcurrency, max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: [confirmed|refuted|inconclusive|failed], findings, evidence_for, evidence_against, error }
})
```

3. Merge results into master `tasks.csv`, delete `wave-1.csv`
4. **Filter for wave 2**: Mark fix tasks as `skipped` if their hypothesis was `refuted` or `inconclusive`

#### Wave 2: Fix Attempts (Parallel, Confirmed Only)

1. If no confirmed hypotheses remain, skip wave 2 entirely
2. Extract wave 2 pending rows, build `prev_context` from confirmed wave 1 findings
3. Write `wave-2.csv`, then execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildFixInstruction(sessionFolder),
  max_concurrency: maxConcurrency, max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { id, status: [fixed|fix_failed|failed], findings, fix_applied, verified, error }
})
```

4. Merge results into master `tasks.csv`, delete `wave-2.csv`

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Export final `tasks.csv` as `results.csv`

2. **Generate context.md**: Debug report with summary (mode, hypothesis/confirmed/fixed/verified counts), per-hypothesis results (hypothesis, evidence for/against, findings, status), per-fix results (fix applied, verified, findings), aggregated root causes, and next steps.

3. **UAT update** (if --from-uat): Update `uat.md` gaps with `root_cause`, `fix_direction`, `affected_files` for confirmed hypotheses.

4. **Issue update**: If `issues.jsonl` exists, update matching issues with status `diagnosed`, add `context.suggested_fix` and `context.notes`.

5. **Register artifact** (phase-scoped only): Append to `state.json.artifacts[]` with `type: "debug"`, `id: DBG-NNN`, `depends_on: triggering_review_id || exec_art.id`.

6. **Post-debug Knowledge Inquiry**: Prompt user to capture knowledge when:
   - Recurring root cause pattern detected -> `/spec-add debug`
   - Non-obvious fix strategy used -> `/spec-add learning`
   - Architectural gap identified -> `/spec-add arch`

8. **Next step routing**:

| Result | Suggestion |
|--------|------------|
| All fixes verified | Run tests: `Skill({ skill: "quality-test", args: "{phase}" })` |
| Fixes applied, not verified | Re-verify: `Skill({ skill: "maestro-verify", args: "{phase}" })` |
| Confirmed but no fix | Plan fixes: `Skill({ skill: "maestro-plan", args: "{phase} --gaps" })` |
| All inconclusive | Resume with more context or manual investigation |
| From UAT, all diagnosed | `Skill({ skill: "quality-test", args: "{phase} --auto-fix" })` |

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
| `root_cause` | `data.location` | `{location, cause, severity, confidence}` | Confirmed root cause |
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
- [ ] context.md produced with diagnosis summary
- [ ] UAT gaps updated (if --from-uat)
- [ ] Issues updated with diagnosis results
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
