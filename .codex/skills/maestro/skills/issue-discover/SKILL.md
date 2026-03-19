---
name: maestro-issue-discover
description: Multi-perspective issue discovery via CSV wave pipeline. 8 parallel perspective agents scan the codebase independently, then a dedup agent aggregates and creates issues. Replaces manage-issue-discover command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"[by-prompt 'what to look for']\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm perspective selection, skip interactive validation, use defaults for scope detection.

# Maestro Issue Discover (CSV Wave)

## Usage

```bash
$maestro-issue-discover
$maestro-issue-discover -c 8 ""
$maestro-issue-discover -y "by-prompt 'error handling gaps in auth module'"
$maestro-issue-discover --continue "discover-multi-20260318"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 8)
- `--continue`: Resume existing session

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + issues appended to `.workflow/issues/issues.jsonl`

---

## Overview

Wave-based multi-perspective issue discovery using `spawn_agents_on_csv`. In default mode, 8 independent perspective agents scan the codebase in parallel (Wave 1), then a single dedup + issue creation agent aggregates all findings (Wave 2). In by-prompt mode, user-defined exploration dimensions replace the 8 fixed perspectives.

**Core workflow**: Parse Mode -> Define Perspectives -> Parallel Scan -> Dedup + Issue Creation

**Dual mode**:
- **Default (no args)**: 8-perspective scan (security, performance, reliability, maintainability, scalability, ux, accessibility, compliance)
- **`by-prompt "..."`**: User-driven exploration decomposed into 3-5 search dimensions

```
+-------------------------------------------------------------------------+
|                 ISSUE DISCOVERY CSV WAVE WORKFLOW                        |
+-------------------------------------------------------------------------+
|                                                                         |
|  Phase 1: Mode Resolution -> CSV                                        |
|     +-- Parse mode from arguments (multi-perspective or by-prompt)       |
|     +-- Validate environment (.workflow/ exists)                         |
|     +-- Initialize discovery session directory                           |
|     +-- [multi] Generate 8 perspective rows + 1 dedup row               |
|     +-- [by-prompt] Decompose prompt into 3-5 dimensions + 1 dedup row  |
|     +-- Determine scope globs per perspective/dimension                  |
|     +-- Generate tasks.csv                                               |
|     +-- User validates perspective breakdown (skip if -y)                |
|                                                                         |
|  Phase 2: Wave Execution Engine                                          |
|     +-- Wave 1: Perspective/Dimension Scan (parallel)                    |
|     |   +-- Each agent scans codebase from its perspective               |
|     |   +-- Agent identifies concrete issues with file:line evidence     |
|     |   +-- Agent rates findings by severity (critical/high/medium/low)  |
|     |   +-- Discoveries shared via board (cross-perspective patterns)    |
|     |   +-- Results: issues_found + severity_distribution per agent      |
|     +-- Wave 2: Dedup + Issue Creation (single agent)                    |
|     |   +-- Aggregates all perspective findings                          |
|     |   +-- Deduplicates by file path + description similarity           |
|     |   +-- Keeps higher-severity duplicate                              |
|     |   +-- Creates issue records (ISS-YYYYMMDD-NNN)                     |
|     |   +-- Appends to issues.jsonl                                      |
|     +-- discoveries.ndjson shared across all waves (append-only)         |
|                                                                         |
|  Phase 3: Results Aggregation                                            |
|     +-- Export results.csv                                               |
|     +-- Generate context.md with all findings                            |
|     +-- Update discovery-state.json                                      |
|     +-- Display summary with breakdown by perspective + severity         |
|     +-- Suggest next steps                                               |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## CSV Schema

### tasks.csv (Master State)

