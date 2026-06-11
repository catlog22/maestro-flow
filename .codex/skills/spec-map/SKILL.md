---
name: spec-map
description: Map codebase tech-stack, architecture, features, and concerns
argument-hint: "[-y|--yes] [-c|--concurrency 4] [--continue] \"[focus area]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Single-wave parallel execution — 4 independent mapper agents each analyze a different codebase dimension. No dependencies between tasks, maximum parallelism.

**Topology**: Independent Parallel (single wave)

```
┌──────────────────────────────────────────────────────┐
│               CODEBASE MAPPER WORKFLOW                 │
├──────────────────────────────────────────────────────┤
│                                                        │
│  Phase 1: Setup → CSV                                  │
│     ├─ Detect focus area from arguments                │
│     ├─ Generate tasks.csv with 4 mapper tasks          │
│     └─ All tasks wave 1 (no dependencies)              │
│                                                        │
│  Phase 2: Wave Execution (Single Wave)                 │
│     ├─ Wave 1: All 4 mappers run concurrently          │
│     │   ├─ Tech Stack mapper                           │
│     │   ├─ Architecture mapper                         │
│     │   ├─ Features mapper                             │
│     │   └─ Cross-cutting Concerns mapper               │
│     └─ discoveries.ndjson shared (append-only)         │
│                                                        │
│  Phase 3: Results → .workflow/codebase/                 │
│     ├─ Write output files from agent findings          │
│     ├─ Generate context.md summary                     │
│     └─ Display completion report                       │
│                                                        │
└──────────────────────────────────────────────────────┘
```
</purpose>

<context>

```bash
$spec-map ""
$spec-map "auth"
$spec-map -c 4 "api layer"
$spec-map --continue "20260318-map-auth"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto-confirm mapper assignment, skip validation)
- `-c, --concurrency N`: Max concurrent agents (default: 4)
- `--continue`: Resume existing session

**Output**: `.workflow/codebase/` (tech-stack.md, architecture.md, features.md, concerns.md)

</context>

<csv_schema>

### tasks.csv

```csv
id,title,description,focus_area,output_file,deps,context_from,wave,status,findings,error
"1","Tech Stack Analysis","Analyze languages, frameworks, dependencies, build system, package managers, runtime configuration. Scan package.json, build configs, CI/CD files.","full","tech-stack.md","","","1","pending","",""
"2","Architecture Analysis","Analyze project structure, module boundaries, layer architecture, data flow patterns, entry points, API surface. Map directory tree and import graph.","full","architecture.md","","","1","pending","",""
"3","Features Analysis","Inventory user-facing capabilities, API endpoints, CLI commands, UI components, background jobs, integrations. Map to source locations.","full","features.md","","","1","pending","",""
"4","Cross-cutting Concerns","Analyze error handling patterns, logging strategy, authentication/authorization, configuration management, testing approach, observability.","full","concerns.md","","","1","pending","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Mapper identifier |
| `title` | Input | Mapper dimension title |
| `description` | Input | Detailed analysis instructions |
| `focus_area` | Input | Focus scope (full or specific area) |
| `output_file` | Input | Target output filename in .workflow/codebase/ |
| `deps` | Input | Empty (all independent) |
| `context_from` | Input | Empty (no cross-task context) |
| `wave` | Computed | Always 1 (single wave) |
| `status` | Lifecycle | `pending` (initial) → `completed`/`failed`/`skipped` (set by merge step from worker's `result_status`) |
| `findings` | Lifecycle | Analysis summary (max 500 chars; merged from worker output) |
| `error` | Lifecycle | Error if failed (merged) |

**Column separation rule**: Wave CSV (input to `spawn_agents_on_csv`) contains Input columns only. Workers return Output columns exclusively via `output_schema` using `result_status` (NOT `status`). Merge maps `result_status` → master `status`.

</csv_schema>

<invariants>
1. **Start Immediately**: Initialize session, generate CSV, execute
2. **CSV is Source of Truth**: tasks.csv holds all mapper state
3. **Discovery Board is Append-Only**: Mappers share findings
4. **Partial Results OK**: If 3/4 mappers succeed, still write available docs
5. **Focus Area Scoping**: When focus is specified, descriptions narrow to that area
6. **DO NOT STOP**: Execute until all mappers complete or fail
</invariants>

<execution>

### Session Initialization

Parse flags from `$ARGUMENTS` (`-y`, `-c N`, `--continue`). Extract focus area (default: "full"). Generate session ID: `{YYYYMMDD}-map-{focusArea}`. Create session folder at `.workflow/.csv-wave/{sessionId}/` and `.workflow/codebase/`.

### Phase 1: Generate tasks.csv

Generate 4 mapper rows. If focus area specified, scope descriptions to that area.

### Phase 2: Wave Execution

Single wave -- all 4 mappers via `spawn_agents_on_csv`:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,       // only rows where status == "pending"
  id_column: "id",
  instruction: MAPPER_INSTRUCTION,                // see "Mapper Worker Contract" below
  max_concurrency: 4,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id:            { type: "string" },
      result_status: { type: "string", enum: ["completed", "failed"] },
      findings:      { type: "string", maxLength: 500 },
      error:         { type: "string" }
    },
    required: ["id", "result_status", "findings"]
  }
})
```

Merge: write `master.status = result_status`, copy `findings` and `error`. Delete `wave-1.csv` and `wave-1-results.csv`.

#### Mapper Worker Contract (MAPPER_INSTRUCTION)

```
You are a codebase mapper for ONE dimension. Your assigned focus_area, description, and output_file come from your CSV row.

