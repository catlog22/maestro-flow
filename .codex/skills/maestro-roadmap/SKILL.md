---
name: maestro-roadmap
description: Dual-mode roadmap generation via 2-wave CSV pipeline. Light mode (default) runs scope/risk/dependency analysis → roadmap assembly. Full mode (--mode full) runs domain/competitive/tech-stack research → 7-phase specification document chain → roadmap. Both modes produce .workflow/roadmap.md.
argument-hint: "\"<requirements>\" [--mode light|full] [-y|--yes] [--phases N] [--skip-research] [--from-brainstorm SESSION-ID]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Unified 2-wave roadmap generation using `spawn_agents_on_csv` with dual execution modes:

- **Light mode** (default): Wave 1 runs parallel requirement analysis agents (scope, risk, dependency). Wave 2 runs roadmap assembly agent producing `roadmap.md` with phases, milestones, and success criteria.
- **Full mode** (`--mode full`): Wave 1 runs parallel research agents (domain, competitive, tech stack). Wave 2 runs a single synthesis agent producing the 7-phase specification document chain (product brief, PRD, architecture, epics, roadmap).

**Common workflow**: Parse Input → Parallel Analysis/Research → Sequential Assembly/Synthesis → Output

```
+---------------------------------------------------------------------------+
|               ROADMAP CSV WAVE WORKFLOW (DUAL MODE)                       |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Input Parsing + CSV Generation                                  |
|     +-- Parse requirement/idea from arguments                             |
|     +-- Detect input type (text, @file, brainstorm import)                |
|     +-- Detect mode: light (default) or full (--mode full)                |
|     +-- Codebase detection (conditional exploration)                      |
|     +-- Generate mode-specific tasks.csv                                  |
|     +-- User validates breakdown (skip if -y)                             |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Analysis/Research (parallel)                              |
|     |   [Light] scope, risk, dependency analysis                          |
|     |   [Full]  domain, competitive, tech stack research                  |
|     +-- Wave 2: Assembly/Synthesis (sequential)                           |
|     |   [Light] roadmap assembly agent → roadmap.md                       |
|     |   [Full]  7-phase document chain → spec package + roadmap.md        |
|     +-- discoveries.ndjson shared across waves (append-only)              |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv                                                |
|     +-- Interactive refinement (skip if -y)                               |
|     +-- [Full only] Readiness check (4 dimensions)                        |
|     +-- Generate context.md                                               |
|     +-- Write .workflow/roadmap.md                                        |
|     +-- Display summary with next steps                                   |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
$ARGUMENTS -- requirement/idea text or @file reference, plus optional flags.

**Usage**:

```bash
# Light mode (default)
$maestro-roadmap "Implement user authentication with OAuth and 2FA"
$maestro-roadmap -y "@requirements.md"
$maestro-roadmap --phases 4 "Build real-time notification system"

# Full mode
$maestro-roadmap --mode full "Build a real-time collaboration platform"
$maestro-roadmap --mode full -y "@requirements.md"
$maestro-roadmap --mode full --skip-research "CLI workflow orchestration tool"

# Shared flags
$maestro-roadmap --from-brainstorm WFS-001 "Enhance auth system"
```

**Flags**:
- `--mode light|full`: Execution mode (default: light)
- `-y, --yes`: Skip all confirmations (auto mode)
- `--phases N`: Target number of roadmap phases (default: auto-determined, light mode only)
- `--skip-research`: Skip Wave 1 research, jump to document generation (full mode only)
- `--from-brainstorm SESSION-ID`: Import guidance-specification.md from brainstorm session as seed

When `--yes` or `-y`: Auto-confirm strategy/decisions, skip interactive refinement, use defaults.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` + `results.csv` + `discoveries.ndjson` + `context.md` + `.workflow/roadmap.md`
**Full mode additional**: Spec package in `.workflow/.spec/SPEC-{slug}-{date}/`
</context>

<csv_schema>

### tasks.csv — Light Mode

```csv
id,title,description,analysis_focus,deps,context_from,wave,status,findings,error
"1","Scope Analysis","Analyze requirement scope: identify all features and sub-features, define MVP boundaries, classify must-have vs nice-to-have, estimate relative size of each feature area. Produce feature inventory with priority tags.","scope","","","1","","",""
"2","Risk Analysis","Assess technical and project risks: identify unknowns, evaluate technical feasibility per feature, rate risk levels (high/medium/low), propose mitigations. Flag features requiring spikes or prototypes.","risk","","","1","","",""
"3","Dependency Analysis","Map dependencies between features: identify ordering constraints, find parallel-safe groups, detect external dependencies (APIs, libraries, infrastructure). Produce dependency graph with critical path.","dependency","","","1","","",""
"4","Roadmap Assembly","Synthesize analysis findings into a complete roadmap. Apply decomposition strategy. Produce roadmap.md with: phase structure (goal, depends-on, requirements, success criteria), milestone grouping, scope decisions, progress table. Each phase must have observable success criteria from user perspective.","","1;2;3","1;2;3","2","","",""
```

