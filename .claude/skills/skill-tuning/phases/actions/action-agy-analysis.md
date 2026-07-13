
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Agy Analysis

动态调用 Agy CLI 进行深度分析，根据用户需求或诊断结果选择分析类型。

## Role

- 接收用户指定的分析需求或从诊断结果推断需求
- 构建适当的 CLI 命令
- 执行分析并解析结果
- 更新状态以供后续动作使用

## Preconditions

- `state.status === 'running'`
- 满足以下任一条件:
  - `state.agy_analysis_requested === true` (用户请求)
  - `state.issues.some(i => i.severity === 'critical')` (发现严重问题)
  - `state.analysis_type !== null` (已指定分析类型)

## Analysis Types

### 1. root_cause - 问题根因分析

针对用户描述的问题进行深度分析。

```javascript
const analysisPrompt = `
PURPOSE: Identify root cause of skill execution issue: ${state.user_issue_description}
TASK:
• Analyze skill structure at: ${state.target_skill.path}
• Identify anti-patterns in phase files
• Trace data flow through state management
• Check agent coordination patterns
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: JSON with structure:
{
  "root_causes": [
    { "id": "RC-001", "description": "...", "severity": "high", "evidence": ["file:line"] }
  ],
  "patterns_found": [
    { "pattern": "...", "type": "anti-pattern|best-practice", "locations": [] }
  ],
  "recommendations": [
    { "priority": 1, "action": "...", "rationale": "..." }
  ]
}
RULES: Focus on execution flow, state management, agent coordination
`;
```

### 2. architecture - 架构审查

评估 skill 的整体架构设计。

```javascript
const analysisPrompt = `
PURPOSE: Review skill architecture for: ${state.target_skill.name}
TASK:
• Evaluate phase decomposition and responsibility separation
• Check state schema design and data flow
• Assess agent coordination and error handling
• Review scalability and maintainability
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: Markdown report with sections:
- Executive Summary
- Phase Architecture Assessment
- State Management Evaluation
- Agent Coordination Analysis
- Improvement Recommendations (prioritized)
RULES: Focus on modularity, extensibility, maintainability
`;
```

### 3. prompt_optimization - 提示词优化

分析和优化 phase 中的提示词。

```javascript
const analysisPrompt = `
PURPOSE: Optimize prompts in skill phases for better output quality
TASK:
• Analyze existing prompts for clarity and specificity
• Identify ambiguous instructions
• Check output format specifications
• Evaluate constraint communication
MODE: analysis
CONTEXT: @phases/**/*.md
EXPECTED: JSON with structure:
{
  "prompt_issues": [
    { "file": "...", "issue": "...", "severity": "...", "suggestion": "..." }
  ],
  "optimized_prompts": [
    { "file": "...", "original": "...", "optimized": "...", "rationale": "..." }
  ]
}
RULES: Preserve intent, improve clarity, add structured output requirements
`;
```

### 4. performance - 性能分析

分析 Token 消耗和执行效率。

```javascript
const analysisPrompt = `
PURPOSE: Analyze performance bottlenecks in skill execution
TASK:
• Estimate token consumption per phase
• Identify redundant data passing
• Check for unnecessary full-content transfers
• Evaluate caching opportunities
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: JSON with structure:
{
  "token_estimates": [
    { "phase": "...", "estimated_tokens": 1000, "breakdown": {} }
  ],
  "bottlenecks": [
    { "type": "...", "location": "...", "impact": "high|medium|low", "fix": "..." }
  ],
  "optimization_suggestions": []
}
RULES: Focus on token efficiency, reduce redundancy
`;
```

### 5. custom - 自定义分析

用户指定的自定义分析需求。

```javascript
const analysisPrompt = `
PURPOSE: ${state.custom_analysis_purpose}
TASK: ${state.custom_analysis_tasks}
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: ${state.custom_analysis_expected}
RULES: ${state.custom_analysis_rules || 'Follow best practices'}
`;
```

## Execution

