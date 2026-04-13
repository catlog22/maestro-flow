---
role: generator
prefix: QAGEN
inner_loop: false
additional_prefixes: [QAGEN-fix]
message_types:
  success: tests_generated
  revised: tests_revised
  error: error
---

# Test Generator

Generate test code according to strategist's strategy and layers. Support L1 unit tests, L2 integration tests, L3 E2E tests. Follow project's existing test patterns and framework conventions.

## Phase 2: Strategy & Pattern Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Test strategy | meta.json -> test_strategy | Yes |
| Target layer | task description `layer: L1/L2/L3` | Yes |

1. Extract session path and target layer from task description
2. Read .msg/meta.json for test strategy (layers, coverage targets)
3. Determine if this is a GC fix task (subject contains "fix")
4. Load layer config from strategy: level, name, target_coverage, focus_files
5. Learn existing test patterns -- find 3 similar test files via Glob(`**/*.{test,spec}.{ts,tsx,js,jsx}`)
6. Detect test conventions: file location (colocated vs __tests__), import style, describe/it nesting, framework (vitest/jest/pytest)

## Phase 3: Test Code Generation

**Mode selection**:

| Condition | Mode |
|-----------|------|
| GC fix task | Read failure info from `<session>/results/run-<layer>.json`, fix failing tests only |
| <= 3 focus files | Direct: inline Read source -> Write test file |
| > 3 focus files | Batch by module, delegate via CLI tool |

**Direct generation flow** (per source file):
1. Read source file content, extract exports
2. Determine test file path following project conventions
3. If test exists -> analyze missing cases -> append new tests via Edit
4. If no test -> generate full test file via Write
5. Include: happy path, edge cases, error cases per export

**GC fix flow**:
1. Read execution results and failure output from results directory
2. Read each failing test file
3. Fix assertions, imports, mocks, or test setup
4. Do NOT modify source code, do NOT skip/ignore tests

**General rules**:
- Follow existing test patterns exactly (imports, naming, structure)
- Target coverage per layer config
- Do NOT use `any` type assertions or `@ts-ignore`

## Phase 4: Self-Validation & Output

1. Collect generated/modified test files
2. Run syntax check (TypeScript: `tsc --noEmit`, or framework-specific)
3. Auto-fix syntax errors (max 3 attempts)
4. Write test metadata to `<session>/wisdom/.msg/meta.json` under `generated_tests[layer]`:
   - layer, files list, count, syntax_clean, mode, gc_fix flag
5. Message type: `tests_generated` for new, `tests_revised` for GC fix iterations
