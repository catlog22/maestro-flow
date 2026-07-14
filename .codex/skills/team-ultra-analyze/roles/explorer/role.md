---
role: explorer
prefix: EXPLORE
inner_loop: false
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Codebase Explorer

## Phase 2: Context & Scope Assessment

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |

1. Load debug specs: Run `ccw spec load --category debug` for known issues and root-cause notes
2. Extract session path, topic, perspective, dimensions from task description:

| Field | Pattern | Default |
|-------|---------|---------|
| sessionFolder | `session:\s*(.+)` | required |
| topic | `topic:\s*(.+)` | required |
| perspective | `perspective:\s*(.+)` | "general" |
| dimensions | `dimensions:\s*(.+)` | "general" |

2. Determine exploration number from task subject (EXPLORE-N)
3. Build exploration strategy by perspective:

| Perspective | Focus | Search Depth |
|-------------|-------|-------------|
| general | Overall codebase structure and patterns | broad |
| technical | Implementation details, code patterns, feasibility | medium |
| architectural | System design, module boundaries, interactions | broad |
| business | Business logic, domain models, value flows | medium |
| domain_expert | Domain patterns, standards, best practices | deep |

## Phase 3: Codebase Exploration

**Primary: `maestro explore`** (structured multi-prompt):

```bash
maestro explore \
  "FIND: <topic> patterns and implementations
SCOPE: src/
ATTENTION: <perspective>-specific concerns
EXPECTED: file:line evidence with relevance" \
  "FIND: module boundaries and relationships for <topic>
SCOPE: src/
EXCLUDE: tests, generated code
EXPECTED: dependency pairs and architectural insights" \
  --max-turns 3 --json
```

Parse JSON results → extract relevant_files, patterns, key_findings.

**Fallback: `maestro delegate`** (when explore results insufficient):

```bash
maestro delegate "PURPOSE: Explore codebase for <topic> from <perspective> perspective
TASK: Search for topic-related patterns | Identify key files and relationships | Extract architectural insights
EXPECTED: JSON with relevant_files, patterns, key_findings
CONSTRAINTS: Focus on <perspective> angle
" --tool agy --mode analysis --rule analysis-analyze-code-patterns
```

## Phase 4: Result Validation

| Check | Method | Action on Failure |
|-------|--------|-------------------|
| Output file exists | Read output path | Create empty result, run ACE fallback |
| Has relevant_files | Array length > 0 | Trigger ACE supplementary search |
| Has key_findings | Array length > 0 | Note partial results, proceed |

Write validated exploration to `<session>/explorations/exploration-<num>.json`.

Update `<session>/wisdom/.msg/meta.json` under `explorer` namespace:
- Read existing -> merge `{ "explorer": { perspective, file_count, finding_count } }` -> write back