REQUIRED STEPS:
  1. Read shared discoveries: {sessionFolder}/discoveries.ndjson (may be empty)
  2. Scan codebase using Read/Grep/Glob within your focus_area
  3. Synthesize findings into the analysis sections required by your description
  4. Append reusable discoveries (tech_stack / code_pattern / integration_point / convention) to discoveries.ndjson
  5. Call report_agent_job_result EXACTLY ONCE

TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success path → result_status = completed
  - Timeout path → if approaching max_runtime_seconds, STOP and report failed with error="timeout (partial findings)"
  - Failure path → on unrecoverable error, report failed with error message
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.

OUTPUT (return via report_agent_job_result; must match output_schema):
  {
    "id": "<your row id>",
    "result_status": "completed" | "failed",
    "findings": "<analysis summary, max 500 chars — orchestrator uses this to write {output_file}>",
    "error": "<message if failed, else empty>"
  }

CONSTRAINTS:
  - Read-only. Do NOT write to .workflow/codebase/ — orchestrator writes output files from your findings in Phase 3.
  - Do NOT write to tasks.csv, wave-*.csv, or results.csv.
  - Do NOT call spawn_agents_on_csv (no recursion).
```

### Phase 3: Write Output Files

Read each agent's findings, write to `.workflow/codebase/{output_file}`, generate `context.md` summary, display report.

### Shared Discovery Board Protocol

Discovery types particularly valuable for mapper agents:

| Type | Dedup Key | Data Schema |
|------|-----------|-------------|
| `tech_stack` | singleton | `{framework, language, tools[]}` |
| `code_pattern` | `data.name` | `{name, file, description}` |
| `integration_point` | `data.file` | `{file, description, exports[]}` |
| `convention` | singleton | `{naming, imports, formatting}` |

Mappers share discoveries so other mappers can skip redundant exploration (e.g., if tech-stack mapper discovers the framework, features mapper can focus on feature-level analysis).

</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| No source files found | Abort: "No source files in project" |
| Mapper agent timeout | Mark failed, continue with other mappers |
| Mapper agent failed | Mark failed, output partial results |
| .workflow/codebase/ exists | Prompt: refresh/skip/merge (auto-refresh with -y) |

</error_codes>

<success_criteria>
- [ ] tasks.csv generated with 4 mapper tasks
- [ ] All mappers executed (completed or failed with partial results)
- [ ] `.workflow/codebase/` populated with output files
- [ ] context.md summary generated
- [ ] Completion report displayed
</success_criteria>
