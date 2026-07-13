
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Analyze Requirements

将用户问题描述拆解为多个分析维度，匹配 Spec，评估覆盖度，检测歧义。

## Purpose

- 将单一用户描述拆解为多个独立关注维度
- 为每个维度匹配 problem-taxonomy（检测）+ tuning-strategies（修复）
- 以"有修复策略"为标准判断是否满足需求
- 检测歧义并在必要时请求用户澄清

## Preconditions

- [ ] `state.status === 'running'`
- [ ] `state.target_skill !== null`
- [ ] `state.completed_actions.includes('action-init')`
- [ ] `!state.completed_actions.includes('action-analyze-requirements')`

## Execution

### Phase 1: 维度拆解 (Agy CLI)

调用 Agy 对用户描述进行语义分析，拆解为独立维度：

```javascript
async function analyzeDimensions(state, workDir) {
  const prompt = `
PURPOSE: 分析用户问题描述，拆解为独立的关注维度
TASK:
• 识别用户描述中的多个关注点（每个关注点应该是独立的、可单独分析的）
• 为每个关注点提取关键词（中英文均可）
• 推断可能的问题类别：
  - context_explosion: 上下文/Token 相关
  - memory_loss: 遗忘/约束丢失相关
  - dataflow_break: 状态/数据流相关
  - agent_failure: Agent/子任务相关
  - prompt_quality: 提示词/输出质量相关
  - architecture: 架构/结构相关
  - performance: 性能/效率相关
  - error_handling: 错误/异常处理相关
  - output_quality: 输出质量/验证相关
  - user_experience: 交互/体验相关
• 评估推断置信度 (0-1)

INPUT:
User description: ${state.user_issue_description}
Target skill: ${state.target_skill.name}
Skill structure: ${JSON.stringify(state.target_skill.phases)}

MODE: analysis
CONTEXT: @specs/problem-taxonomy.md @specs/dimension-mapping.md
EXPECTED: JSON (不要包含 markdown 代码块标记)
{
  "dimensions": [
    {
      "id": "DIM-001",
      "description": "关注点的简短描述",
      "keywords": ["关键词1", "关键词2"],
      "inferred_category": "问题类别",
      "confidence": 0.85,
      "reasoning": "推断理由"
    }
  ],
  "analysis_notes": "整体分析说明"
}
RULES: 
- 每个维度必须独立，不重叠
- 低于 0.5 置信度的推断应标注需要澄清
- 如果用户描述非常模糊，至少提取一个 "general" 维度
`;

  const cliCommand = `maestro delegate "${escapeForShell(prompt)}" --to agy --mode analysis --cd "${state.target_skill.path}"`;
  
  console.log('Phase 1: 执行 Agy 维度拆解分析...');
  
  const result = Bash({
    command: cliCommand,
    run_in_background: true,
    timeout: 300000
  });
  
  return result;
}
```

### Phase 2: Spec 匹配

基于 `specs/category-mappings.json` 配置为每个维度匹配检测模式和修复策略：

```javascript
// 加载集中式映射配置
const mappings = JSON.parse(Read('specs/category-mappings.json'));

function matchSpecs(dimensions) {
  return dimensions.map(dim => {
    // 匹配 taxonomy pattern
    const taxonomyMatch = findTaxonomyMatch(dim.inferred_category);

    // 匹配 strategy
    const strategyMatch = findStrategyMatch(dim.inferred_category);

    // 判断是否满足（核心标准：有修复策略）
    const hasFix = strategyMatch !== null && strategyMatch.strategies.length > 0;

    return {
      dimension_id: dim.id,
      taxonomy_match: taxonomyMatch,
      strategy_match: strategyMatch,
      has_fix: hasFix,
      needs_agy_analysis: taxonomyMatch === null || mappings.categories[dim.inferred_category]?.needs_agy_analysis
    };
  });
}

function findTaxonomyMatch(category) {
  const config = mappings.categories[category];
  if (!config || config.pattern_ids.length === 0) return null;

  return {
    category: category,
    pattern_ids: config.pattern_ids,
    severity_hint: config.severity_hint
  };
}

function findStrategyMatch(category) {
  const config = mappings.categories[category];
  if (!config) {
    // Fallback to custom from config
    return mappings.fallback;
  }

  return {
    strategies: config.strategies,
    risk_levels: config.risk_levels
  };
}
```

