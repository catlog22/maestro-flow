# QA Pipelines

Pipeline definitions and task registry for team-quality-assurance.

## Pipeline Modes

| Mode | Description | Entry Role |
|------|-------------|------------|
| discovery | Scout-first: issue discovery then testing | scout |
| testing | Skip scout, direct test pipeline | strategist |
| full | Complete QA closed loop + regression scan | scout |

## Pipeline Definitions

### Discovery Mode (5 tasks, serial)

```
SCOUT-001 -> QASTRAT-001 -> QAGEN-001 -> QARUN-001 -> QAANA-001
```

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| SCOUT-001 | scout | (none) | Multi-perspective issue scanning |
| QASTRAT-001 | strategist | SCOUT-001 | Change scope analysis + test strategy |
| QAGEN-001 | generator | QASTRAT-001 | L1 unit test generation |
| QARUN-001 | executor | QAGEN-001 | L1 test execution + fix cycles |
| QAANA-001 | analyst | QARUN-001 | Defect pattern analysis + quality report |

### Testing Mode (6 tasks, progressive layers)

```
QASTRAT-001 -> QAGEN-L1-001 -> QARUN-L1-001 -> QAGEN-L2-001 -> QARUN-L2-001 -> QAANA-001
```

| Task ID | Role | Dependencies | Layer | Description |
|---------|------|-------------|-------|-------------|
| QASTRAT-001 | strategist | (none) | — | Test strategy formulation |
| QAGEN-L1-001 | generator | QASTRAT-001 | L1 | L1 unit test generation |
| QARUN-L1-001 | executor | QAGEN-L1-001 | L1 | L1 test execution + fix cycles |
| QAGEN-L2-001 | generator | QARUN-L1-001 | L2 | L2 integration test generation |
| QARUN-L2-001 | executor | QAGEN-L2-001 | L2 | L2 test execution + fix cycles |
| QAANA-001 | analyst | QARUN-L2-001 | — | Quality analysis report |

### Full Mode (8 tasks, parallel windows + regression)

```
SCOUT-001 -> QASTRAT-001 -> [QAGEN-L1-001 || QAGEN-L2-001] -> [QARUN-L1-001 || QARUN-L2-001] -> QAANA-001 -> SCOUT-002
```

| Task ID | Role | Dependencies | Layer | Description |
|---------|------|-------------|-------|-------------|
| SCOUT-001 | scout | (none) | — | Multi-perspective issue scanning |
| QASTRAT-001 | strategist | SCOUT-001 | — | Test strategy formulation |
| QAGEN-L1-001 | generator-1 | QASTRAT-001 | L1 | L1 unit test generation (parallel) |
| QAGEN-L2-001 | generator-2 | QASTRAT-001 | L2 | L2 integration test generation (parallel) |
| QARUN-L1-001 | executor-1 | QAGEN-L1-001 | L1 | L1 test execution + fix cycles (parallel) |
| QARUN-L2-001 | executor-2 | QAGEN-L2-001 | L2 | L2 test execution + fix cycles (parallel) |
| QAANA-001 | analyst | QARUN-L1-001, QARUN-L2-001 | — | Quality analysis report |
| SCOUT-002 | scout | QAANA-001 | — | Regression scan after fixes |

## GC Loop

Generator-Executor iterate per test layer until coverage targets are met:

```
QAGEN -> QARUN -> (if coverage < target) -> QAGEN-fix -> QARUN-gc
                  (if coverage >= target) -> next layer or QAANA
```

- Max iterations: 3 per layer
- After 3 iterations: accept current coverage with warning

## Coverage Targets

| Layer | Name | Default Target |
|-------|------|----------------|
| L1 | Unit Tests | 80% |
| L2 | Integration Tests | 60% |
| L3 | E2E Tests | 40% |

## Scan Perspectives

| Perspective | Focus |
|-------------|-------|
| bug | Logic errors, crash paths, null references |
| security | Vulnerabilities, auth bypass, data exposure |
| test-coverage | Untested code paths, missing assertions |
| code-quality | Anti-patterns, complexity, maintainability |
| ux | User-facing issues, accessibility (optional) |

## Session Directory

```
.workflow/.team/QA-<slug>-<YYYY-MM-DD>/
├── .msg/messages.jsonl          # Message bus log
├── .msg/meta.json               # Session state + cross-role state
├── wisdom/                     # Cross-task knowledge
│   ├── learnings.md
│   ├── decisions.md
│   ├── conventions.md
│   └── issues.md
├── scan/                       # Scout output
│   └── scan-results.json
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