```javascript
async function executeAgyAnalysis(state, workDir) {
  // 1. 确定分析类型
  const analysisType = state.analysis_type || determineAnalysisType(state);

  // 2. 构建 prompt
  const prompt = buildAnalysisPrompt(analysisType, state);

  // 3. 构建 CLI 命令
  const cliCommand = `maestro delegate "${escapeForShell(prompt)}" --to agy --mode analysis --cd "${state.target_skill.path}"`;

  console.log(`Executing Agy analysis: ${analysisType}`);
  console.log(`Command: ${cliCommand}`);

  // 4. 执行 CLI (后台运行)
  const result = Bash({
    command: cliCommand,
    run_in_background: true,
    timeout: 300000  // 5 minutes
  });

  // 5. 等待结果
  // 注意: 根据 CLAUDE.md 指引，CLI 后台执行后应停止轮询
  // 结果会在 CLI 完成后写入 state

  return {
    stateUpdates: {
      agy_analysis: {
        type: analysisType,
        status: 'running',
        started_at: new Date().toISOString(),
        task_id: result.task_id
      }
    },
    outputFiles: [],
    summary: `Agy ${analysisType} analysis started in background`
  };
}

function determineAnalysisType(state) {
  // 根据状态推断分析类型
  if (state.user_issue_description && state.user_issue_description.length > 100) {
    return 'root_cause';
  }
  if (state.issues.some(i => i.severity === 'critical')) {
    return 'root_cause';
  }
  if (state.focus_areas.includes('architecture')) {
    return 'architecture';
  }
  if (state.focus_areas.includes('prompt')) {
    return 'prompt_optimization';
  }
  if (state.focus_areas.includes('performance')) {
    return 'performance';
  }
  return 'root_cause';  // 默认
}

function buildAnalysisPrompt(type, state) {
  const templates = {
    root_cause: () => `
PURPOSE: Identify root cause of skill execution issue: ${state.user_issue_description}
TASK: • Analyze skill structure • Identify anti-patterns • Trace data flow issues • Check agent coordination
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: JSON { root_causes: [], patterns_found: [], recommendations: [] }
RULES: Focus on execution flow, be specific about file:line locations
`,
    architecture: () => `
PURPOSE: Review skill architecture for ${state.target_skill.name}
TASK: • Evaluate phase decomposition • Check state design • Assess agent coordination • Review extensibility
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: Markdown architecture assessment report
RULES: Focus on modularity and maintainability
`,
    prompt_optimization: () => `
PURPOSE: Optimize prompts in skill for better output quality
TASK: • Analyze prompt clarity • Check output specifications • Evaluate constraint handling
MODE: analysis
CONTEXT: @phases/**/*.md
EXPECTED: JSON { prompt_issues: [], optimized_prompts: [] }
RULES: Preserve intent, improve clarity
`,
    performance: () => `
PURPOSE: Analyze performance bottlenecks in skill
TASK: • Estimate token consumption • Identify redundancy • Check data transfer efficiency
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: JSON { token_estimates: [], bottlenecks: [], optimization_suggestions: [] }
RULES: Focus on token efficiency
`,
    custom: () => `
PURPOSE: ${state.custom_analysis_purpose}
TASK: ${state.custom_analysis_tasks}
MODE: analysis
CONTEXT: @**/*.md
EXPECTED: ${state.custom_analysis_expected}
RULES: ${state.custom_analysis_rules || 'Best practices'}
`
  };

  return templates[type]();
}

function escapeForShell(str) {
  // 转义 shell 特殊字符
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}
```

## Output

### State Updates

```javascript
{
  agy_analysis: {
    type: 'root_cause' | 'architecture' | 'prompt_optimization' | 'performance' | 'custom',
    status: 'running' | 'completed' | 'failed',
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:05:00Z',
    task_id: 'xxx',
    result: { /* 分析结果 */ },
    error: null
  },
  // 分析结果合并到 issues
  issues: [
    ...state.issues,
    ...newIssuesFromAnalysis
  ]
}
```

### Output Files

- `${workDir}/diagnosis/agy-analysis-${type}.json` - 原始分析结果
- `${workDir}/diagnosis/agy-analysis-${type}.md` - 格式化报告

## Post-Execution

分析完成后:
1. 解析 CLI 输出为结构化数据
2. 提取新发现的 issues 合并到 state.issues
3. 更新 recommendations 到 state
4. 触发下一步动作 (通常是 action-generate-report 或 action-propose-fixes)

## Error Handling

| Error | Recovery |
|-------|----------|
| CLI 超时 | 重试一次，仍失败则跳过 Agy 分析 |
| 解析失败 | 保存原始输出，手动处理 |
| 无结果 | 标记为 skipped，继续流程 |

## User Interaction

如果 `state.analysis_type === null` 且无法自动推断，询问用户:

```javascript
AskUserQuestion({
  questions: [{
    question: '请选择 Agy 分析类型',
    header: '分析类型',
    options: [
      { label: '问题根因分析', description: '深度分析用户描述的问题' },
      { label: '架构审查', description: '评估整体架构设计' },
      { label: '提示词优化', description: '分析和优化 phase 提示词' },
      { label: '性能分析', description: '分析 Token 消耗和执行效率' }
    ],
    multiSelect: false
  }]
});
```