### Phase 3: 覆盖度评估

评估所有维度的 Spec 覆盖情况：

```javascript
function evaluateCoverage(specMatches) {
  const total = specMatches.length;
  const withDetection = specMatches.filter(m => m.taxonomy_match !== null).length;
  const withFix = specMatches.filter(m => m.has_fix).length;
  
  const rate = total > 0 ? Math.round((withFix / total) * 100) : 0;
  
  let status;
  if (rate >= 80) {
    status = 'satisfied';
  } else if (rate >= 50) {
    status = 'partial';
  } else {
    status = 'unsatisfied';
  }
  
  return {
    total_dimensions: total,
    with_detection: withDetection,
    with_fix_strategy: withFix,
    coverage_rate: rate,
    status: status
  };
}
```

### Phase 4: 歧义检测

识别需要用户澄清的歧义点：

```javascript
function detectAmbiguities(dimensions, specMatches) {
  const ambiguities = [];
  
  for (const dim of dimensions) {
    const match = specMatches.find(m => m.dimension_id === dim.id);
    
    // 检测1: 低置信度 (< 0.5)
    if (dim.confidence < 0.5) {
      ambiguities.push({
        dimension_id: dim.id,
        type: 'vague_description',
        description: `维度 "${dim.description}" 描述模糊，推断置信度低 (${dim.confidence})`,
        possible_interpretations: suggestInterpretations(dim),
        needs_clarification: true
      });
    }
    
    // 检测2: 无匹配类别
    if (!match || (!match.taxonomy_match && !match.strategy_match)) {
      ambiguities.push({
        dimension_id: dim.id,
        type: 'no_category_match',
        description: `维度 "${dim.description}" 无法匹配到已知问题类别`,
        possible_interpretations: ['custom'],
        needs_clarification: true
      });
    }
    
    // 检测3: 关键词冲突（可能属于多个类别）
    if (dim.keywords.length > 3 && hasConflictingKeywords(dim.keywords)) {
      ambiguities.push({
        dimension_id: dim.id,
        type: 'conflicting_keywords',
        description: `维度 "${dim.description}" 的关键词可能指向多个不同问题`,
        possible_interpretations: inferMultipleCategories(dim.keywords),
        needs_clarification: true
      });
    }
  }
  
  return ambiguities;
}

function suggestInterpretations(dim) {
  // 基于 mappings 配置推荐可能的解释
  const categories = Object.keys(mappings.categories).filter(
    cat => cat !== 'authoring_principles_violation'  // 排除内部检测类别
  );
  return categories.slice(0, 4);  // 返回最常见的 4 个作为选项
}

function hasConflictingKeywords(keywords) {
  // 检查关键词是否指向不同方向
  const categoryHints = keywords.map(k => getKeywordCategoryHint(k));
  const uniqueCategories = [...new Set(categoryHints.filter(c => c))];
  return uniqueCategories.length > 1;
}

function getKeywordCategoryHint(keyword) {
  // 从 mappings.keywords 构建查找表（合并中英文关键词）
  const keywordMap = {
    ...mappings.keywords.chinese,
    ...mappings.keywords.english
  };
  return keywordMap[keyword.toLowerCase()];
}
```

## User Interaction

如果检测到需要澄清的歧义，暂停并询问用户：

```javascript
async function handleAmbiguities(ambiguities, dimensions) {
  const needsClarification = ambiguities.filter(a => a.needs_clarification);
  
  if (needsClarification.length === 0) {
    return null;  // 无需澄清
  }
  
  const questions = needsClarification.slice(0, 4).map(a => {
    const dim = dimensions.find(d => d.id === a.dimension_id);
    
    return {
      question: `关于 "${dim.description}"，您具体指的是？`,
      header: a.dimension_id,
      options: a.possible_interpretations.map(interp => ({
        label: getCategoryLabel(interp),
        description: getCategoryDescription(interp)
      })),
      multiSelect: false
    };
  });
  
  return await AskUserQuestion({ questions });
}

function getCategoryLabel(category) {
  // 从 mappings 配置加载标签
  return mappings.category_labels_chinese[category] || category;
}

function getCategoryDescription(category) {
  // 从 mappings 配置加载描述
  return mappings.category_descriptions[category] || 'Requires further analysis';
}
```

