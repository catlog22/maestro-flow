

# Pipeline Definitions — Team Ultra Analyze

## Pipeline Modes

### Quick Mode (3 tasks, serial)

```
EXPLORE-001 -> ANALYZE-001 -> SYNTH-001
```

| Task | Role | Dependencies |
|------|------|-------------|
| EXPLORE-001 | explorer | (none) |
| ANALYZE-001 | analyst | EXPLORE-001 |
| SYNTH-001 | synthesizer | ANALYZE-001 |

### Standard Mode (2N+2 tasks, parallel windows)

```
[EXPLORE-001..N](parallel) -> [ANALYZE-001..N](parallel) -> DISCUSS-001 -> SYNTH-001
```

| Task | Role | Dependencies |
|------|------|-------------|
| EXPLORE-001..N | explorer | (none, parallel) |
| ANALYZE-001..N | analyst | corresponding EXPLORE-N |
| DISCUSS-001 | discussant | all ANALYZE tasks |
| SYNTH-001 | synthesizer | DISCUSS-001 |

### Deep Mode (2N+1 tasks initially, dynamic loop)

Same as Standard but SYNTH-001 is omitted at dispatch. Created dynamically after discussion loop completes.

Dynamic tasks created during discussion loop:
- `DISCUSS-N` (round N) — created based on user feedback
- `ANALYZE-fix-N` (direction fix) — created when user requests adjusted focus
- `SYNTH-001` — created after final discussion round

## Task Metadata Registry

| Task ID | Role | Dependencies | Description |
|---------|------|-------------|-------------|
| EXPLORE-1..depth | explorer | (none) | Parallel codebase exploration, one per perspective |
| ANALYZE-1..depth | analyst | EXPLORE-1..depth (all) | Parallel deep analysis, one per perspective |
| DISCUSS-001 | discussant | ANALYZE-1..depth (all) | Process analysis results, identify gaps |
| ANALYZE-fix-N | analyst | DISCUSS-N | Re-analysis for adjusted focus (Deep mode) |
| DISCUSS-002..N | discussant | ANALYZE-fix-N | Subsequent discussion rounds (Deep mode, max 5) |
| SYNTH-001 | synthesizer | Last DISCUSS-N | Cross-perspective integration and conclusions |

## Discussion Loop Control

| Mode | Max Rounds | Trigger |
|------|-----------|---------|
| quick | 0 | No discussion |
| standard | 1 | After DISCUSS-001 |
| deep | 5 | After each DISCUSS-N |

## Checkpoints

| Trigger | Location | Behavior |
|---------|----------|----------|
| Discussion round (Deep mode) | After DISCUSS-N completes | Pause, AskUser for direction/continuation |
| Discussion loop limit | >5 rounds | Force synthesis, offer continuation |
| Pipeline stall | No ready + no running | Check missing tasks, report to user |
