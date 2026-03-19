# Maestro → Codex CSV Wave Migration Design

## Executive Summary

Migrate 32 `.claude/commands/*.md` to `.codex/skills/maestro/` Codex skills, leveraging `spawn_agents_on_csv` for parallel execution where commands have independent subtasks. Commands are classified into 4 tiers based on parallelism potential.

**Key Insight**: Maestro commands follow a thin-contract pattern (command → workflow). CSV Wave migration replaces the Agent-based parallelism in workflows with `spawn_agents_on_csv` declarative orchestration, gaining: automatic wave computation, cross-wave context propagation, CSV-based state tracking, and discovery board sharing.

---

## Architecture: Dual-Layer Skill System

```
.codex/skills/maestro/
├── SKILL.md                          # Router skill (replaces /maestro coordinator)
├── DESIGN.md                         # Migration design document
├── shared/                           # Shared utilities (all skills)
│   ├── discovery-protocol.md         # Standard discovery types + protocol
│   └── wave-engine.md                # Wave computation + execution engine (includes session init + CSV merge)
├── schemas/                          # Per-skill CSV schemas (Tier A only, flat)
│   ├── review-tasks.md
│   └── spec-map-tasks.md
├── instructions/                     # Per-skill agent instructions (Tier A only, flat)
│   ├── review-agent.md
│   └── spec-map-agent.md
└── skills/                           # Individual migrated commands
    ├── execute/SKILL.md              # Tier A: CSV Wave
    ├── review/SKILL.md
    ├── brainstorm/SKILL.md
    ├── verify/SKILL.md
    ├── issue-discover/SKILL.md
    ├── spec-map/SKILL.md
    ├── analyze/SKILL.md
    ├── test-gen/SKILL.md
    ├── integration-test/SKILL.md
    ├── codebase-rebuild/SKILL.md
    ├── debug/SKILL.md               # Tier B: Light CSV (2-wave)
    ├── plan/SKILL.md
    ├── spec-generate/SKILL.md
    ├── roadmap/SKILL.md
    ├── init/SKILL.md                # Tier C: Single Agent
    ├── quick/SKILL.md
    ├── phase-transition/SKILL.md
    ├── phase-add/SKILL.md
    ├── milestone-audit/SKILL.md
    ├── milestone-complete/SKILL.md
    ├── ui-design/SKILL.md
    ├── test/SKILL.md
    ├── refactor/SKILL.md
    ├── status/SKILL.md              # Tier D: Simple (no agent)
    ├── sync/SKILL.md
    ├── spec-setup/SKILL.md
    ├── spec-add/SKILL.md
    ├── spec-load/SKILL.md
    ├── memory/SKILL.md
    ├── memory-capture/SKILL.md
    ├── issue/SKILL.md
    └── codebase-refresh/SKILL.md
```

---

## Command Classification

### Tier A: Full CSV Wave (10 commands) — spawn_agents_on_csv

Commands with independent parallel subtasks. Maximum benefit from CSV Wave.

| Command | Parallelism Pattern | Wave Topology | Tasks | Rationale |
|---------|-------------------|---------------|-------|-----------|
| `maestro-execute` | Task waves from plan.json | Diamond/Custom | 3-20 | Already wave-based; perfect 1:1 mapping |
| `quality-review` | 6 dimension agents | Independent Parallel | 6 | Each dimension is independent |
| `maestro-brainstorm` | N role analysis agents | Wide Funnel | 3-9 | Parallel roles → synthesis |
| `maestro-verify` | 3-layer verification | Staged Parallel | 3-6 | Layer 1,2,3 partially parallelizable |
| `manage-issue-discover` | 8 perspective agents | Wide Funnel | 8 | Each perspective independent |
| `spec-map` | 4 mapper agents | Independent Parallel | 4 | Perfect independent parallel |
| `maestro-analyze` | Multi-dimension analysis | Diamond | 4-8 | Explore → Score → Decide |
| `quality-test-gen` | Per-module test gen | Independent Parallel | 3-10 | One agent per source module |
| `quality-integration-test` | Multi-layer test exec | Staged Parallel | 4-8 | L0→L1→L2→L3 progressive |
| `manage-codebase-rebuild` | Parallel doc generators | Independent Parallel | 4-6 | Independent doc dimensions |

