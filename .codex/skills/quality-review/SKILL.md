---
name: quality-review
description: Use after execution to evaluate code quality across correctness, security, performance, and architecture
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--level quick|standard|deep] [--dimensions list]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Wave-based multi-dimensional code review using `spawn_agents_on_csv`. Decomposes review into independent dimension agents (Wave 1), then aggregates findings into a unified report with verdict (Wave 2).

**Core workflow**: Collect Files -> Spec Compliance Check -> Decompose Dimensions -> Parallel Review -> Aggregate + Verdict

## Spec Compliance Pre-Check
Before dimensional review, verify each task's `convergence.criteria[]` are actually met in the code. UNMET criteria = critical spec-compliance finding that blocks quality review.

## Receiving Review Feedback
When external feedback is received: verify before implementing (reviewer may lack context), technical acknowledgment only (no performative "Great point!"), push back when wrong with evidence, YAGNI check on suggested additions, implement one at a time with testing.

```
+---------------------------------------------------------------------------+
|                    CODE REVIEW CSV WAVE WORKFLOW                           |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Phase Resolution -> CSV                                         |
|     +-- Resolve phase directory from arguments                            |
|     +-- Collect changed files from task summaries                         |
|     +-- Auto-detect review level (quick/standard/deep)                    |
|     +-- Determine active dimensions                                       |
|     +-- Generate tasks.csv with one row per dimension                     |
|     +-- User validates dimension breakdown (skip if -y)                   |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Dimension Review (parallel)                               |
|     |   +-- Each dimension agent reviews all changed files                |
|     |   +-- Agent classifies findings by severity                         |
|     |   +-- Discoveries shared via board (patterns, conventions)          |
|     |   +-- Results: severity_counts + top_issues per dimension           |
|     +-- Wave 2: Aggregation + Deep-Dive (if needed)                       |
|     |   +-- Aggregate all dimension findings                              |
|     |   +-- If criticals > 0 (standard) or always (deep): deep-dive      |
|     |   +-- Cross-dimension impact analysis                               |
|     |   +-- Generate verdict: PASS / WARN / BLOCK                        |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv + review.json                                  |
|     +-- Generate context.md with all findings                             |
|     +-- Auto-create issues for qualifying findings                        |
|     +-- Update phase index.json with review status                        |
|     +-- Display summary with verdict + next steps                         |
|                                                                           |
+---------------------------------------------------------------------------+
```

</purpose>

<context>
```bash
$quality-review "3"
$quality-review -c 6 "3 --level deep"
$quality-review -y "3 --dimensions security,performance"
$quality-review --continue "20260318-review-P3-auth"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 6)
- `--continue [session-id]`: Resume existing session. If session-id provided, load that session directly. If omitted, list available sessions in `.workflow/.csv-wave/` matching `*-review-*` and prompt user to select. Resume reads master `tasks.csv`, skips completed waves, and continues from the next pending wave.
- `--level quick|standard|deep`: Explicit review level (default: auto-detect from file count)
- `--dimensions <list>`: Comma-separated subset of dimensions to review (overrides level defaults)
- `--skip-specs`: Skip loading project specs as review context

When `--yes` or `-y`: Auto-confirm dimension selection, skip interactive validation, use defaults for level detection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `review.json` (structured review output)

**Output boundary**: ALL file writes MUST target `.workflow/.csv-wave/{session-id}/`, `.workflow/state.json`, or `.workflow/issues/issues.jsonl` only. NEVER modify source code or files outside these paths. Review produces reports only — no source modifications.
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,dimension,changed_files,project_specs,review_level,deps,context_from,wave,status
"1","Correctness Review","Review all changed files for correctness: logic errors, missing edge cases, incorrect return values, null/undefined handling, off-by-one errors. Classify each finding as critical/high/medium/low with file:line references.","correctness","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","Existing patterns use Result type for error handling","standard","","","1","pending"
"2","Security Review","Review all changed files for security vulnerabilities: injection flaws, XSS, CSRF, auth bypass, sensitive data exposure, insecure crypto. Reference OWASP Top 10. Classify each finding.","security","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","Auth uses bcrypt + JWT","standard","","","1","pending"
"3","Performance Review","Review all changed files for performance issues: N+1 queries, unnecessary re-renders, memory leaks, blocking operations, unoptimized algorithms.","performance","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","pending"
"4","Architecture Review","Review all changed files for architecture issues: layer violations, circular dependencies, inappropriate coupling, missing abstractions, SRP violations.","architecture","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","ESM modules, strict TypeScript","standard","","","1","pending"
"5","Maintainability Review","Review all changed files for maintainability: code duplication, overly complex functions, poor naming, missing types, unclear control flow.","maintainability","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","pending"
"6","Best Practices Review","Review all changed files for best-practice violations: error handling gaps, missing validation, hardcoded values, deprecated API usage, inconsistent patterns.","best-practices","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","pending"
"7","Aggregate + Deep-Dive","Aggregate all dimension findings. Calculate severity distribution. Determine verdict (PASS/WARN/BLOCK). If critical findings exist, perform deep-dive with cross-file impact analysis.","aggregation","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","1;2;3;4;5;6","1;2;3;4;5;6","2","pending"
```

