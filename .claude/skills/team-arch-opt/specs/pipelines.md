

# Pipeline Definitions — team-arch-opt

## Available Pipelines

### Single Mode (Linear)

```
ANALYZE-001 → DESIGN-001 → REFACTOR-001 → VALIDATE-001 + REVIEW-001
[analyzer]    [designer]    [refactorer]    [validator]    [reviewer]
                                ^                |
                                +<-- FIX-001 ----+
                                          (max 3 iterations)
```

### Fan-out Mode (Shared Stages + Parallel Branches)

```
ANALYZE-001 → DESIGN-001 --+→ REFACTOR-B01 → VALIDATE-B01 + REVIEW-B01
[analyzer]    [designer]    |  [refactorer]    [validator]    [reviewer]
                            +→ REFACTOR-B02 → VALIDATE-B02 + REVIEW-B02
                            +→ REFACTOR-B0N → VALIDATE-B0N + REVIEW-B0N
                                                           |
                                                      AGGREGATE → Phase 5
```

Branch tasks created at CP-2.5 after DESIGN-001 completes.

### Independent Mode (M Complete Pipelines)

```
Pipeline A: ANALYZE-A01 → DESIGN-A01 → REFACTOR-A01 → VALIDATE-A01 + REVIEW-A01
Pipeline B: ANALYZE-B01 → DESIGN-B01 → REFACTOR-B01 → VALIDATE-B01 + REVIEW-B01
...                                                               |
                                                             AGGREGATE → Phase 5
```

### Auto Mode

Auto-detects based on refactoring count at CP-2.5:
- count <= 2 → switch to single mode
- count >= 3 → switch to fan-out mode

## Task Metadata Registry

### Single Mode

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| ANALYZE-001 | analyzer | Stage 1 | (none) | Analyze architecture, identify structural issues |
| DESIGN-001 | designer | Stage 2 | ANALYZE-001 | Design refactoring plan from architecture report |
| REFACTOR-001 | refactorer | Stage 3 | DESIGN-001 | Implement highest-priority refactorings |
| VALIDATE-001 | validator | Stage 4 | REFACTOR-001 | Validate build, tests, metrics, API compatibility |
| REVIEW-001 | reviewer | Stage 4 | REFACTOR-001 | Review refactoring code for correctness |
| FIX-001 | refactorer | Stage 3 (cycle) | REVIEW-001 or VALIDATE-001 | Fix issues found in review/validation |

### Fan-out Mode (Branch Tasks at CP-2.5)

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| ANALYZE-001 | analyzer | Stage 1 (shared) | (none) | Analyze architecture |
| DESIGN-001 | designer | Stage 2 (shared) | ANALYZE-001 | Design plan with discrete REFACTOR-IDs |
| REFACTOR-B{NN} | refactorer | Stage 3 (branch) | DESIGN-001 | Implement REFACTOR-{NNN} only |
| VALIDATE-B{NN} | validator | Stage 4 (branch) | REFACTOR-B{NN} | Validate branch B{NN} |
| REVIEW-B{NN} | reviewer | Stage 4 (branch) | REFACTOR-B{NN} | Review branch B{NN} |
| FIX-B{NN}-{cycle} | refactorer | Fix (branch) | (none) | Fix issues in branch B{NN} |

### Independent Mode

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| ANALYZE-{P}01 | analyzer | Stage 1 | (none) | Analyze for pipeline {P} target |
| DESIGN-{P}01 | designer | Stage 2 | ANALYZE-{P}01 | Design for pipeline {P} |
| REFACTOR-{P}01 | refactorer | Stage 3 | DESIGN-{P}01 | Implement pipeline {P} refactorings |
| VALIDATE-{P}01 | validator | Stage 4 | REFACTOR-{P}01 | Validate pipeline {P} |
| REVIEW-{P}01 | reviewer | Stage 4 | REFACTOR-{P}01 | Review pipeline {P} |

## Checkpoints

| Checkpoint | Trigger | Location | Behavior |
|------------|---------|----------|----------|
| CP-1 | ANALYZE-001 complete | After Stage 1 | User reviews architecture report, can refine scope |
| CP-2 | DESIGN-001 complete | After Stage 2 | User reviews refactoring plan, can adjust priorities |
| CP-2.5 | DESIGN-001 complete (auto/fan-out) | After Stage 2 | Auto-create N branch tasks, spawn all REFACTOR-B* in parallel |
| CP-3 | REVIEW/VALIDATE fail | Stage 4 (per-branch) | Auto-create FIX task for that branch only (max 3x per branch) |
| CP-4 | All tasks/branches complete | Phase 5 | Aggregate results, interactive completion action |

## Task Naming Rules

| Mode | Stage 3 | Stage 4 | Fix | Retry |
|------|---------|---------|-----|-------|
| Single | REFACTOR-001 | VALIDATE-001, REVIEW-001 | FIX-001 | VALIDATE-001-R1, REVIEW-001-R1 |
| Fan-out | REFACTOR-B01 | VALIDATE-B01, REVIEW-B01 | FIX-B01-1 | VALIDATE-B01-R1, REVIEW-B01-R1 |
| Independent | REFACTOR-A01 | VALIDATE-A01, REVIEW-A01 | FIX-A01-1 | VALIDATE-A01-R1, REVIEW-A01-R1 |

## Parallel Mode Invocation

```bash
Skill(skill="team-arch-opt", args="<task-description>")                           # auto mode
Skill(skill="team-arch-opt", args="--parallel-mode=fan-out <task-description>")   # force fan-out
Skill(skill="team-arch-opt", args='--parallel-mode=independent "target1" "target2"')  # independent
Skill(skill="team-arch-opt", args="--max-branches=3 <task-description>")           # limit branches
```
