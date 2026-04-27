---
name: maestro-analyze
description: Multi-dimensional analysis via CSV wave pipeline. Diamond topology — CLI exploration agents (Wave 1), 6-dimension scoring agents (Wave 2), decision synthesis agent (Wave 3). Supports dual depth with -q quick mode and --gaps issue root cause analysis. Replaces maestro-analyze command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase|topic> [-q|--quick] [--gaps [ISS-ID]]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based multi-dimensional analysis using `spawn_agents_on_csv`. Diamond topology: CLI exploration agents gather codebase context (Wave 1), 6-dimension scoring agents evaluate in parallel (Wave 2), then decision synthesis agent compiles final decisions and context.md (Wave 3).

**Core workflow**: Parse Subject -> CLI Exploration -> 6-Dimension Scoring -> Decision Synthesis

**Tri-depth**: Full mode (all 3 waves), Quick mode (`-q`, Wave 3 only), or Gaps mode (`--gaps`, issue root cause analysis pipeline).

```
+---------------------------------------------------------------------------+
|                    ANALYZE CSV WAVE WORKFLOW                               |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Subject Resolution -> CSV                                       |
|     +-- Parse phase number or topic text from arguments                   |
|     +-- Detect mode (phase / scratch) and depth (full / quick)            |
|     +-- Resolve output directory                                          |
|     +-- Load prior context (project.md, roadmap, brainstorm artifacts)    |
|     +-- Select dimensions and perspectives (interactive or auto)          |
|     +-- Generate tasks.csv with exploration + scoring + synthesis rows     |
|     +-- User validates dimension breakdown (skip if -y)                   |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: CLI Exploration (parallel) [SKIP in -q mode]              |
|     |   +-- Each agent explores codebase for a specific dimension         |
|     |   +-- 3-layer exploration: module discovery, structure tracing,      |
|     |   |   code anchor extraction                                        |
|     |   +-- Discoveries shared via board (code patterns, tech stack)       |
|     |   +-- Results: findings + relevant file paths per dimension          |
|     +-- Wave 2: 6-Dimension Scoring (parallel) [SKIP in -q mode]          |
|     |   +-- Each agent scores one dimension (1-5) with evidence           |
|     |   +-- Receives exploration findings via prev_context                |
|     |   +-- Discoveries shared via board (risks, alternatives)            |
|     |   +-- Results: score + recommendations per dimension                |
|     +-- Wave 3: Decision Synthesis (single agent)                         |
|     |   +-- Compile all scores into analysis.md                           |
|     |   +-- Identify gray areas, generate Locked/Free/Deferred decisions  |
|     |   +-- Build context.md for downstream plan                          |
|     |   +-- Go/No-Go recommendation with confidence level                 |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv + analysis.md + context.md                     |
|     +-- Generate conclusions.json with decision trail                     |
|     +-- Auto-create issues for deferred items                             |
|     +-- Update phase index.json with analysis status                      |
|     +-- Display summary with verdict + next steps                         |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$maestro-analyze "3"
$maestro-analyze -y "microservices vs monolith"
$maestro-analyze -c 6 "3 -q"
$maestro-analyze --continue "20260318-analyze-microservices"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 6)
- `--continue`: Resume existing session
- `-q, --quick`: Quick mode -- skip exploration + scoring, go straight to decision extraction (Wave 3 only)
- `--gaps [ISS-ID]`: Issue root cause analysis mode. If ISS-ID provided, analyze single issue. If omitted, analyze all open/registered issues from issues.jsonl. Replaces manage-issue-analyze.

When `--yes` or `-y`: Auto-confirm dimension selection, skip interactive scoping, use defaults for perspectives and depth, auto-deepen for up to 3 rounds.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (decision extraction report) + `analysis.md` (6-dimension scoring summary)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,dimension,analysis_type,deps,context_from,wave,status,findings,score,recommendations,error
"1","Explore: Architecture","Explore codebase for architecture-relevant patterns: module boundaries, dependency graph, layer violations, design patterns in use. 3-layer exploration: module discovery, structure tracing, code anchor extraction.","architecture","explore","","","1","","","","",""
"2","Explore: Implementation","Explore codebase for implementation patterns: code structure, error handling, algorithm choices, type safety. Extract code anchors with file:line references.","implementation","explore","","","1","","","","",""
"3","Explore: Performance","Explore codebase for performance characteristics: hot paths, resource utilization, concurrency patterns, potential bottlenecks.","performance","explore","","","1","","","","",""
"4","Score: Feasibility","Score feasibility (0-100) with evidence: technical difficulty, team capability gaps, time estimate, tooling requirements. Reference exploration findings.","feasibility","score","1;2;3","1;2;3","2","","","","",""
"5","Score: Impact","Score impact (0-100) with evidence: user value, business value, tech debt reduction, developer experience improvement.","impact","score","1;2;3","1;2;3","2","","","","",""
"6","Score: Risk","Score risk (0-100) with evidence: failure modes, security concerns, scalability limits, regression potential. Build probability-impact matrix.","risk","score","1;2;3","1;2;3","2","","","","",""
"7","Score: Complexity","Score complexity (0-100) with evidence: integration points, dependency count, learning curve, testing difficulty.","complexity","score","1;2;3","1;2;3","2","","","","",""
"8","Score: Alignment","Score alignment (0-100) with evidence: project vision fit, roadmap consistency, architecture principle adherence.","alignment","score","1;2;3","1;2;3","2","","","","",""
"9","Score: Maintainability","Score maintainability (0-100) with evidence: code clarity, documentation coverage, test coverage, refactoring safety.","maintainability","score","1;2;3","1;2;3","2","","","","",""
"10","Decision Synthesis","Compile all dimension scores into analysis.md. Identify gray areas. Generate Locked/Free/Deferred decisions for context.md. Formulate Go/No-Go recommendation with confidence. Build conclusions.json.","synthesis","decide","4;5;6;7;8;9","4;5;6;7;8;9","3","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed analysis instructions for this task |
| `dimension` | Input | Analysis dimension: architecture/implementation/performance/feasibility/impact/risk/complexity/alignment/maintainability/synthesis |
| `analysis_type` | Input | Task type: explore/score/decide |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = explore, 2 = score, 3 = decide) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `score` | Output | Dimension score (0-100 for scoring tasks, empty for explore/decide) |
| `recommendations` | Output | Dimension-specific recommendations |
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
| `context.md` | Locked/Free/Deferred decisions for downstream plan | Created in Phase 3 |
| `analysis.md` | 6-dimension scoring summary + risk matrix + Go/No-Go | Created in Phase 3 (full mode only) |
| `conclusions.json` | Structured conclusions with decision trail | Created in Phase 3 (full mode only) |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-analyze-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- analysis.md
+-- conclusions.json
+-- wave-{N}.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Quick Mode Shortcut**: With -q flag, generate only wave 3 task, skip exploration and scoring
6b. **Gaps Mode Pipeline**: With --gaps flag, load issues, explore per issue, write analysis records back to issues.jsonl, output context.md for plan --gaps
7. **Skip on Failure**: Degrade gracefully -- missing exploration reduces scoring quality, missing scoring reduces synthesis quality
8. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
9. **DO NOT STOP**: Continuous execution until all waves complete
10. **Tri-Output**: context.md is ALWAYS produced (all modes). analysis.md + conclusions.json are full-mode only. Gaps mode writes analysis records to issues.jsonl + context.md for plan --gaps.
</invariants>

<execution>

### Session Initialization

**Parse from `$ARGUMENTS`**:

| Variable | Source | Default |
|----------|--------|---------|
| `AUTO_YES` | `--yes` or `-y` | false |
| `continueMode` | `--continue` | false |
| `maxConcurrency` | `--concurrency N` or `-c N` | 6 |
| `QUICK_MODE` | `-q` or `--quick` | false |
| `GAPS_MODE` | `--gaps` | false |
| `gapsIssueId` | `--gaps ISS-{id}` | null |
| `subjectArg` | remaining text after flag removal | "" |

**Auto-bootstrap**: If `.workflow/state.json` missing, create minimal `{ project: null, status: "active", current_milestone: null, artifacts: [] }`.

**Scope determination** (from `state.json` + `subjectArg`):

| Condition | Scope | Slug |
|-----------|-------|------|
| `GAPS_MODE` | `gaps` | `gapsIssueId` slugified or `"issue-gaps"` |
| Empty subject + milestone + roadmap | `milestone` | milestone name slugified |
| Empty subject, no roadmap | ERROR: `"E001: No args and no roadmap"` | — |
| Numeric subject + milestone + roadmap | `phase` | phase slug from roadmap |
| Numeric subject, no roadmap | ERROR: `"Phase number requires init + roadmap"` | — |
| Text subject + milestone | `adhoc` | subject slugified (max 40 chars) |
| Text subject, no milestone | `standalone` | subject slugified (max 40 chars) |

**Session paths** (UTC+8 date prefix):
- `sessionFolder`: `.workflow/.csv-wave/{YYYYMMDD}-analyze-{slug}/`
- `scratchDir`: `.workflow/scratch/{YYYYMMDD}-analyze-{slug}/`

Create both directories.

### Phase 1: Subject Resolution -> CSV

**Objective**: Parse subject, load context, select dimensions, generate tasks.csv.

**Decomposition Rules**:

1. **Scope detection**: Already determined in Session Initialization (milestone/phase/adhoc/standalone)
2. **Context loading** (milestone/phase scope):
   - Read `.workflow/project.md` -- project vision and constraints
   - Read `.workflow/roadmap.md` -- phase structure and dependencies
   - Read `.workflow/state.json` → `current_milestone`, `artifacts[]`, `accumulated_context`
   - Find prior analyze artifacts from `state.json.artifacts[]` (type=analyze, same milestone) → load their `context.md`
   - Find brainstorm artifacts from `state.json.artifacts[]` (type=brainstorm, same milestone) → load `guidance-specification.md`
   - Load project specs: `maestro spec load --category arch`

3. **Quick mode routing**: If QUICK_MODE, generate only wave 3 (synthesis/decide) task in CSV. Skip exploration and scoring.

3b. **Gaps mode routing** (if GAPS_MODE):
   - Load issues from `.workflow/issues/issues.jsonl`
   - If `gapsIssueId`: load single issue, validate existence
   - If no ISS-ID: filter `status == "open" || status == "registered"`
   - For each issue, generate an exploration task (wave 1) focused on issue context
   - Generate a synthesis task (wave 2) that writes analysis records back to issues.jsonl
   - Skip standard dimension scoring (wave 2 in normal mode)
   - Pipeline: Load Issues → CLI Exploration per issue → Root Cause Synthesis → Write issue.analysis → Output context.md
   - On completion: append history entry `{ action: "analyzed", at: <ISO>, by: "maestro-analyze --gaps" }` per issue

4. **Dimension and perspective selection** (full mode):

| Depth | Exploration Dimensions | Scoring Dimensions |
|-------|----------------------|-------------------|
| Standard (default) | architecture, implementation, performance | feasibility, impact, risk, complexity, alignment, maintainability |
| Custom (interactive) | User-selected from 8 available | All 6 scoring dimensions |

Available exploration dimensions:
- architecture, implementation, performance, security, concept, comparison, decision, external_research

5. **CSV generation**:
   - Full mode: N exploration rows (wave 1) + 6 scoring rows (wave 2) + 1 synthesis row (wave 3)
   - Quick mode: 1 synthesis row only (wave 1, no deps)

**Wave computation**: 3-wave diamond -- explore = wave 1, score = wave 2, decide = wave 3. Quick mode: single wave.

**User validation**: Display task breakdown (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Execute analysis pipeline wave-by-wave via spawn_agents_on_csv.

#### Wave 1: CLI Exploration (Parallel) [SKIP in -q mode]

Filter `wave == 1 && status == pending` from master CSV. No prev_context (no predecessors). Write `wave-1.csv`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildExplorationInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, score, recommendations, error }
  // required: id, status, findings
})
```

