---
name: quality-refactor
description: Use when accumulated tech debt needs systematic identification and safe reduction
argument-hint: "[<scope>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Targeted refactoring with safety guarantees: plan → confirm → execute with test verification per change → reflection-log.md.
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

### Pre-load context (before refactoring)

1. **Coding specs**: Run `maestro load --type spec --category coding` to load coding conventions. Apply conventions to all refactored code.
2. **Review specs**: Run `maestro load --type spec --category review` to load review standards. Use as quality gate for refactored code.
3. **Role Knowledge**:
   - Browse: `maestro search --category coding`
   - Identify task-relevant entries, then load: `maestro load --type knowhow --id <id1> [id2...]`
4. All are optional — proceed without if unavailable.
</context>

<execution>
Follow '~/.maestro/workflows/refactor.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Analysis → Plan**
- REQUIRED: Affected files and dependencies identified.
- REQUIRED: Refactoring plan created with specific changes.
- BLOCKED if missing: cannot refactor without identified targets.

**GATE 2: Plan → Execution**
- REQUIRED: User confirmed refactoring plan.
- BLOCKED if not confirmed: do not apply changes without approval.

**GATE 3: Execution → Completion**
- REQUIRED: All changes applied with test verification per modification.
- REQUIRED: Zero regressions (all tests pass).
- REQUIRED: reflection-log.md written with strategy and outcomes.
- BLOCKED if tests fail: fix regressions before completing.

**Knowledge inquiry on completion:**
After successful refactoring, ask user once: "Record refactoring pattern as coding convention?" If yes → `Skill("spec-add", "coding \"<title>\" \"<pattern>\" --keywords <kw1>,<kw2> --description \"<summary>\"")`.
</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS|NEEDS_RETRY
CONCERNS: {description if applicable}
--- END STATUS ---
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| All tests pass | `/quality-sync` (update codebase docs) |
| Test failures after refactor | `/quality-debug "test failures after refactor in {scope}"` |
| No test suite available | `/quality-auto-test {phase}` |
</completion>

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