```csv
id,title,description,perspective,scope_glob,deps,context_from,wave,status,findings,issues_found,severity_distribution,error
"1","Security Scan","Scan codebase for security vulnerabilities: authentication bypass, injection flaws, XSS, CSRF, sensitive data exposure, insecure crypto, secrets in code. Rate each finding critical/high/medium/low with file:line references.","security","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"2","Performance Scan","Scan codebase for performance issues: N+1 queries, unbounded loops, missing caching, memory leaks, large payloads, blocking operations, unoptimized algorithms.","performance","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"3","Reliability Scan","Scan codebase for reliability issues: unhandled errors, missing retry logic, race conditions, data integrity gaps, missing graceful degradation, silent failures.","reliability","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"4","Maintainability Scan","Scan codebase for maintainability issues: code duplication, tight coupling, missing abstractions, unclear naming, dead code, overly complex functions.","maintainability","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"5","Scalability Scan","Scan codebase for scalability issues: hardcoded limits, single-threaded bottlenecks, stateful assumptions, schema rigidity, missing pagination.","scalability","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"6","UX Scan","Scan codebase for UX issues: confusing flows, missing user feedback, inconsistent behavior, missing loading states, poor error messages.","ux","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"7","Accessibility Scan","Scan codebase for accessibility issues: missing ARIA labels, keyboard navigation gaps, color contrast problems, missing alt text, focus management issues.","accessibility","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"8","Compliance Scan","Scan codebase for compliance issues: logging gaps, missing audit trails, data retention violations, privacy control gaps, regulatory requirement gaps.","compliance","src/**/*.{ts,tsx,js,jsx}","","","1","","","","",""
"9","Dedup + Issue Creation","Aggregate all perspective findings. Deduplicate by file path + description similarity (keep higher severity). Generate ISS-YYYYMMDD-NNN issue records. Append to .workflow/issues/issues.jsonl.","dedup","","1;2;3;4;5;6;7;8","1;2;3;4;5;6;7;8","2","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed scan instructions for this perspective |
| `perspective` | Input | Scan perspective: security/performance/reliability/maintainability/scalability/ux/accessibility/compliance/dedup |
| `scope_glob` | Input | File scope glob for analysis (e.g., `src/**/*.{ts,tsx}`) |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = perspective scans, 2 = dedup + issue creation) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key scan findings summary (max 500 chars) |
| `issues_found` | Output | JSON array of discovered issues: `[{"title":"...","severity":"critical","description":"...","location":"file:line","fix_direction":"...","affected_components":["..."]}]` |
| `severity_distribution` | Output | JSON: `{"critical":N,"high":N,"medium":N,"low":N}` |
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
| `context.md` | Human-readable discovery report | Created in Phase 3 |
| `discovery-state.json` | Session metadata and progress | Updated throughout |
| `.workflow/issues/issues.jsonl` | Issues appended here | Append-only |

---

## Session Structure

```
.workflow/.csv-wave/discover-{mode}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- discovery-state.json
+-- wave-{N}.csv (temporary)
```

Also writes to:
```
.workflow/issues/discoveries/{SESSION_ID}/
+-- discovery-state.json (copy)
+-- discovery-issues.jsonl
+-- {perspective}-findings.json (per perspective raw output)
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
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 8

// Parse mode
const cleanArgs = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+/g, '')
  .trim()