Merge results into master `tasks.csv`, delete `wave-1.csv`.

**Exploration agent responsibilities** (3-layer per dimension):
1. **Module Discovery** (breadth) -- keyword search, relevant files, module boundaries
2. **Structure Tracing** (depth) -- top 3-5 files: call chains 2-3 levels, data flow
3. **Code Anchor Extraction** (detail) -- code snippet (20-50 lines) with file:line per finding
- Share findings via discovery board

#### Wave 2: 6-Dimension Scoring (Parallel) [SKIP in -q mode]

Filter `wave == 2 && status == pending` from master CSV. Build `prev_context` from wave 1 findings (format: `[Task N: Title] summary...` per exploration task). Write `wave-2.csv` with `prev_context` column.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildScoringInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { id, status: ["completed"|"failed"], findings, score, recommendations, error }
  // required: id, status, findings, score
})
```

Merge results into master `tasks.csv`, delete `wave-2.csv`.

**Scoring agent responsibilities** (6 dimensions):

| Dimension | Focus Areas | Score Range |
|-----------|------------|-------------|
| Feasibility | Technical difficulty, team capability, time, tooling | 0-100 |
| Impact | User value, business value, tech debt reduction, DX | 0-100 |
| Risk | Failure modes, security, scalability, regression | 0-100 |
| Complexity | Integration points, dependencies, learning curve, testing | 0-100 |
| Alignment | Project vision fit, roadmap consistency, architecture principles | 0-100 |
| Maintainability | Code clarity, documentation, test coverage, refactoring safety | 0-100 |

Each score MUST include specific evidence (code refs, data points from exploration findings).

#### Wave 3: Decision Synthesis (Single Agent)

Filter `wave == 3` (or wave 1 in quick mode) `&& status == pending`. If full mode and all wave 2 failed, fall back to available exploration context.

**prev_context source**:
- Full mode: wave 2 scoring findings (format: `[Task N: Score Dim] Score: X. summary...`)
- Quick mode: loaded project context (project.md, roadmap, brainstorm artifacts)

Write wave CSV with `prev_context`, execute `spawn_agents_on_csv` for synthesis agent, merge results, delete temp CSV.

**Synthesis agent responsibilities**:
- Compile dimension scores into analysis.md (full mode):
  - Executive summary with overall assessment
  - Per-dimension scores with key evidence
  - Risk matrix visualization
  - Go/No-Go recommendation with confidence
- Identify gray areas (both modes):
  - Domain-aware: something users SEE/CALL/RUN/READ/are ORGANIZED
  - Phase-specific: skip areas decided in prior context.md
  - If guidance-specification.md loaded: skip MUST/MUST NOT, focus on SHOULD/MAY gaps
- Generate Locked/Free/Deferred decisions for context.md
- Build conclusions.json (full mode) with decision trail and recommendations

### Phase 3: Results Aggregation

**Objective**: Generate final results and output artifacts.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. Build `analysis.md` (full mode only):

```markdown
# Analysis Report -- {subject}

