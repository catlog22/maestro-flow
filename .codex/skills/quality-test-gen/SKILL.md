---
name: quality-test-gen
description: Test generation via CSV wave pipeline. Decomposes source files into independent parallel agents, each generating tests with TDD/E2E classification and RED-GREEN methodology. Replaces quality-test-gen command.
argument-hint: "[-y|--yes] [-c|--concurrency N] [--continue] \"<phase> [--type unit|integration|e2e] [--framework jest|vitest|...]\""
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Wave-based test generation using `spawn_agents_on_csv`. Each source file/module gets an independent agent that classifies, plans, and writes tests using RED-GREEN methodology. All agents run in a single parallel wave.

**Core workflow**: Discover Infrastructure -> Identify Gaps -> Classify Files -> Decompose to CSV -> Parallel Test Gen -> Aggregate Results

```
+---------------------------------------------------------------------------+
|                  TEST GENERATION CSV WAVE WORKFLOW                         |
+---------------------------------------------------------------------------+
|                                                                           |
|  Phase 1: Gap Analysis -> CSV                                             |
|     +-- Resolve phase directory from arguments                            |
|     +-- Discover test infrastructure (framework, patterns, conventions)   |
|     +-- Identify gaps from verification.json + coverage-report.json       |
|     +-- Classify changed files into unit/integration/e2e/skip             |
|     +-- Apply --type filter if set                                        |
|     +-- Generate tasks.csv with one row per source file                   |
|     +-- User validates test plan breakdown (skip if -y)                   |
|                                                                           |
|  Phase 2: Wave Execution Engine                                           |
|     +-- Wave 1: Test Generation (independent parallel)                    |
|     |   +-- Each agent generates tests for its assigned source file       |
|     |   +-- RED phase: write failing test targeting real behavior          |
|     |   +-- GREEN assessment: check if source already satisfies           |
|     |   +-- Discoveries shared via board (test patterns, fixtures)        |
|     |   +-- Results: tests_created + coverage_delta per source file       |
|     +-- discoveries.ndjson shared across all agents (append-only)         |
|                                                                           |
|  Phase 3: Results Aggregation                                             |
|     +-- Export results.csv + test-gen-report.json                         |
|     +-- Run full test suite to verify no regressions                      |
|     +-- Generate context.md with all findings                             |
|     +-- Update validation.json with new coverage status                   |
|     +-- Display summary with next steps                                   |
|                                                                           |
+---------------------------------------------------------------------------+
```
</purpose>

<context>
```bash
$quality-test-gen "3"
$quality-test-gen -c 4 "3 --type unit"
$quality-test-gen -y "3 --type e2e --framework vitest"
$quality-test-gen --continue "test-gen-phase3-20260318"
```

**Flags**:
- `-y, --yes`: Skip all confirmations (auto mode)
- `-c, --concurrency N`: Max concurrent agents within the wave (default: 6)
- `--continue`: Resume existing session

