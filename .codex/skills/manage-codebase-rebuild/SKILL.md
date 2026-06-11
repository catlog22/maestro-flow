---
name: manage-codebase-rebuild
description: Rebuild all codebase documentation from scratch
argument-hint: "[-y|--yes] [-c|--concurrency 5] [--continue] \"[--force] [--skip-commit]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Single-wave parallel execution -- 5 independent doc generator agents each analyze a different documentation dimension of the codebase. All agents run concurrently with no dependencies. This is a destructive operation that rebuilds the entire `.workflow/codebase/` directory from scratch.

**Core workflow**: Prepare Directory -> Decompose Doc Dimensions -> Parallel Generation -> Assemble doc-index.json

**Topology**: Independent Parallel (single wave)

```
+---------------------------------------------------------------------------+
|                  CODEBASE REBUILD CSV WAVE WORKFLOW                        |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Setup -> CSV                                                    |
|     +-- Validate .workflow/ exists                                        |
|     +-- Confirm rebuild (or --force / -y)                                 |
|     +-- Clear .workflow/codebase/ directory                               |
|     +-- Detect source directories (src/, lib/, app/, packages/)           |
|     +-- Generate tasks.csv with 5 doc generator tasks                    |
|     +-- All tasks wave 1 (no dependencies)                               |
|                                                                           |
|  Phase 2: Wave Execution (Single Wave)                                    |
|     +-- Wave 1: All 5 generators run concurrently                        |
|     |   +-- Component Scanner (TC-* entries)                             |
|     |   +-- Feature Mapper (FT-* entries)                                |
|     |   +-- Requirement Linker (REQ-* entries, if specs exist)           |
|     |   +-- Tech Registry Writer (tech-registry/*.md)                    |
|     |   +-- Feature Map Writer (feature-maps/*.md)                       |
|     +-- discoveries.ndjson shared (append-only)                          |
|                                                                           |
|  Phase 3: Results -> .workflow/codebase/                                  |
|     +-- Assemble doc-index.json from agent findings                      |
|     +-- Validate all output files exist                                  |
|     +-- Update state.json with rebuild timestamp                         |
|     +-- Generate context.md summary                                      |
|     +-- Auto-commit (unless --skip-commit)                               |
|     +-- Display completion report                                        |
|                                                                           |
+---------------------------------------------------------------------------+
```

</purpose>

<context>
$ARGUMENTS -- optional flags for rebuild control.

**Usage**:

```bash
$manage-codebase-rebuild ""
$manage-codebase-rebuild -y "--force"
$manage-codebase-rebuild -c 5 "--force --skip-commit"
$manage-codebase-rebuild --continue "20260318-rebuild-full"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode, implies --force)
- `-c, --concurrency N`: Max concurrent agents (default: 5)
- `--continue`: Resume existing session

**Inner flags** (passed inside quotes):
- `--force`: Clear existing .workflow/codebase/ and rebuild from scratch
- `--skip-commit`: Do not auto-commit after rebuild

When `--yes` or `-y`: Auto-confirm rebuild (implies --force), skip all prompts.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report)
**Target**: `.workflow/codebase/` (doc-index.json, tech-registry/, feature-maps/)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,doc_dimension,output_path,deps,context_from,wave
"1","Component Scanner","Scan all source directories for components: models, services, controllers, utils, types, config, middleware, core modules. For each component extract exported symbols, determine type, record code locations. Return JSON array of component entries with id (TC-NNN), name, type, code_locations, symbols via output_schema. Do NOT write files — orchestrator assembles doc-index.json in Phase 3.","components","<ABS_WORKFLOW>/codebase/doc-index.json#components","","","1"
"2","Feature Mapper","Group discovered components by domain/functional area using directory proximity, naming patterns, and import relationships. Map features to requirements if <ABS_WORKFLOW>/blueprint/ exists. Return JSON array of feature entries with id (FT-NNN), name, status, component_ids, requirement_ids, phase via output_schema. Do NOT write files.","features","<ABS_WORKFLOW>/codebase/doc-index.json#features","","","1"
"3","Requirement Linker","If <ABS_WORKFLOW>/blueprint/ exists, scan BLP-*/requirements/REQ-*.md files. Parse requirement metadata (title, priority, acceptance_criteria). Match requirements to features by keyword analysis. Also scan for ADR-*.md architecture decisions. Return JSON arrays for requirements and architecture_decisions via output_schema. Do NOT write files.","requirements","<ABS_WORKFLOW>/codebase/doc-index.json#requirements","","","1"
"4","Tech Registry Writer","For each component discovered, use the Write tool to create a markdown documentation file at <ABS_WORKFLOW>/codebase/tech-registry/{slug}.md with: ID, type, features, code locations, exported symbols, dependencies. Also write <ABS_WORKFLOW>/codebase/tech-registry/_index.md with the component table. After all writes, verify every intended file exists with Glob and return file count + absolute paths via output_schema. MUST use the Write tool — files on disk are the deliverable, do NOT return file content as text.","tech-registry","<ABS_WORKFLOW>/codebase/tech-registry/","","","1"
"5","Feature Map Writer","For each feature discovered, use the Write tool to create a markdown documentation file at <ABS_WORKFLOW>/codebase/feature-maps/{slug}.md with: ID, status, phase, requirements, component table. Also write <ABS_WORKFLOW>/codebase/feature-maps/_index.md with the feature table. After all writes, verify every intended file exists with Glob and return file count + absolute paths via output_schema. MUST use the Write tool — files on disk are the deliverable, do NOT return file content as text.","feature-maps","<ABS_WORKFLOW>/codebase/feature-maps/","","","1"
```