### Tier B: Light CSV (4 commands) — 2-wave CSV

Commands with limited parallelism (explore → act pattern). Simple 2-wave CSV.

| Command | Wave 1 | Wave 2 | Rationale |
|---------|--------|--------|-----------|
| `quality-debug` | Parallel hypothesis generation | Parallel fix attempts | Hypothesis → verify → fix |
| `maestro-plan` | Parallel exploration | Sequential planning | Explore context → generate plan |
| `maestro-spec-generate` | Parallel research | Sequential document gen | 7-phase but research is parallel |
| `maestro-roadmap` | Parallel requirement analysis | Sequential roadmap assembly | Analyze → compose |

### Tier C: Single Agent (9 commands) — No CSV needed

Sequential commands where CSV adds overhead without benefit. Migrate as simple Codex skills.

| Command | Reason |
|---------|--------|
| `maestro-init` | Sequential project setup |
| `maestro-quick` | Single fast-track execution |
| `maestro-phase-transition` | State machine transition |
| `maestro-phase-add` | Single roadmap mutation |
| `maestro-milestone-audit` | Sequential audit |
| `maestro-milestone-complete` | Sequential archive |
| `maestro-ui-design` | Interactive design flow |
| `quality-test` | UAT with session persistence (interactive) |
| `quality-refactor` | Iterative refactoring cycle |

### Tier D: Simple Utility (9 commands) — Direct Codex skill

Lightweight commands with no agent spawning. Simple read/write operations.

| Command | Type |
|---------|------|
| `manage-status` | Dashboard display |
| `spec-setup` | Interactive questionnaire |
| `spec-add` | Single record append |
| `spec-load` | File reader |
| `manage-memory` | Memory CRUD |
| `manage-memory-capture` | Session capture |
| `manage-issue` | Issue CRUD |
| `manage-codebase-refresh` | Incremental update |
| `quality-sync` | Git diff → doc update |

---

## Tier A Detailed CSV Schema Designs

### A1: maestro-execute (Task Execution Pipeline)

**Topology**: Custom (from plan.json waves)
**Source**: plan.json defines tasks and waves; CSV is built from task definitions.

```csv
id,title,description,scope,convergence_criteria,hints,execution_directives,deps,context_from,wave,status,findings,files_modified,tests_passed,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Task ID (TASK-001 format) |
| `title` | Input | Short task title |
| `description` | Input | Full task description from TASK-*.json |
| `scope` | Input | Target file/dir glob |
| `convergence_criteria` | Input | Grep-verifiable completion criteria |
| `hints` | Input | Implementation hints + reference files |
| `execution_directives` | Input | Verification commands to run |
| `deps` | Input | Task dependency IDs |
| `context_from` | Input | Context source task IDs |
| `wave` | Computed | From plan.json wave assignment |
| `status` | Output | pending/completed/failed/skipped |
| `findings` | Output | Implementation notes |
| `files_modified` | Output | Modified file list |
| `tests_passed` | Output | Test pass/fail status |
| `error` | Output | Error if failed |

**Discovery types**: `code_pattern`, `integration_point`, `convention`, `blocker`, `tech_stack`, `test_command`

**Wave computation**: Direct from plan.json waves (no Kahn's needed — already computed).

---

### A2: quality-review (Dimension Review Pipeline)

**Topology**: Wide Funnel (6 parallel → 1 aggregation)

```csv
id,title,description,dimension,changed_files,project_specs,deps,context_from,wave,status,findings,severity_counts,top_issues,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `dimension` | Input | correctness/security/performance/architecture/maintainability/best-practices |
| `changed_files` | Input | Files to review (semicolon-separated) |
| `project_specs` | Input | Relevant spec context |
| `severity_counts` | Output | JSON: {critical, high, medium, low} |
| `top_issues` | Output | Top 5 issues with file:line refs |

**Waves**:
- Wave 1: 6 dimension agents (independent parallel)
- Wave 2: 1 aggregation agent (synthesis + deep-dive if criticals)