### tasks.csv — Full Mode

```csv
id,title,description,research_focus,doc_phase,deps,context_from,wave,status,findings,output_file,error
"1","Domain Research","Research the problem domain: identify target users, market needs, existing solutions, industry trends, and domain terminology. Produce structured findings with confidence levels.","domain","","","","1","","","",""
"2","Competitive Analysis","Analyze competing products and approaches: feature comparison matrix, UX patterns, pricing models, market positioning. Identify gaps and opportunities for differentiation.","competitive","","","","1","","","",""
"3","Tech Stack Analysis","Evaluate technical feasibility: recommended languages, frameworks, databases, infrastructure. Assess constraints, integration complexity, scalability requirements. Reference existing codebase if available.","tech_stack","","","","1","","","",""
"4","Document Chain","Generate complete 7-phase specification package using research context. Phases: (1) Product Brief, (2) PRD with REQ-*/NFR-*, (3) Architecture with ADR-*, (4) Data Model, (5) API Specification, (6) UI Wireframes, (7) Epic-to-Roadmap with EPIC-* and phase mapping. Produce glossary.json for terminology consistency.","","1-7","1;2;3","1;2;3","2","","","",""
```

### Shared Columns

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = analysis/research, 2 = assembly/synthesis) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `error` | Output | Error message if failed |

**Light-only**: `analysis_focus` (scope/risk/dependency)
**Full-only**: `research_focus` (domain/competitive/tech_stack), `doc_phase`, `output_file`

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column.
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
6. **Graceful Degradation**: If Wave 1 fails, Wave 2 proceeds with seed input only
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
8. **DO NOT STOP**: Continuous execution until all waves complete
</invariants>

<execution>

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after each wave |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across waves |
| `context.md` | Human-readable report | Created in Phase 3 |
| `spec-config.json` | Session metadata (full mode only) | Created in Phase 1 |

### Session Structure

**Light mode**:
```
.workflow/.csv-wave/{YYYYMMDD}-roadmap-{slug}/
+-- tasks.csv, results.csv, discoveries.ndjson, context.md
```

**Full mode**:
```
.workflow/.csv-wave/{YYYYMMDD}-roadmap-full-{slug}/
+-- tasks.csv, results.csv, discoveries.ndjson, context.md, spec-config.json

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

### Session Initialization

Parse `$ARGUMENTS` to extract:
- `mode` from `--mode light|full` (default: `light`)
- `AUTO_YES` from `--yes` / `-y`
- `targetPhases` from `--phases N` (light mode only)
- `skipResearch` from `--skip-research` (full mode only)
- `brainstormSession` from `--from-brainstorm <SESSION-ID>`
- `requirementArg` = remaining text after stripping all flags
- `slug` = requirementArg lowercased, non-alphanumeric → `-`, max 40 chars

Session ID: `{YYYYMMDD}-roadmap-{slug}` (light) or `{YYYYMMDD}-roadmap-full-{slug}` (full)
Session folder: `.workflow/.csv-wave/{sessionId}/` — create via `mkdir -p`

### Phase 1: Input Parsing + CSV Generation

**Shared steps**:
1. **Input parsing**: Parse `{requirementArg}` -- direct text or `@file` reference
2. **Brainstorm import**: If `--from-brainstorm`, read `guidance-specification.md` for enriched context
3. **Codebase detection**: Check for source files; if found, add context to analysis/research prompts
4. **Load project specs**: Read `.workflow/specs/` for constraint awareness

**Light mode specific**:
5. **Uncertainty assessment**:

| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Scope clarity | Requirements explicit | Some ambiguity | Vague/open-ended |
| Technical risk | Proven stack | Some unknowns | New technology |
| Dependency unknown | All mapped | Some unclear | Many external |
| Domain familiarity | Expert | Moderate | New domain |
| Requirement stability | Locked | Some flux | Evolving |

Strategy: >=3 high → progressive, >=3 low → direct, else → ask (or auto if -y).

6. **CSV generation**: 3 analysis tasks (wave 1) + 1 assembly task (wave 2)

**Full mode specific**:
5. **Session init**: Create `spec-config.json` with session metadata
6. **CSV generation**: 3 research tasks (wave 1) + 1 document chain task (wave 2). If `--skip-research`: 0 research + 1 doc chain (wave 1).

**User validation**: Display task breakdown + strategy (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

#### Wave 1 (Parallel)

Filter master `tasks.csv` for `wave == 1 AND status == pending` → write `wave-1.csv`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: mode === 'light'
    ? buildAnalysisInstruction(sessionFolder, requirementArg, strategy)
    : buildResearchInstruction(sessionFolder, requirementArg),
  max_concurrency: 3,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      output_file: { type: "string" },  // full mode only
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

Merge results into master `tasks.csv`, delete `wave-1.csv`.

#### Wave 2 (Sequential)

Filter for `wave == 2 AND status == pending`. If all wave 1 tasks failed, use degraded mode (requirement/seed text only).

Build `prev_context` from wave 1 findings. Format: `[Task N: Title] summary...` per completed task. Inject decomposition strategy and `--phases N` constraint (light mode) into assembly prompt.

Write `wave-2.csv` with `prev_context` column → execute `spawn_agents_on_csv` → merge → delete temp CSV.

**Light mode**: Assembly agent produces roadmap.md with phases, milestones, success criteria.
**Full mode**: Document chain agent produces 7-phase spec package + glossary.json. If agent fails, export partial output and log quality issues (do NOT abort).

### Phase 3: Results Aggregation

Export master `tasks.csv` as `results.csv`.

**Interactive refinement** (skip if AUTO_YES): Present overview, collect feedback via AskUserQuestion (max 3 rounds).

**Full mode only — Readiness check**: Score on 4 dimensions (25% each):
- Completeness, Consistency, Traceability, Depth
- Gate: Pass (>=80%) / Review (60-79%) / Fail (<60%)

Generate `context.md`:

**Light mode template**:
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

**Full mode template**:
```markdown
# Spec Generate Report

