---
name: learn-decompose
description: 4-dimension parallel pattern extraction via CSV wave pipeline. Structural, behavioral, data, and error dimension agents scan in parallel (Wave 1), cross-reference agent deduplicates and catalogs (Wave 2). Outputs pattern catalog to lessons.jsonl.
argument-hint: "[-y|--yes] [-c|--concurrency 4] [--continue] \"<path|module> [--patterns <list>] [--save-spec] [--save-wiki]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Systematic pattern extraction from code via CSV wave pipeline. 4 parallel dimension agents
scan a module, then a cross-reference agent deduplicates against existing patterns and
produces a catalog. Discovered patterns persist to `lessons.jsonl` and optionally to
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

**Output**: `.workflow/.csv-wave/{session-id}/` + `.workflow/learning/decompose-{slug}-{date}.md`
</context>

<invariants>
1. **4 dimensions always**: structural, behavioral, data, error — each a wave 1 task
2. **Evidence required**: Every finding must have file:line anchors
3. **Dedup before persist**: Cross-reference against existing specs + lessons
4. **Stable IDs**: INS-id from `hash("decompose" + target + pattern_name)`
5. **No files modified outside** `.workflow/learning/` (and optionally specs/wiki)
</invariants>

<execution>

### Phase 1: Session Init + Target Resolution

Parse flags from `$ARGUMENTS`: `-y`/`--yes`, `--patterns <list>`, `--save-spec`, `--save-wiki`, `--continue`, `-c N`.
Extract remaining text as target path/module.

Resolve target to file list. Load existing patterns from `coding-conventions.md` + `lessons.jsonl` for dedup set.

### Phase 2: Wave 1 — Parallel Dimension Scans

Generate `tasks.csv` with 4 dimension rows (wave 1) + 1 cross-ref row (wave 2):

| id | dimension | focus |
|----|-----------|-------|
| 1 | structural | Class hierarchy, composition, DI, factories, exports |
| 2 | behavioral | Events, middleware, observer, command, state machines |
| 3 | data | Repository, DTO, caching, serialization, validation |
| 4 | error | Boundaries, retry/backoff, fallbacks, guards, logging |
| 5 | cross-ref | Dedup + catalog from wave 1 findings |

Each dimension agent returns:
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

Single agent receives all wave 1 findings via `prev_context`. Tasks:
- Match against dedup set → mark as `documented`, `known`, or `new`
- Merge duplicates across dimensions (same pattern found by multiple agents)
- Flag contradictions with documented conventions
- Build pattern catalog grouped by dimension

### Phase 4: Persist

1. Write `decompose-{slug}-{date}.md` with full catalog
2. Append each **new** pattern to `lessons.jsonl` (source: "decompose", category: "pattern")
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
- [ ] Pattern catalog written to `decompose-{slug}-{date}.md`
- [ ] New patterns appended to `lessons.jsonl` with stable INS-ids
- [ ] If --save-spec / --save-wiki: entries created
</success_criteria>
