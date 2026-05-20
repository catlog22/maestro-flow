# Analyze Task

Parse user task -> detect tech debt signals -> assess complexity -> determine pipeline mode and roles.

**CONSTRAINT**: Text-level analysis only. NO source code reading, NO codebase exploration.

## Signal Detection

| Keywords | Signal | Mode Hint |
|----------|--------|-----------|
| 扫描, scan, 审计, audit | debt-scan | scan |
| 评估, assess, quantify | debt-assess | scan |
| 规划, plan, roadmap | debt-plan | targeted |
| 修复, fix, remediate, clean | debt-fix | remediate |
| 验证, validate, verify | debt-validate | remediate |
| 定向, targeted, specific | debt-targeted | targeted |

## Complexity Scoring

| Factor | Points |
|--------|--------|
| Full codebase scope | +2 |
| Multiple debt dimensions | +1 per dimension (max 3) |
| Large codebase (implied) | +1 |
| Targeted specific items | -1 |

Results: 1-3 Low (scan mode), 4-6 Medium (remediate), 7+ High (remediate + full pipeline)

## Pipeline Mode Determination

| Score + Signals | Mode |
|----------------|------|
| scan/audit keywords | scan |
| targeted/specific keywords | targeted |
| Default | remediate |

## Output

Write scope context to coordinator memory:
```json
{
  "pipeline_mode": "<scan|remediate|targeted>",
  "scope": "<detected-scope>",
  "focus_dimensions": ["code", "architecture", "testing", "dependency", "documentation"],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
