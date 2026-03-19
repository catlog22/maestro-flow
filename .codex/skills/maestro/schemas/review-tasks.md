# Maestro Review — CSV Schema

## Master CSV: tasks.csv

### Column Definitions

#### Input Columns (Set by Decomposer)

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| `id` | string | Yes | Unique task identifier | `"1"` |
| `title` | string | Yes | Short task title | `"Security Review"` |
| `description` | string | Yes | Detailed review instructions (self-contained) | `"Review all changed files for security..."` |
| `deps` | string | No | Semicolon-separated dependency task IDs | `"1;2;3"` |
| `context_from` | string | No | Semicolon-separated task IDs for context | `"1;2;3;4;5;6"` |
| `dimension` | string | Yes | Review dimension identifier | `"security"` |
| `changed_files` | string | Yes | Semicolon-separated file paths | `"src/auth/login.ts;src/utils.ts"` |
| `project_specs` | string | No | Relevant project specs/conventions | `"Uses Result type, bcrypt+JWT"` |
| `review_level` | string | Yes | Review depth level | `"standard"` |

#### Computed Columns (Set by Wave Engine)

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `wave` | integer | Wave number (1=dimensions, 2=aggregation) | `1` |
| `prev_context` | string | Aggregated findings from context_from tasks (per-wave CSV only) | `"[Task 1] Found 2 critical..."` |

#### Output Columns (Set by Agent)

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `status` | enum | `pending` → `completed` / `failed` / `skipped` | `"completed"` |
| `findings` | string | Key review findings (max 500 chars) | `"Found 2 critical SQL injection..."` |
| `severity_counts` | string | JSON severity distribution | `'{"critical":2,"high":1,"medium":3,"low":5}'` |
| `top_issues` | string | Top 5 issues with severity + file:line | `"[critical] SQL injection (src/db.ts:42)"` |
| `error` | string | Error message if failed | `""` |

---

### Example Data

```csv
id,title,description,dimension,changed_files,project_specs,review_level,deps,context_from,wave,status,findings,severity_counts,top_issues,error
"1","Correctness Review","Review all changed files for correctness...","correctness","src/auth/login.ts;src/auth/register.ts","Result type for errors","standard","","","1","completed","Found 1 high: missing null check in login handler","{\"critical\":0,\"high\":1,\"medium\":2,\"low\":1}","[high] Missing null check (src/auth/login.ts:35)",""
"2","Security Review","Review all changed files for security...","security","src/auth/login.ts;src/auth/register.ts","bcrypt + JWT auth","standard","","","1","completed","Found 1 critical: unsanitized input in SQL query","{\"critical\":1,\"high\":0,\"medium\":1,\"low\":0}","[critical] SQL injection (src/auth/login.ts:42)",""
"7","Aggregate + Deep-Dive","Aggregate all dimension findings...","aggregation","src/auth/login.ts;src/auth/register.ts","","standard","1;2;3;4;5;6","1;2;3;4;5;6","2","completed","Verdict: BLOCK — 1 critical finding requires fix","{\"critical\":1,\"high\":1,\"medium\":5,\"low\":3}","[critical] SQL injection (src/auth/login.ts:42); [high] Missing null check (src/auth/login.ts:35)",""
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
dimension   ───────────►  dimension   ──────────►  (reads)
changed_files──────────►  changed_files─────────►  (reads)
project_specs──────────►  project_specs─────────►  (reads)
review_level───────────►  review_level──────────►  (reads)
                          wave         ──────────►  (reads)
                          prev_context ──────────►  (reads)
                                                    status
                                                    findings
                                                    severity_counts
                                                    top_issues
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
    "severity_counts": { "type": "string" },
    "top_issues": { "type": "string" },
    "error": { "type": "string" }
  },
  "required": ["id", "status", "findings"]
}
```

---

## Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `vulnerability` | `data.location` | `{location, type, severity, cwe}` | Security vulnerability |
| `code_smell` | `data.location` | `{location, type, severity, description}` | Code quality issue |
| `performance_hotspot` | `data.location` | `{location, type, impact}` | Performance issue |
| `architecture_violation` | `data.location` | `{location, rule, description}` | Architecture rule violation |
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern |
| `convention` | singleton | `{naming, imports, formatting}` | Project conventions |

### Discovery NDJSON Format

```jsonl
{"ts":"2026-03-18T10:00:00Z","worker":"2","type":"vulnerability","data":{"location":"src/auth/login.ts:42","type":"sql_injection","severity":"critical","cwe":"CWE-89"}}
{"ts":"2026-03-18T10:00:01Z","worker":"1","type":"code_smell","data":{"location":"src/auth/register.ts:15","type":"missing_null_check","severity":"high","description":"User input not validated before use"}}
{"ts":"2026-03-18T10:00:02Z","worker":"4","type":"architecture_violation","data":{"location":"src/auth/login.ts:60","rule":"no-direct-db-access","description":"Controller directly accesses database, bypassing service layer"}}
```

---

## Validation Rules

| Rule | Check | Error |
|------|-------|-------|
| Unique IDs | No duplicate `id` values | "Duplicate task ID: {id}" |
| Valid deps | All dep IDs exist in tasks | "Unknown dependency: {dep_id}" |
| No self-deps | Task cannot depend on itself | "Self-dependency: {id}" |
| Valid dimension | dimension ∈ {correctness, security, performance, architecture, maintainability, best-practices, aggregation} | "Invalid dimension: {dimension}" |
| Changed files non-empty | Every task has changed_files | "Empty changed_files for task: {id}" |
| Status enum | status ∈ {pending, completed, failed, skipped} | "Invalid status: {status}" |
