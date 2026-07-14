---
role: analyst
prefix: ANALYZE
inner_loop: false
additional_prefixes: [ANALYZE-fix]
message_types: 
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Deep Analyst

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| Exploration results | `<session>/explorations/*.json` | Yes |

1. Extract session path, topic, perspective, dimensions from task description
2. Detect direction-fix mode: `type:\s*direction-fix` with `adjusted_focus:\s*(.+)`
3. Load corresponding exploration results:

| Condition | Source |
|-----------|--------|
| Direction fix | Read ALL exploration files, merge context |
| Normal ANALYZE-N | Read exploration matching number N |
| Fallback | Read first available exploration file |

4. Select CLI tool by perspective:

| Perspective | CLI Tool | Rule Template |
|-------------|----------|---------------|
| technical | agy | analysis-analyze-code-patterns |
| architectural | claude | analysis-review-architecture |
| business | codex | analysis-analyze-code-patterns |
| domain_expert | agy | analysis-analyze-code-patterns |
| direction-fix (any) | agy | analysis-diagnose-bug-root-cause |

## Phase 3: Deep Analysis via CLI

Build analysis prompt with exploration context:

```
PURPOSE: <Normal: "Deep analysis of '<topic>' from <perspective> perspective">
         <Fix: "Supplementary analysis with adjusted focus on '<adjusted_focus>'">
Success: Actionable insights with confidence levels and evidence references

PRIOR EXPLORATION CONTEXT:
- Key files: <top 5-8 files from exploration>
- Patterns found: <top 3-5 patterns>
- Key findings: <top 3-5 findings>

TASK:
- <perspective-specific analysis tasks>
- Generate structured findings with confidence levels (high/medium/low)
- Identify discussion points requiring user input
- List open questions needing further exploration

MODE: analysis
CONTEXT: @**/* | Topic: <topic>
EXPECTED: Structured analysis with: key_insights, key_findings, discussion_points, open_questions, recommendations
CONSTRAINTS: Focus on <perspective> perspective | <dimensions>
```

Execute: `maestro delegate "<prompt>" --to <cli-tool> --mode analysis --rule <rule>`

### Tech Profile Scan

After analysis, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check analysis findings → signals (`sql_detected`, `auth_detected`, `ml_detected`, `api_surface`)
2. Check risk areas → signals (`perf_sensitive`, `injection_risk`, `legacy_patterns`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Result Aggregation

Write analysis output to `<session>/analyses/analysis-<num>.json`:

```json
{
  "perspective": "<perspective>",
  "dimensions": ["<dim1>", "<dim2>"],
  "is_direction_fix": false,
  "key_insights": [{"insight": "...", "confidence": "high", "evidence": "file:line"}],
  "key_findings": [{"finding": "...", "file_ref": "...", "impact": "..."}],
  "discussion_points": ["..."],
  "open_questions": ["..."],
  "recommendations": [{"action": "...", "rationale": "...", "priority": "high"}],
  "_metadata": {"cli_tool": "...", "cli_rule": "...", "perspective": "...", "timestamp": "..."}
}
```

Update `<session>/wisdom/.msg/meta.json` under `analyst` namespace:
- Read existing -> merge `{ "analyst": { perspective, insight_count, finding_count, is_direction_fix } }` -> write back
