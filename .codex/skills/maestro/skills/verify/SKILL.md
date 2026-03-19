---
name: maestro-verify
description: Goal-Backward 3-layer verification via CSV wave pipeline. Staged parallel waves check Truths, Artifacts, and Wiring with anti-pattern scan and Nyquist test coverage audit. Replaces maestro-verify command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--skip-tests] [--skip-antipattern]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm check decomposition, skip interactive validation, use defaults for layer detection.

# Maestro Verify (CSV Wave)

## Usage

```bash
$maestro-verify "3"
$maestro-verify -c 4 "3 --skip-tests"
$maestro-verify -y "3 --skip-antipattern"
$maestro-verify --continue "verify-phase3-20260318"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 4)
- `--continue`: Resume existing session

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `verification.json` (structured verification output) + `validation.json` (test coverage output, if Nyquist ran)

---

## Overview

Wave-based 3-layer Goal-Backward verification using `spawn_agents_on_csv`. Decomposes verification into staged parallel checks across three waves: truth + artifact existence (Wave 1), artifact substance + wiring (Wave 2), anti-pattern scan + Nyquist audit (Wave 3).

**Core workflow**: Load Phase Artifacts -> Establish Must-Haves -> Decompose Checks -> Staged Parallel Verification -> Aggregate + Fix Plans

**Core principle**: Task completion != Goal achievement. A task marked complete may contain stubs/placeholders. This verifier checks that goals are actually achieved.

```
+-------------------------------------------------------------------------+
|                  VERIFICATION CSV WAVE WORKFLOW                         |
+-------------------------------------------------------------------------+
|                                                                         |
|  Phase 1: Phase Resolution -> CSV                                       |
|     +-- Resolve phase directory from arguments                          |
|     +-- Load index.json, plan.json, TASK-*.json, summaries              |
|     +-- Establish must-haves (truths, artifacts, key links)             |
|     +-- Decompose into check tasks per layer                            |
|     +-- Assign waves based on layer dependencies                        |
|     +-- Generate tasks.csv with one row per check                       |
|     +-- User validates check breakdown (skip if -y)                     |
|                                                                         |
|  Phase 2: Wave Execution Engine                                         |
|     +-- Wave 1: Truth Checks + Artifact Existence (parallel)            |
|     |   +-- Truth agents verify observable behaviors                    |
|     |   +-- Artifact-exist agents check L1 (file exists on disk)        |
|     |   +-- Discoveries shared via board (gap patterns, stubs)          |
|     |   +-- Results: status + evidence + gaps_found per check           |
|     +-- Wave 2: Artifact Substance + Wiring (parallel)                  |
|     |   +-- Substance agents check L2 (real impl, not stub)             |
|     |   +-- Wiring agents check L3 (imported + used)                    |
|     |   +-- Needs truth context from wave 1                             |
|     |   +-- Results: status + evidence + gaps_found per check           |
|     +-- Wave 3: Anti-Pattern Scan + Nyquist Audit (parallel)            |
|     |   +-- Anti-pattern agent scans modified files (skip if flagged)   |
|     |   +-- Nyquist agent maps requirements to tests (skip if flagged)  |
|     |   +-- Needs artifact context from wave 2                          |
|     |   +-- Results: antipatterns[] + coverage gaps                     |
|     +-- discoveries.ndjson shared across all waves (append-only)        |
|                                                                         |
|  Phase 3: Results Aggregation                                           |
|     +-- Export results.csv                                              |
|     +-- Build verification.json (must_haves, gaps, antipatterns, fixes) |
|     +-- Build validation.json (if Nyquist ran)                          |
|     +-- Generate context.md with all findings                           |
|     +-- Auto-create issues for gaps + blocker anti-patterns             |
|     +-- Generate fix plans (cluster related gaps)                       |
|     +-- Update phase index.json with verification status                |
|     +-- Display summary with next steps                                 |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## CSV Schema

