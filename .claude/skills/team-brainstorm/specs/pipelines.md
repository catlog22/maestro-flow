

# Pipeline Definitions — team-brainstorm

## Available Pipelines

### Quick Pipeline (3 beats, strictly serial)

```
IDEA-001 → CHALLENGE-001 → SYNTH-001
[ideator]   [challenger]   [synthesizer]
```

### Deep Pipeline (6 beats, Generator-Critic loop)

```
IDEA-001 → CHALLENGE-001 → IDEA-002(fix) → CHALLENGE-002 → SYNTH-001 → EVAL-001
```

GC loop check: if critique.severity >= HIGH → create IDEA-fix → CHALLENGE-2 → SYNTH; else skip to SYNTH

### Full Pipeline (7 tasks, fan-out parallel ideation + GC)

```
[IDEA-001 + IDEA-002 + IDEA-003](parallel) → CHALLENGE-001(batch) → IDEA-004(fix) → SYNTH-001 → EVAL-001
```

## Task Metadata Registry

| Task ID | Role | Phase | Dependencies | Description |
|---------|------|-------|-------------|-------------|
| IDEA-001 | ideator | generate | (none) | Multi-angle idea generation |
| IDEA-002 | ideator | generate | (none) | Parallel angle (Full pipeline only) |
| IDEA-003 | ideator | generate | (none) | Parallel angle (Full pipeline only) |
| CHALLENGE-001 | challenger | challenge | IDEA-001 (or all IDEA-*) | Devil's advocate critique and feasibility challenge |
| IDEA-004 | ideator | gc-fix | CHALLENGE-001 | Revision based on critique (GC loop, if triggered) |
| CHALLENGE-002 | challenger | gc-fix | IDEA-004 | Re-critique of revised ideas (GC loop round 2) |
| SYNTH-001 | synthesizer | synthesize | last CHALLENGE-* | Cross-idea integration, theme extraction, conflict resolution |
| EVAL-001 | evaluator | evaluate | SYNTH-001 | Scoring, ranking, priority recommendation, final selection |

## Checkpoints

| Trigger | Location | Behavior |
|---------|----------|----------|
| Generator-Critic loop | After CHALLENGE-* | If severity >= HIGH → create IDEA-fix task; else proceed to SYNTH |
| GC loop limit | Max 2 rounds | Exceeds limit → force convergence to SYNTH |
| Pipeline stall | No ready + no running | Check missing tasks, report to user |

## Completion Conditions

| Mode | Completion Condition |
|------|---------------------|
| quick | All 3 tasks completed |
| deep | All 6 tasks (+ any skipped GC tasks) completed |
| full | All 7 tasks (+ any skipped GC tasks) completed |

## Shared State (meta.json)

| Role | State Key |
|------|-----------|
| ideator | `generated_ideas` |
| challenger | `critique_insights` |
| synthesizer | `synthesis_themes` |
| evaluator | `evaluation_scores` |

## Message Types

| Role | Types |
|------|-------|
| coordinator | `pipeline_selected`, `gc_loop_trigger`, `task_unblocked`, `error`, `shutdown` |
| ideator | `ideas_ready`, `ideas_revised`, `error` |
| challenger | `critique_ready`, `error` |
| synthesizer | `synthesis_ready`, `error` |
| evaluator | `evaluation_ready`, `error` |