When `--yes` or `-y`: Auto-confirm test plan, skip interactive validation, use defaults for framework detection.

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final) + `discoveries.ndjson` (shared exploration) + `context.md` (human-readable report) + `test-gen-report.json` (structured output for downstream)
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,title,description,source_file,test_type,test_framework,deps,context_from,wave,status,findings,tests_created,coverage_delta,error
"1","Test validate.ts","Generate unit tests for src/utils/validate.ts: email validation, input sanitization. RED-GREEN methodology. Follow existing vitest patterns. Gap: SC-002 MISSING coverage.","src/utils/validate.ts","unit","vitest","","","1","","","","",""
"2","Test ChatWindow.tsx","Generate e2e tests for src/components/ChatWindow.tsx: message rendering, scroll behavior, input handling. Follow existing Playwright patterns. Gap: SC-005 PARTIAL coverage.","src/components/ChatWindow.tsx","e2e","playwright","","","1","","","","",""
"3","Test comments.ts","Generate integration tests for src/api/comments.ts: CRUD endpoints, auth middleware, error responses. Follow existing supertest patterns. Gap: SC-003 MISSING coverage.","src/api/comments.ts","integration","vitest","","","1","","","","",""
"4","Test useChat.ts","Generate unit tests for src/hooks/useChat.ts: state management, WebSocket connection, message queue. RED-GREEN methodology. Gap: SC-004 MISSING coverage.","src/hooks/useChat.ts","unit","vitest","","","1","","","","",""
"5","Test auth.ts","Generate unit tests for src/auth/auth.ts: token verification, session management, password hashing. Follow existing test patterns. Gap: SC-001 MISSING coverage.","src/auth/auth.ts","unit","vitest","","","1","","","","",""
```

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier (string) |
| `title` | Input | Short task title |
| `description` | Input | Detailed test generation instructions for this source file, including gap refs and pattern guidance |
| `source_file` | Input | Source file path to generate tests for |
| `test_type` | Input | Test category: unit/integration/e2e |
| `test_framework` | Input | Detected or specified framework: jest/vitest/pytest/mocha/playwright/cypress |
| `deps` | Input | Semicolon-separated dependency task IDs (empty for independent parallel) |
| `context_from` | Input | Semicolon-separated task IDs whose findings this task needs (empty for wave 1) |
| `wave` | Computed | Wave number (always 1 -- independent parallel topology) |
| `status` | Output | `pending` -> `completed` / `failed` / `skipped` |
| `findings` | Output | Key findings summary: bugs discovered, patterns used (max 500 chars) |
| `tests_created` | Output | Semicolon-separated paths to generated test files |
| `coverage_delta` | Output | Coverage improvement estimate: `+N%` or `N new cases` |
| `error` | Output | Error message if failed |

### Per-Wave CSV (Temporary)

Each wave generates `wave-{N}.csv` with extra `prev_context` column (empty for wave 1).

### Output Artifacts

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `tasks.csv` | Master state -- all tasks with status/findings | Updated after wave completes |
| `wave-{N}.csv` | Per-wave input (temporary) | Created before wave, deleted after |
| `results.csv` | Final export of all task results | Created in Phase 3 |
| `discoveries.ndjson` | Shared exploration board | Append-only, carries across agents |
| `context.md` | Human-readable test generation report | Created in Phase 3 |
| `test-gen-report.json` | Structured output for downstream commands | Created in Phase 3 |

### Session Structure

```
.workflow/.csv-wave/test-gen-{phase}-{date}/
+-- tasks.csv
+-- results.csv
+-- discoveries.ndjson
+-- context.md
+-- test-gen-report.json
+-- wave-{N}.csv (temporary)
```
</csv_schema>

<invariants>
1. **Start Immediately**: First action is session initialization, then Phase 1
2. **Single Wave**: All test generation agents run in one parallel wave (independent topology)
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **RED-GREEN Methodology**: Write failing test first, then assess -- never write trivially passing tests
5. **Tests Expose, Not Fix**: Failing tests document bugs; source code changes are NOT permitted
6. **Discovery Board is Append-Only**: Never clear, modify, or recreate discoveries.ndjson
7. **Follow Existing Patterns**: Generated tests must match project's test conventions (imports, structure, assertions)
8. **Cleanup Temp Files**: Remove wave-{N}.csv after results are merged
9. **DO NOT STOP**: Continuous execution until all agents complete and results are aggregated
</invariants>

<execution>

### Session Initialization

```javascript
const getUtc8ISOString = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

// Parse flags
const AUTO_YES = $ARGUMENTS.includes('--yes') || $ARGUMENTS.includes('-y')
const continueMode = $ARGUMENTS.includes('--continue')
const concurrencyMatch = $ARGUMENTS.match(/(?:--concurrency|-c)\s+(\d+)/)
const maxConcurrency = concurrencyMatch ? parseInt(concurrencyMatch[1]) : 6

// Parse test-gen-specific flags
const typeMatch = $ARGUMENTS.match(/--type\s+(unit|integration|e2e)/)
const frameworkMatch = $ARGUMENTS.match(/--framework\s+([\w]+)/)

// Clean phase text
const phaseArg = $ARGUMENTS
  .replace(/--yes|-y|--continue|--concurrency\s+\d+|-c\s+\d+|--type\s+\w+|--framework\s+[\w]+/g, '')
  .trim()

const dateStr = getUtc8ISOString().substring(0, 10).replace(/-/g, '')
const sessionId = `test-gen-phase${phaseArg}-${dateStr}`
const sessionFolder = `.workflow/.csv-wave/${sessionId}`