### tasks.csv (Master State)

```csv
id,title,description,layer,phase_dir,check_type,deps,context_from,wave,status,findings,gaps_found,fix_plan,error
"1","Truth: User can see existing messages","Verify observable behavior: user can see existing messages by checking supporting artifacts, API calls, and render logic.","truth",".workflow/phases/03-chat/","observable_behavior","","","1","","","","",""
"2","Truth: User can send new messages","Verify observable behavior: user can send new messages by checking form submission, API POST, and state update.","truth",".workflow/phases/03-chat/","observable_behavior","","","1","","","","",""
"3","Artifact Exists: src/components/Chat.tsx","Check L1 existence: verify file src/components/Chat.tsx exists on disk.","artifact",".workflow/phases/03-chat/","exists","","","1","","","","",""
"4","Artifact Exists: src/api/chat.ts","Check L1 existence: verify file src/api/chat.ts exists on disk.","artifact",".workflow/phases/03-chat/","exists","","","1","","","","",""
"5","Artifact Substance: src/components/Chat.tsx","Check L2 substance: verify src/components/Chat.tsx has real implementation (not stub/placeholder). Minimum logic threshold, no placeholder markers.","artifact",".workflow/phases/03-chat/","substance","3","3","2","","","","",""
"6","Artifact Substance: src/api/chat.ts","Check L2 substance: verify src/api/chat.ts has real implementation (not stub/placeholder).","artifact",".workflow/phases/03-chat/","substance","4","4","2","","","","",""
"7","Wiring: Chat.tsx -> /api/chat","Check L3 wiring: verify Chat.tsx imports and calls /api/chat endpoints. Check import statements and actual usage beyond imports.","wiring",".workflow/phases/03-chat/","import_usage","3;4","3;4","2","","","","",""
"8","Anti-Pattern Scan","Scan all modified files for TODO/FIXME/XXX/HACK, placeholder content, empty returns, log-only functions, hardcoded test data, disabled tests. Categorize as Blocker/Warning/Info.","antipattern",".workflow/phases/03-chat/","pattern_scan","1;2;5;6;7","1;2;5;6;7","3","","","","",""
"9","Nyquist Test Coverage Audit","Map requirements to test files. Classify each as COVERED/PARTIAL/MISSING. Detect test framework, run coverage if available.","nyquist",".workflow/phases/03-chat/","test_coverage","1;2;5;6;7","1;2;5;6;7","3","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short check title |
| `description` | Input | Detailed verification instructions for this check |
| `layer` | Input | Verification layer: truth/artifact/wiring/antipattern/nyquist |
| `phase_dir` | Input | Phase directory path (e.g., `.workflow/phases/03-chat/`) |
| `check_type` | Input | Specific check type: observable_behavior/exists/substance/import_usage/pattern_scan/test_coverage |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = truths + existence, 2 = substance + wiring, 3 = antipattern + nyquist) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key verification findings summary (max 500 chars) |
| `gaps_found` | Output | JSON array of gap descriptions: `[{"id":"GAP-001","type":"missing_feature","severity":"critical","description":"...","fix_direction":"..."}]` |
| `fix_plan` | Output | Suggested fix actions for identified gaps |
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
| `context.md` | Human-readable verification report | Created in Phase 3 |
| `verification.json` | Structured verification output for downstream | Created in Phase 3 |
| `validation.json` | Nyquist test coverage output (if ran) | Created in Phase 3 |

---

## Session Structure

```
.workflow/.csv-wave/verify-{phase}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- verification.json
+-- validation.json (if Nyquist ran)
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
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 4

// Parse verify-specific flags
const skipTests = $ARGUMENTS.includes('--skip-tests')
const skipAntipattern = $ARGUMENTS.includes('--skip-antipattern')

