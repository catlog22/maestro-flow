
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task - Performance Optimization

## Signal Detection

### Parallel Mode Detection

| Flag | Value | Pipeline Shape |
|------|-------|----------------|
| `--parallel-mode=single` | explicit | Single linear pipeline |
| `--parallel-mode=fan-out` | explicit | Shared profile+strategy, N parallel IMPL branches |
| `--parallel-mode=independent` | explicit | M fully independent pipelines |
| `--parallel-mode=auto` or absent | default | Auto-detect from bottleneck count at CP-2.5 |
| `auto` with count <= 2 | auto-resolved | single mode |
| `auto` with count >= 3 | auto-resolved | fan-out mode |

### Scope Detection

| Signal | Target |
|--------|--------|
| Specific file/module mentioned | Scoped optimization |
| "slow", "performance", generic | Full application profiling |
| Specific metric mentioned (FCP, memory, startup) | Targeted metric optimization |
| Multiple quoted targets (independent mode) | Per-target scoped optimization |

### Optimization Keywords

| Keywords | Capability |
|----------|------------|
| profile, bottleneck, slow, benchmark | profiler |
| optimize, improve, reduce, speed | optimizer |
| strategy, plan, prioritize | strategist |
| verify, test, validate | benchmarker |
| review, audit, quality | reviewer |

## Output

Coordinator state from this command (used by dispatch.md):

```json
{
  "parallel_mode": "<auto|single|fan-out|independent>",
  "max_branches": 5,
  "optimization_targets": ["<target1>", "<target2>"],
  "independent_targets": [],
  "scope": "<specific|full-app|targeted>",
  "target_metrics": ["<metric1>", "<metric2>"]
}
```

## Pipeline Structure by Mode

| Mode | Stages |
|------|--------|
| single | PROFILE-001 -> STRATEGY-001 -> IMPL-001 -> BENCH-001 + REVIEW-001 |
| fan-out | PROFILE-001 -> STRATEGY-001 -> [IMPL-B01..N in parallel] -> BENCH+REVIEW per branch |
| independent | N complete pipelines (PROFILE+STRATEGY+IMPL+BENCH+REVIEW) in parallel |
| auto | Decided at CP-2.5 after STRATEGY-001 completes based on bottleneck count |