**Discovery types**: `vulnerability`, `code_smell`, `performance_hotspot`, `architecture_violation`

---

### A3: maestro-brainstorm (Multi-Role Analysis Pipeline)

**Topology**: Diamond (guidance → N roles → synthesis)

```csv
id,title,description,role,topic,guidance_spec,deps,context_from,wave,status,findings,analysis_file,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `role` | Input | Role identifier (system-architect, ui-designer, etc.) |
| `topic` | Input | Brainstorm topic |
| `guidance_spec` | Input | guidance-specification.md content reference |
| `analysis_file` | Output | Path to generated analysis.md |

**Waves**:
- Wave 1: 1 guidance-specification generator
- Wave 2: 3-9 role analysis agents (parallel)
- Wave 3: 1 synthesis + feature-index agent

---

### A4: maestro-verify (3-Layer Verification Pipeline)

**Topology**: Staged Parallel

```csv
id,title,description,layer,phase_dir,check_type,deps,context_from,wave,status,findings,gaps_found,fix_plan,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `layer` | Input | truth/artifact/wiring/antipattern/nyquist |
| `phase_dir` | Input | Phase directory path |
| `check_type` | Input | Specific check within layer |
| `gaps_found` | Output | JSON array of gap descriptions |
| `fix_plan` | Output | Suggested fix actions |

**Waves**:
- Wave 1: Truth checks + Artifact existence checks (parallel)
- Wave 2: Artifact substance + Wiring checks (need truth context)
- Wave 3: Anti-pattern scan + Nyquist audit (parallel, need artifact context)

---

### A5: manage-issue-discover (Multi-Perspective Discovery)

**Topology**: Wide Funnel (8 parallel → 1 dedup)

```csv
id,title,description,perspective,scope_glob,deps,context_from,wave,status,findings,issues_found,severity_distribution,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `perspective` | Input | security/performance/reliability/maintainability/scalability/ux/accessibility/compliance |
| `scope_glob` | Input | File scope for analysis |
| `issues_found` | Output | JSON array of discovered issues |
| `severity_distribution` | Output | JSON: {critical, high, medium, low, info} |

**Waves**:
- Wave 1: 8 perspective agents (independent parallel)
- Wave 2: 1 dedup + issue creation agent

---

### A6: spec-map (Codebase Mapper Pipeline)

**Topology**: Independent Parallel (single wave)

```csv
id,title,description,focus_area,output_file,deps,context_from,wave,status,findings,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `focus_area` | Input | tech-stack/architecture/features/concerns |
| `output_file` | Input | Target output file path |

**Waves**: Single wave — all 4 mappers independent.

**Discovery types**: `tech_stack`, `code_pattern`, `integration_point`, `convention`

---

### A7: maestro-analyze (Multi-Dimension Analysis)

**Topology**: Diamond (explore → score → decide)

```csv
id,title,description,dimension,analysis_type,deps,context_from,wave,status,findings,score,recommendations,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `dimension` | Input | Analysis dimension name |
| `analysis_type` | Input | explore/score/decide |
| `score` | Output | 0-100 score for this dimension |
| `recommendations` | Output | Dimension-specific recommendations |

**Waves**:
- Wave 1: CLI exploration agents (parallel)
- Wave 2: 6-dimension scoring agents (parallel)
- Wave 3: Decision synthesis agent

---

### A8: quality-test-gen (Test Generation Pipeline)

**Topology**: Independent Parallel

```csv
id,title,description,source_file,test_type,test_framework,deps,context_from,wave,status,findings,tests_created,coverage_delta,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `source_file` | Input | Source file to test |
| `test_type` | Input | unit/integration/e2e |
| `test_framework` | Input | jest/vitest/mocha/etc |
| `tests_created` | Output | Generated test file paths |
| `coverage_delta` | Output | Coverage improvement |

**Waves**: Single wave — each source file gets independent test agent.

---

### A9: quality-integration-test (Progressive Test Layers)

**Topology**: Linear Pipeline (L0 → L1 → L2 → L3)