// Clean phase text
const phaseArg = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+|--skip-tests|--skip-antipattern/g, '')
  .trim()

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `verify-phase${phaseArg}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

---

### Phase 1: Phase Resolution -> CSV

**Objective**: Resolve phase, load artifacts, establish must-haves, decompose into check tasks, generate tasks.csv.

**Decomposition Rules**:

1. **Phase resolution**: Resolve `{phaseArg}` to `.workflow/phases/{NN}-{slug}/`
2. **Artifact loading**: Read from phase directory:
   - `index.json` -- success_criteria (ground truth for verification)
   - `plan.json` -- original plan with task_ids
   - All `.task/TASK-{NNN}.json` -- task definitions with convergence.criteria
   - All `.summaries/TASK-{NNN}-summary.md` -- execution results
   - `uat.md` (if exists) -- human UAT gaps to incorporate

3. **Must-have establishment** (priority order):
   - **success_criteria from index.json** -- primary contract
   - **convergence.criteria from task JSON** -- per-task completion criteria
   - **Derived from phase goal** -- fallback: derive 3-7 observable behaviors

4. **Must-have decomposition** into 3 layers:
   - **Truths**: Observable behaviors (e.g., "User can see existing messages")
   - **Artifacts**: Concrete file paths that must exist and be substantive
   - **Key Links**: Critical wiring between artifacts (e.g., "Chat.tsx imports /api/chat")

5. **Check task generation**: For each must-have, generate check rows:

| Layer | Check Types | Wave |
|-------|-------------|------|
| truth | observable_behavior | 1 |
| artifact (exists) | exists | 1 |
| artifact (substance) | substance | 2 |
| wiring | import_usage | 2 |
| antipattern | pattern_scan | 3 (skip if `--skip-antipattern`) |
| nyquist | test_coverage | 3 (skip if `--skip-tests`) |

6. **Wave computation**: Assign waves based on layer dependency chain:
   - Wave 1: truth + artifact/exists (no predecessors, parallel)
   - Wave 2: artifact/substance + wiring (need existence confirmation from wave 1)
   - Wave 3: antipattern + nyquist (need substance/wiring context from wave 2)

7. **Specs loading**: `specs_content = maestro spec load --category validation`

8. **CSV generation**: One row per check task.

**User validation**: Display check breakdown (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Execute verification checks wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Truth Checks + Artifact Existence (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildVerifyInstruction(sessionFolder, "wave1"),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      gaps_found: { type: "string" },
      fix_plan: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`

**Truth check agent protocol**:
- For each truth, identify supporting artifacts
- Check artifact existence and substance indicators
- Check wiring indicators (import/usage grep)
- Determine truth status: VERIFIED / FAILED / UNCERTAIN
- Report gaps for FAILED truths with severity and fix direction

**Artifact existence agent protocol**:
- Check file exists on disk via `ls` or `stat`
- If missing, report gap with severity=critical
- If exists, note file size and basic structure for wave 2

#### Wave 2: Artifact Substance + Wiring (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps -- if all wave 1 existence checks failed for a given artifact, skip substance check
4. Build `prev_context` from wave 1 findings:
   ```
   [Task 1: Truth: User can see messages] VERIFIED - Chat.tsx renders message list from API response
   [Task 3: Artifact Exists: Chat.tsx] completed - file exists, 142 lines
   ...
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute `spawn_agents_on_csv` for substance + wiring agents
7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`

**Substance check agent protocol**:
- Files under ~10 lines of real logic -> STUB
- Contains "placeholder", "coming soon", "TODO: implement" -> STUB
- Real implementation with business logic -> SUBSTANTIVE

**Wiring check agent protocol**:
- `grep -r "import.*{artifact_name}" src/` -- check imported
- `grep -r "{artifact_name}" src/ | grep -v "import"` -- check used beyond import
- Status: WIRED / ORPHANED / NOT_WIRED

