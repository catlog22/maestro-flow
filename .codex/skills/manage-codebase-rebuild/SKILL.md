---
name: manage-codebase-rebuild
description: Full codebase documentation rebuild via CSV wave pipeline. Spawns 5 parallel doc generator agents to scan project and produce complete .workflow/codebase/ documentation set. Replaces manage-codebase-rebuild command.
argument-hint: "[-y|--yes] [-c|--concurrency 5] [--continue] \"[--force] [--skip-commit]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
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
$manage-codebase-rebuild --continue "rebuild-full-20260318"
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
id,title,description,doc_dimension,output_path,deps,context_from,wave,status,findings,error
"1","Component Scanner","Scan all source directories for components: models, services, controllers, utils, types, config, middleware, core modules. For each component extract exported symbols, determine type, record code locations. Output JSON array of component entries with id (TC-NNN), name, type, code_locations, symbols.","components",".workflow/codebase/doc-index.json#components","","","1","","",""
"2","Feature Mapper","Group discovered components by domain/functional area using directory proximity, naming patterns, and import relationships. Map features to requirements if .workflow/task-specs/ exists. Output JSON array of feature entries with id (FT-NNN), name, status, component_ids, requirement_ids, phase.","features",".workflow/codebase/doc-index.json#features","","","1","","",""
"3","Requirement Linker","If .workflow/task-specs/ exists, scan SPEC-*/requirements/REQ-*.md files. Parse requirement metadata (title, priority, acceptance_criteria). Match requirements to features by keyword analysis. Also scan for ADR-*.md architecture decisions. Output JSON arrays for requirements and architecture_decisions.","requirements",".workflow/codebase/doc-index.json#requirements","","","1","","",""
"4","Tech Registry Writer","For each component discovered, generate a markdown documentation file in .workflow/codebase/tech-registry/{slug}.md with: ID, type, features, code locations, exported symbols, dependencies. Generate _index.md with component table. Output file count and paths.","tech-registry",".workflow/codebase/tech-registry/","","","1","","",""
"5","Feature Map Writer","For each feature discovered, generate a markdown documentation file in .workflow/codebase/feature-maps/{slug}.md with: ID, status, phase, requirements, component table. Generate _index.md with feature table. Output file count and paths.","feature-maps",".workflow/codebase/feature-maps/","","","1","","",""
```

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
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Generation summary -- counts, paths, notes (max 500 chars) |
| `error` | Output | Error message if failed |

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

### Session Structure

```
.workflow/.csv-wave/rebuild-{scope}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- config.json
+-- wave-1.csv (temporary)
+-- wave-1-results.csv (temporary)
```

### Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue')
const concurrencyMatch = $ARGUMENTS.match(/(?:--concurrency|-c)\s+(\d+)/)
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 5

// Parse rebuild-specific flags
const forceMode = $ARGUMENTS.includes('--force') || AUTO_YES
const skipCommit = $ARGUMENTS.includes('--skip-commit')

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `rebuild-full-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

### Phase 1: Setup -> CSV

**Objective**: Validate prerequisites, prepare directory, detect source dirs, generate tasks.csv.

**Steps**:

1. **Validate .workflow/ exists**:
   - Check `.workflow/state.json` exists
   - If not: abort with "Run init first"

2. **Confirm rebuild**:
   - If `.workflow/codebase/` exists AND NOT forceMode:
     ```
     AskUserQuestion: "Codebase docs already exist. Rebuild will overwrite all files. Continue? [y/N]"
     If no: exit
     ```
   - If forceMode or confirmed: clear `.workflow/codebase/`

3. **Prepare directory structure**:
   ```bash
   mkdir -p .workflow/codebase/tech-registry
   mkdir -p .workflow/codebase/feature-maps
   mkdir -p .workflow/codebase/action-logs
   ```

4. **Detect source directories**:
   - Check for: `src/`, `lib/`, `app/`, `packages/`
   - Read `project-tech.json` if available for `source_dirs`
   - If no source directories found: abort with "No source files in project"

5. **Load project specs** (if available):
   - Read `.workflow/specs/` for architecture context

6. **Generate tasks.csv**: 5 rows, all wave 1, no dependencies.

7. **User validation**: Display doc generator breakdown. Skip if AUTO_YES.

### Phase 2: Wave Execution (Single Wave)

**Objective**: Run all 5 doc generators concurrently via spawn_agents_on_csv.

#### Wave 1: All Generators (Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (single wave, all independent)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildRebuildInstruction(sessionFolder, sourceDirs),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 900,
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

### Phase 3: Results -> .workflow/codebase/

**Objective**: Assemble doc-index.json from agent findings, validate, update state.

1. Read final master `tasks.csv`
2. Export as `results.csv`

3. **Assemble doc-index.json**:
   - Read component findings from task 1 (Component Scanner)
   - Read feature findings from task 2 (Feature Mapper)
   - Read requirement/ADR findings from task 3 (Requirement Linker)
   - Merge into complete doc-index.json:
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

4. **Validate output files**:
   - Check doc-index.json exists and is valid JSON
   - Check tech-registry/_index.md exists (from task 4)
   - Check feature-maps/_index.md exists (from task 5)
   - Log warnings for any missing files

5. **Update state.json**: Set `codebase.last_rebuild` timestamp.

6. **Generate context.md**:

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

7. **Auto-commit** (unless --skip-commit):
   - Stage `.workflow/codebase/` files
   - Suggest commit: "docs(codebase): full rebuild of codebase documentation"

8. **Display completion report**:

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
  Skill({ skill: "manage-status" })
  Skill({ skill: "manage-codebase-refresh" })
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

1. **Read** `{session_folder}/discoveries.ndjson` before own analysis
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as discovered
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"1","type":"tech_stack","data":{"framework":"Express","language":"TypeScript","tools":["jest","eslint","prettier"]}}' >> {session_folder}/discoveries.ndjson
```

Generators share discoveries so other generators can skip redundant scanning (e.g., Component Scanner discovers components, Feature Mapper and Tech Registry Writer can leverage those findings).
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
