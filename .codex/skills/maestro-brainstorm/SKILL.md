---
name: maestro-brainstorm
description: Multi-role brainstorming via CSV wave pipeline. Diamond topology — guidance specification generator (Wave 1), parallel role analysis agents (Wave 2), synthesis + feature-index agent (Wave 3). Replaces maestro-brainstorm command.
argument-hint: "[topic] [-y|--yes] [-c|--concurrency N] [--continue] [--count N] [--skip-questions]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based multi-role brainstorming using `spawn_agents_on_csv`. Diamond topology: guidance specification generation (Wave 1), parallel role analysis agents (Wave 2), then synthesis + feature-index generation (Wave 3).

**Core workflow**: Parse Topic -> Generate Guidance Spec -> Parallel Role Analysis -> Synthesis + Feature Index

```
+---------------------------------------------------------------------------+
|                  BRAINSTORM CSV WAVE WORKFLOW                              |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Topic Resolution -> CSV                                         |
|     +-- Parse topic and flags from arguments                              |
|     +-- Detect mode (phase / scratch)                                     |
|     +-- Resolve output directory                                          |
|     +-- Select roles (interactive or auto, --count N)                     |
|     +-- Load project specs for architecture-aware analysis                |
|     +-- Generate tasks.csv with guidance + role + synthesis rows           |
|     +-- User validates role breakdown (skip if -y)                        |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Guidance Specification (single agent)                     |
|     |   +-- Analyze topic, extract terminology, define boundaries         |
|     |   +-- Generate guidance-specification.md with RFC 2119 keywords     |
|     |   +-- Feature decomposition (max 8 features)                        |
|     |   +-- Discoveries shared via board (terms, non-goals, features)     |
|     |   +-- Results: guidance_spec content + analysis_file path           |
|     +-- Wave 2: Role Analysis (parallel, 3-9 agents)                      |
|     |   +-- Each role agent analyzes topic through its lens               |
|     |   +-- Receives guidance-specification.md via prev_context           |
|     |   +-- Feature-point organization when feature list available        |
|     |   +-- Discoveries shared via board (role insights, conflicts)       |
|     |   +-- Results: analysis_file path per role                          |
|     +-- Wave 3: Synthesis + Feature Index (single agent)                  |
|     |   +-- Cross-role analysis: consensus, conflicts, unique insights    |
|     |   +-- Generate feature specs or synthesis-specification.md          |
|     |   +-- Build feature-index.json + synthesis-changelog.md             |
|     |   +-- Discoveries shared via board (cross-role patterns)            |
|     +-- discoveries.ndjson shared across all waves (append-only)          |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv                                                |
|     +-- Generate context.md with all findings                             |
|     +-- Copy artifacts to .brainstorming/ directory                       |
|     +-- Update phase index.json with brainstorm status                    |
|     +-- Display summary with next steps                                   |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$maestro-brainstorm "Build real-time collaboration platform"
$maestro-brainstorm -y "Build real-time collaboration platform"
$maestro-brainstorm -c 6 "Build real-time collaboration platform --count 5"
$maestro-brainstorm --continue "20260318-brainstorm-collab"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within each wave (default: 6)
- `--continue`: Resume existing session
- `--count N`: Number of roles to select (default 3, max 9)
- `--skip-questions`: Skip context gathering questions

When `--yes` or `-y`: Auto-confirm role selection, skip interactive questions, use defaults for count and role selection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `.brainstorming/` (role analyses + synthesis artifacts)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,role,topic,guidance_spec,deps,context_from,wave,status,findings,analysis_file,error
"1","Guidance Specification","Analyze topic and generate guidance-specification.md: extract 5-10 core terms, define non-goals, decompose into features (max 8), apply RFC 2119 keywords. Output: guidance-specification.md with sections for positioning, terminology, non-goals, feature decomposition.","guidance-generator","Build real-time collaboration platform","","","","1","","","",""
"2","System Architect Analysis","Analyze topic from system-architect perspective: technical architecture, scalability, integration patterns. Must include Data Model (3-5 entities), State Machine, Error Handling, Observability (5+ metrics), Configuration Model. Use RFC 2119 keywords. Reference guidance-specification.md for framework.","system-architect","Build real-time collaboration platform","","1","1","2","","","",""
"3","UI Designer Analysis","Analyze topic from ui-designer perspective: visual design, layout systems, component hierarchy, design tokens, responsive breakpoints. Reference guidance-specification.md for framework and feature decomposition.","ui-designer","Build real-time collaboration platform","","1","1","2","","","",""
"4","Product Manager Analysis","Analyze topic from product-manager perspective: product strategy, prioritization, user value proposition, competitive analysis, roadmap alignment. Reference guidance-specification.md for framework.","product-manager","Build real-time collaboration platform","","1","1","2","","","",""
"5","Synthesis + Feature Index","Cross-role synthesis: analyze all role outputs for consensus, conflicts, unique contributions. Generate feature specs (F-001 through F-00N) or synthesis-specification.md. Build feature-index.json and synthesis-changelog.md. Resolve conflicts with [RESOLVED]/[SUGGESTED]/[UNRESOLVED] tags.","synthesis","Build real-time collaboration platform","","2;3;4","2;3;4","3","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `role` | Input | Role identifier: guidance-generator, system-architect, ui-designer, product-manager, ..., synthesis |
| `topic` | Input | Brainstorm topic text |
| `guidance_spec` | Input | Guidance-specification.md content reference (populated for wave 2+ from wave 1) |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs |
| `wave` | Computed | Wave number (1 = guidance, 2 = role analysis, 3 = synthesis) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary (max 500 chars) |
| `analysis_file` | Output | Path to generated analysis file |
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
| `context.md` | Human-readable brainstorm report | Created in Phase 3 |
| `.brainstorming/` | Role analyses + synthesis artifacts | Populated in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-brainstorm-{slug}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- wave-{N}.csv (temporary)
+-- .brainstorming/
    +-- guidance-specification.md
    +-- feature-index.json
    +-- synthesis-changelog.md
    +-- feature-specs/
    |   +-- F-001-{slug}.md
    |   +-- F-00N-{slug}.md
    +-- {role}/
    |   +-- analysis.md
    |   +-- analysis-cross-cutting.md
    |   +-- analysis-F-{id}-{slug}.md
    +-- synthesis-specification.md (fallback mode)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Wave Order is Sacred**: Never execute wave 2 before wave 1 completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: prev_context built from master CSV, not from memory
5. **Guidance First**: Wave 1 (guidance) MUST complete before any role analysis begins
6. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
7. **Skip on Failure**: If guidance fails, abort. If all roles fail, skip synthesis.
8. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
9. **DO NOT STOP**: Continuous execution until all waves complete
10. **9 Valid Roles Only**: data-architect, product-manager, product-owner, scrum-master, subject-matter-expert, system-architect, test-strategist, ui-designer, ux-expert
</invariants>

<execution>

### Session Initialization

```
Parse from $ARGUMENTS:
  AUTO_YES       ← --yes | -y
  continueMode   ← --continue
  maxConcurrency ← --concurrency | -c N  (default: 6)
  roleCount      ← --count N  (default: 3, max: 9)
  skipQuestions   ← --skip-questions
  topicArg       ← remaining text after flag removal