#### Wave 3: Anti-Pattern Scan + Nyquist Audit (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 3` AND `status == pending`
3. If `--skip-antipattern`: mark antipattern task as `skipped`
4. If `--skip-tests`: mark nyquist task as `skipped`
5. Build `prev_context` from wave 1 + wave 2 findings
6. Write `wave-3.csv` with `prev_context` column
7. Execute `spawn_agents_on_csv` for remaining tasks
8. Merge results into master `tasks.csv`
9. Delete `wave-3.csv`

**Anti-pattern scan agent protocol**:
- Extract modified files from task summaries
- Scan for: TODO/FIXME/XXX/HACK, placeholder content, empty returns, log-only functions, hardcoded test data, disabled tests
- Categorize: Blocker (prevents goal) / Warning (incomplete) / Info (notable)
- Report as JSON array in gaps_found

**Nyquist audit agent protocol**:
- Detect test framework (jest, vitest, pytest, etc.)
- Map requirements (must-haves) to test files
- Classify: COVERED / PARTIAL / MISSING
- Run coverage command if available
- Report gaps and coverage percentage

---

### Phase 3: Results Aggregation

**Objective**: Generate final results, fix plans, and human-readable report.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. **Aggregate must_haves** from all check results:

```json
{
  "truths": [
    { "claim": "User can see existing messages", "status": "verified", "evidence": "Chat.tsx renders from /api/chat GET" }
  ],
  "artifacts": [
    { "path": "src/components/Chat.tsx", "status": "exists", "substantive": true }
  ],
  "key_links": [
    { "from": "Chat.tsx -> /api/chat", "status": "wired" }
  ]
}
```

4. **Collect all gaps** from all tasks' `gaps_found` columns + UAT gaps (if uat.md exists)
5. **Generate fix plans**: Cluster related gaps -> generate plan per cluster -> order by dependency
6. **Build verification.json**:

```json
{
  "phase": "<phase>",
  "status": "passed|gaps_found|human_needed",
  "verified_at": "<ISO>",
  "verifier": "csv-wave-verifier",
  "must_haves": { "truths": [...], "artifacts": [...], "key_links": [...] },
  "gaps": [...],
  "antipatterns": [...],
  "fix_plans": [...],
  "human_verification": [...],
  "coverage_score": 0.85
}
```

7. **Build validation.json** (if Nyquist ran):

```json
{
  "phase": "<phase>",
  "status": "passed|gaps_found",
  "validated_at": "<ISO>",
  "test_framework": "vitest",
  "coverage": { "statements": 80, "branches": 72, "functions": 85, "lines": 78 },
  "requirement_coverage": [
    { "requirement": "REQ-001", "tests": ["auth.spec.ts"], "status": "covered" }
  ],
  "gaps": [...]
}
```

8. **Generate context.md**:

```markdown
# Verification Report -- Phase {phase}

## Summary
- Truths: {verified}/{total} verified
- Artifacts: {artifact_verified}/{artifact_total} (L1-L3)
- Wiring: {links_wired}/{links_total} key links
- Anti-patterns: {blocker_count} blockers, {warning_count} warnings
- Nyquist: {coverage_pct}% coverage ({skipped|status})

## Overall Status: **{status}**

## Must-Have Truths
### {truth_claim}
Status: {VERIFIED|FAILED|UNCERTAIN}
Evidence: {evidence}

## Artifact Checks
| Path | Exists | Substantive | Wired | Status |
|------|--------|-------------|-------|--------|

## Key Links
| Link | Status | Evidence |

## Gaps
| ID | Type | Severity | Description | Fix Direction |

## Anti-Patterns
| File:Line | Pattern | Severity | Description |

## Fix Plans
### {cluster_name}
Objective: {objective}
Tasks: {task_list}
Issue Refs: {issue_ids}

## Nyquist Coverage
{requirement_coverage_table}
```

9. **Overall status determination**:

| Condition | Status |
|-----------|--------|
| All truths VERIFIED, all artifacts pass L1-L3, all key links WIRED, no blockers | passed |
| Any truth FAILED, artifact MISSING/STUB, key link NOT_WIRED, or blocker found | gaps_found |
| All automated checks pass but human verification items remain | human_needed |

10. **Auto-create issues** from gaps + blocker anti-patterns (same ID generation as verify workflow: ISS-YYYYMMDD-NNN)

11. **Archive previous verification artifacts** before writing to phase directory:
    - If `verification.json` or `validation.json` exists in phase dir, move to `.history/`

12. **Copy output files** to phase directory:
    - `verification.json` -> `{phase_dir}/verification.json`
    - `validation.json` -> `{phase_dir}/validation.json` (if generated)

13. **Update phase index.json** with verification status and timestamps.

14. **Display summary**:

```
=== VERIFICATION RESULTS ===
Phase:         {phase_name}

Goal-Backward: {verified_count}/{total_truths} truths verified
  Artifacts:   {artifact_verified}/{artifact_total} (L1-L3)
  Wiring:      {links_wired}/{links_total} key links
Anti-patterns: {blocker_count} blockers, {warning_count} warnings
Nyquist:       {coverage_pct}% coverage ({SKIPPED|status})

Gaps: {gap_count}
  Critical: {critical_count}
  High:     {high_count}
  Medium:   {medium_count}
  Low:      {low_count}

Fix Plans: {fix_plan_count} generated
Issues Created: {issue_count}
Human Verification: {human_items} items

Files:
  {session_folder}/verification.json
  {session_folder}/validation.json (if generated)
  {phase_dir}/verification.json
  {phase_dir}/validation.json (if generated)
```

15. **Next step routing**:

| Result | Suggestion |
|--------|------------|
| All passed, no gaps | `$maestro-review "{phase}"` for code review |
| Critical gaps found | `$maestro-debug` for investigation |
| Minor gaps only | `$maestro-plan "{phase} --gaps"` -> `$maestro-execute` -> re-run `$maestro-verify` |
| Low test coverage | `$maestro-test-gen "{phase}"` to generate missing tests |
| Human verification needed | `$maestro-test "{phase}"` for interactive UAT |

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
| `verification_gap` | `data.gap_id` | `{gap_id, layer, severity, description}` | Verification gap found |
| `stub_detected` | `data.file` | `{file, line, marker, content}` | Stub/placeholder file detected |
| `broken_wiring` | `data.from+data.to` | `{from, to, expected, actual}` | Broken integration link |
| `antipattern` | `data.location` | `{location, pattern, severity}` | Anti-pattern instance |
| `test_gap` | `data.requirement` | `{requirement, status, suggested_test}` | Missing test coverage |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own check
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"verification_gap","data":{"gap_id":"GAP-001","layer":"truth","severity":"critical","description":"User cannot send messages - form handler is a stub"}}' >> {session_folder}/discoveries.ndjson
```

---

## Error Handling

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| No execution results found | Abort with error: "No completed tasks found -- run execute first" |
| No summaries found | Warn, proceed with task file analysis only |
| No success_criteria in index.json | Derive must-haves from phase goal (fallback) |
| Truth check agent timeout | Mark as failed, continue remaining checks |
| Substance check on missing artifact | Auto-skip (dep failed), mark as skipped |
| Anti-pattern scan disabled | Mark as skipped, note in context.md |
| Nyquist audit disabled | Mark as skipped, note in context.md |
| Test framework not detected | Skip coverage calculation, warn user |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |

---

## Core Rules

1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Failure**: If artifact existence check failed, skip its substance/wiring checks
7. **Respect Skip Flags**: `--skip-tests` and `--skip-antipattern` mark wave 3 tasks as skipped, not removed
8. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
9. **DO NOT STOP**: Continuous execution until all waves complete
10. **Goal-Backward**: Verify goals are achieved, not just tasks completed
