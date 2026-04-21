---
name: spec-map
description: Analyze codebase with 4 parallel mapper agents via CSV wave pipeline. Produces .workflow/codebase/ documents for tech-stack, architecture, features, and cross-cutting concerns.
argument-hint: "[-y|--yes] [-c|--concurrency 4] [--continue] \"[focus area]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
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
$spec-map --continue "map-auth-20260318"
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
"1","Tech Stack Analysis","Analyze languages, frameworks, dependencies, build system, package managers, runtime configuration. Scan package.json, build configs, CI/CD files.","full","tech-stack.md","","","1","","",""
"2","Architecture Analysis","Analyze project structure, module boundaries, layer architecture, data flow patterns, entry points, API surface. Map directory tree and import graph.","full","architecture.md","","","1","","",""
"3","Features Analysis","Inventory user-facing capabilities, API endpoints, CLI commands, UI components, background jobs, integrations. Map to source locations.","full","features.md","","","1","","",""
"4","Cross-cutting Concerns","Analyze error handling patterns, logging strategy, authentication/authorization, configuration management, testing approach, observability.","full","concerns.md","","","1","","",""
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
| `status` | Output | pending/completed/failed/skipped |
| `findings` | Output | Analysis summary (max 500 chars) |
| `error` | Output | Error if failed |

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

```javascript
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const focusArea = $ARGUMENTS.replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+/g, '').trim() || 'full'
const dateStr = new Date(Date.now() + 8*60*60*1000).toISOString().substring(0,10).replace(/-/g,'')
const sessionId = `map-${focusArea.substring(0,20)}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
Bash(`mkdir -p .workflow/codebase`)
```

### Phase 1: Generate tasks.csv

Generate 4 mapper rows. If focus_area is specified, scope descriptions to that area.

### Phase 2: Wave Execution

Single wave — all 4 mappers run concurrently:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildMapperInstruction(sessionFolder, focusArea),
  max_concurrency: 4,
  max_runtime_seconds: 600,
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

### Phase 3: Write Output Files

1. Read each agent's findings from results
2. Write to `.workflow/codebase/{output_file}`
3. Generate context.md summary
4. Display report

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
