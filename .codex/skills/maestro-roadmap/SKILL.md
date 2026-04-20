---
name: maestro-roadmap
description: Lightweight roadmap generation via 2-wave CSV pipeline. Wave 1 runs parallel requirement analysis agents (scope, risk, dependency). Wave 2 runs roadmap assembly agent producing roadmap.md with phases, milestones, and success criteria. Replaces maestro-roadmap command.
argument-hint: "\"<requirements>\" [-y|--yes] [--phases N] [--from-brainstorm SESSION-ID]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm strategy selection, skip interactive refinement rounds, use recommended defaults for decomposition mode and phase count.

# Maestro Roadmap (CSV Wave)

## Usage

```bash
$maestro-roadmap "Implement user authentication with OAuth and 2FA"
$maestro-roadmap -y "@requirements.md"
$maestro-roadmap --phases 4 "Build real-time notification system"
$maestro-roadmap --from-brainstorm WFS-001 "Enhance auth system"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `--phases N`: Target number of roadmap phases (default: auto-determined)
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md from brainstorm session as seed

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `.workflow/roadmap.md`

---

## Overview

2-wave roadmap generation using `spawn_agents_on_csv`. Wave 1 runs parallel requirement analysis agents to assess scope, risk, and dependencies. Wave 2 runs a single roadmap assembly agent that synthesizes analysis findings into a complete roadmap with phases, milestones, and success criteria.

**Core workflow**: Parse Requirements → Parallel Analysis → Roadmap Assembly → Interactive Refinement → Output

```
+---------------------------------------------------------------------------+
|                    ROADMAP CSV WAVE WORKFLOW                               |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Requirement Parsing + CSV Generation                            |
|     +-- Parse requirement text from arguments                             |
|     +-- Detect input type (text, @file, brainstorm import)                |
|     +-- Codebase detection (conditional exploration)                      |
|     +-- Assess uncertainty factors for strategy selection                  |
|     +-- Select decomposition strategy (progressive/direct/auto)           |
|     +-- Generate tasks.csv with analysis + assembly rows                  |
|     +-- User validates breakdown (skip if -y)                             |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Requirement Analysis (parallel)                           |
|     |   +-- Scope analysis agent: features, boundaries, MVP definition    |
|     |   +-- Risk analysis agent: technical risks, uncertainties, mitigations|
|     |   +-- Dependency analysis agent: ordering, blockers, parallel groups |
|     |   +-- Discoveries shared via board (constraints, patterns)          |
|     |   +-- Results: findings per analysis dimension                      |
|     +-- Wave 2: Roadmap Assembly (sequential)                             |
|     |   +-- Single agent produces roadmap.md:                             |
|     |   |   - Phase structure with goals and success criteria             |
|     |   |   - Dependency ordering between phases                          |
|     |   |   - Milestone grouping (MVP, Usable, Complete)                  |
|     |   |   - Scope decisions (in/deferred/out)                           |
|     |   |   - Progress tracking table                                     |
|     |   +-- Uses Wave 1 analysis as prev_context                          |
|     |   +-- Applies decomposition strategy from Phase 1                   |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv                                                |
|     +-- Interactive refinement (max 3 rounds, skip if -y)                 |
|     +-- Generate context.md with roadmap summary                          |
|     +-- Write .workflow/roadmap.md                                        |
|     +-- Ensure .workflow/scratch/ directory exists                         |
|     +-- Display summary with next steps                                   |
|                                                                           |
+---------------------------------------------------------------------------+
```

---

## CSV Schema

### tasks.csv (Master State)

```csv
id,title,description,analysis_focus,deps,context_from,wave,status,findings,error
"1","Scope Analysis","Analyze requirement scope: identify all features and sub-features, define MVP boundaries, classify must-have vs nice-to-have, estimate relative size of each feature area. Produce feature inventory with priority tags.","scope","","","1","","",""
"2","Risk Analysis","Assess technical and project risks: identify unknowns, evaluate technical feasibility per feature, rate risk levels (high/medium/low), propose mitigations. Flag features requiring spikes or prototypes.","risk","","","1","","",""
"3","Dependency Analysis","Map dependencies between features: identify ordering constraints, find parallel-safe groups, detect external dependencies (APIs, libraries, infrastructure). Produce dependency graph with critical path.","dependency","","","1","","",""
"4","Roadmap Assembly","Synthesize analysis findings into a complete roadmap. Apply decomposition strategy. Produce roadmap.md with: phase structure (goal, depends-on, requirements, success criteria), milestone grouping, scope decisions, progress table. Each phase must have observable success criteria from user perspective.","","1;2;3","1;2;3","2","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `analysis_focus` | Input | Analysis dimension: scope/risk/dependency (Wave 1 only) |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = analysis, 2 = assembly) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
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
| `context.md` | Human-readable roadmap generation report | Created in Phase 3 |

---

## Session Structure

```
.workflow/.csv-wave/roadmap-{slug}-{date}/
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
const phasesMatch = $ARGUMENTS.match(/--phases\s+(\d+)/)
const targetPhases = phasesMatch ? parseInt(phasesMatch[1]) : null
const brainstormMatch = $ARGUMENTS.match(/--from-brainstorm\s+(\S+)/)
const brainstormSession = brainstormMatch ? brainstormMatch[1] : null

// Clean requirement text
const requirementArg = $ARGUMENTS
  .replace(/--yes|-y|--phases\s+\d+|--from-brainstorm\s+\S+/g, '')
  .trim()

const slug = requirementArg.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .substring(0, 40)
const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `roadmap-${slug}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

---

