---
role: designer
prefix: DESIGN
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Refactoring Designer

## Phase 2: Analysis Loading

| Input | Source | Required |
|-------|--------|----------|
| Architecture report | <session>/artifacts/architecture-report.md | Yes |
| Architecture baseline | <session>/artifacts/architecture-baseline.json | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Wisdom files | <session>/wisdom/patterns.md | No |

1. Extract session path from task description
2. Read architecture report -- extract ranked issue list with severities and categories
3. Read architecture baseline -- extract current structural metrics
4. Load .msg/meta.json for analyzer findings (project_type, scope)
5. Assess overall refactoring complexity:

| Issue Count | Severity Mix | Complexity |
|-------------|-------------|------------|
| 1-2 | All Medium | Low |
| 2-3 | Mix of High/Medium | Medium |
| 3+ or any Critical | Any Critical present | High |

## Phase 3: Strategy Formulation

For each architecture issue, select refactoring approach by type:

| Issue Type | Strategies | Risk Level |
|------------|-----------|------------|
| Circular dependency | Interface extraction, dependency inversion, mediator pattern | High |
| God Class/Module | SRP decomposition, extract class/module, delegate pattern | High |
| Layering violation | Move to correct layer, introduce Facade, add anti-corruption layer | Medium |
| Code duplication | Extract shared utility/base class, template method pattern | Low |
| High coupling | Introduce interface/abstraction, dependency injection, event-driven | Medium |
| API bloat / dead exports | Privatize internals, re-export only public API, barrel file cleanup | Low |
| Dead code | Safe removal with reference verification | Low |
| Missing abstraction | Extract interface/type, introduce strategy/factory pattern | Medium |

Prioritize refactorings by impact/effort ratio:

| Priority | Criteria |
|----------|----------|
| P0 (Critical) | High impact + Low effort -- quick wins (dead code removal, simple moves) |
| P1 (High) | High impact + Medium effort (cycle breaking, layer fixes) |
| P2 (Medium) | Medium impact + Low effort (duplication extraction) |
| P3 (Low) | Low impact or High effort -- defer (large God Class decomposition) |

If complexity is High, invoke `discuss` CLI tool (DISCUSS-REFACTOR round) to evaluate trade-offs between competing strategies before finalizing the plan.

Define measurable success criteria per refactoring (target metric improvement or structural change).

## Phase 4: Plan Output

1. Write refactoring plan to `<session>/artifacts/refactoring-plan.md`:

   Each refactoring MUST have a unique REFACTOR-ID and self-contained detail block:

   ```markdown
   ### REFACTOR-001: <title>
   - Priority: P0
   - Target issue: <issue from report>
   - Issue type: <CYCLE|COUPLING|GOD_CLASS|DUPLICATION|LAYER_VIOLATION|DEAD_CODE|API_BLOAT>
   - Target files: <file-list>
   - Strategy: <selected approach>
   - Expected improvement: <metric> by <description>
   - Risk level: <Low/Medium/High>
   - Success criteria: <specific structural change to verify>
   - Implementation guidance:
     1. <step 1>
     2. <step 2>
     3. <step 3>

   ### REFACTOR-002: <title>
   ...
   ```

   Requirements:
   - Each REFACTOR-ID is sequentially numbered (REFACTOR-001, REFACTOR-002, ...)
   - Each refactoring must be **non-overlapping** in target files (no two REFACTOR-IDs modify the same file unless explicitly noted with conflict resolution)
   - Implementation guidance must be self-contained -- a branch refactorer should be able to work from a single REFACTOR block without reading others

2. Update `<session>/wisdom/.msg/meta.json` under `designer` namespace:
   - Read existing -> merge -> write back:
   ```json
   {
     "designer": {
       "complexity": "<Low|Medium|High>",
       "refactoring_count": 4,
       "priorities": ["P0", "P0", "P1", "P2"],
       "discuss_used": false,
       "refactorings": [
         {
           "id": "REFACTOR-001",
           "title": "<title>",
           "issue_type": "<CYCLE|COUPLING|...>",
           "priority": "P0",
           "target_files": ["src/a.ts", "src/b.ts"],
           "expected_improvement": "<metric> by <description>",
           "success_criteria": "<threshold>"
         }
       ]
     }
   }
   ```

3. If DISCUSS-REFACTOR was triggered, record discussion summary in `<session>/discussions/DISCUSS-REFACTOR.md`