const isByPrompt = cleanArgs.startsWith('by-prompt')
const userPrompt = isByPrompt
  ? cleanArgs.replace(/^by-prompt\s*/, '').replace(/^['"]|['"]$/g, '').trim()
  : ''
const mode = isByPrompt ? 'by-prompt' : 'multi'

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const timeStr = getUtc8ISOString().substring(11, 19).replace(/:/g, '')
const sessionId = `DBP-${dateStr}-${timeStr}`
const csvSessionId = `discover-${mode}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${csvSessionId}`
const discoveryDir = `.workflow/issues/discoveries/${sessionId}`

Bash(`mkdir -p ${sessionFolder} && mkdir -p ${discoveryDir} && mkdir -p .workflow/issues`)
Bash(`touch .workflow/issues/issues.jsonl`)
```

Initialize `discovery-state.json`:
```json
{
  "id": "{sessionId}",
  "mode": "{mode}",
  "status": "in_progress",
  "started_at": "{ISO}",
  "completed_at": null,
  "perspectives_completed": [],
  "issues_found": 0,
  "issues_deduplicated": 0
}
```

---

### Phase 1: Mode Resolution -> CSV

**Objective**: Determine mode, define perspectives/dimensions, determine scope, generate tasks.csv.

#### Multi-Perspective Mode (default)

**8 fixed perspectives**:

| # | Perspective | Focus | Guiding Question |
|---|-------------|-------|------------------|
| 1 | security | Auth, authz, input validation, secrets, injection | What security vulnerabilities or unsafe patterns exist? |
| 2 | performance | N+1 queries, loops, caching, memory, payloads | What performance bottlenecks or inefficiencies exist? |
| 3 | reliability | Error handling, retry, race conditions, data integrity | What failure modes are unhandled or could cause data loss? |
| 4 | maintainability | Duplication, coupling, abstractions, naming, dead code | What makes this codebase harder to understand or change? |
| 5 | scalability | Hardcoded limits, single-thread, stateful, schema rigidity | What will break or degrade as load/data/users increase? |
| 6 | ux | Confusing flows, feedback, consistency, loading states | What creates friction or confusion for end users? |
| 7 | accessibility | Screen reader, keyboard nav, contrast, ARIA, focus | What barriers exist for users with disabilities? |
| 8 | compliance | Logging, audit trails, retention, privacy, regulatory | What regulatory or policy requirements are not met? |

**CSV generation**: 8 perspective rows (wave 1) + 1 dedup row (wave 2).

**Scope detection**: Default `src/**/*.{ts,tsx,js,jsx}`. Refine by reading `.workflow/project.md` for tech stack hints.

#### By-Prompt Mode

1. Parse `userPrompt` -- if empty, ask user interactively
2. Decompose prompt into 3-5 exploration dimensions (use analysis to break down the user's intent into searchable dimensions)
3. For each dimension: define name, description, search patterns, file patterns, finding criteria
4. Store dimensions in `{discoveryDir}/exploration-plan.json`
5. Generate N dimension rows (wave 1) + 1 dedup row (wave 2)

**Specs loading**: `specs_content = maestro spec load --category execution` -- pass to agents for severity calibration.

**User validation**: Display perspective/dimension breakdown (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Execute perspective scans wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Perspective/Dimension Scans (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildDiscoverInstruction(sessionFolder, discoveryDir, mode),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 900,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      issues_found: { type: "string" },
      severity_distribution: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. For each completed perspective, save raw findings to `{discoveryDir}/{perspective}-findings.json`
8. Update `discovery-state.json`: `perspectives_completed += ["{perspective}"]`
9. Delete `wave-1.csv`

**Perspective scan agent protocol**:
- Scan all source files matching scope_glob
- Identify concrete issues with file:line references
- Rate each finding: critical / high / medium / low
- Provide brief fix direction for each finding
- Report affected_components[]
- Share cross-cutting discoveries via discovery board
- Output issues_found as JSON array + severity_distribution as JSON object

#### Wave 2: Dedup + Issue Creation (Single Agent)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps -- if all wave 1 agents failed, skip dedup
4. Build `prev_context` from wave 1 findings:
   ```
   [Task 1: Security Scan] Found 3 issues: SQL injection in query builder (critical), missing CSRF token (high)...
   [Task 2: Performance Scan] Found 5 issues: N+1 query in user listing (high), missing pagination (medium)...
   ...
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute `spawn_agents_on_csv` for dedup agent
7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`

**Dedup agent protocol**:
- Load all perspective findings from prev_context
- Merge into single list
- Deduplicate:
  - Group findings by affected file path
  - Within each file group, compare descriptions
  - If two findings describe the same issue (>80% overlap or same file:line), keep higher severity
- For each unique finding:
  - Generate ISS-YYYYMMDD-NNN ID (read existing issues.jsonl to avoid collisions)
  - Build issue record with full schema (id, title, status, priority, severity, source, description, fix_direction, context, tags, etc.)
  - Severity-to-priority: critical->1, high->2, medium->3, low->4
  - Set source = "discovery", tags = ["{perspective}"]
- Append all issues to `.workflow/issues/issues.jsonl`
- Append to `{discoveryDir}/discovery-issues.jsonl`
- Report: total issues_found (pre-dedup), issues after dedup, severity_distribution

---

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. **Update discovery-state.json**:

```json
{
  "id": "{sessionId}",
  "mode": "{mode}",
  "status": "completed",
  "started_at": "{ISO}",
  "completed_at": "{ISO}",
  "perspectives_completed": ["security", "performance", ...],
  "issues_found": 42,
  "issues_deduplicated": 31
}
```

4. Copy `discovery-state.json` to `{discoveryDir}/discovery-state.json`

5. **Generate context.md**:

```markdown
# Issue Discovery Report

## Summary
- Session: {sessionId}
- Mode: {mode}
- Perspectives: {perspective_count}
- Raw findings: {issues_found}
- Unique issues: {issues_deduplicated}

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| Security | {N} | {N} | {N} | {N} | {N} |
| Performance | {N} | {N} | {N} | {N} | {N} |
| ... | | | | | |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | {N} |
| High | {N} |
| Medium | {N} |
| Low | {N} |

## Perspective Details
### {perspective_name}
{findings_summary}

**Top Issues:**
{top_issues_list}

## Issues Created
{list of ISS-YYYYMMDD-NNN IDs with titles}
```

6. **Display summary**:

```
====================================================
  DISCOVERY COMPLETE: {sessionId}
  Mode: {mode} ({perspective_count} perspectives)
  Findings: {issues_found} raw, {issues_deduplicated} unique
  Issues created: {issues_deduplicated}
====================================================

BREAKDOWN BY PERSPECTIVE:
  Security:        {count}
  Performance:     {count}
  Reliability:     {count}
  Maintainability: {count}
  Scalability:     {count}
  UX:              {count}
  Accessibility:   {count}
  Compliance:      {count}

BREAKDOWN BY SEVERITY:
  Critical: {count}
  High:     {count}
  Medium:   {count}
  Low:      {count}

Files:
  {session_folder}/results.csv
  {session_folder}/context.md
  {discoveryDir}/discovery-state.json
  {discoveryDir}/discovery-issues.jsonl
  .workflow/issues/issues.jsonl (appended)
```

7. **Next step routing**:

| Result | Suggestion |
|--------|------------|
| Critical issues found | `$maestro-issue "list --severity critical"` -- Review critical issues |
| Issues created | `$maestro-issue "list"` -- View all issues |
| Specific area needs deeper look | `$maestro-issue-discover "by-prompt '...'"` -- Explore deeper |
| Full scan complete | `$maestro-issue "list --source discovery"` -- View discovered issues |

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
| `reliability_risk` | `data.location` | `{location, failure_mode, impact}` | Reliability concern |
| `scalability_limit` | `data.location` | `{location, constraint, threshold}` | Scalability bottleneck |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own scan
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
| `.workflow/` does not exist | Abort: "No project initialized. Run maestro-init first." |
| `by-prompt` with empty prompt | Interactive prompt with suggested options |
| Perspective agent timeout | Mark as failed, continue remaining perspectives |
| All perspective agents failed | Skip dedup, report no findings |
| Dedup agent failed | Use wave 1 results directly, create issues from raw findings |
| issues.jsonl write failure | Retry once, then report error with findings in context.md |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| ID collision in issues.jsonl | Re-read file, recalculate next sequence number |

---

## Core Rules

1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Skip on Failure**: If all perspective agents failed, skip dedup
7. **Evidence Required**: Every finding must have file:line reference -- no speculative issues
8. **Dedup Before Create**: Never append to issues.jsonl without deduplication
9. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
10. **DO NOT STOP**: Continuous execution until all waves complete
