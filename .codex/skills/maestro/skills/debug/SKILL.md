---
name: maestro-debug
description: Hypothesis-driven debugging via CSV wave pipeline. Wave 1 generates parallel hypotheses, Wave 2 attempts parallel fixes on confirmed hypotheses. Replaces quality-debug command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"[bug description] [--from-uat <phase>] [--parallel]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm hypothesis selection, skip interactive symptom gathering (require bug description in args), use defaults for mode detection.

# Maestro Debug (CSV Wave)

## Usage

```bash
$maestro-debug "Login button throws 500 error on click"
$maestro-debug -y "JWT token not refreshed --from-uat 3"
$maestro-debug -c 4 "Navigation crash --from-uat 3 --parallel"
$maestro-debug --continue "debug-jwt-expiry-20260318"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 5)
- `--continue`: Resume existing session

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report)

---

## Overview

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

---

## CSV Schema

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
| `verified` | Output | `true` / `false` — whether fix was verified to work (wave 2 only) |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.

---

## Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable diagnosis report | Created in Phase 3 |

---

## Session Structure

```
.workflow/.csv-wave/debug-{slug}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- wave-{N}.csv (temporary)
```

---

## Implementation

### Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue')
const concurrencyMatch = $ARGUMENTS.match(/(?:--concurrency|-c)\s+(\d+)/)
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 5

// Parse debug-specific flags
const fromUatMatch = $ARGUMENTS.match(/--from-uat\s+(\S+)/)
const parallelMode = $ARGUMENTS.includes('--parallel')

// Clean bug description
const bugDescription = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+|--from-uat\s+\S+|--parallel/g, '')
  .trim()

const slug = bugDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40)
const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `debug-${slug}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

---

### Phase 1: Input Resolution -> CSV

**Objective**: Parse mode, gather symptoms or load UAT gaps, generate hypotheses, build tasks.csv.

**Decomposition Rules**:

1. **Mode detection**:

| Condition | Mode |
|-----------|------|
| `--from-uat` flag present | from-uat (load gaps from uat.md) |
| `--parallel` flag present | parallel (implies from-uat, one agent per gap cluster) |
| Neither flag | standalone (gather symptoms interactively) |

2. **Symptom collection**:

| Mode | Source | Action |
|------|--------|--------|
| standalone | User input | Ask 5 questions: expected, actual, errors, timeline, reproduction |
| from-uat | `{phase_dir}/uat.md` | Parse Gaps section, cluster by component |
| parallel | `{phase_dir}/uat.md` | Same as from-uat, one investigation per cluster |

3. **Hypothesis generation**: For each symptom cluster or bug description:
   - Analyze code patterns around affected area
   - Generate 3-5 ranked hypotheses
   - Each hypothesis becomes a wave 1 CSV row

4. **Fix task generation**: For each hypothesis, pre-generate a wave 2 fix row:
   - `deps` points to the hypothesis ID
   - `context_from` points to the hypothesis ID
   - Wave 2 tasks only execute if their hypothesis is confirmed

5. **CSV generation**: Hypothesis rows (wave 1) + fix rows (wave 2).

**Wave computation**: Simple 2-wave -- all hypothesis tasks = wave 1, all fix tasks = wave 2.

**User validation**: Display hypothesis breakdown (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Investigate hypotheses wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Hypothesis Investigation (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildInvestigationInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["confirmed", "refuted", "inconclusive", "failed"] },
      findings: { type: "string" },
      evidence_for: { type: "string" },
      evidence_against: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`
8. **Filter for wave 2**: Mark wave 2 fix tasks as `skipped` if their hypothesis was `refuted` or `inconclusive`

#### Wave 2: Fix Attempts (Parallel, Confirmed Only)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending` (not skipped)
3. If no confirmed hypotheses, skip wave 2 entirely
4. Build `prev_context` from wave 1 findings:
   ```
   [H1: Null pointer in login handler] CONFIRMED: User object null when DB returns empty...
   [H3: Stale session token] CONFIRMED: Refresh logic only handles 403, not 401...
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildFixInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 900,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["fixed", "fix_failed", "failed"] },
      findings: { type: "string" },
      fix_applied: { type: "string" },
      verified: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`

---

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. Generate `context.md`:

```markdown
# Debug Report -- {bug_description}

## Summary
- Mode: {standalone | from-uat | parallel}
- Hypotheses: {total} investigated
- Confirmed: {confirmed_count}
- Fixes applied: {fixed_count}
- Fixes verified: {verified_count}

## Hypothesis Results

### H{N}: {title} [{status}]
**Hypothesis**: {hypothesis}
**Evidence For**: {evidence_for}
**Evidence Against**: {evidence_against}
**Findings**: {findings}

## Fix Results

### FIX-H{N}: {title} [{status}]
**Fix Applied**: {fix_applied}
**Verified**: {verified}
**Findings**: {findings}

## Root Causes
{aggregated confirmed hypotheses with evidence}

## Next Steps
{suggested actions based on results}
```

4. **UAT update** (if --from-uat): For each confirmed hypothesis with fix:
   - Update `{phase_dir}/uat.md` gaps with `root_cause`, `fix_direction`, `affected_files`

5. **Issue update**: If `.workflow/issues/issues.jsonl` exists:
   - Update matching issues with status `diagnosed`, add `context.suggested_fix` and `context.notes`

6. **Next step routing**:

| Result | Suggestion |
|--------|------------|
| All fixes verified | Run tests: `Skill({ skill: "quality-test", args: "{phase}" })` |
| Fixes applied, not verified | Re-verify: `Skill({ skill: "maestro-verify", args: "{phase}" })` |
| Confirmed but no fix | Plan fixes: `Skill({ skill: "maestro-plan", args: "{phase} --gaps" })` |
| All inconclusive | Resume with more context or manual investigation |
| From UAT, all diagnosed | `Skill({ skill: "quality-test", args: "{phase} --auto-fix" })` |

7. Display summary.

---

## Shared Discovery Board Protocol

### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `root_cause` | `data.location` | `{location, cause, severity, confidence}` | Confirmed root cause |
| `hypothesis_evidence` | `data.hypothesis+data.location` | `{hypothesis, location, type, conclusion}` | Evidence for/against hypothesis |
| `affected_component` | `data.component` | `{component, files[], impact}` | Component affected by bug |
| `reproduction_path` | `data.trigger` | `{trigger, steps[], frequency}` | Bug reproduction path |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own investigation
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"root_cause","data":{"location":"src/auth/login.ts:42","cause":"null_dereference","severity":"high","confidence":"confirmed"}}' >> {session_folder}/discoveries.ndjson
```

---

## Error Handling

| Error | Resolution |
|-------|------------|
| No bug description and no --from-uat | Abort with error: "Issue description required" |
| UAT file not found for --from-uat phase | Abort with error: "uat.md not found for phase {N}" |
| No gaps in UAT file | Abort with error: "No failed gaps found in uat.md" |
| Hypothesis agent timeout | Mark as inconclusive, continue with remaining |
| All hypotheses refuted | Skip wave 2, suggest manual investigation |
| Fix agent timeout | Mark as fix_failed, report partial results |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| Existing debug session found | Offer resume (skip if AUTO_YES) |

---

## Core Rules

1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Refuted**: Wave 2 fix tasks skip if their hypothesis was refuted or inconclusive
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