### Phase 1: Requirement Parsing + CSV Generation

**Objective**: Parse requirements, assess uncertainty, select strategy, generate tasks.csv.

**Decomposition Rules**:

1. **Input parsing**: Parse `{requirementArg}` — direct text or `@file` reference
2. **Brainstorm import**: If `--from-brainstorm`, read `guidance-specification.md` for enriched context (problem statement, features, non-goals, terminology)
3. **Codebase detection**: Check for source files; if found, add codebase context to analysis prompts
4. **Load project specs**: Read `.workflow/specs/` for constraint awareness

5. **Uncertainty assessment**:

| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Scope clarity | Requirements explicit | Some ambiguity | Vague/open-ended |
| Technical risk | Proven stack | Some unknowns | New technology |
| Dependency unknown | All mapped | Some unclear | Many external |
| Domain familiarity | Expert | Moderate | New domain |
| Requirement stability | Locked | Some flux | Evolving |

Strategy: >= 3 high -> progressive, >= 3 low -> direct, else -> ask user (or auto if `-y`).

6. **CSV generation**: 3 analysis tasks (wave 1) + 1 assembly task (wave 2).

7. **Wave computation**: Simple 2-wave — all analysis tasks = wave 1, assembly = wave 2.

**User validation**: Display task breakdown + strategy (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Execute analysis and assembly wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Requirement Analysis (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildAnalysisInstruction(sessionFolder, requirementArg, strategy),
  max_concurrency: 3,
  max_runtime_seconds: 300,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`

#### Wave 2: Roadmap Assembly (Sequential)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps — if all wave 1 tasks failed, use degraded mode (requirement text only)
4. Build `prev_context` from wave 1 findings:
   ```
   [Task 1: Scope Analysis] Features: auth, OAuth, 2FA. MVP: basic auth + OAuth. Size: M...
   [Task 2: Risk Analysis] High risk: OAuth provider integration. Medium: 2FA delivery...
   [Task 3: Dependency Analysis] Critical path: auth -> OAuth -> 2FA. Parallel: UI + API...
   ```
5. Inject strategy and `--phases N` constraint into assembly prompt
6. Write `wave-2.csv` with `prev_context` column
7. Execute `spawn_agents_on_csv` for assembly agent
8. Merge results into master `tasks.csv`
9. Delete `wave-2.csv`

---

### Phase 3: Results Aggregation

**Objective**: Generate final results, optional refinement, and write roadmap.

1. Read final master `tasks.csv`
2. Export as `results.csv`

3. **Interactive refinement** (skip if AUTO_YES):
   - Present roadmap overview: phase count, milestone structure, dependency graph
   - User feedback via AskUserQuestion (max 3 rounds):
     - **Approve**: Proceed to output
     - **Adjust Scope**: Move features between phases
     - **Reorder**: Change phase sequencing
     - **Split/Merge**: Break large phases or combine small ones
   - Each round: update roadmap draft

4. Generate `context.md`:

```markdown
# Roadmap Generation Report

## Summary
- Requirements: {requirement_summary}
- Strategy: {progressive|direct}
- Analysis agents: 3 ({completed_count} completed)
- Phases generated: {phase_count}
- Milestones: {milestone_count}

## Analysis Findings
### Scope Analysis
{findings}

### Risk Analysis
{findings}

### Dependency Analysis
{findings}

## Roadmap
- Phases: {phase_count}
- Strategy: {strategy}
- MVP scope: {mvp_description}
- Deferred: {deferred_items}
```

5. **Write outputs**:
   - Write `.workflow/roadmap.md` using standard roadmap template structure
   - Ensure `.workflow/scratch/` directory exists (phases are labels, not directories)
   - Update `state.json` milestones array and set `current_milestone`
   - Update `.workflow/state.json` (if exists): set `current_phase: 1`

6. Display summary:

```
=== ROADMAP CREATED ===
Strategy: {progressive|direct}
Phases:   {phase_count} across {milestone_count} milestones
Roadmap:  .workflow/roadmap.md

Next steps:
  maestro-init                    -- Set up project (if not yet initialized)
  maestro-plan "1"                -- Plan first phase
  manage-status                   -- View project dashboard
```

---

## Shared Discovery Board Protocol

### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `scope_boundary` | `data.feature` | `{feature, inclusion, rationale}` | Scope inclusion/exclusion decision |
| `risk_factor` | `data.name` | `{name, severity, probability, mitigation}` | Identified risk |
| `dependency_constraint` | `data.from+data.to` | `{from, to, type, strength}` | Dependency between features |
| `external_dependency` | `data.name` | `{name, type, risk, alternative}` | External system dependency |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own analysis
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"risk_factor","data":{"name":"OAuth provider rate limits","severity":"medium","probability":"high","mitigation":"Implement token caching and retry logic"}}' >> {session_folder}/discoveries.ndjson
```

---

## Error Handling

| Error | Resolution |
|-------|------------|
| No requirement text provided | Abort with error: "Requirement text or @file required" |
| Brainstorm session not found | Abort with error: "Session {id} not found" — list available sessions |
| @file not found | Abort with error: "File {path} not found" |
| Analysis agent timeout | Mark as failed, assembly uses available findings |
| All analysis agents failed | Assembly runs in degraded mode (requirement text only) |
| Assembly agent failed | Abort with error: "Roadmap generation failed" |
| Circular dependency detected | Prompt user to re-decompose |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Max refinement rounds (3) | Force proceed with current roadmap |

---

## Core Rules

1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Graceful Degradation**: If analysis fails, assembly proceeds with requirement text only
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
