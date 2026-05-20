# Evaluation Criteria

Skill 质量评估标准，由 Phase 03 (Evaluate) 引用。Gemini 按此标准对 skill 产出物进行多维度评分。

## Dimensions

| Dimension | Weight | ID | Description |
|-----------|--------|----|-------------|
| Clarity | 0.20 | clarity | 指令清晰无歧义，结构良好，易于遵循。Phase 文件有明确的 Step 划分、输入输出说明 |
| Completeness | 0.25 | completeness | 覆盖所有必要阶段、边界情况、错误处理。没有遗漏关键执行路径 |
| Correctness | 0.25 | correctness | 逻辑正确，数据流一致，Phase 间无矛盾。State schema 与实际使用匹配 |
| Effectiveness | 0.20 | effectiveness | 在给定测试场景下能产出高质量输出。产物满足用户需求和成功标准 |
| Efficiency | 0.10 | efficiency | 无冗余内容，上下文使用合理，不浪费 token。Phase 职责清晰无重叠 |

## Scoring Guide

| Range | Level | Description |
|-------|-------|-------------|
| 90-100 | Excellent | 生产级别，几乎无改进空间 |
| 80-89 | Good | 可投入使用，仅需微调 |
| 70-79 | Adequate | 功能可用，有明显可改进区域 |
| 60-69 | Needs Work | 存在影响产出质量的显著问题 |
| 0-59 | Poor | 结构或逻辑存在根本性问题 |

## Composite Score Calculation

```
composite = sum(dimension.score * dimension.weight)
```

## Output JSON Schema

```json
{
  "composite_score": 75,
  "dimensions": [
    { "name": "Clarity", "id": "clarity", "score": 80, "weight": 0.20, "feedback": "..." },
    { "name": "Completeness", "id": "completeness", "score": 70, "weight": 0.25, "feedback": "..." },
    { "name": "Correctness", "id": "correctness", "score": 78, "weight": 0.25, "feedback": "..." },
    { "name": "Effectiveness", "id": "effectiveness", "score": 72, "weight": 0.20, "feedback": "..." },
    { "name": "Efficiency", "id": "efficiency", "score": 85, "weight": 0.10, "feedback": "..." }
  ],
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "...", "..."],
  "suggestions": [
    {
      "priority": "high",
      "target_file": "phases/02-execute.md",
      "description": "Add explicit error handling for CLI timeout",
      "rationale": "Current phase has no recovery path when CLI execution exceeds timeout",
      "code_snippet": "optional suggested replacement code"
    }
  ]
}
```

## Evaluation Focus by Iteration

| Iteration | Primary Focus |
|-----------|--------------|
| 1 | 全面评估，建立 baseline |
| 2-3 | 重点关注上一轮 weaknesses 是否改善，避免重复已解决的问题 |
| 4+ | 精细化改进，关注 Effectiveness 和 Efficiency |