## Output

### State Updates

```javascript
return {
  stateUpdates: {
    requirement_analysis: {
      status: ambiguities.some(a => a.needs_clarification) ? 'needs_clarification' : 'completed',
      analyzed_at: new Date().toISOString(),
      dimensions: dimensions,
      spec_matches: specMatches,
      coverage: coverageResult,
      ambiguities: ambiguities
    },
    // 根据分析结果自动优化 focus_areas
    focus_areas: deriveOptimalFocusAreas(specMatches)
  },
  outputFiles: [
    `${workDir}/requirement-analysis.json`,
    `${workDir}/requirement-analysis.md`
  ],
  summary: generateSummary(dimensions, coverageResult, ambiguities)
};

function deriveOptimalFocusAreas(specMatches) {
  const coreCategories = ['context', 'memory', 'dataflow', 'agent'];
  const matched = specMatches
    .filter(m => m.taxonomy_match !== null)
    .map(m => {
      // 映射到诊断 focus_area
      const category = m.taxonomy_match.category;
      if (category === 'context_explosion' || category === 'performance') return 'context';
      if (category === 'memory_loss') return 'memory';
      if (category === 'dataflow_break') return 'dataflow';
      if (category === 'agent_failure' || category === 'error_handling') return 'agent';
      return null;
    })
    .filter(f => f && coreCategories.includes(f));
  
  // 去重
  return [...new Set(matched)];
}

function generateSummary(dimensions, coverage, ambiguities) {
  const dimCount = dimensions.length;
  const coverageStatus = coverage.status;
  const ambiguityCount = ambiguities.filter(a => a.needs_clarification).length;
  
  let summary = `分析完成：${dimCount} 个维度`;
  summary += `，覆盖度 ${coverage.coverage_rate}% (${coverageStatus})`;
  
  if (ambiguityCount > 0) {
    summary += `，${ambiguityCount} 个歧义点待澄清`;
  }
  
  return summary;
}
```

### Output Files

#### requirement-analysis.json

```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "target_skill": "skill-name",
  "user_description": "原始用户描述",
  "dimensions": [...],
  "spec_matches": [...],
  "coverage": {...},
  "ambiguities": [...],
  "derived_focus_areas": [...]
}
```

#### requirement-analysis.md

```markdown
# 需求分析报告

## 用户描述
> ${user_issue_description}

## 维度拆解

| ID | 描述 | 类别 | 置信度 |
|----|------|------|--------|
| DIM-001 | ... | ... | 0.85 |

## Spec 匹配

| 维度 | 检测模式 | 修复策略 | 是否满足 |
|------|----------|----------|----------|
| DIM-001 | CTX-001,002 | sliding_window | ✓ |

## 覆盖度评估

- 总维度数: N
- 有检测手段: M
- 有修复策略: K (满足标准)
- 覆盖率: X%
- 状态: satisfied/partial/unsatisfied

## 歧义点

(如有)
```

## Error Handling

| Error | Recovery |
|-------|----------|
| Agy CLI 超时 | 重试一次，仍失败则使用简化分析 |
| JSON 解析失败 | 尝试修复 JSON 或使用默认维度 |
| 无法匹配任何类别 | 全部归类为 custom，触发 Agy 深度分析 |

## Next Actions

- 如果 `requirement_analysis.status === 'completed'`: 继续到 `action-diagnose-*`
- 如果 `requirement_analysis.status === 'needs_clarification'`: 等待用户澄清后重新执行
- 如果 `coverage.status === 'unsatisfied'`: 自动触发 `action-agy-analysis` 进行深度分析
