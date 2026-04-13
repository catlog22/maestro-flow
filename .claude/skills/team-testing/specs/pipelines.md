# Testing Pipelines

Pipeline definitions and task registry for team-testing.

## Pipeline Selection

| Condition | Pipeline |
|-----------|----------|
| fileCount <= 3 AND moduleCount <= 1 | targeted |
| fileCount <= 10 AND moduleCount <= 3 | standard |
| Otherwise | comprehensive |

## Pipeline Definitions

### Targeted Pipeline (3 tasks, serial)

```
STRATEGY-001 -> TESTGEN-001 -> TESTRUN-001
```

| Task ID | Role | Dependencies | Layer | Description |
|---------|------|-------------|-------|-------------|
| STRATEGY-001 | strategist | (none) | — | Analyze changes, define test strategy |
| TESTGEN-001 | generator | STRATEGY-001 | L1 | Generate L1 unit tests |
| TESTRUN-001 | executor | TESTGEN-001 | L1 | Execute L1 tests, collect coverage |

### Standard Pipeline (6 tasks, progressive layers)

```
STRATEGY-001 -> TESTGEN-001 -> TESTRUN-001 -> TESTGEN-002 -> TESTRUN-002 -> TESTANA-001
```

| Task ID | Role | Dependencies | Layer | Description |
|---------|------|-------------|-------|-------------|
| STRATEGY-001 | strategist | (none) | — | Analyze changes, define test strategy |
| TESTGEN-001 | generator | STRATEGY-001 | L1 | Generate L1 unit tests |
| TESTRUN-001 | executor | TESTGEN-001 | L1 | Execute L1 tests, collect coverage |
| TESTGEN-002 | generator | TESTRUN-001 | L2 | Generate L2 integration tests |
| TESTRUN-002 | executor | TESTGEN-002 | L2 | Execute L2 tests, collect coverage |
| TESTANA-001 | analyst | TESTRUN-002 | — | Defect pattern analysis, quality report |

### Comprehensive Pipeline (8 tasks, parallel windows)

```
STRATEGY-001 -> [TESTGEN-001 || TESTGEN-002] -> [TESTRUN-001 || TESTRUN-002] -> TESTGEN-003 -> TESTRUN-003 -> TESTANA-001
```

| Task ID | Role | Dependencies | Layer | Description |
|---------|------|-------------|-------|-------------|
| STRATEGY-001 | strategist | (none) | — | Analyze changes, define test strategy |
| TESTGEN-001 | generator-1 | STRATEGY-001 | L1 | Generate L1 unit tests (parallel) |
| TESTGEN-002 | generator-2 | STRATEGY-001 | L2 | Generate L2 integration tests (parallel) |
| TESTRUN-001 | executor-1 | TESTGEN-001 | L1 | Execute L1 tests (parallel) |
| TESTRUN-002 | executor-2 | TESTGEN-002 | L2 | Execute L2 tests (parallel) |
| TESTGEN-003 | generator | TESTRUN-001, TESTRUN-002 | L3 | Generate L3 E2E tests |
| TESTRUN-003 | executor | TESTGEN-003 | L3 | Execute L3 tests, collect coverage |
| TESTANA-001 | analyst | TESTRUN-003 | — | Defect pattern analysis, quality report |

## GC Loop (Generator-Critic)

Generator and executor iterate per test layer:

```
TESTGEN -> TESTRUN -> (if pass_rate < 0.95 OR coverage < target) -> TESTGEN-fix -> TESTRUN-fix
                      (if pass_rate >= 0.95 AND coverage >= target) -> next layer or TESTANA
```

- Max iterations: 3 per layer
- After 3 iterations: accept current state with warning

## Coverage Targets

| Layer | Name | Default Target |
|-------|------|----------------|
| L1 | Unit Tests | 80% |
| L2 | Integration Tests | 60% |
| L3 | E2E Tests | 40% |

## Session Directory

```
.workflow/.team/TST-<slug>-<YYYY-MM-DD>/
├── .msg/messages.jsonl          # Message bus log
├── .msg/meta.json               # Session metadata
├── wisdom/                     # Cross-task knowledge
│   ├── learnings.md
│   ├── decisions.md
│   ├── conventions.md
│   └── issues.md
├── strategy/                   # Strategist output
│   └── test-strategy.md
├── tests/                      # Generator output
│   ├── L1-unit/
│   ├── L2-integration/
│   └── L3-e2e/
├── results/                    # Executor output
│   ├── run-001.json
│   └── coverage-001.json
└── analysis/                   # Analyst output
    └── quality-report.md
```
