---
name: maestro-spec-generate
description: Specification package generation via 2-wave CSV pipeline. Wave 1 runs parallel research agents (domain, competitive, tech stack). Wave 2 runs sequential 7-phase document chain using research context. Replaces maestro-spec-generate command.
argument-hint: "\"<idea or @file>\" [-y|--yes] [--skip-research] [--from-brainstorm SESSION-ID]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Auto Mode

When `--yes` or `-y`: Auto-confirm all interactive decisions, skip requirement clarification rounds, use recommended defaults for spec type and depth.

# Maestro Spec Generate (CSV Wave)

## Usage

```bash
$maestro-spec-generate "Build a real-time collaboration platform"
$maestro-spec-generate -y "@requirements.md"
$maestro-spec-generate --skip-research "CLI workflow orchestration tool"
$maestro-spec-generate --from-brainstorm WFS-001 "Enhance auth system"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `--skip-research`: Skip Wave 1 research, jump directly to document generation
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md from brainstorm session as seed

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + spec package in `.workflow/.spec/SPEC-{slug}-{date}/`

---

## Overview

2-wave specification generation using `spawn_agents_on_csv`. Wave 1 runs parallel research agents to gather domain, competitive, and technical context. Wave 2 runs a single synthesis agent that produces the full 7-phase document chain (product brief, PRD, architecture, data model, API spec, UI wireframes, epic-to-roadmap) using Wave 1 research as context.

**Core workflow**: Parse Input → Parallel Research → Sequential Document Chain → Readiness Check → Roadmap Output

```
+---------------------------------------------------------------------------+
|                  SPEC GENERATE CSV WAVE WORKFLOW                          |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Input Parsing + CSV Generation                                  |
|     +-- Parse idea/topic from arguments                                   |
|     +-- Detect input type (text, @file, brainstorm import)                |
|     +-- Initialize session directory + spec-config.json                   |
|     +-- Codebase detection (conditional exploration)                      |
|     +-- Generate tasks.csv with research + synthesis rows                 |
|     +-- User validates breakdown (skip if -y)                             |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Research (parallel)                                       |
|     |   +-- Domain research agent: problem space, competitors, trends     |
|     |   +-- Competitive analysis agent: existing solutions, gaps          |
|     |   +-- Tech stack analysis agent: feasibility, constraints, stack    |
|     |   +-- Discoveries shared via board (patterns, tech, domain)         |
|     |   +-- Results: findings per research dimension                      |
|     +-- Wave 2: Document Chain (sequential synthesis)                     |
|     |   +-- Single agent produces 7-phase output:                         |
|     |   |   1. Product Brief (vision, goals, scope)                       |
|     |   |   2. PRD / Requirements (REQ-*, NFR-*)                          |
|     |   |   3. Architecture (ADR-*, component design)                     |
|     |   |   4. Data Model (entities, relationships)                       |
|     |   |   5. API Specification (endpoints, contracts)                   |
|     |   |   6. UI Wireframes (user flows, screen specs)                   |
|     |   |   7. Epic-to-Roadmap (EPIC-*, phase mapping)                    |
|     |   +-- Uses Wave 1 research as prev_context                          |
|     |   +-- Generates glossary.json for terminology consistency           |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv                                                |
|     +-- Run readiness check (completeness, consistency, traceability)     |
|     +-- Generate context.md with spec summary                             |
|     +-- Write spec package to .workflow/.spec/SPEC-{slug}-{date}/         |
|     +-- Write .workflow/roadmap.md                                        |
|     +-- Display summary with quality score + next steps                   |
|                                                                           |
+---------------------------------------------------------------------------+
```

---

## CSV Schema

### tasks.csv (Master State)

```csv
id,title,description,research_focus,doc_phase,deps,context_from,wave,status,findings,output_file,error
"1","Domain Research","Research the problem domain: identify target users, market needs, existing solutions, industry trends, and domain terminology. Produce structured findings with confidence levels.","domain","","","","1","","","",""
"2","Competitive Analysis","Analyze competing products and approaches: feature comparison matrix, UX patterns, pricing models, market positioning. Identify gaps and opportunities for differentiation.","competitive","","","","1","","","",""
"3","Tech Stack Analysis","Evaluate technical feasibility: recommended languages, frameworks, databases, infrastructure. Assess constraints, integration complexity, scalability requirements. Reference existing codebase if available.","tech_stack","","","","1","","","",""
"4","Document Chain","Generate complete 7-phase specification package using research context. Phases: (1) Product Brief with vision/goals/scope, (2) PRD with REQ-*/NFR-* requirements, (3) Architecture with ADR-* decisions, (4) Data Model with entity relationships, (5) API Specification with endpoint contracts, (6) UI Wireframes with user flows, (7) Epic-to-Roadmap with EPIC-* and phase mapping. Produce glossary.json for terminology consistency across all documents.","","1-7","1;2;3","1;2;3","2","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `research_focus` | Input | Research dimension: domain/competitive/tech_stack (Wave 1 only) |
| `doc_phase` | Input | Document phase range: "1-7" (Wave 2 only, empty for research) |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = research, 2 = document chain) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `output_file` | Output | Path to generated output file(s), semicolon-separated |
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
| `context.md` | Human-readable spec generation report | Created in Phase 3 |
| `spec-config.json` | Session metadata and phase tracking | Created in Phase 1 |

---

## Session Structure

```
.workflow/.csv-wave/spec-generate-{slug}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- spec-config.json
+-- wave-{N}.csv (temporary)
```