## Summary
- Topic: {topic}
- Research agents: 3 ({completed_count} completed)
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

**Write outputs**:
- `.workflow/roadmap.md` (both modes)
- `.workflow/.spec/SPEC-{slug}-{date}/` (full mode only)
- Ensure `.workflow/scratch/` exists
- Update `state.json` milestones array and `current_milestone`

Display summary with next steps:
```
=== ROADMAP CREATED ===
Mode:     {light|full}
Strategy: {progressive|direct}
Phases:   {phase_count} across {milestone_count} milestones
Roadmap:  .workflow/roadmap.md
[Full]    Spec:  .workflow/.spec/SPEC-{slug}-{date}/
[Full]    Quality: {score}% ({gate})

Next steps:
  maestro-init                    -- Set up project (if not yet initialized)
  maestro-plan "1"                -- Plan first phase
  manage-status                   -- View project dashboard
```

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

#### Light Mode Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `scope_boundary` | `data.feature` | `{feature, inclusion, rationale}` | Scope decision |
| `risk_factor` | `data.name` | `{name, severity, probability, mitigation}` | Identified risk |
| `dependency_constraint` | `data.from+data.to` | `{from, to, type, strength}` | Feature dependency |
| `external_dependency` | `data.name` | `{name, type, risk, alternative}` | External system dependency |

#### Full Mode Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `domain_term` | `data.term` | `{term, definition, aliases}` | Domain terminology |
| `competitor` | `data.name` | `{name, features[], gaps[]}` | Competitive product |
| `market_trend` | `data.name` | `{name, impact, relevance}` | Market trend |
| `tech_constraint` | `data.name` | `{name, type, severity, mitigation}` | Technical constraint |

#### Protocol

Read `{session_folder}/discoveries.ndjson` before own analysis. Deduplicate by type + dedup key before writing. Append-only — never modify or delete.

```bash
# Light mode example
echo '{"ts":"<ISO>","worker":"{id}","type":"risk_factor","data":{"name":"OAuth provider rate limits","severity":"medium","probability":"high","mitigation":"Implement token caching and retry logic"}}' >> {session_folder}/discoveries.ndjson

# Full mode example
echo '{"ts":"<ISO>","worker":"{id}","type":"domain_term","data":{"term":"workflow","definition":"A sequence of orchestrated tasks","aliases":["pipeline","process"]}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>
| Error | Resolution |
|-------|------------|
| No requirement/idea text provided | Abort with error: "Requirement text or @file required" |
| Brainstorm session not found | Abort with error: "Session {id} not found" -- list available sessions |
| @file not found | Abort with error: "File {path} not found" |
| Wave 1 agent timeout | Mark as failed, Wave 2 uses available findings |
| All Wave 1 agents failed | Wave 2 runs in degraded mode (seed input only) |
| Wave 2 agent failed (light) | Abort with error: "Roadmap generation failed" |
| Wave 2 agent failed (full) | Export partial output, log quality issues |
| Circular dependency detected | Prompt user to re-decompose (light mode) |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Max refinement rounds (3) | Force proceed with current output |
| Readiness score < 60% (full) | Log issues, proceed with available output |
</error_codes>

<success_criteria>

**Both modes**:
- [ ] Input parsed from text, @file, or brainstorm session
- [ ] Wave 1 agents completed (analysis or research)
- [ ] Wave 2 agent produced output
- [ ] Interactive refinement offered (or skipped with -y)
- [ ] .workflow/roadmap.md written
- [ ] state.json updated with milestones
- [ ] context.md generated
- [ ] Completion report displayed with next steps

**Light mode additional**:
- [ ] Uncertainty assessed and decomposition strategy selected
- [ ] Roadmap has phases with milestones and success criteria

**Full mode additional**:
- [ ] spec-config.json created with session metadata
- [ ] Spec package written to .workflow/.spec/SPEC-{slug}-{date}/
- [ ] Readiness check scored on 4 dimensions
- [ ] Quality score and gate reported
</success_criteria>
