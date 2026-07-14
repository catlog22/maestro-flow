

# Pipeline Definitions — Team Performance Optimization

## Pipeline Modes

### Single Mode (Linear with Review-Fix Cycle)

```
Stage 1           Stage 2           Stage 3           Stage 4
PROFILE-001  -->  STRATEGY-001 -->  IMPL-001   --> BENCH-001
[profiler]        [strategist]      [optimizer]    [benchmarker]
                                        ^               |
                                        +<--FIX-001---->+
                                        |          REVIEW-001
                                        +<-------->  [reviewer]
                                  (max 3 iterations)
```

### Fan-out Mode (Shared stages 1-2, parallel branches 3-4)

```
Stage 1           Stage 2         CP-2.5          Stage 3+4 (per branch)
PROFILE-001 --> STRATEGY-001 --+-> IMPL-B01 --> BENCH-B01 + REVIEW-B01 (fix cycle)
                               +-> IMPL-B02 --> BENCH-B02 + REVIEW-B02 (fix cycle)
                               +-> IMPL-B0N --> BENCH-B0N + REVIEW-B0N (fix cycle)
                                                          |
                                                     AGGREGATE -> Phase 5
```

### Independent Mode (M fully independent pipelines)

```
Pipeline A: PROFILE-A01 --> STRATEGY-A01 --> IMPL-A01 --> BENCH-A01 + REVIEW-A01
Pipeline B: PROFILE-B01 --> STRATEGY-B01 --> IMPL-B01 --> BENCH-B01 + REVIEW-B01
                                                          |
                                                     AGGREGATE -> Phase 5
```

## Task Metadata Registry (Single Mode)

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| PROFILE-001 | profiler | Stage 1 | (none) | Profile application, identify bottlenecks |
| STRATEGY-001 | strategist | Stage 2 | PROFILE-001 | Design optimization plan from bottleneck report |
| IMPL-001 | optimizer | Stage 3 | STRATEGY-001 | Implement highest-priority optimizations |
| BENCH-001 | benchmarker | Stage 4 | IMPL-001 | Run benchmarks, compare vs baseline |
| REVIEW-001 | reviewer | Stage 4 | IMPL-001 | Review optimization code for correctness |
| FIX-001 | optimizer | Stage 3 (cycle) | REVIEW-001 or BENCH-001 | Fix issues found in review/benchmark |

## Checkpoints

| Checkpoint | Trigger | Behavior |
|------------|---------|----------|
| CP-1 | PROFILE-001 complete | User reviews bottleneck report, can refine scope |
| CP-2 | STRATEGY-001 complete | User reviews optimization plan, can adjust priorities |
| CP-2.5 | STRATEGY-001 complete (auto/fan-out) | Auto-create N branch tasks, spawn all IMPL-B* in parallel |
| CP-3 | REVIEW/BENCH fail | Auto-create FIX task for that branch only (max 3x per branch) |
| CP-4 | All tasks/branches complete | Aggregate results, interactive completion action |

## Task Naming Rules

| Mode | Stage 3 | Stage 4 | Fix | Retry |
|------|---------|---------|-----|-------|
| Single | IMPL-001 | BENCH-001, REVIEW-001 | FIX-001 | BENCH-001-R1, REVIEW-001-R1 |
| Fan-out | IMPL-B01 | BENCH-B01, REVIEW-B01 | FIX-B01-1 | BENCH-B01-R1, REVIEW-B01-R1 |
| Independent | IMPL-A01 | BENCH-A01, REVIEW-A01 | FIX-A01-1 | BENCH-A01-R1, REVIEW-A01-R1 |