**Path resolution (orchestrator MUST do BEFORE writing tasks.csv)**: substitute `<ABS_WORKFLOW>` with the absolute path to the project's `.workflow/` directory (e.g. `D:/maestro2/.workflow`). Agent Write tool requires absolute paths — passing relative `.workflow/...` literals will fail.

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Generator identifier |
| `title` | Input | Doc generator dimension title |
| `description` | Input | Detailed generation instructions |
| `doc_dimension` | Input | Documentation dimension: components/features/requirements/tech-registry/feature-maps |
| `output_path` | Input | Target output path in .workflow/codebase/ |
| `deps` | Input | Empty (all independent) |
| `context_from` | Input | Empty (no cross-task context needed) |
| `wave` | Computed | Always 1 (single wave, independent parallel) |

**Output columns** (returned exclusively via `output_schema`, NOT in wave CSV):

| Column | Description |
|--------|-------------|
| `result_status` | `completed` / `failed` (mapped to master `status` on merge) |
| `result_findings` | Generation summary -- counts, paths, notes (max 500 chars) |
| `error` | Error message if failed |

**Column separation rule**: Input columns and Output columns MUST NOT share names. Wave CSV only contains Input columns + prev_context. Output columns are returned exclusively via output_schema.

### Per-Wave CSV (Temporary)

Single wave generates `wave-1.csv`. No `prev_context` needed (all tasks independent).
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **CSV is Source of Truth**: tasks.csv holds all generator state
3. **Discovery Board is Append-Only**: Generators share findings via NDJSON
4. **Partial Results OK**: If 3/5 generators succeed, still assemble available docs
5. **Destructive by Design**: This is a full rebuild -- existing codebase/ is cleared
6. **Single Wave**: All generators are independent, no wave ordering needed
7. **Cleanup Temp Files**: Remove wave-1.csv after results are merged
8. **DO NOT STOP**: Execute until all generators complete or fail
9. **Absolute Paths Only**: All paths in `description` and `output_path` MUST be absolute before tasks.csv is written. Orchestrator substitutes `<ABS_WORKFLOW>` placeholder; never let it leak into a spawned agent's prompt.
10. **Writer vs Returner Split**: Tasks 1-3 return data via `output_schema` (no file writes). Tasks 4-5 MUST write files via Write tool + verify with Glob. Mixing the two contracts (e.g., returning markdown content as text from tasks 4-5) is a contract violation.
</invariants>

<execution>

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after wave |
| `wave-1.csv` | Wave input (temporary) | Created before wave, deleted after |
| `wave-1-results.csv` | Wave output | Created by spawn_agents_on_csv |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only during wave |
| `context.md` | Human-readable rebuild report | Created in Phase 3 |

### Target Output (in .workflow/codebase/)

| File | Description |
|------|-------------|
| `doc-index.json` | Single source of truth: components, features, requirements, ADRs |
| `tech-registry/_index.md` | Component index table |
| `tech-registry/{slug}.md` | Per-component documentation |
| `feature-maps/_index.md` | Feature index table |
| `feature-maps/{slug}.md` | Per-feature documentation |
| `knowledge-graph.json` | Knowledge Graph: nodes, edges, layers, tour (generated by `maestro kg index`) |