**Columns**:

| Column | Layer | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed review instructions for this dimension |
| `dimension` | Input | Review dimension: correctness/security/performance/architecture/maintainability/best-practices/aggregation |
| `changed_files` | Input | Semicolon-separated file paths to review |
| `project_specs` | Input | Relevant project specs/conventions context |
| `review_level` | Input | quick/standard/deep -- controls depth |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = dimension review, 2 = aggregation) |
| `status` | Lifecycle | Task lifecycle state in master CSV: `pending` / `completed` / `failed` / `skipped` (initialized to `pending`; updated during merge from `result_status`) |
| `result_status` | Output | `completed` / `failed` (returned via output_schema) |
| `findings` | Output | Key review findings summary (max 500 chars) |
| `severity_counts` | Output | JSON: `{"critical":N,"high":N,"medium":N,"low":N}` |
| `top_issues` | Output | Top 5 issues with `[severity] description (file:line)` format |
| `error` | Output | Error message if failed |

**Column separation rule**: Input columns and Output columns MUST NOT share names. Wave CSV only contains Input columns + prev_context. Output columns are returned exclusively via output_schema.

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after merge |
| `wave-{N}-results.csv` | Per-wave output from spawn_agents_on_csv (temporary) | Created by spawn_agents_on_csv, deleted after merge |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable review report | Created in Phase 3 |
| `review.json` | Structured review output for downstream | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-review-P{N}-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- review.json
+-- wave-{N}.csv (temporary, deleted after merge)
+-- wave-{N}-results.csv (temporary, deleted after merge)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Failure**: If all dimension agents failed, skip aggregation and flag all downstream outputs as LOW CONFIDENCE. Record `degradation_event` in discoveries.ndjson. **Note**: timed-out workers that report `completed` with empty findings are treated as effectively failed for degradation purposes if `severity_counts` is all-zero AND `findings` is empty. This is a defined degradation path, not a violation of invariant 2.
7. **Cleanup Temp Files**: Remove wave-{N}.csv and wave-{N}-results.csv after results are merged
8. **Pipeline continuity**: Continuous execution until all waves complete. When invariant 6 (skip on failure) activates, the pipeline continues in degraded mode.
9. **BLOCK Severity Separation**: Only critical safety issues, syntax errors, or logical bugs may trigger a BLOCK verdict. Code style warnings, formatting changes, and documentation warnings MUST NOT block the pipeline and should be downgraded to WARN.
</invariants>

<execution>

### Session Initialization

Parse `$ARGUMENTS` to extract:
- `AUTO_YES` from `--yes` / `-y`
- `continueMode` from `--continue`
- `maxConcurrency` from `--concurrency N` / `-c N` (default: 6)
- `levelMatch` from `--level quick|standard|deep`
- `dimsMatch` from `--dimensions <list>`
- `phaseArg` = remaining text after stripping all flags

**Resume flow** (when `--continue`):
1. If session-id argument provided: load `.workflow/.csv-wave/{session-id}/tasks.csv` directly
2. If no session-id: scan `.workflow/.csv-wave/*-review-*` directories, list sessions with their status (pending wave counts), prompt user to select
3. Read master `tasks.csv`, identify next pending wave (lowest wave number with `status == "pending"` rows), skip to Phase 2 for that wave
4. If no pending rows remain, skip to Phase 3 (results aggregation)

Session ID: `{YYYYMMDD}-review-P{phaseArg}-{phaseSlug}` (phaseSlug from index.json or roadmap)
Session folder: `.workflow/.csv-wave/{sessionId}/` — create via `mkdir -p`

### Phase 1: Phase Resolution -> CSV

**Objective**: Resolve phase, collect changed files, determine review level, generate tasks.csv.

**Decomposition Rules**:

1. **Phase resolution**: Resolve `{phaseArg}` via `state.json` artifact registry to `.workflow/scratch/{YYYYMMDD}-{type}-{slug}/`
2. **Related session discovery**: Query `state.json.artifacts[]` for matching phase + milestone. Extract prior quality context (verdicts, root causes, UAT gaps) from artifact outputs by type (execute → .summaries/.task/, review → review.json, debug → understanding.md, test → uat.md)
3. **File collection**: Read `.task/TASK-*.json` → collect `files[].path` where action != "read"
4. **Level detection**:

| Condition | Level |
|-----------|-------|
| `--level` flag provided | Use explicit level |
| <=3 changed files | quick |
| 4-19 changed files | standard |
| >=20 files OR phase marked critical | deep |

5. **Dimension selection**:

| Level | Dimensions |
|-------|------------|
| quick | correctness, security |
| standard | correctness, security, performance, architecture, maintainability, best-practices |
| deep | all 6 + forced deep-dive in aggregation |

If `--dimensions` flag provided, override with explicit list.

6. **Specs loading**: Run `maestro load --type spec --category review` to load review standards, checklists, AND discoverable knowhow tools (unless `--skip-specs`). Also run `maestro spec conflict list` to load existing conflict markers (review should prioritize verifying contested entries against code)
7. **CSV generation**: One row per dimension + one aggregation row

**Wave computation**: Simple 2-wave -- all dimension tasks = wave 1, aggregation = wave 2.

**User validation**: Display task breakdown (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Execute dimension reviews wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Dimension Reviews (Parallel)

Filter master `tasks.csv` for `wave == 1 AND status == "pending"` → write `wave-1.csv` (no prev_context needed).

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: REVIEW_DIMENSION_INSTRUCTION,    // see "Dimension Worker Contract" below
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:              { type: "string" },
      result_status:   { type: "string", enum: ["completed", "failed"] },
      findings:        { type: "string", maxLength: 500 },
      severity_counts: { type: "string", description: "JSON object string {critical, high, medium, low}" },
      top_issues:      { type: "string", description: "JSON array string of top issues with file:line" },
      error:           { type: "string" }
    },
    required: ["id", "result_status", "findings"]
  }
})
```

Merge `wave-1-results.csv` into master `tasks.csv` (map `result_status` → master `status` column; copy `findings`, `severity_counts`, `top_issues`, `error`), then delete both `wave-1.csv` and `wave-1-results.csv`.

#### Dimension Worker Contract (REVIEW_DIMENSION_INSTRUCTION)

```
You are a code reviewer for ONE dimension (correctness/security/performance/maintainability/...). Your dimension, scope, and standards come from your CSV row.

REQUIRED STEPS:
  1. Read shared discoveries: {sessionFolder}/discoveries.ndjson
  2. Read specs loaded by orchestrator (review category) for severity calibration
  3. Scan code in scope using Read/Grep/Glob (read-only)
  4. Classify each issue: critical / high / medium / low with file:line refs
  5. Append cross-cutting patterns to discoveries.ndjson
  6. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success → result_status=completed (severity_counts may be all-zero if clean)
  - Timeout → near max_runtime_seconds, STOP and report completed with partial findings
  - Failure → unrecoverable read/parse error → result_status=failed
  - NEVER skip report_agent_job_result.