## Executive Summary
- Overall assessment: {Go/No-Go/Conditional}
- Confidence: {high/medium/low}
- Key risk: {top risk}

## Dimension Scores
| Dimension | Score | Key Evidence |
|-----------|-------|-------------|
| Feasibility | {N}/100 | {evidence} |
| Impact | {N}/100 | {evidence} |
| Risk | {N}/100 | {evidence} |
| Complexity | {N}/100 | {evidence} |
| Alignment | {N}/100 | {evidence} |
| Maintainability | {N}/100 | {evidence} |

## Risk Matrix
{probability-impact matrix}

## Recommendations
{prioritized recommendations with rationale}
```

4. Build `context.md` (both modes):

```markdown
# Context: {subject}

**Date**: {date}
**Mode**: {full|quick}
**Areas discussed**: {list}

## Decisions

### Decision N: {TITLE}
- **Context**: {what and why}
- **Options**: 1. {opt1} 2. {opt2}
- **Chosen**: {selected}
- **Reason**: {rationale}

## Constraints

### Locked
{decisions that are final and must be followed}

### Free
{decisions left to implementer discretion}

### Deferred
{ideas captured but postponed to later phases}

## Code Context
{relevant code references from exploration}
```

5. Build `conclusions.json` (full mode only):

```json
{
  "session_id": "<session>",
  "subject": "<subject>",
  "mode": "full",
  "recommendation": "Go|No-Go|Conditional",
  "confidence": "high|medium|low",
  "dimensions": [
    { "name": "feasibility", "score": 75, "findings": "...", "recommendations": "..." }
  ],
  "decisions": [
    { "title": "...", "classification": "locked|free|deferred", "rationale": "..." }
  ],
  "risk_matrix": [...],
  "timestamp": "<ISO>"
}
```

6. **Auto-create issues from Deferred items**: Filter decisions with `classification == "Deferred"`, append each as issue to `.workflow/issues/issues.jsonl`.

7. **Register artifact in state.json**: Append `{ id: "ANL-{next_id}", type: "analyze", milestone, phase, scope, path: scratchDir, status: "completed", depends_on: null, harvested: false, created_at, completed_at }`.
8. Copy final outputs (context.md, analysis.md, conclusions.json) from CSV session folder to `scratchDir`
9. Display summary

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
| `exploration_finding` | `data.file+data.line` | `{file, line, snippet, dimension, significance}` | Code anchor from exploration |
| `dimension_score` | `data.dimension` | `{dimension, score, evidence, confidence}` | Scoring result |
| `risk_item` | `data.description` | `{description, probability, impact, mitigation}` | Identified risk |
| `decision_candidate` | `data.area` | `{area, options[], recommendation, classification}` | Gray area for decision |
| `alternative` | `data.name` | `{name, description, pros[], cons[], fit_score}` | Alternative approach |

#### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own analysis
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"exploration_finding","data":{"file":"src/auth/login.ts","line":42,"snippet":"export async function verifyToken(...)","dimension":"architecture","significance":"Core auth entry point"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Subject argument missing (non-gaps) | Abort with error: "Analysis subject required (phase number or topic text)" |
| --gaps but no issues found | Abort with error: "No open/registered issues in issues.jsonl" |
| --gaps ISS-ID not found | Abort with error: "Issue {ISS-ID} not found — run manage-issue list" |
| Phase directory not found | List available phases, abort with error |
| No prior context for quick mode | Warn: limited context, proceed with available information |
| Exploration agent timeout | Mark as failed, continue with remaining exploration agents |
| All exploration agents failed | Proceed to scoring with limited context, note limitation |
| Scoring agent timeout | Mark as failed, use available scores for synthesis |
| All scoring agents failed | Skip analysis.md, proceed to decision extraction only |
| Synthesis agent failed | Use raw scores/exploration as fallback, generate minimal context.md |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All waves executed in order (or skipped per mode)
- [ ] context.md produced (all modes)
- [ ] analysis.md + conclusions.json produced (full mode only)
- [ ] Deferred items auto-created as issues
- [ ] Artifact registered in state.json
- [ ] Final outputs copied to scratchDir
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