Bash(`mkdir -p ${sessionFolder}`)
```

### Phase 1: Gap Analysis -> CSV

**Objective**: Discover test infrastructure, identify coverage gaps, classify files, generate tasks.csv.

**Decomposition Rules**:

1. **Phase resolution**: Resolve `{phaseArg}` to `.workflow/phases/{NN}-{slug}/`

2. **Test infrastructure discovery**:
   - Find config files: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `.mocharc.*`
   - Find existing test files: `*.test.*`, `*.spec.*`, `test_*`
   - Find test utilities: `test-utils.*`, `testHelper*`, `conftest.py`
   - Read 2-3 existing tests to learn patterns (imports, assertions, mocking)
   - If no framework detected: Error E003

3. **Gap identification**:

| Source | Gap Type | Priority |
|--------|----------|----------|
| `verification.json` gaps where status = MISSING | No test at all | HIGH |
| `coverage-report.json` requirements_uncovered | Untested requirement | HIGH |
| `verification.json` gaps where status = PARTIAL | Incomplete test | MEDIUM |
| Task summaries (modified files) | Changed code | LOW |

4. **File classification**:

| File Type | Test Category | Rationale |
|-----------|---------------|-----------|
| Pure function / utility | unit | Isolated, no side effects |
| React component | unit + e2e | Unit for logic, E2E for rendering |
| API route / handler | integration | Needs request context |
| Database model / query | integration | Needs DB connection |
| CLI command | e2e | Needs process execution |
| Config / types / constants | skip | No behavior to test |
| CSS / styles | skip | Visual, not testable |
| Test files themselves | skip | Don't test tests |

5. **Filter application**: If `--type` flag set, include only matching test type.

6. **Framework resolution**: Use `--framework` if provided, otherwise auto-detected framework.

7. **CSV generation**: One row per source file (skip category excluded).

**Wave computation**: Single wave -- all tasks are independent parallel (wave = 1).

**User validation**: Display test plan breakdown (skip if AUTO_YES).

### Phase 2: Wave Execution Engine

**Objective**: Execute test generation agents in parallel via spawn_agents_on_csv.

#### Wave 1: Test Generation (Independent Parallel)

1. Read master `tasks.csv`
2. Filter rows where `wave == 1` AND `status == pending`
3. No prev_context needed (single wave, no predecessors)
4. Write `wave-1.csv`
5. Execute:

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: buildTestGenInstruction(sessionFolder),
  max_concurrency: maxConcurrency,
  max_runtime_seconds: 600,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["completed", "failed"] },
      findings: { type: "string" },
      tests_created: { type: "string" },
      coverage_delta: { type: "string" },
      error: { type: "string" }
    },
    required: ["id", "status", "findings"]
  }
})
```

6. Read `wave-1-results.csv`, merge into master `tasks.csv`
7. Delete `wave-1.csv`

**Agent Instruction Template** (`buildTestGenInstruction`):

Each agent receives:
- Source file path and test type classification
- Detected framework and existing test patterns
- Gap references (requirement IDs, descriptions)
- RED-GREEN methodology rules:
  1. **RED**: Write test that fails if behavior is broken (not trivially passing)
  2. **Verify RED**: Run test -- if passes, strengthen; if fails with expected error, good
  3. **GREEN assessment**: If source satisfies, gap was missing test; if fails, record as bug discovery
- Discovery board protocol for sharing test patterns and fixtures
- Instruction to NOT fix source code -- failing tests are valuable bug documentation

### Phase 3: Results Aggregation

**Objective**: Run full suite, generate final results and human-readable report.

1. Read final master `tasks.csv`
2. Export as `results.csv`

3. **Run full test suite** to verify no regressions:
   ```bash
   {test_run_command} 2>&1 | tail -50
   ```
   Categorize: new passing (gap filled), new failing (bug discovered), existing broken (regression).

4. **Archive previous artifacts** before writing:
   ```
   IF file exists "{phase_dir}/.tests/test-gen-report.json":
     mkdir -p "{phase_dir}/.history"
     mv to "{phase_dir}/.history/test-gen-report-{TIMESTAMP}.json"
   ```

5. Build `test-gen-report.json`:

