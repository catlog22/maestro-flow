---
name: maestro-review
description: Tiered code review via CSV wave pipeline. Decomposes into 6 dimension agents running in parallel, with optional deep-dive aggregation wave. Replaces quality-review command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--level quick|standard|deep] [--dimensions list]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm dimension selection, skip interactive validation, use defaults for level detection.

# Maestro Review (CSV Wave)

## Usage

```bash
$maestro-review "3"
$maestro-review -c 6 "3 --level deep"
$maestro-review -y "3 --dimensions security,performance"
$maestro-review --continue "review-phase3-20260318"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 6)
- `--continue`: Resume existing session

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `review.json` (structured review output)

---

## Overview

Wave-based multi-dimensional code review using `spawn_agents_on_csv`. Decomposes review into independent dimension agents (Wave 1), then aggregates findings into a unified report with verdict (Wave 2).

**Core workflow**: Collect Files → Decompose Dimensions → Parallel Review → Aggregate + Verdict

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CODE REVIEW CSV WAVE WORKFLOW                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Phase 1: Phase Resolution → CSV                                         │
│     ├─ Resolve phase directory from arguments                            │
│     ├─ Collect changed files from task summaries                         │
│     ├─ Auto-detect review level (quick/standard/deep)                    │
│     ├─ Determine active dimensions                                       │
│     ├─ Generate tasks.csv with one row per dimension                     │
│     └─ User validates dimension breakdown (skip if -y)                   │
│                                                                          │
│  Phase 2: Wave Execution Engine                                          │
│     ├─ Wave 1: Dimension Review (parallel)                               │
│     │   ├─ Each dimension agent reviews all changed files                │
│     │   ├─ Agent classifies findings by severity                         │
│     │   ├─ Discoveries shared via board (patterns, conventions)          │
│     │   └─ Results: severity_counts + top_issues per dimension           │
│     ├─ Wave 2: Aggregation + Deep-Dive (if needed)                       │
│     │   ├─ Aggregate all dimension findings                              │
│     │   ├─ If criticals > 0 (standard) or always (deep): deep-dive      │
│     │   ├─ Cross-dimension impact analysis                               │
│     │   └─ Generate verdict: PASS / WARN / BLOCK                        │
│     └─ discoveries.ndjson shared across all waves (append-only)          │
│                                                                          │
│  Phase 3: Results Aggregation                                            │
│     ├─ Export results.csv + review.json                                  │
│     ├─ Generate context.md with all findings                             │
│     ├─ Auto-create issues for qualifying findings                        │
│     ├─ Update phase index.json with review status                        │
│     └─ Display summary with verdict + next steps                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## CSV Schema

### tasks.csv (Master State)

```csv
id,title,description,dimension,changed_files,project_specs,review_level,deps,context_from,wave,status,findings,severity_counts,top_issues,error
"1","Correctness Review","Review all changed files for correctness: logic errors, missing edge cases, incorrect return values, null/undefined handling, off-by-one errors. Classify each finding as critical/high/medium/low with file:line references.","correctness","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","Existing patterns use Result type for error handling","standard","","","1","","","","",""
"2","Security Review","Review all changed files for security vulnerabilities: injection flaws, XSS, CSRF, auth bypass, sensitive data exposure, insecure crypto. Reference OWASP Top 10. Classify each finding.","security","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","Auth uses bcrypt + JWT","standard","","","1","","","","",""
"3","Performance Review","Review all changed files for performance issues: N+1 queries, unnecessary re-renders, memory leaks, blocking operations, unoptimized algorithms.","performance","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","","","","",""
"4","Architecture Review","Review all changed files for architecture issues: layer violations, circular dependencies, inappropriate coupling, missing abstractions, SRP violations.","architecture","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","ESM modules, strict TypeScript","standard","","","1","","","","",""
"5","Maintainability Review","Review all changed files for maintainability: code duplication, overly complex functions, poor naming, missing types, unclear control flow.","maintainability","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","","","","",""
"6","Best Practices Review","Review all changed files for best-practice violations: error handling gaps, missing validation, hardcoded values, deprecated API usage, inconsistent patterns.","best-practices","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","","","1","","","","",""
"7","Aggregate + Deep-Dive","Aggregate all dimension findings. Calculate severity distribution. Determine verdict (PASS/WARN/BLOCK). If critical findings exist, perform deep-dive with cross-file impact analysis.","aggregation","src/auth/login.ts;src/auth/register.ts;src/utils/validation.ts","","standard","1;2;3;4;5;6","1;2;3;4;5;6","2","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed review instructions for this dimension |
| `dimension` | Input | Review dimension: correctness/security/performance/architecture/maintainability/best-practices/aggregation |
| `changed_files` | Input | Semicolon-separated file paths to review |
| `project_specs` | Input | Relevant project specs/conventions context |
| `review_level` | Input | quick/standard/deep — controls depth |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = dimension review, 2 = aggregation) |
| `status` | Output | `pending` → `completed` / `failed` / `skipped` |
| `findings` | Output | Key review findings summary (max 500 chars) |
| `severity_counts` | Output | JSON: `{"critical":N,"high":N,"medium":N,"low":N}` |
| `top_issues` | Output | Top 5 issues with `[severity] description (file:line)` format |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.

