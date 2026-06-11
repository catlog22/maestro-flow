---
name: learn-decompose
description: Extract design patterns from code into specs and wiki
argument-hint: "[-y|--yes] [-c|--concurrency 4] [--continue] \"<path|module> [--patterns <list>] [--save-spec] [--save-wiki]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, request_user_input
---

<purpose>
Systematic pattern extraction from code via CSV wave pipeline. 4 parallel dimension agents
scan a module, then a cross-reference agent deduplicates against existing patterns and
produces a catalog. Discovered patterns persist to `.workflow/specs/learnings.md` and optionally to
specs (via `spec-add`) and wiki.

```
Resolve Target → Load Existing Patterns → Wave 1 (4 parallel dimension scans) → Wave 2 (cross-ref + catalog) → Persist
```
</purpose>

<context>
$ARGUMENTS — target path/module and optional flags.

**Target resolution:**
- File path → analyze that file
- Directory path → all source files in it
- Module name → Glob `src/**/{module}*`

**Flags:**
- `-y, --yes`: Skip confirmations
- `-c, --concurrency N`: Max concurrent agents (default: 4)
- `--continue`: Resume existing session
- `--patterns <list>`: Comma-separated pattern names to focus on
- `--save-spec`: Invoke `spec-add` for each new pattern
- `--save-wiki`: Create wiki note entries per dimension group

**Output**: `.workflow/.csv-wave/{session-id}/` + `.workflow/knowhow/KNW-decompose-{slug}-{date}.md`
</context>

<invariants>
1. **4 dimensions always**: structural, behavioral, data, error — each a wave 1 task
2. **Evidence required**: Every finding must have file:line anchors
3. **Dedup before persist**: Cross-reference against existing specs + lessons
4. **Stable IDs**: INS-id from `hash("decompose" + target + pattern_name)`
5. **No files modified outside** `.workflow/knowhow/` (and optionally specs/wiki)
</invariants>

<execution>

### Phase 1: Session Init + Target Resolution

Parse flags from `$ARGUMENTS`: `-y`/`--yes`, `--patterns <list>`, `--save-spec`, `--save-wiki`, `--continue`, `-c N`.
Extract remaining text as target path/module.

Resolve target to file list. Load coding specs: `maestro spec load --category coding` for documented patterns and conventions. Load existing patterns from `coding-conventions.md` + `.workflow/specs/learnings.md` for dedup set. Browse wiki: `maestro search --category coding`, load relevant entries.

### Phase 2: Wave 1 — Parallel Dimension Scans

Generate `tasks.csv` with 4 dimension rows (wave 1) + 1 cross-ref row (wave 2). Initialize every row with `status="pending"`. Filter `wave==N AND status=="pending"` when writing each wave CSV.

| id | dimension | focus |
|----|-----------|-------|
| 1 | structural | Class hierarchy, composition, DI, factories, exports |
| 2 | behavioral | Events, middleware, observer, command, state machines |
| 3 | data | Repository, DTO, caching, serialization, validation |
| 4 | error | Boundaries, retry/backoff, fallbacks, guards, logging |
| 5 | cross-ref | Dedup + catalog from wave 1 findings |

**output_schema** (both waves):

```json
{
  "type": "object",
  "properties": {
    "id":            { "type": "string" },
    "result_status": { "type": "string", "enum": ["completed", "failed"] },
    "dimension":     { "type": "string", "enum": ["structural", "behavioral", "data", "error", "cross-ref"] },
    "patterns":      { "type": "string", "description": "JSON array string: [{name, dimension, confidence, anchors, description, rationale, tradeoffs}]" },
    "findings":      { "type": "string", "maxLength": 500 },
    "error":         { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

Merge: `result_status` → master `status`; copy `dimension`, `patterns`, `findings`, `error`.

**Shared termination contract** (embed in every instruction):
```
You MUST call report_agent_job_result EXACTLY ONCE before exiting.
- Success → result_status=completed (patterns may be empty array if nothing found)
- Failure → result_status=failed with error message
- Timeout → near max_runtime_seconds → result_status=completed with partial patterns
- NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
- Every finding MUST include file:line anchors. No speculation.
- Read-only analysis. Do NOT modify source.
Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
```

Each dimension agent populates `patterns` as a JSON array string of:
```json
[{
  "name": "pattern name",
  "dimension": "structural|behavioral|data|error",
  "confidence": "high|medium|low",
  "anchors": ["file:line"],
  "description": "what it does",
  "rationale": "why this approach",
  "tradeoffs": "what was given up"
}]
```

### Phase 3: Wave 2 — Cross-Reference + Catalog

Single agent receives all wave 1 findings via `prev_context`. Uses same `output_schema` + termination contract above. Tasks:
- Match against dedup set → mark as `documented`, `known`, or `new`
- Merge duplicates across dimensions (same pattern found by multiple agents)
- Flag contradictions with documented conventions
- Build pattern catalog grouped by dimension

### Phase 4: Persist

1. Write `KNW-decompose-{slug}-{date}.md` with full catalog
2. Append each **new** pattern to `.workflow/specs/learnings.md` (source: "decompose", category: "pattern")
3. If `--save-spec`: invoke `spec-add` per new pattern
4. If `--save-wiki`: create wiki note per dimension group
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target path not found | Check path or use module name |
| E002 | error | No source files in target | Check target has .ts/.js files |
| W001 | warning | Dimension agent failed — partial results | Proceed with available dimensions |
| W002 | warning | coding-conventions.md not found | All patterns marked "new" |
</error_codes>

<success_criteria>
- [ ] Target resolved to concrete file list
- [ ] 4 dimension agents spawned in parallel via spawn_agents_on_csv
- [ ] Each finding has: name, dimension, confidence, anchors, description
- [ ] Cross-reference performed (documented / known / new)
- [ ] Pattern catalog written to `KNW-decompose-{slug}-{date}.md`
- [ ] New patterns appended to `.workflow/specs/learnings.md` with stable INS-ids
- [ ] If --save-spec / --save-wiki: entries created
</success_criteria>