```csv
id,title,description,test_layer,test_scope,deps,context_from,wave,status,findings,tests_passed,tests_failed,coverage,error
```

| Column | Phase | Description |
|--------|-------|-------------|
| `test_layer` | Input | L0-static/L1-unit/L2-integration/L3-e2e |
| `test_scope` | Input | Files/modules to test |
| `tests_passed` | Output | Count of passing tests |
| `tests_failed` | Output | Count of failing tests |
| `coverage` | Output | Coverage percentage |

**Waves**:
- Wave 1: L0 static analysis
- Wave 2: L1 unit tests (parallel per module)
- Wave 3: L2 integration tests
- Wave 4: L3 E2E tests

---

### A10: manage-codebase-rebuild (Parallel Doc Generation)

**Topology**: Independent Parallel

```csv
id,title,description,doc_dimension,output_path,deps,context_from,wave,status,findings,error
```

Same as spec-map but produces full documentation set in `.workflow/codebase/`.

---

## Router Skill Design (SKILL.md)

The root `SKILL.md` replaces the `/maestro` coordinator command.

See `SKILL.md` for the full router implementation with 32+ skill routes, 7 chain definitions, state-based routing, and fuzzy-match fallback.

---

## Migration Priority

### Phase 1: Foundation (Tier A core)
1. `maestro-execute` — Core execution engine, most complex, highest value
2. `quality-review` — Clean parallel pattern, validates CSV wave approach
3. `spec-map` — Simple independent parallel, good starter

### Phase 2: Analysis & Discovery
4. `manage-issue-discover` — 8-perspective parallel
5. `maestro-analyze` — Diamond topology
6. `maestro-brainstorm` — Multi-role parallel

### Phase 3: Quality Pipeline
7. `maestro-verify` — Staged parallel
8. `quality-test-gen` — Independent parallel
9. `quality-integration-test` — Linear pipeline
10. `manage-codebase-rebuild` — Independent parallel

### Phase 4: Light CSV + Single Agent
11-14. Tier B commands (debug, plan, spec-generate, roadmap)
15-23. Tier C commands (init, quick, phase-*, milestone-*, ui-design, test, refactor)

### Phase 5: Utilities
24-32. Tier D commands (status, spec-*, memory-*, issue, sync)

---

## Instruction Template Pattern (Tier A)

All Tier A skills share a common instruction template structure:

```markdown
## TASK ASSIGNMENT

### MANDATORY FIRST STEPS
1. Read shared discoveries: {session_folder}/discoveries.ndjson (if exists)
2. Read project context: .workflow/project-tech.json (if exists)
3. Read project specs: .workflow/specs/ (if exists)

## Your Task

**Task ID**: {id}
**Title**: {title}
**Description**: {description}
**[Domain Column]**: {domain_value}

### Previous Tasks' Findings
{prev_context}

## Execution Protocol

1. Read discoveries board for shared exploration findings
2. Apply previous task findings from prev_context
3. [DOMAIN-SPECIFIC EXECUTION STEPS]
4. Share discoveries:
   ```bash
   echo '{"ts":"<ISO>","worker":"{id}","type":"<type>","data":{...}}' >> {session_folder}/discoveries.ndjson
   ```
5. Report result via report_agent_job_result

## Output

{
  "id": "{id}",
  "status": "completed" | "failed",
  "findings": "...",
  [domain_output_fields],
  "error": ""
}
```

---

## Context Flow Strategy

| Tier A Skill | Context Channel | Discovery Value |
|-------------|----------------|-----------------|
| execute | Directed (task deps) | High (shared code patterns) |
| review | None (wave 1) + Directed (wave 2) | High (cross-dimension findings) |
| brainstorm | Directed (guidance → roles → synthesis) | Moderate (role insights) |
| verify | Directed (layer chain) | Moderate (gap propagation) |
| issue-discover | None (wave 1) + Directed (wave 2) | High (cross-perspective dedup) |
| spec-map | None (single wave) | High (codebase conventions) |
| analyze | Directed (explore → score → decide) | Moderate (exploration findings) |
| test-gen | None (single wave) | High (test patterns, fixtures) |
| integration-test | Directed (L0→L1→L2→L3) | High (test commands, coverage gaps) |
| codebase-rebuild | None (single wave) | High (tech stack, patterns) |

