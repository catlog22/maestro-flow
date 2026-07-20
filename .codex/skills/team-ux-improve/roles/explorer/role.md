---
role: explorer
prefix: EXPLORE
inner_loop: false
message_types: "[state_update]"
---

# Codebase Explorer

## Phase 2: Exploration Scope

1. Parse exploration request from task description
2. Determine file patterns based on framework:

### Wisdom Input

1. Read `{run_dir}/work/team/wisdom/patterns/ui-feedback.md` and `{run_dir}/work/team/wisdom/patterns/state-management.md` if available
2. Use known patterns as reference when exploring codebase for component structures
3. Check `{run_dir}/work/team/wisdom/anti-patterns/common-ux-pitfalls.md` to identify problematic patterns during exploration

| Framework | Patterns |
|-----------|----------|
| React | `**/*.tsx`, `**/*.jsx`, `**/use*.ts`, `**/store*.ts` |
| Vue | `**/*.vue`, `**/composables/*.ts`, `**/stores/*.ts` |

3. Check exploration cache: `{run_dir}/work/team/explorations/cache-index.json`
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

1. Generate pattern summary and write to `{run_dir}/work/team/explorations/exploration-summary.md`
2. Cache results to `{run_dir}/work/team/explorations/cache-index.json`

### Wisdom Contribution

If new component patterns or framework conventions discovered:
1. Write pattern summaries to `{run_dir}/work/team/wisdom/contributions/explorer-patterns-<timestamp>.md`
2. Format: Pattern Name, Framework, Use Case, Code Example, Adoption

4. Share state via team_msg:
   ```
   team_msg(operation="log", session_id=<run-id>, from="explorer",
            type="state_update", data={
              framework: <framework>,
              components_found: <count>,
              patterns_identified: [<pattern-list>]
            })
   ```
