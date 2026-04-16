---
name: quality-refactor
description: Tech debt reduction with reflection-driven iteration
argument-hint: "[<scope>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---
<purpose>
Plan and execute targeted refactoring with safety guarantees through analysis, planning, and reflection-driven iteration. Identifies affected files and dependencies, creates a refactoring plan, confirms with the user before execution, then applies changes with test verification after every modification to ensure zero regressions. Each refactoring round records strategy, outcome, and adjustments in reflection-log.md.
</purpose>

<required_reading>
@~/.maestro/workflows/refactor.md
</required_reading>

<context>
Scope: $ARGUMENTS (required)
- Module path: "src/auth" - specific directory
- Feature area: "authentication" - conceptual scope
- "all" - full codebase scan

If not provided, prompt user for scope.
</context>

<execution>
Follow '~/.maestro/workflows/refactor.md' completely.

**Next-step routing on completion:**
- All tests pass → Skill({ skill: "quality-sync" }) (update codebase docs)
- Test failures after refactor → Skill({ skill: "quality-debug", args: "{scope}" })
- No test suite available → Skill({ skill: "quality-test-gen", args: "{phase}" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Refactoring scope/description required | Prompt user for module path, feature area, or "all" |
| E002 | error | Test suite not available for affected area | Suggest creating tests first, or proceed with manual verification |
| W001 | warning | Partial test coverage for affected area | Note uncovered areas, proceed with extra caution |
</error_codes>

<success_criteria>
- [ ] Refactoring plan created and confirmed by user
- [ ] Changes implemented according to plan
- [ ] All tests pass after refactoring
- [ ] No regressions introduced
- [ ] reflection-log.md written with strategy and outcomes
</success_criteria>