**Wiki Integration**: After rebuild, KG nodes are automatically indexed as virtual wiki entries (type: knowhow, virtualKind: kg-node/kg-layer/kg-tour-step) on next `maestro wiki` access. Verify with `maestro search "kg" --type knowhow`. Use `maestro kg diff-wiki` for future change impact analysis.

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-rebuild-{scope}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- config.json
+-- wave-1.csv (temporary)
+-- wave-1-results.csv (temporary)
```

### Session Initialization

Parse `$ARGUMENTS` to extract:
- `AUTO_YES` from `--yes` / `-y`
- `continueMode` from `--continue`
- `maxConcurrency` from `--concurrency N` / `-c N` (default: 5)
- `forceMode` from `--force` (or implied by AUTO_YES)
- `skipCommit` from `--skip-commit`

Session ID: `{YYYYMMDD}-rebuild-full`
Session folder: `.workflow/.csv-wave/{sessionId}/` — create via `mkdir -p`

### Phase 1: Setup -> CSV

**Objective**: Validate prerequisites, prepare directory, detect source dirs, generate tasks.csv.

**Steps**:

1. **Validate** `.workflow/state.json` exists — abort with "Run init first" if missing
2. **Confirm rebuild**: If `.workflow/codebase/` exists AND NOT forceMode, prompt user. If forceMode or confirmed, clear `.workflow/codebase/`
3. **Prepare directories**:
   ```bash
   mkdir -p .workflow/codebase/tech-registry
   mkdir -p .workflow/codebase/feature-maps
   mkdir -p .workflow/codebase/action-logs
   ```
4. **Detect source directories**: `src/`, `lib/`, `app/`, `packages/` — abort if none found
5. **Load project specs** from `.workflow/specs/` if available
6. **Generate tasks.csv**: 5 rows, all wave 1, no dependencies
7. **User validation**: Display doc generator breakdown (skip if AUTO_YES)

### Phase 2: Wave Execution (Single Wave)

**Objective**: Run all 5 doc generators concurrently via spawn_agents_on_csv.

#### Wave 1: All Generators (Parallel)

Filter master `tasks.csv` for `wave == 1 AND status == pending` → write `wave-1.csv` (no prev_context needed, all independent).

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: REBUILD_INSTRUCTION,                // see "Rebuild Worker Contract" below
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:              { type: "string" },
      result_status:   { type: "string", enum: ["completed", "failed"] },
      result_findings: { type: "string", description: "For task 1-3: JSON payload to merge into doc-index.json. For task 4-5: list of files written" },
      error:           { type: "string" }
    },
    required: ["id", "result_status", "result_findings"]
  }
})
```

Merge `wave-1-results.csv` into master `tasks.csv`: map `result_status` -> master `status`, `result_findings` -> master `findings`, copy `error` as-is. After merge, delete temporary files (`wave-1.csv` and `wave-1-results.csv`).

#### Rebuild Worker Contract (REBUILD_INSTRUCTION)

```
You are a codebase doc generator for ONE task (Component Scanner / Feature Mapper / Requirement Linker / Tech Registry Writer / Feature Map Writer). Your contract depends on your task id — read description carefully.

DUAL CONTRACT (per task id):
  Tasks 1-3 (Scanner/Mapper/Linker) → RETURN data via result_findings (JSON payload). Do NOT write files.
  Tasks 4-5 (Writers) → MUST WRITE files via the Write tool. Verify each via Glob. Return file count + absolute paths via result_findings.

REQUIRED STEPS:
  1. Scan codebase per description and focus_area
  2. For tasks 1-3: assemble JSON payload matching the documented section schema (components / features / requirements)
  3. For tasks 4-5: render markdown documents and write them to disk; verify every intended file exists via Glob; if any file missing → result_status=failed
  4. Append discoveries to {sessionFolder}/discoveries.ndjson if reusable
  5. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success → result_status=completed
  - Failure → unrecoverable error / write verification fails → result_status=failed
  - Timeout → near max_runtime_seconds, finish current write/scan if safe, then report failed with error="timeout (partial)"
  - NEVER skip report_agent_job_result.

CONTRACT VIOLATION GUARD:
  - Tasks 4-5 returning markdown content in result_findings instead of writing files → MUST self-report failed (orchestrator cannot assemble docs from text).
  - Tasks 1-3 writing files to .workflow/codebase/ → MUST self-report failed (orchestrator owns assembly).

OUTPUT (must match output_schema):
  Tasks 1-3:
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "result_findings": "<JSON payload to merge into doc-index.json section>",
    "error": "<message if failed, else empty>"
  }
  Tasks 4-5:
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "result_findings": "<count + semicolon-separated absolute paths of files written>",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Do NOT write to tasks.csv, wave-*.csv, results.csv, doc-index.json (orchestrator assembles in Phase 3).
  - Do NOT call spawn_agents_on_csv (no recursion).
```