OUTPUT (must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "findings": "<one-sentence dimension summary, max 500 chars>",
    "severity_counts": "<JSON object string: {critical:N, high:N, medium:N, low:N}>",
    "top_issues": "<JSON array string: [{title, severity, location, recommendation}...]>",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Every issue MUST have a concrete file:line reference. No speculation.
  - Do NOT modify source. This is review only.
  - Do NOT write to tasks.csv, wave-*.csv, results.csv, review.json (orchestrator owns those).
  - Do NOT call spawn_agents_on_csv (no recursion).
```

#### Wave 2: Aggregation + Deep-Dive

Filter master `tasks.csv` for `wave == 2 AND status == "pending"`. If all wave 1 tasks failed, skip aggregation (invariant 6).

Build `prev_context` from wave 1 findings (format: `[Task N: Title] summary...` per task). **Failed-dependency handling**: exclude failed task IDs from prev_context. If SOME wave 1 tasks failed, append gap_note listing missing dimensions so the aggregation agent knows its coverage is incomplete.
Write `wave-2.csv` with `prev_context` column → execute `spawn_agents_on_csv` with `REVIEW_AGGREGATION_INSTRUCTION` (same termination contract; output_schema returns `result_status` enum [completed|failed], findings, plus `verdict` enum [PASS|WARN|BLOCK]) → merge results into master `tasks.csv` (map `result_status` → master `status` column) → delete both `wave-2.csv` and `wave-2-results.csv`.

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

Export master `tasks.csv` as `results.csv`. Build `review.json`:

```json
{
  "phase": "<phase>",
  "level": "<level>",
  "verdict": "PASS|WARN|BLOCK",
  "severity_distribution": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "dimensions": [
    { "dimension": "correctness", "status": "completed", "severity_counts": {...}, "top_issues": [...] }
  ],
  "deep_dive": { "performed": true/false, "iterations": N, "impact_analysis": "..." },
  "issues_created": [],
  "timestamp": "<ISO>"
}
```

Generate `context.md`:

```markdown
# Code Review Report -- Phase {phase}

## Summary
- Level: {level}
- Files reviewed: {file_count}
- Dimensions: {dimension_count}
- Verdict: **{verdict}**

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | {N} |
| High     | {N} |
| Medium   | {N} |
| Low      | {N} |

## Dimension Results
### {dimension_name}
{findings}

**Top Issues:**
{top_issues}

## Deep-Dive Analysis
{if performed: impact analysis results}

## Issues Created
{list of created issue IDs}
```

**Verdict determination**:

| Condition | Verdict |
|-----------|---------|
| Any critical findings | BLOCK |
| High findings > 3 | BLOCK |
| Any high findings | WARN |
| Medium findings > 5 | WARN |
| Otherwise | PASS |

**Side-effect confirmation gate** (skip when `-y/--yes`):
Before writing to external stores, present a summary to the user via `request_user_input`:
- Issues to create (count + severity + titles)
- Phase index update (artifact dir)
- Artifact registration in state.json
The user can approve all, selectively exclude, or skip entirely.

**Issue creation** (approved items only) by level threshold:

| Level | Create Issues For |
|-------|------------------|
| quick | critical only |
| standard | critical + high |
| deep | critical + high + medium |

**Spec conflict check**: If any finding directly contradicts a loaded spec entry (code behavior ≠ spec rule), suggest `maestro spec conflict mark <file> <line> --note "<evidence>"` on the spec entry. Code is the single source of truth. Log spec conflicts in review.json as `spec_conflicts[]`.

**Phase index update** (after confirmation): Update `{artifact_dir}/index.json` with review status.

**Register artifact** (after confirmation): Append to `state.json.artifacts[]` with `type: "review"`, `id: REV-NNN`, `path: "scratch/{YYYYMMDD}-review-P{N}-{slug}"`, `depends_on: exec_art.id`. Output directory is independent scratch, not shared with plan.

Display summary. **Next-step suggestion** (suggest only, NEVER auto-execute): if spec conflicts detected, suggest `maestro spec conflict list` → `$manage-knowledge-audit --scope spec`. The user decides whether to proceed.

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
| `vulnerability` | `data.location` | `{location, type, severity, cwe}` | Security vulnerability |
| `code_smell` | `data.location` | `{location, type, severity, description}` | Code quality issue |
| `performance_hotspot` | `data.location` | `{location, type, impact}` | Performance issue |
| `architecture_violation` | `data.location` | `{location, rule, description}` | Architecture rule violation |

#### Protocol

Read `{session_folder}/discoveries.ndjson` before own review. Deduplicate by type + dedup key before writing. Append-only — never modify or delete.

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"vulnerability","data":{"location":"src/auth/login.ts:42","type":"sql_injection","severity":"critical","cwe":"CWE-89"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| No task summaries found | Abort with error: "No execution results -- run execute first" |
| No changed files | Abort with error: "No changed files detected" |
| Dimension agent timeout | Mark as failed, skip dependent aggregation if all failed |
| Aggregation agent failed | Use wave 1 results directly, verdict based on raw counts |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All dimension reviews executed in parallel (wave 1)
- [ ] Aggregation + deep-dive executed (wave 2)
- [ ] review.json produced with verdict and severity distribution
- [ ] context.md produced with full review report
- [ ] Issues created for qualifying severity findings (after user confirmation in interactive mode; auto in -y mode)
- [ ] Phase index.json updated with review status (after user confirmation in interactive mode; auto in -y mode)
- [ ] discoveries.ndjson append-only throughout
- [ ] Ralph-invoked: `maestro ralph complete <idx> --status {STATUS}` called with correct verdict
</success_criteria>

<ralph_completion>
When invoked as a ralph session step, end by calling the CLI (no standalone report):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```
Status verdicts: **DONE** (normal), **DONE_WITH_CONCERNS** (caveats; pass `--concerns`), **NEEDS_RETRY** (transient error), **BLOCKED** (hard blocker; pass `--reason`).
</ralph_completion>
