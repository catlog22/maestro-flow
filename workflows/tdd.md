<!-- session-mode: inherited -->
# TDD Workflow

---

## Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

Write code before the test? Delete it. Start over.
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete

---

## Red-Green-Refactor Cycle

Every feature/behavior follows this mandatory sequence:

```
RED: Write failing test → verify it fails correctly
GREEN: Write minimal code to pass → verify ALL tests pass
REFACTOR: Clean up → verify tests still pass
```

Each cycle produces exactly 3 tasks in the plan. No steps may be skipped or merged.

---

## Red Flags — These Thoughts Mean STOP

- "This is too simple to need TDD"
- "I'll write tests after to verify"
- "Let me explore the implementation first, then add tests"
- "I'll keep the code as reference and write tests first"
- "TDD will slow me down"
- "I already manually tested this"
- "Tests after achieve the same goals"

All of these mean: **follow the cycle anyway**.

---

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing — you never saw them catch the bug. |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Already manually tested" | Ad-hoc != systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Need to explore first" | Fine. Throw away exploration, start fresh with TDD. |
| "Test hard = design unclear" | Listen to the test. Hard to test = hard to use. Simplify the interface. |
| "TDD will slow me down" | TDD is faster than debugging in production. |

---

## Task Chain Generation

When `maestro-plan --tdd` is active, each behavior/feature decomposes into a TDD triplet:

### Structure

For each behavior B (derived from requirements or convergence criteria):

```
TASK-{N}a: RED — Write failing test for B
TASK-{N}b: GREEN — Implement minimal code to pass B
TASK-{N}c: REFACTOR — Clean up B implementation (optional, skip if nothing to clean)
```

### TASK-{N}a: RED — Write Failing Test

```json
{
  "id": "TASK-{N}a",
  "title": "RED: Write failing test for {behavior}",
  "type": "test",
  "action": "Write test that describes expected behavior. Test MUST fail before implementation exists.",
  "implementation": [
    "Identify the behavior to test from requirement",
    "Write one minimal test — one behavior per test, clear name",
    "Use real code, not mocks (unless external dependency)",
    "Run test: verify it FAILS (not errors) with expected failure message",
    "If test passes: wrong test — testing existing behavior, fix test",
    "If test errors: fix error, re-run until it fails correctly"
  ],
  "convergence": {
    "criteria": [
      "Test file exists at {test_path}",
      "Test run exits non-zero (test fails, not errors)",
      "Failure message matches expected behavior gap"
    ],
    "verification": "Run test command, confirm RED status (failure, not error)"
  },
  "meta": {
    "tdd_phase": "red",
    "tdd_group": "{N}"
  }
}
```

### TASK-{N}b: GREEN — Write Minimal Code

```json
{
  "id": "TASK-{N}b",
  "title": "GREEN: Implement minimal code for {behavior}",
  "type": "feature",
  "depends_on": ["TASK-{N}a"],
  "action": "Write the simplest code that makes the failing test pass. No features beyond what the test requires.",
  "implementation": [
    "Read the failing test to understand exactly what is needed",
    "Write minimal production code — just enough to pass",
    "Do NOT add features, refactor other code, or improve beyond the test",
    "Do NOT add options, configurability, or flexibility not required by test",
    "Run test: verify it PASSES",
    "Run full test suite: verify no regressions (all other tests still pass)",
    "If test fails: fix code, NOT test",
    "If other tests fail: fix now"
  ],
  "convergence": {
    "criteria": [
      "Test from TASK-{N}a passes (exit 0)",
      "Full test suite passes (no regressions)",
      "No warnings or errors in test output"
    ],
    "verification": "Run test command, confirm GREEN status (all pass, clean output)"
  },
  "meta": {
    "tdd_phase": "green",
    "tdd_group": "{N}"
  }
}
```

### TASK-{N}c: REFACTOR — Clean Up

```json
{
  "id": "TASK-{N}c",
  "title": "REFACTOR: Clean up {behavior} implementation",
  "type": "refactor",
  "depends_on": ["TASK-{N}b"],
  "action": "Remove duplication, improve names, extract helpers. Keep tests green. Do NOT add behavior.",
  "implementation": [
    "Review code from TASK-{N}b for duplication, naming, structure",
    "Apply refactoring while keeping ALL tests green",
    "Remove duplication across the new and existing code",
    "Improve variable and function names for clarity",
    "Extract helpers only if reuse is immediate (not speculative)",
    "Run full test suite after each refactoring step",
    "If any test fails during refactoring: undo last change, re-run"
  ],
  "convergence": {
    "criteria": [
      "Full test suite passes (same as GREEN, no regressions)",
      "No new behavior added beyond what tests cover"
    ],
    "verification": "Run full test suite, confirm still GREEN"
  },
  "meta": {
    "tdd_phase": "refactor",
    "tdd_group": "{N}"
  }
}
```

---

## Wave Assignment

TDD triplets are sequential within each group but groups can parallelize if independent:

```
Wave 1: TASK-1a (RED for feature A),  TASK-2a (RED for feature B)    — parallel if independent
Wave 2: TASK-1b (GREEN for feature A), TASK-2b (GREEN for feature B)  — parallel
Wave 3: TASK-1c (REFACTOR for A),     TASK-2c (REFACTOR for B)       — parallel
```

Within a group, the dependency chain is always: `{N}a → {N}b → {N}c`.

---

## Integration with plan.json

When `--tdd` is active, the plan.json output includes:

```json
{
  "tdd_mode": true,
  "tdd_groups": [
    {
      "group": 1,
      "behavior": "User can login with email and password",
      "tasks": ["TASK-1a", "TASK-1b", "TASK-1c"]
    }
  ]
}
```

The standard `plan.json.waves[]` and `.task/TASK-*.json` structure is preserved — `maestro-execute` consumes it without modification.

---

## Execution Enforcement

When `maestro-execute` processes a TDD plan (detected by `plan.json.tdd_mode == true`):

### RED task verification
- After TASK-{N}a completes, verify test exists AND fails
- If test passes: mark task BLOCKED with reason "Test passes before implementation — wrong test"

### GREEN task verification
- After TASK-{N}b completes, verify ALL tests pass
- If the RED test still fails: mark task BLOCKED, provide failure output
- If other tests regress: mark task BLOCKED, list regressed tests

### REFACTOR task verification
- After TASK-{N}c completes, verify ALL tests still pass
- If any test fails: undo changes, mark as needing re-attempt

---

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing per test. "and" in name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear** | Name describes behavior | `test('test1')`, `test('it works')` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |
| **Real code** | Uses actual implementations | Mocks everything, tests mock behavior |

---

## When to Skip REFACTOR

TASK-{N}c (REFACTOR) may be omitted from the plan when:
- GREEN code is already clean (no duplication, good names)
- The change is truly trivial (single-line fix)

When skipped, mark in plan.json: `"refactor_skipped": true, "reason": "GREEN code already clean"`

---

## Error Handling

| Situation | Action |
|-----------|--------|
| No test framework detected | Abort: "No test infrastructure found. Set up testing first." |
| RED test passes immediately | BLOCKED: "Test passes before implementation — rewrite test" |
| GREEN test still fails after implementation | Retry once with more context, then BLOCKED |
| REFACTOR breaks tests | Undo refactoring, mark as BLOCKED |
| Cannot write meaningful test | AskUserQuestion: "Behavior '{B}' is hard to test. Should we: (1) simplify the interface, (2) skip TDD for this behavior, (3) use integration test instead?" |
