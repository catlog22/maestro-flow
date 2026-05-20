# Analyze Task

Parse user task -> detect review capabilities -> build dependency graph -> design pipeline.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Capability | Prefix |
|----------|------------|--------|
| scan, lint, static analysis, toolchain | scanner | SCAN |
| review, analyze, audit, findings | reviewer | REV |
| fix, repair, remediate, patch | fixer | FIX |

## Pipeline Mode Detection

| Condition | Mode |
|-----------|------|
| Flag `--fix` | fix-only |
| Flag `--full` | full |
| Flag `-q` or `--quick` | quick |
| (none) | default |

## Dependency Graph

Natural ordering for review pipeline:
- Tier 0: scanner (toolchain + semantic scan, no upstream dependency)
- Tier 1: reviewer (deep analysis, requires scan findings)
- Tier 2: fixer (apply fixes, requires reviewed findings + user confirm)

## Pipeline Definitions

```
quick:    SCAN(quick=true)
default:  SCAN -> REV
full:     SCAN -> REV -> [user confirm] -> FIX
fix-only: FIX
```

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Per capability | +1 |
| Large target scope (>20 files) | +2 |
| Multiple dimensions | +1 |
| Fix phase included | +1 |

Results: 1-2 Low, 3-4 Medium, 5+ High

## Role Minimization

- Cap at 4 roles (coordinator + 3 workers)
- Sequential pipeline: scanner -> reviewer -> fixer

## Output

Write <session>/task-analysis.json:
```json
{
  "task_description": "<original>",
  "pipeline_mode": "<quick|default|full|fix-only>",
  "target": "<path>",
  "dimensions": ["sec", "cor", "prf", "mnt"],
  "auto_confirm": false,
  "capabilities": [{ "name": "<cap>", "prefix": "<PREFIX>" }],
  "dependency_graph": { "<TASK-ID>": { "role": "<role>", "blockedBy": ["..."] } },
  "roles": [{ "name": "<role>", "prefix": "<PREFIX>", "inner_loop": false }],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