```json
{
  "phase": "<phase>",
  "generated_at": "<ISO>",
  "session_id": "<session-id>",
  "infrastructure": {
    "framework": "vitest",
    "test_dir": "__tests__/",
    "run_command": "npm test"
  },
  "classification": {
    "unit": ["src/utils/validate.ts", "src/hooks/useChat.ts"],
    "integration": ["src/api/comments.ts"],
    "e2e": ["src/components/ChatWindow.tsx"],
    "skip": ["src/types/index.ts"]
  },
  "generated": [
    {
      "id": "1",
      "source_file": "src/utils/validate.ts",
      "test_file": "src/utils/__tests__/validate.test.ts",
      "test_type": "unit",
      "test_cases": 4,
      "status": "passing|failing|mixed",
      "bugs_discovered": []
    }
  ],
  "summary": {
    "files_generated": 5,
    "test_cases_total": 22,
    "passing": 18,
    "failing": 4,
    "bugs_discovered": 2,
    "coverage_delta": "+12%"
  }
}
```

6. Generate `context.md`:

```markdown
# Test Generation Report -- Phase {phase}

## Summary
- Framework: {framework}
- Source files analyzed: {file_count}
- Test type filter: {type_filter or "all"}

## Classification
| Category | Files |
|----------|-------|
| Unit | {N} |
| Integration | {N} |
| E2E | {N} |
| Skipped | {N} |

## Generation Results
| # | Source File | Type | Tests | Status | Bugs |
|---|-----------|------|-------|--------|------|
| 1 | validate.ts | unit | 4 | passing | 0 |
| 2 | ChatWindow.tsx | e2e | 3 | mixed | 1 |

## Test Suite Verification
- New tests passing: {N} (coverage gaps filled)
- New tests failing: {N} (bugs discovered)
- Existing tests broken: {N} (regressions)

## Bugs Discovered
{list of failing tests with descriptions -- NOT fixed, documented only}

## Next Steps
{suggested_next_command}
```

7. Update `validation.json` gaps: change MISSING -> COVERED for gaps that now have tests.

8. Copy `test-gen-report.json` to phase `.tests/` directory.

9. Display summary.

**Next step routing**:

| Result | Suggestion |
|--------|------------|
| All tests passing | `maestro-verify {phase}` to update Nyquist coverage |
| Bugs discovered (failing tests) | `quality-debug --from-uat {phase}` to investigate |
| Regressions found | `quality-debug` immediately |
| Coverage still low | Run again with `--type` for uncovered layers |

### Shared Discovery Board Protocol

#### Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |

#### Domain Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `test_pattern` | `data.name` | `{name, file, framework, description}` | Reusable test pattern (describe structure, assertion style) |
| `test_fixture` | `data.name` | `{name, file, setup, teardown}` | Shared test fixture or factory |
| `mock_strategy` | `data.module` | `{module, strategy, file}` | How a dependency is mocked |
| `bug_discovered` | `data.location` | `{location, test_file, description, severity}` | Bug found via failing test |

#### Protocol

1. **Read** `{session_folder}/discoveries.ndjson` before own test generation
2. **Skip covered**: If discovery of same type + dedup key exists, skip
3. **Write immediately**: Append findings as found
4. **Append-only**: Never modify or delete
5. **Deduplicate**: Check before writing

```bash
echo '{"ts":"<ISO>","worker":"{id}","type":"test_pattern","data":{"name":"api-endpoint-test","file":"src/api/__tests__/users.test.ts","framework":"vitest","description":"supertest + vitest pattern for REST endpoints"}}' >> {session_folder}/discoveries.ndjson
```
</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Phase directory not found | Abort with error: "Phase {N} not found" |
| No verification results found | Abort with error: "No verification results -- run maestro-verify first" |
| No test framework detected | Abort with error: "No test framework detected (E003)" |
| No gaps identified | Info: "No coverage gaps found -- phase fully tested" |
| Agent timeout | Mark as failed, continue with remaining agents |
| Test file write conflict | Agent checks for existing test, extends rather than overwrites |
| CSV parse error | Validate format, show line number |
| discoveries.ndjson corrupt | Ignore malformed lines |
| Continue mode: no session found | List available sessions |
| Regression detected in existing tests | Flag as blocker (W002), do not fix source code |
</error_codes>

<success_criteria>
- [ ] Session folder created with valid tasks.csv
- [ ] All test generation agents executed in parallel (single wave)
- [ ] Test files created following project conventions
- [ ] RED-GREEN methodology applied (no trivially passing tests)
- [ ] test-gen-report.json produced with classification and results
- [ ] context.md produced with test generation report
- [ ] Full test suite run to verify no regressions
- [ ] validation.json gaps updated for covered items
- [ ] discoveries.ndjson append-only throughout
</success_criteria>
