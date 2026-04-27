# Test Generation Workflow

Generate missing automated tests for a phase based on gap analysis from maestro-verify (Nyquist audit) and quality-test (UAT coverage gaps). Classifies changed files into unit/E2E/skip, discovers test infrastructure, generates a test plan for user approval, then writes tests using RED-GREEN methodology.

Tests expose bugs -- fixing is for quality-debug or maestro-execute.

---

### Step 0: Load Project Specs

```
specs_content = maestro spec load --category test
```

Follow project test conventions in Step 4 (Generate Test Plan) and Step 5 (Write Tests).

---

### Step 1: Discover Test Infrastructure

Detect existing test framework and patterns by scanning for:
- **Config files**: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `pyproject.toml`, `.mocharc.*`
- **Existing tests**: `*.test.*`, `*.spec.*`, `test_*` (exclude node_modules, .git)
- **Utilities**: `test-utils.*`, `testHelper*`, `conftest.py`, `setup.*`

Extract: framework, directory structure, naming convention, test utilities, run command.

Read 2-3 existing test files to learn: import style, describe/it nesting, assertion library, mock patterns, setup/teardown.

If no test framework detected: Error E003.

---

### Step 2: Identify Gaps

Sources: validation.json (`gaps[]` MISSING/PARTIAL), coverage-report.json (`requirements_uncovered[]`), task summaries (modified files).

Priority: MISSING or uncovered requirement → HIGH; PARTIAL → MEDIUM.

---

### Step 3: Classify Files

Classify each changed file into test categories:

| File Type | Category | Rationale |
|-----------|----------|-----------|
| Pure function / utility | unit | Isolated, no side effects |
| React component | unit + e2e | Unit for logic, E2E for rendering |
| API route / handler | integration | Needs request context |
| Database model / query | integration | Needs DB connection |
| CLI command | e2e | Needs process execution |
| Config / types / constants / CSS / test files | skip | No testable behavior |

Output: `{ "unit": [...], "integration": [...], "e2e": [...], "skip": [...] }`

Apply --layer filter if set.

---

### Step 4: Generate Test Plan

For each gap + classified file, create a test entry:

```json
{
  "tests": [
    {
      "id": "TG-001",
      "target_file": "src/utils/validate.ts",
      "test_file": "src/utils/__tests__/validate.test.ts",
      "layer": "unit",
      "requirement_ref": "SC-002",
      "description": "Validate email format accepts valid emails, rejects invalid",
      "test_cases": [
        "accepts standard email format",
        "rejects missing @ symbol",
        "rejects empty string",
        "handles unicode characters"
      ],
      "priority": "high"
    }
  ]
}
```

Present plan to user:

```
=== TEST GENERATION PLAN ===
Phase: {phase_name}

| # | Target | Layer | Test Cases | Priority |
|---|--------|-------|------------|----------|
| TG-001 | validate.ts | unit | 4 cases | HIGH |
| TG-002 | ChatWindow.tsx | e2e | 3 cases | HIGH |
| TG-003 | comments.ts | integration | 5 cases | MEDIUM |

Total: {N} test files, {M} test cases

Proceed? (yes/modify/cancel)
```

Wait for user approval via AskUserQuestion.
- "yes" / "y" -> proceed to Step 5
- "modify" -> ask what to change, update plan
- "cancel" -> abort

---

### Step 5: Generate Tests (RED-GREEN)

For each approved test entry:

1. **RED** -- Write test following existing patterns; tests must fail if behavior is broken (not trivially pass)
2. **Verify RED** -- Run `{test_run_command} {test_file}`:
   - Passes → may be trivial, strengthen it
   - Fails expected → good, targets real behavior
   - Fails unexpected → fix test setup, not source code
3. **GREEN assessment** -- Passes = gap was missing test; Fails = bug discovery (do NOT fix source)

**Important**: This command generates tests only. Failing tests document missing behavior -- fixing is for quality-debug.

Write each test file to the discovered test directory structure.

---

### Step 6: Run Full Test Suite

Verify no regressions.

```bash
{test_run_command} 2>&1 | tail -50
```

Categorize results:
- New tests passing: coverage gap filled
- New tests failing: bug discovered (document, don't fix)
- Existing tests broken: regression introduced (investigate)

If regressions found, flag as blocker. (W002)

---

### Step 7: Write Artifacts

Archive existing `.tests/test-gen-report.json` → `.history/test-gen-report-{timestamp}.json` if present.

Write `.tests/test-gen-report.json`:
```json
{
  "phase": "{phase}",
  "generated_at": "{ISO timestamp}",
  "infrastructure": {
    "framework": "vitest",
    "test_dir": "__tests__/",
    "run_command": "npm test"
  },
  "classification": { "unit": [...], "integration": [...], "e2e": [...], "skip": [...] },
  "generated": [
    {
      "id": "TG-001",
      "test_file": "src/utils/__tests__/validate.test.ts",
      "layer": "unit",
      "test_cases": 4,
      "status": "passing|failing|mixed",
      "bugs_discovered": []
    }
  ],
  "summary": {
    "files_generated": N,
    "test_cases_total": M,
    "passing": P,
    "failing": F,
    "bugs_discovered": B
  }
}
```

Update validation.json gaps: change MISSING -> COVERED for gaps that now have tests.

---

### Step 8: Report

```
Display: phase, framework, files/cases generated, passing/failing counts,
  bugs found (with descriptions), coverage delta, report path, next step suggestion
```

**Next step routing:**

| Result | Suggestion |
|--------|------------|
| All tests passing | Skill({ skill: "maestro-verify", args: "{phase}" }) to update Nyquist coverage |
| Bugs discovered (failing tests) | Skill({ skill: "quality-debug", args: "--from-uat {phase}" }) to investigate |
| Regressions found | Skill({ skill: "quality-debug" }) immediately |
| Coverage still low | Run again with `--layer` for uncovered layers |