Derive:
  slug           ← topicArg kebab-cased, max 40 chars
  dateStr        ← UTC+8 YYYYMMDD
  sessionId      ← "{dateStr}-brainstorm-{slug}"
  sessionFolder  ← ".workflow/.csv-wave/{sessionId}"

mkdir -p {sessionFolder}/.brainstorming
```

### Phase 1: Topic Resolution -> CSV

**Objective**: Parse topic, select roles, generate tasks.csv.

**Decomposition Rules**:

1. **Mode detection**: Number = phase mode (resolve via state.json artifact registry to `.workflow/scratch/{YYYYMMDD}-{type}-{slug}/`), text = scratch mode
2. **Project specs loading**: Read `.workflow/specs/` for architecture-aware analysis context
3. **Role selection**:

| Condition | Action |
|-----------|--------|
| `--yes` flag | Auto-select top `roleCount` roles based on topic relevance |
| Interactive | AskUserQuestion (multiSelect=true) with recommended roles + rationale |

4. **Valid roles** (9 total):

| Role ID | Focus Area |
|---------|------------|
| `data-architect` | Data models, storage strategies, data flow |
| `product-manager` | Product strategy, roadmap, prioritization |
| `product-owner` | Backlog management, user stories, acceptance criteria |
| `scrum-master` | Process facilitation, impediment removal |
| `subject-matter-expert` | Domain knowledge, business rules, compliance |
| `system-architect` | Technical architecture, scalability, integration |
| `test-strategist` | Test strategy, quality assurance |
| `ui-designer` | Visual design, mockups, design systems |
| `ux-expert` | User research, information architecture, journey |

5. **CSV generation**: 1 guidance row (wave 1) + N role rows (wave 2) + 1 synthesis row (wave 3).

**Wave computation**: 3-wave diamond -- guidance = wave 1, all role tasks = wave 2, synthesis = wave 3.

**User validation**: Display task breakdown (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Execute brainstorm pipeline wave-by-wave via spawn_agents_on_csv.

#### Wave 1: Guidance Specification (Single Agent)

1. Extract wave 1 pending rows from master `tasks.csv` into `wave-1.csv` (no prev_context needed)
2. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildGuidanceInstruction(sessionFolder, topicArg),
  max_concurrency: 1, max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: { id, status: [completed|failed], findings, analysis_file, error }
})
```

3. Merge results into master `tasks.csv`, delete `wave-1.csv`
4. Read generated `guidance-specification.md` for wave 2 context propagation

**Guidance agent responsibilities**:
- Analyze topic, extract 5-10 core domain terms
- Define non-goals and scope boundaries
- Decompose into features (max 8): F-{3-digit} ID, kebab-case slug, description, related roles, priority
- Apply RFC 2119 keywords (MUST, SHOULD, MAY, MUST NOT, SHOULD NOT)
- Write `guidance-specification.md` to `.brainstorming/`