**Spec package output**:
```
.workflow/.spec/SPEC-{slug}-{date}/
+-- spec-config.json
+-- product-brief.md
+-- glossary.json
+-- requirements/
|   +-- _index.md
|   +-- REQ-NNN-{slug}.md
|   +-- NFR-{type}-NNN-{slug}.md
+-- architecture/
|   +-- _index.md
|   +-- ADR-NNN-{slug}.md
+-- epics/
|   +-- _index.md
|   +-- EPIC-NNN-{slug}.md
+-- readiness-report.md
+-- spec-summary.md
+-- roadmap.md
```

---

## Implementation

### Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const skipResearch = $ARGUMENTS.includes('--skip-research')
const brainstormMatch = $ARGUMENTS.match(/--from-brainstorm\s+(\S+)/)
const brainstormSession = brainstormMatch ? brainstormMatch[1] : null

// Clean topic text
const topicArg = $ARGUMENTS
  .replace(/--yes|-y|--skip-research|--from-brainstorm\s+\S+/g, '')
  .trim()

const slug = topicArg.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .substring(0, 40)
const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `spec-generate-${slug}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

---

### Phase 1: Input Parsing + CSV Generation

**Objective**: Parse input, detect type, initialize session, generate tasks.csv.

**Decomposition Rules**:

1. **Input parsing**: Parse `{topicArg}` — direct text, `@file` reference, or brainstorm import
2. **Brainstorm import**: If `--from-brainstorm`, read `guidance-specification.md` as enriched seed
3. **Codebase detection**: Check for source files (*.ts, *.js, *.py); if found, add codebase context to research prompts
4. **Session init**: Create `spec-config.json` with session metadata

5. **CSV generation**:

| Condition | Wave 1 Tasks | Wave 2 Tasks |
|-----------|-------------|-------------|
| Normal | 3 research agents | 1 document chain agent |
| `--skip-research` | 0 (skipped) | 1 document chain agent (wave 1) |
| `--from-brainstorm` | 3 research agents (enriched) | 1 document chain agent |

6. **Wave computation**: Simple 2-wave — all research tasks = wave 1, document chain = wave 2.

**User validation**: Display task breakdown (skip if AUTO_YES).

---

### Phase 2: Wave Execution Engine

**Objective**: Execute research and document generation wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Research (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (wave 1 has no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildResearchInstruction(sessionFolder, topicArg),
  max_concurrency: 3,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      output_file: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`

#### Wave 2: Document Chain (Sequential)

1. Read master `tasks.csv`
2. Filter rows where `wave == 2` AND `status == pending`
3. Check deps — if all wave 1 tasks failed, use degraded mode (basic seed only)
4. Build `prev_context` from wave 1 findings:
   ```
   [Task 1: Domain Research] Target users: developers building workflow tools. Market trends: ...
   [Task 2: Competitive Analysis] Key competitors: X, Y, Z. Differentiation opportunities: ...
   [Task 3: Tech Stack Analysis] Recommended: TypeScript + Node.js. Constraints: ...
   ```
5. Write `wave-2.csv` with `prev_context` column
6. Execute `spawn_agents_on_csv` for document chain agent
7. Merge results into master `tasks.csv`
8. Delete `wave-2.csv`

---

### Phase 3: Results Aggregation

**Objective**: Generate final results, readiness check, and write spec package.

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. **Readiness check** — score on 4 dimensions (25% each):
   - Completeness: all required documents generated with substantive content
   - Consistency: glossary terms used uniformly, scope containment
   - Traceability: goals -> requirements -> architecture -> epics chain
   - Depth: acceptance criteria testable, ADRs justified, stories estimable

4. **Gate decision**:

| Score | Gate | Action |
|-------|------|--------|
| >= 80% | Pass | Proceed to output |
| 60-79% | Review | Proceed with caveats logged |
| < 60% | Fail | Log issues, proceed with available output |

5. Generate `context.md`:

```markdown
# Spec Generate Report

## Summary
- Topic: {topic}
- Research agents: {research_count} ({completed_count} completed)
- Document phases: 7
- Quality score: {score}% ({gate})

## Research Findings
### Domain Research
{findings}

### Competitive Analysis
{findings}

### Tech Stack Analysis
{findings}

## Document Chain Output
- Product Brief: {status}
- Requirements: {req_count} REQs + {nfr_count} NFRs
- Architecture: {adr_count} ADRs
- Epics: {epic_count} Epics
- Roadmap: {phase_count} phases

## Readiness
- Completeness: {score}%
- Consistency: {score}%
- Traceability: {score}%
- Depth: {score}%
- Overall: {score}% ({gate})
```

6. Write spec package to `.workflow/.spec/SPEC-{slug}-{date}/`
7. Write `.workflow/roadmap.md`
8. Display summary.

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
| `domain_term` | `data.term` | `{term, definition, aliases}` | Domain terminology |
| `competitor` | `data.name` | `{name, features[], gaps[]}` | Competitive product |
| `market_trend` | `data.name` | `{name, impact, relevance}` | Market trend |
| `tech_constraint` | `data.name` | `{name, type, severity, mitigation}` | Technical constraint |

### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own analysis
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"domain_term","data":{"term":"workflow","definition":"A sequence of orchestrated tasks","aliases":["pipeline","process"]}}' >> {session_folder}/discoveries.ndjson
```

---

## Error Handling

| Error | Resolution |
|-------|------------|
| No idea/topic provided | Abort with error: "Idea or topic text required" |
| Brainstorm session not found | Abort with error: "Session {id} not found" — list available sessions |
| @file not found | Abort with error: "File {path} not found" |
| Research agent timeout | Mark as failed, document chain uses available findings |
| All research agents failed | Document chain runs in degraded mode (seed only) |
| Document chain agent failed | Export partial output, log quality issues |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Readiness score < 60% | Log issues, proceed with available output |

---

## Core Rules

1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Graceful Degradation**: If research fails, document chain proceeds with seed input only
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
