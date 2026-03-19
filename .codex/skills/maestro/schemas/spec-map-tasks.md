# Maestro Spec Map — CSV Schema

## Master CSV: tasks.csv

### Column Definitions

#### Input Columns (Set by Decomposer)

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| `id` | string | Yes | Unique task identifier | `"1"` |
| `title` | string | Yes | Short mapper title | `"Tech Stack Analysis"` |
| `description` | string | Yes | Detailed analysis instructions (self-contained) | `"Analyze languages, frameworks, dependencies..."` |
| `focus_area` | string | Yes | Focus scope for analysis | `"full"` or `"auth"` |
| `output_file` | string | Yes | Target output filename in .workflow/codebase/ | `"tech-stack.md"` |
| `deps` | string | No | Empty (all mappers independent) | `""` |
| `context_from` | string | No | Empty (no cross-task context) | `""` |

#### Computed Columns (Set by Wave Engine)

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `wave` | integer | Always 1 (single wave, all independent) | `1` |

#### Output Columns (Set by Agent)

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `status` | enum | `pending` -> `completed` / `failed` / `skipped` | `"completed"` |
| `findings` | string | Analysis summary (max 500 chars) | `"Found Express.js + TypeScript stack..."` |
| `error` | string | Error message if failed | `""` |

---

### Example Data

```csv
id,title,description,focus_area,output_file,deps,context_from,wave,status,findings,error
"1","Tech Stack Analysis","Analyze languages, frameworks, dependencies, build system, package managers, runtime configuration. Scan package.json, build configs, CI/CD files.","full","tech-stack.md","","","1","completed","TypeScript + Node.js, Express.js, ESM modules, Commander.js CLI, Vitest testing, npm package manager",""
"2","Architecture Analysis","Analyze project structure, module boundaries, layer architecture, data flow patterns, entry points, API surface. Map directory tree and import graph.","full","architecture.md","","","1","completed","Layered: bin/ → commands/ → core/ → tools/. MCP server exposes tools via stdio. ESM with strict TS.",""
"3","Features Analysis","Inventory user-facing capabilities, API endpoints, CLI commands, UI components, background jobs, integrations. Map to source locations.","full","features.md","","","1","completed","32 CLI commands, MCP tool exposure, workflow orchestration, extension system, dashboard UI",""
"4","Cross-cutting Concerns","Analyze error handling patterns, logging strategy, authentication/authorization, configuration management, testing approach, observability.","full","concerns.md","","","1","failed","","Agent timeout after 600s"
```

---

### Column Lifecycle

```
Decomposer (Phase 1)     Wave Engine (Phase 2)    Agent (Execution)
─────────────────────    ────────────────────     ─────────────────
id          ───────────►  id          ──────────►  id
title       ───────────►  title       ──────────►  (reads)
description ───────────►  description ──────────►  (reads)
deps        ───────────►  deps        ──────────►  (reads)
context_from───────────►  context_from──────────►  (reads)
focus_area  ───────────►  focus_area  ──────────►  (reads)
output_file ───────────►  output_file ──────────►  (reads)
                          wave         ──────────►  (reads)
                                                    status
                                                    findings
                                                    error
```

---

## Output Schema (JSON)

Agent output via `report_agent_job_result`:

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "status": { "type": "string", "enum": ["completed", "failed"] },
    "findings": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "status", "findings"]
}
```

---

## Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |

### Discovery NDJSON Format

```jsonl
{"ts":"2026-03-18T10:00:00Z","worker":"1","type":"tech_stack","data":{"framework":"Express.js","language":"TypeScript","tools":["Commander.js","Vitest","ESM"]}}
{"ts":"2026-03-18T10:00:01Z","worker":"2","type":"code_pattern","data":{"name":"extension-loader","file":"src/core/extension-loader.ts","description":"Dynamic plugin loading from ~/.maestro/extensions/"}}
{"ts":"2026-03-18T10:00:02Z","worker":"3","type":"integration_point","data":{"file":"src/mcp/server.ts","description":"MCP stdio transport exposing CLI tools","exports":["startServer","registerTools"]}}
```

---

## Validation Rules

| Rule | Check | Error |
|------|-------|-------|
| Unique IDs | No duplicate `id` values | "Duplicate task ID: {id}" |
| Valid focus_area | focus_area is non-empty string | "Empty focus_area for task: {id}" |
| Valid output_file | output_file ends with `.md` | "Invalid output_file: {output_file}" |
| No deps | deps must be empty (single wave) | "Dependencies not allowed in single-wave topology" |
| Status enum | status in {pending, completed, failed, skipped} | "Invalid status: {status}" |
