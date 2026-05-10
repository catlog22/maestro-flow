---
name: learn-decompose
description: Extract design patterns from code into specs and wiki
argument-hint: "<path|module> [--patterns <list>] [--save-spec] [--save-wiki]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Systematic pattern extraction from code. Analyzes a module or directory across 4 dimensions (structural, behavioral, data, error) using parallel agents, then catalogs findings with code anchors. Discovered patterns can be persisted to specs (via `spec-add`) and wiki (via `maestro wiki create`).

Unlike `learn-follow` which reads code with forcing questions, this command is purpose-built for pattern identification and cataloging. It produces a reusable pattern catalog that feeds into the spec system.
</purpose>

<context>
Arguments: $ARGUMENTS

**Target resolution:**
- File path → analyze that file
- Directory path → analyze all source files in it
- Module name → Glob for matching directory under `src/`

**Flags:**
- `--patterns <list>` — Comma-separated pattern names to look for (e.g., "observer,factory,middleware"). If omitted, detect all.
- `--save-spec` — Invoke `Skill({ skill: "spec-add" })` for each newly discovered pattern
- `--save-wiki` — Create wiki note entries per pattern group via `maestro wiki create --type note`

**Storage written:**
- `.workflow/knowhow/KNW-decompose-{slug}-{YYYY-MM-DD}.md` — Pattern decomposition report
- `.workflow/specs/learnings.md` — One `<spec-entry>` per discovered pattern (source: "decompose")
- If `--save-spec`: entries appended to `.workflow/specs/coding-conventions.md`
- If `--save-wiki`: new wiki note entries

**Storage read:**
- Source files at target path
- `.workflow/specs/coding-conventions.md` — Existing documented patterns (for dedup)
- `.workflow/specs/learnings.md` — Previously identified patterns (for dedup)
</context>

<execution>

### Stage 1: Resolve Target
- If argument is a file: verify exists, use as single-file target
- If argument is a directory: list all `.ts`, `.tsx`, `.js`, `.jsx` files (exclude `node_modules`, `dist`, `.test.`)
- If argument is a module name: Glob `src/**/{module}*` to find matching directory
- If target unresolvable, AskUserQuestion with suggestions

### Stage 2: Load Existing Patterns
- Read `.workflow/specs/coding-conventions.md` — extract documented patterns
- Search `specs/learnings.md` for `<spec-entry>` blocks with `roles="implement"` — previously discovered
- Build dedup set: pattern names already known

### Stage 3: Parallel Agent Analysis (4 dimensions)
Spawn 4 Agents in a single message, each analyzing the target from one dimension:

**Agent 1 — Structural Patterns:**
- Class hierarchy and composition relationships
- Module boundaries and encapsulation
- Dependency injection / inversion of control
- Builder, Factory, Singleton patterns
- Export structure (barrel files, re-exports)

**Agent 2 — Behavioral Patterns:**
- Event flow (EventEmitter, pub/sub, callbacks)
- Middleware chains and interceptors
- Observer/subscriber patterns
- Command/strategy patterns
- State machines

**Agent 3 — Data Patterns:**
- Repository / data access patterns
- DTO / transformation pipelines
- Caching strategies (memoization, LRU, TTL)
- Serialization / deserialization
- Schema validation approaches

**Agent 4 — Error Patterns:**
- Error boundary and propagation
- Retry / backoff / circuit breaker
- Fallback chains
- Validation and guard clauses
- Logging and observability patterns

Each agent returns findings as structured list:
```json
[{
  "name": "pattern name",
  "dimension": "structural|behavioral|data|error",
  "confidence": "high|medium|low",
  "anchors": ["file:line", "file:line"],
  "description": "what it does",
  "rationale": "why this approach",
  "tradeoffs": "what was given up"
}]
```

If `--patterns` specified, instruct agents to focus only on named patterns.

### Stage 4: Cross-Reference & Dedup
- Match agent findings against existing pattern set from Stage 2
- Mark each finding: `documented` (already in specs), `known` (in knowhow), or `new`
- Flag contradictions: finding conflicts with documented convention
- Merge duplicate findings across agents (same pattern found by multiple dimensions)

### Stage 5: Produce Pattern Catalog
Build the decomposition report grouped by dimension:

```markdown
# Pattern Decomposition: {target}

## Summary
- Patterns found: N (M new, K documented, J known)
- Dimensions analyzed: structural, behavioral, data, error
- Contradictions: N

## Structural Patterns
| Pattern | Confidence | Location | Status |
|---------|-----------|----------|--------|
| {name} | high | {file:line} | new / documented / known |

### {Pattern Name}
**Description:** ...
**Code example:** (inline snippet from anchor)
**Trade-offs:** ...

## Behavioral Patterns
...
```

### Stage 6: Persist
1. Write `.workflow/knowhow/KNW-decompose-{slug}-{date}.md`
2. Append each **new** pattern as a `<spec-entry>` block to `specs/learnings.md` via `maestro spec add learning --roles implement --body "<content>" --keywords "decompose,pattern,{dimension},{target-slug}"`:
   - Stable INS-id from `hash("decompose" + target + pattern_name)`
4. If `--save-spec`: for each new pattern, invoke `Skill({ skill: "spec-add", args: "pattern {description}" })`
5. If `--save-wiki`: create wiki note per dimension group via `maestro wiki create --type note --slug decompose-{dimension}-{slug}`
6. Display summary with counts and next steps

**Next-step routing:**
- Follow-along on a specific pattern → `/learn-follow <anchor-file>`
- Get second opinion on findings → `/learn-second-opinion <target>`
- Add all new patterns to specs → `/spec-add coding ...` per pattern
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Target path not found | Check path exists, or use a module name |
| E002 | error | No source files found in target directory | Check target has .ts/.js files, exclude filters may be too aggressive |
| W001 | warning | One or more dimension agents failed — partial results | Proceed with available dimensions, retry failed ones |
| W002 | warning | coding-conventions.md not found — skipping dedup against specs | All patterns marked as "new" |
| W003 | warning | Large target (>50 files) — analysis may be slow | Consider narrowing scope with --patterns filter |
</error_codes>

<success_criteria>
- [ ] Target resolved to concrete file list
- [ ] Existing patterns loaded for dedup
- [ ] All 4 dimension agents spawned in parallel
- [ ] Each finding has: name, dimension, confidence, anchors, description, tradeoffs
- [ ] Cross-reference performed (documented / known / new status assigned)
- [ ] Pattern catalog written to `KNW-decompose-{slug}-{date}.md`
- [ ] New patterns appended to `specs/learnings.md` as `<spec-entry>` blocks with stable INS-ids
- [ ] If --save-spec: spec entries created for new patterns
- [ ] If --save-wiki: wiki notes created per dimension group
- [ ] No files modified outside `.workflow/knowhow/` (and optionally specs/wiki)
- [ ] Summary displayed with pattern counts and next-step routing
</success_criteria>
