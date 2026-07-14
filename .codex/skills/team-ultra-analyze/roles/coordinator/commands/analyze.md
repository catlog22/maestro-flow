
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

## Signal Detection

### Pipeline Mode Detection

Parse `--mode` from arguments first. If not specified, auto-detect from topic description:

| Condition | Mode | Depth |
|-----------|------|-------|
| `--mode=quick` or topic contains "quick/overview/fast" | Quick | 1 |
| `--mode=deep` or topic contains "deep/thorough/detailed/comprehensive" | Deep | N (from perspectives) |
| Default (no match) | Standard | N (from perspectives) |

### Dimension Detection

Scan topic keywords to select analysis perspectives:

| Dimension | Keywords |
|-----------|----------|
| architecture | architecture, design, structure |
| implementation | implement, code, source |
| performance | performance, optimize, speed |
| security | security, auth, vulnerability |
| concept | concept, theory, principle |
| comparison | compare, vs, difference |
| decision | decision, choice, tradeoff |

**Depth** = number of selected perspectives. Quick mode always uses depth=1.

## Pipeline Mode Rules

| Mode | Task Structure |
|------|----------------|
| quick | EXPLORE-001 -> ANALYZE-001 -> SYNTH-001 (serial, depth=1) |
| standard | EXPLORE-001..N (parallel) -> ANALYZE-001..N (parallel) -> DISCUSS-001 -> SYNTH-001 |
| deep | Same as standard but SYNTH-001 omitted (created dynamically after discussion loop) |

## Output

Write analysis config to coordinator state (not a file), to be used by dispatch.md:

```json
{
  "pipeline_mode": "<quick|standard|deep>",
  "depth": <number>,
  "perspectives": ["<perspective1>", "<perspective2>"],
  "topic": "<original topic>",
  "dimensions": ["<dim1>", "<dim2>"]
}
```

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per perspective | +1 |
| Deep mode | +2 |
| Cross-domain (3+ perspectives) | +1 |

Results: 1-3 Quick, 4-6 Standard, 7+ Deep (if not explicitly set)

## Discussion Loop Configuration

| Mode | Max Discussion Rounds |
|------|----------------------|
| quick | 0 |
| standard | 1 |
| deep | 5 |