#### Wave 2: Role Analysis (Parallel, 3-9 Agents)

1. Extract wave 2 pending rows from master `tasks.csv`
2. Build `prev_context` from wave 1 findings + `guidance-specification.md` content
3. Write `wave-2.csv` with `prev_context` column
4. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: buildRoleAnalysisInstruction(sessionFolder),
  max_concurrency: maxConcurrency, max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: { id, status: [completed|failed], findings, analysis_file, error }
})
```

5. Merge results into master `tasks.csv`, delete `wave-2.csv`

**Role agent responsibilities**:
- Read guidance-specification.md for framework context
- Analyze topic through role-specific lens
- Feature-point organization when feature list available:
  - `analysis.md` -- Role overview INDEX only (< 1500 words)
  - `analysis-cross-cutting.md` -- Cross-feature decisions (< 2000 words)
  - `analysis-F-{id}-{slug}.md` -- Per-feature analysis (< 2000 words each)
- Fallback organization (no feature list):
  - `analysis.md` -- Main analysis (< 3000 words)
- system-architect MUST include: Data Model, State Machine, Error Handling, Observability, Configuration Model
- Write analysis files to `.brainstorming/{role}/`

#### Wave 3: Synthesis + Feature Index (Single Agent)

1. If all wave 2 tasks failed, skip synthesis entirely
2. Extract wave 3 pending rows, build `prev_context` from wave 2 findings
3. Write `wave-3.csv`, execute `spawn_agents_on_csv` for synthesis agent (same output_schema pattern)
4. Merge results into master `tasks.csv`, delete `wave-3.csv`

**Synthesis agent responsibilities**:
- Cross-role analysis: consensus, conflicts, unique contributions
- Conflict resolution with [RESOLVED]/[SUGGESTED]/[UNRESOLVED] tags
- Feature mode: generate `feature-specs/F-{id}-{slug}.md` per feature (7 sections, 1500-2500 words)
- Fallback mode: generate `synthesis-specification.md`
- Build `feature-index.json` and `synthesis-changelog.md`
- Four-Layer Aggregation: Direct Reference, Structured Extraction, Conflict Distillation, Cross-Feature Annotation

### Phase 3: Results Aggregation

**Objective**: Generate final results and human-readable report.

1. Export final `tasks.csv` as `results.csv`
2. Generate `context.md`:

```markdown
# Brainstorm Report -- {topic}

## Summary
- Topic: {topic}
- Roles analyzed: {role_count}
- Features decomposed: {feature_count}
- Conflicts resolved: {resolved_count}

## Guidance Specification
{summary of guidance-specification.md}

## Role Analysis Results
### {role_name}
{findings summary}
**Analysis file**: {analysis_file path}

## Synthesis
{synthesis summary}
- Consensus areas: {list}
- Resolved conflicts: {list}
- Unresolved items: {list}

## Feature Index
{feature-index.json summary}

## Next Steps
- Skill: maestro-analyze -- Evaluate feasibility + lock decisions
- Skill: maestro-plan -- Plan directly if scope is clear
- Skill: maestro-spec-generate -- Generate full spec package from brainstorm
```

4. Copy artifacts to output `.brainstorming/` directory (phase mode or scratch mode target)
5. Update phase `index.json` with brainstorm status (if phase mode)
6. Display summary with next step suggestions

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
| `terminology` | `data.term` | `{term, definition, aliases[], category}` | Domain term extracted |
| `non_goal` | `data.title` | `{title, rationale}` | Scope exclusion identified |
| `feature_candidate` | `data.id` | `{id, slug, description, roles[], priority}` | Feature decomposed from topic |
| `role_insight` | `data.role+data.topic` | `{role, topic, insight, confidence}` | Role-specific finding |
| `cross_role_conflict` | `data.area` | `{area, roles[], positions[], resolution}` | Cross-role disagreement |

#### Protocol

Read `discoveries.ndjson` before analysis. Append-only: dedup by type+key before writing, never modify/delete.

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"terminology","data":{"term":"CRDT","definition":"Conflict-free Replicated Data Type","aliases":["conflict-free"],"category":"technical"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Topic argument missing | Abort with error: "Topic text required" |
| Invalid role name in selection | Filter to valid roles, warn user |
| Role count exceeds 9 | Cap at 9 with warning |
| Guidance agent timeout | Mark as failed, abort pipeline (wave 2 depends on guidance) |
| Role agent timeout | Mark as failed, continue with remaining roles |
| All role agents failed | Skip synthesis (wave 3), report partial results |
| Synthesis agent failed | Use wave 2 results directly, no feature index |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| Phase directory not found | Abort with error: "Phase {N} not found" |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All 3 waves executed in order
- [ ] guidance-specification.md produced in .brainstorming/
- [ ] Role analysis files produced per selected role
- [ ] Synthesis artifacts produced (feature specs or synthesis-specification.md)
- [ ] feature-index.json and synthesis-changelog.md produced
- [ ] context.md produced with full brainstorm report
- [ ] Artifacts copied to target .brainstorming/ directory
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
