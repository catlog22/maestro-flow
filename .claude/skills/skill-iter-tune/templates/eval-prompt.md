# Evaluation Prompt Template

Phase 03 使用此模板构造 ccw cli 提示词，让 Gemini 按多维度评估 skill 质量。

## Template

```
PURPOSE: Evaluate the quality of a workflow skill by examining both its definition files and the artifacts it produced when executed against a test scenario. Provide a structured multi-dimensional score with actionable improvement suggestions.

SKILL DEFINITION:
${skillContent}

TEST SCENARIO:
${testScenario.description}
Requirements: ${testScenario.requirements}
Success Criteria: ${testScenario.success_criteria}

ARTIFACTS PRODUCED:
${artifactsSummary}

EVALUATION CRITERIA:
${evaluationCriteria}

${previousEvalContext}

TASK:
1. Read all skill definition files and produced artifacts carefully
2. Score each dimension on 0-100 based on the evaluation criteria:
   - Clarity (weight 0.20): Instructions unambiguous, well-structured, easy to follow
   - Completeness (weight 0.25): All phases, edge cases, error handling covered
   - Correctness (weight 0.25): Logic sound, data flow consistent, no contradictions
   - Effectiveness (weight 0.20): Produces high-quality output for the test scenario
   - Efficiency (weight 0.10): Minimal redundancy, appropriate context usage
3. Calculate weighted composite score
4. List top 3 strengths
5. List top 3-5 weaknesses with specific file:section references
6. Provide 3-5 prioritized improvement suggestions with concrete changes

MODE: analysis

EXPECTED OUTPUT FORMAT (strict JSON, no markdown wrapping):
{
  "composite_score": <number 0-100>,
  "dimensions": [
    { "name": "Clarity", "id": "clarity", "score": <0-100>, "weight": 0.20, "feedback": "<specific feedback>" },
    { "name": "Completeness", "id": "completeness", "score": <0-100>, "weight": 0.25, "feedback": "<specific feedback>" },
    { "name": "Correctness", "id": "correctness", "score": <0-100>, "weight": 0.25, "feedback": "<specific feedback>" },
    { "name": "Effectiveness", "id": "effectiveness", "score": <0-100>, "weight": 0.20, "feedback": "<specific feedback>" },
    { "name": "Efficiency", "id": "efficiency", "score": <0-100>, "weight": 0.10, "feedback": "<specific feedback>" }
  ],
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<weakness 1 with file:section reference>", "..."],
  "suggestions": [
    {
      "priority": "high|medium|low",
      "target_file": "<relative path to skill file>",
      "description": "<what to change>",
      "rationale": "<why this improves quality>",
      "code_snippet": "<optional: suggested replacement content>"
    }
  ],
  "chain_scores": {
    "<skill_name>": "<number 0-100, per-skill score — only present in chain mode>"
  }
}

CONSTRAINTS:
- Be rigorous and specific — reference exact file paths and sections
- Each suggestion MUST include a target_file that maps to a skill file
- Focus suggestions on highest-impact changes first
- Do NOT suggest changes already addressed in previous iterations
- Output ONLY the JSON object, no surrounding text or markdown
```

## Variable Substitution

| Variable | Source | Description |
|----------|--------|-------------|
| `${skillContent}` | Same as execute-prompt.md | 完整 skill 文件内容 |
| `${testScenario.*}` | iteration-state.json | 测试场景信息 |
| `${artifactsSummary}` | Phase 03 reads artifacts/ dir | 产出物文件列表 + 内容摘要 |
| `${evaluationCriteria}` | specs/evaluation-criteria.md | 评分标准全文 |
| `${previousEvalContext}` | 历史迭代记录 | 前几轮评估摘要（避免重复建议） |
| `${chainContext}` | Phase 03 constructs | chain 模式下的链上下文信息 |

## previousEvalContext Construction

```javascript
// Build context from prior iterations to avoid repeating suggestions
const previousEvalContext = state.iterations.length > 0
  ? `PREVIOUS ITERATIONS (context for avoiding duplicate suggestions):
${state.iterations.map(iter => `
Iteration ${iter.round}: Score ${iter.evaluation?.score || 'N/A'}
  Applied changes: ${iter.improvement?.changes_applied?.map(c => c.summary).join('; ') || 'none'}
  Remaining weaknesses: ${iter.evaluation?.weaknesses?.slice(0, 3).join('; ') || 'none'}
`).join('')}
IMPORTANT: Focus on NEW issues or issues NOT adequately addressed in previous improvements.`
  : '';
```

## chainContext Construction

```javascript
// Build chain context for evaluation (chain mode only)
const chainContext = state.execution_mode === 'chain'
  ? `CHAIN CONTEXT:
This skill chain contains ${state.chain_order.length} skills executed in order:
${state.chain_order.map((s, i) => `${i+1}. ${s}`).join('\n')}
Current evaluation covers the entire chain output.
Please provide per-skill quality scores in an additional "chain_scores" field.`
  : '';
```

## artifactsSummary Construction

```javascript
// Read manifest.json if available, otherwise list files
const manifestPath = `${iterDir}/artifacts/manifest.json`;
let artifactsSummary;

if (fileExists(manifestPath)) {
  const manifest = JSON.parse(Read(manifestPath));
  artifactsSummary = manifest.artifacts.map(a =>
    `- ${a.path}: ${a.description} (Phase ${a.phase})`
  ).join('\n');
} else {
  // Fallback: list all files with first 200 lines each
  const files = Glob(`${iterDir}/artifacts/**/*`);
  artifactsSummary = files.map(f => {
    const content = Read(f, { limit: 200 });
    return `--- ${f.replace(iterDir + '/artifacts/', '')} ---\n${content}`;
  }).join('\n\n');
}
```