### Phase 3: Results -> .workflow/codebase/

**Objective**: Assemble doc-index.json from agent findings, validate, update state.

Export master `tasks.csv` as `results.csv`.

**Assemble doc-index.json** by merging findings from tasks 1-3 (Component Scanner, Feature Mapper, Requirement Linker):
   ```json
   {
     "version": "1.0",
     "schema_version": "1.0",
     "project": "<project name>",
     "last_updated": "<ISO>",
     "features": [],
     "components": [],
     "requirements": [],
     "architecture_decisions": [],
     "actions": []
   }
   ```
   - Write to `.workflow/codebase/doc-index.json`

**Validate output files**: doc-index.json (valid JSON), tech-registry/_index.md, feature-maps/_index.md — log warnings for missing.

**Update state.json**: Set `codebase.last_rebuild` timestamp.

**Generate context.md**:

```markdown
# Codebase Rebuild Report

## Summary
- Components discovered: {count}
- Features mapped: {count}
- Requirements linked: {count}
- ADRs recorded: {count}
- Files generated: {count}
- Generators: {completed}/{total} succeeded

## Generator Results
| Generator | Status | Output | Findings |
|-----------|--------|--------|----------|
| Component Scanner | {status} | {count} components | {summary} |
| Feature Mapper | {status} | {count} features | {summary} |
| Requirement Linker | {status} | {count} requirements | {summary} |
| Tech Registry Writer | {status} | {count} files | {summary} |
| Feature Map Writer | {status} | {count} files | {summary} |

## Discovery Board Summary
{aggregated discovery findings}

## Next Steps
- Run manage-status to review
- Run manage-codebase-refresh for future incremental updates
```

**Auto-commit** (unless --skip-commit): Stage `.workflow/codebase/` files, commit "docs(codebase): full rebuild of codebase documentation".

**Display completion report**:

```
=== CODEBASE REBUILD COMPLETE ===
Components: {count}
Features:   {count}
Requirements: {count}
ADRs:       {count}
Files:      {count} generated in .workflow/codebase/

Generators: {completed}/{total} succeeded
{if failures: "W001: {failed_generator} failed -- partial results available"}

Next steps:
  $manage-status
  $manage-codebase-refresh
  maestro kg stats           # verify KG
  maestro search "kg" --type knowhow  # verify wiki integration
  maestro kg diff-wiki       # future change impact
```

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack identified |
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project coding conventions |

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `component` | `data.id` | `{id, name, type, code_locations[]}` | Component discovered by scanner |
| `feature_group` | `data.name` | `{name, component_ids[], directory}` | Feature grouping identified |

#### Protocol

Read `{session_folder}/discoveries.ndjson` before own analysis. Deduplicate by type + dedup key before writing. Append-only — never modify or delete. Generators share discoveries to skip redundant scanning.

```bash
echo '{"ts":"<ISO>","worker":"1","type":"tech_stack","data":{"framework":"Express","language":"TypeScript","tools":["jest","eslint","prettier"]}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>
| Error | Resolution |
|-------|------------|
| .workflow/ not initialized | Abort: "Run init first" (E001) |
| No source directories found | Abort: "No source files in project" |
| .workflow/codebase/ exists without --force | Prompt user for confirmation |
| Generator agent timeout | Mark as failed, continue with other generators |
| Generator agent failed | Mark as failed, log W001, output partial results |
| doc-index.json assembly fails | Use available generator outputs, log missing sections |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
</error_codes>

<success_criteria>
- [ ] Session initialized with tasks.csv
- [ ] .workflow/codebase/ cleared (if --force or confirmed)
- [ ] All 5 doc generators executed via spawn_agents_on_csv
- [ ] doc-index.json assembled from generator findings
- [ ] tech-registry/ and feature-maps/ populated with markdown docs
- [ ] state.json updated with rebuild timestamp
- [ ] context.md generated with rebuild report
- [ ] Auto-commit performed (unless --skip-commit)
- [ ] Completion report displayed with counts and next steps
</success_criteria>
