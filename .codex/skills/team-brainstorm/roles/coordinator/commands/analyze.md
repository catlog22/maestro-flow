
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Analyze Task

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| generate, create, brainstorm, ideas, explore | ideator | IDEA |
| challenge, critique, argue, devil, risk | challenger | CHALLENGE |
| synthesize, integrate, combine, merge, themes | synthesizer | SYNTH |
| evaluate, score, rank, prioritize, select | evaluator | EVAL |

## Dependency Graph

Natural ordering tiers:
- Tier 0: ideator (divergent generation -- no dependencies)
- Tier 1: challenger (requires ideator output)
- Tier 2: ideator-revision (requires challenger output, GC loop)
- Tier 3: synthesizer (requires last challenger output)
- Tier 4: evaluator (requires synthesizer output, deep/full only)

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per capability needed | +1 |
| Strategic/systemic topic | +3 |
| Multi-dimensional analysis | +2 |
| Innovation-focused request | +2 |
| Simple/basic topic | -2 |

Results: 0-1 Low (quick), 2-3 Medium (deep), 4+ High (full)

## Pipeline Selection

| Complexity | Pipeline | Tasks |
|------------|----------|-------|
| Low | quick | IDEA → CHALLENGE → SYNTH |
| Medium | deep | IDEA → CHALLENGE → IDEA-fix → CHALLENGE-2 → SYNTH → EVAL |
| High | full | 3x IDEA (parallel) → CHALLENGE → IDEA-fix → SYNTH → EVAL |

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_type": "<quick|deep|full>",
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>", "keywords": ["..."] }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "blockedBy": ["..."], "priority": "P0|P1|P2" } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" },
  "angles": ["Technical", "Product", "Innovation", "Risk"]
}
```
