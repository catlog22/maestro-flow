# Review Pipelines

Pipeline definitions and task registry for team-review.

## Pipeline Modes

| Mode | Description | Tasks |
|------|-------------|-------|
| default | Scan + review | SCAN -> REV |
| full | Scan + review + fix | SCAN -> REV -> [confirm] -> FIX |
| fix-only | Fix from existing manifest | FIX |
| quick | Quick scan only | SCAN (quick=true) |

## Pipeline Definitions

### default Mode (2 tasks, linear)

```
SCAN-001 -> REV-001
```

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| SCAN-001 | scanner | (none) | Multi-dimension code scan (toolchain + LLM) |
| REV-001 | reviewer | SCAN-001 | Deep finding analysis and review report |

### full Mode (3 tasks, linear with user checkpoint)

```
SCAN-001 -> REV-001 -> [user confirm] -> FIX-001
```

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| SCAN-001 | scanner | (none) | Multi-dimension code scan (toolchain + LLM) |
| REV-001 | reviewer | SCAN-001 | Deep finding analysis and review report |
| FIX-001 | fixer | REV-001 + user confirm | Plan + execute + verify fixes |

### fix-only Mode (1 task)

```
FIX-001
```

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| FIX-001 | fixer | (none) | Execute fixes from existing manifest |

### quick Mode (1 task)

```
SCAN-001 (quick=true)
```

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| SCAN-001 | scanner | (none) | Quick scan, max 20 findings, skip toolchain |

## Review Dimensions (4-Dimension System)

| Dimension | Code | Focus |
|-----------|------|-------|
| Security | SEC | Vulnerabilities, auth, data exposure |
| Correctness | COR | Bugs, logic errors, type safety |
| Performance | PRF | N+1, memory leaks, blocking ops |
| Maintainability | MNT | Coupling, complexity, dead code |

## Fix Scope Options

| Scope | Description |
|-------|-------------|
| all | Fix all findings |
| critical,high | Fix critical and high severity only |
| skip | Skip fix phase |

## Session Directory

```
.workflow/.team/RV-<slug>-<YYYY-MM-DD>/
├── .msg/messages.jsonl          # Message bus log
├── .msg/meta.json               # Session state + cross-role state
├── wisdom/                     # Cross-task knowledge
│   ├── learnings.md
│   ├── decisions.md
│   ├── conventions.md
│   └── issues.md
├── scan/                       # Scanner output
│   ├── toolchain-findings.json
│   ├── semantic-findings.json
│   └── scan-results.json
├── review/                     # Reviewer output
│   ├── enriched-findings.json
│   ├── review-report.json
│   └── review-report.md
└── fix/                        # Fixer output
    ├── fix-manifest.json
    ├── fix-plan.json
    ├── execution-results.json
    ├── verify-results.json
    ├── fix-summary.json
    └── fix-summary.md
```