---

## Session Structure (Unified)

All Tier A skills use the same session directory structure:

```
.workflow/.csv-wave/{skill}-{slug}-{date}/
├── tasks.csv                # Master state
├── wave-{N}.csv             # Temporary per-wave input
├── wave-{N}-results.csv     # Per-wave output
├── results.csv              # Final aggregated results
├── discoveries.ndjson       # Shared discovery board
├── context.md               # Human-readable report
└── config.json              # Session metadata (skill, args, timestamps)
```

---

## Key Differences from Claude Commands

| Aspect | Claude Commands | Codex CSV Wave Skills |
|--------|---------------|----------------------|
| Orchestration | Agent tool spawn + wait | spawn_agents_on_csv batch |
| Parallelism | Manual (multiple Agent calls) | Automatic (wave grouping) |
| State | In-memory + workflow files | CSV is source of truth |
| Context flow | Agent prompt injection | prev_context column |
| Knowledge sharing | File-based (ad-hoc) | Discovery board (structured NDJSON) |
| Resumability | Workflow state.json | CSV state reload (--continue) |
| Progress tracking | index.json updates | CSV status column |
| Failure handling | Per-agent try/catch | Cascading skip + wave retry |

---

## Workflow File Reuse

Existing `workflows/*.md` files are **NOT migrated**. They remain as Claude Code workflow references. Codex skills embed execution logic directly in SKILL.md following CSV Wave Pipeline conventions.

**Mapping**: Each workflow file's logic is translated into CSV decomposition rules + agent instruction templates within the corresponding Codex skill.

| Workflow File | Codex Equivalent |
|--------------|-----------------|
| `workflows/execute.md` | skills/execute/SKILL.md Phase 1-3 |
| `workflows/review.md` | skills/review/SKILL.md Phase 1-3 |
| `workflows/brainstorm.md` | skills/brainstorm/SKILL.md Phase 1-3 |
| ... | ... |

---

## Generation Plan

Use the `csv-wave-skill-designer` meta-skill to generate each Tier A skill:

```
For each Tier A command:
  1. Input: .claude/commands/{command}.md + workflows/{workflow}.md
  2. Mode: Conversion (existing skill → CSV wave)
  3. csv-wave-skill-designer Phase 1: Extract domain, topology, columns
  4. csv-wave-skill-designer Phase 2: Design CSV schema, context flow
  5. csv-wave-skill-designer Phase 3: Generate SKILL.md + schemas/ + instructions/
  6. csv-wave-skill-designer Phase 4: Validate + deliver to .codex/skills/maestro/skills/{name}/
```

**Batch execution**: Use CSV Wave Pipeline itself to generate skills in parallel (meta-bootstrapping):

```csv
id,title,description,source_command,source_workflow,topology,deps,context_from,wave
1,execute,Generate execute skill,maestro-execute.md,execute.md,custom,,1
2,review,Generate review skill,quality-review.md,review.md,wide-funnel,,1
3,spec-map,Generate spec-map skill,spec-map.md,map.md,independent,,1
4,issue-discover,Generate issue-discover skill,manage-issue-discover.md,issue-discover.md,wide-funnel,,1
5,brainstorm,Generate brainstorm skill,maestro-brainstorm.md,brainstorm.md,diamond,,1
6,analyze,Generate analyze skill,maestro-analyze.md,analyze.md,diamond,,1
7,verify,Generate verify skill,maestro-verify.md,verify.md,staged,1,1,2
8,test-gen,Generate test-gen skill,quality-test-gen.md,test-gen.md,independent,,1
9,integration-test,Generate integration-test skill,quality-integration-test.md,integration-test.md,linear,,1
10,codebase-rebuild,Generate codebase-rebuild skill,manage-codebase-rebuild.md,codebase-rebuild.md,independent,,1
```

Wave 1: Commands 1-6,8-10 (independent — can generate in parallel)
Wave 2: Command 7 (verify depends on execute's schema for gap-fix integration)
