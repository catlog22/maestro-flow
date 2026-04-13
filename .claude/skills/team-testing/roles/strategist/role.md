---
role: strategist
prefix: STRATEGY
inner_loop: false
message_types:
  success: strategy_ready
  error: error
---

# Test Strategist

Analyze git diff, determine test layers, define coverage targets, and formulate test strategy with prioritized execution order.

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | No |

1. Extract session path and scope from task description
2. Get git diff for change analysis:

```
Bash("git diff HEAD~1 --name-only 2>/dev/null || git diff --cached --name-only")
Bash("git diff HEAD~1 -- <changed-files> 2>/dev/null || git diff --cached -- <changed-files>")
```

3. Detect test framework from project files:

| Signal File | Framework | Test Pattern |
|-------------|-----------|-------------|
| jest.config.js/ts | Jest | `**/*.test.{ts,tsx,js}` |
| vitest.config.ts/js | Vitest | `**/*.test.{ts,tsx}` |
| pytest.ini / pyproject.toml | Pytest | `**/test_*.py` |
| No detection | Default | Jest patterns |

4. Scan existing test patterns:

```
Glob("**/*.test.*")
Glob("**/*.spec.*")
```

5. Read .msg/meta.json if exists for session context

## Phase 3: Strategy Formulation

**Change analysis dimensions**:

| Change Type | Analysis | Priority |
|-------------|----------|----------|
| New files | Need new tests | High |
| Modified functions | Need updated tests | Medium |
| Deleted files | Need test cleanup | Low |
| Config changes | May need integration tests | Variable |

**Strategy output structure**:

1. **Change Analysis Table**: File, Change Type, Impact, Priority
2. **Test Layer Recommendations**:
   - L1 Unit: Scope, Coverage Target, Priority Files, Patterns
   - L2 Integration: Scope, Coverage Target, Integration Points
   - L3 E2E: Scope, Coverage Target, User Scenarios
3. **Risk Assessment**: Risk, Probability, Impact, Mitigation
4. **Test Execution Order**: Prioritized sequence

Write strategy to `<session>/strategy/test-strategy.md`

**Self-validation**:

| Check | Criteria | Fallback |
|-------|----------|----------|
| Has L1 scope | L1 scope not empty | Default to all changed files |
| Has coverage targets | L1 target > 0 | Use defaults (80/60/40) |
| Has priority files | List not empty | Use all changed files |

## Phase 4: Wisdom & State Update

1. Write discoveries to `<session>/wisdom/conventions.md` (detected framework, patterns)
2. Update `<session>/wisdom/.msg/meta.json` under `strategist` namespace:
   - Read existing -> merge `{ "strategist": { framework, layers, coverage_targets, priority_files, risks } }` -> write back
