---
role: explorer
prefix: EXPLORE
inner_loop: false
message_types: [state_update]
---

# Codebase Explorer

## Run Artifact Boundary

This file executes under the parent skill's active Run. The assignment MUST carry `run_id` and `run_dir`. Formal deliverables go to `{run_dir}/outputs/`, evidence/traces to `{run_dir}/evidence/`, and synthesis to `{run_dir}/report.md`. `.workflow/.team/` remains transient coordination only.

**Legacy Compatibility Mapping:** Any private session, `artifacts/`, `wisdom/`, `understanding.md`, or `evidence.ndjson` path below is staging-only and MUST be promoted into the active Run before completion.

Explore codebase for UI component patterns, state management conventions, and framework-specific patterns. Callable by coordinator only.

## Phase 2: Exploration Scope

1. Parse exploration request from task description
2. Determine file patterns based on framework:

### Wisdom Input

1. Read `<session>/wisdom/patterns/ui-feedback.md` and `<session>/wisdom/patterns/state-management.md` if available
2. Use known patterns as reference when exploring codebase for component structures
3. Check `<session>/wisdom/anti-patterns/common-ux-pitfalls.md` to identify problematic patterns during exploration

| Framework | Patterns |
|-----------|----------|
| React | `**/*.tsx`, `**/*.jsx`, `**/use*.ts`, `**/store*.ts` |
| Vue | `**/*.vue`, `**/composables/*.ts`, `**/stores/*.ts` |

3. Check exploration cache: `<session>/explorations/cache-index.json`
   - If cache hit and fresh -> return cached results
   - If cache miss or stale -> proceed to Phase 3

## Phase 3: Codebase Exploration

Use ACE search for semantic queries:

```
(
  project_root_path="<project-path>",
  query="<exploration-query>"
)
```

Exploration dimensions:

| Dimension | Query | Purpose |
|-----------|-------|---------|
| Component patterns | "UI components with user interactions" | Find interactive components |
| State management | "State management patterns useState ref reactive" | Identify state conventions |
| Event handling | "Event handlers onClick onChange onSubmit" | Map event patterns |
| Error handling | "Error handling try catch error state" | Find error patterns |
| Feedback mechanisms | "Loading state spinner progress indicator" | Find existing feedback |

For each dimension, collect:
- File paths
- Pattern examples
- Convention notes

## Phase 4: Exploration Summary

1. Generate pattern summary and write to `<session>/explorations/exploration-summary.md`
2. Cache results to `<session>/explorations/cache-index.json`

### Wisdom Contribution

If new component patterns or framework conventions discovered:
1. Write pattern summaries to `<session>/wisdom/contributions/explorer-patterns-<timestamp>.md`
2. Format: Pattern Name, Framework, Use Case, Code Example, Adoption

4. Share state via team_msg:
   ```
   team_msg(operation="log", session_id=<session-id>, from="explorer",
            type="state_update", data={
              framework: <framework>,
              components_found: <count>,
              patterns_identified: [<pattern-list>]
            })
   ```