---

## Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state — all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable review report | Created in Phase 3 |
| `review.json` | Structured review output for downstream | Created in Phase 3 |

---

## Session Structure

```
.workflow/.csv-wave/review-{phase}-{date}/
├── tasks.csv
├── results.csv
├── discoveries.ndjson
├── context.md
├── review.json
└── wave-{N}.csv (temporary)
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
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 6

// Parse review-specific flags
const levelMatch = $ARGUMENTS.match(/--level\s+(quick|standard|deep)/)
const dimsMatch = $ARGUMENTS.match(/--dimensions\s+([\w,]+)/)

// Clean phase text
const phaseArg = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+|--level\s+\w+|--dimensions\s+[\w,]+/g, '')
  .trim()

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `review-phase${phaseArg}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

---

### Phase 1: Phase Resolution → CSV

**Objective**: Resolve phase, collect changed files, determine review level, generate tasks.csv.

**Decomposition Rules**:

1. **Phase resolution**: Resolve `{phaseArg}` to `.workflow/phases/{NN}-{slug}/`
2. **File collection**: Read `.task/TASK-*.json` → collect all `files[].path` where action != "read"
3. **Level detection**:

| Condition | Level |
|-----------|-------|
| `--level` flag provided | Use explicit level |
| ≤3 changed files | quick |
| 4-19 changed files | standard |
| ≥20 files OR phase marked critical | deep |

4. **Dimension selection**:

| Level | Dimensions |
|-------|------------|
| quick | correctness, security |
| standard | correctness, security, performance, architecture, maintainability, best-practices |
| deep | all 6 + forced deep-dive in aggregation |

If `--dimensions` flag provided, override with explicit list.

5. **Specs loading**: Read `.workflow/specs/` for project conventions (unless `--skip-specs`)

6. **CSV generation**: One row per dimension + one aggregation row.

**Wave computation**: Simple 2-wave — all dimension tasks = wave 1, aggregation = wave 2.

**User validation**: Display task breakdown (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Execute dimension reviews wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Dimension Reviews (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildReviewInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      severity_counts: { type: "string" },
      top_issues: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`

#### Wave 2: Aggregation + Deep-Dive

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps — if all wave 1 tasks failed, skip aggregation
4. Build `prev_context` from wave 1 findings:
   ```
   [Task 1: Correctness Review] Found 2 critical issues: null pointer in login handler...
   [Task 2: Security Review] Found 1 high issue: SQL injection in query builder...
   ...
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute `spawn_agents_on_csv` for aggregation agent
7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`

---

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. Build `review.json`:

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

4. Generate `context.md`:

```markdown
# Code Review Report — Phase {phase}

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

5. **Verdict determination**:

| Condition | Verdict |
|-----------|---------|
| Any critical findings | BLOCK |
| High findings > 3 | BLOCK |
| Any high findings | WARN |
| Medium findings > 5 | WARN |
| Otherwise | PASS |

6. **Issue creation**: Based on level thresholds:

| Level | Create Issues For |
|-------|------------------|
| quick | critical only |
| standard | critical + high |
| deep | critical + high + medium |

7. **Phase index update**: Update `.workflow/phases/{phase}/index.json` with review status.

8. Display summary.

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
| `vulnerability` | `data.location` | `{location, type, severity, cwe}` | Security vulnerability |
| `code_smell` | `data.location` | `{location, type, severity, description}` | Code quality issue |
| `performance_hotspot` | `data.location` | `{location, type, impact}` | Performance issue |
| `architecture_violation` | `data.location` | `{location, rule, description}` | Architecture rule violation |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own review
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"vulnerability","data":{"location":"src/auth/login.ts:42","type":"sql_injection","severity":"critical","cwe":"CWE-89"}}' >> {session_folder}/discoveries.ndjson
```

---

## Error Handling

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| No task summaries found | Abort with error: "No execution results — run execute first" |
| No changed files | Abort with error: "No changed files detected" |
| Dimension agent timeout | Mark as failed, skip dependent aggregation if all failed |
| Aggregation agent failed | Use wave 1 results directly, verdict based on raw counts |
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
6. **Skip on Failure**: If all dimension agents failed, skip aggregation
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
