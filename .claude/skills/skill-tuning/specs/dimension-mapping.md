

# Dimension to Spec Mapping

维度关键词到 Spec 的映射规则，用于 action-analyze-requirements 阶段的自动匹配。

## When to Use

| Phase | Usage |
|-------|-------|
| action-analyze-requirements | 维度→类别→Spec 自动匹配 |
| action-propose-fixes | 策略选择参考 |

---

## Keyword → Category Mapping

基于关键词将用户描述的维度映射到问题类别。

### 中英文关键词表

| Keywords (中文) | Keywords (英文) | Primary Category | Secondary |
|----------------|-----------------|------------------|-----------|
| token, 上下文, 爆炸, 太长, 超限, 膨胀 | token, context, explosion, overflow, bloat | context_explosion | - |
| 遗忘, 忘记, 指令丢失, 约束消失, 目标漂移 | forget, lost, drift, constraint, goal | memory_loss | - |
| 状态, 数据, 格式, 不一致, 丢失, 损坏 | state, data, format, inconsistent, corrupt | dataflow_break | - |
| agent, 子任务, 失败, 嵌套, 调用, 协调 | agent, subtask, fail, nested, call, coordinate | agent_failure | - |
| 慢, 性能, 效率, token 消耗, 延迟 | slow, performance, efficiency, latency | performance | context_explosion |
| 提示词, prompt, 输出不稳定, 幻觉 | prompt, unstable, hallucination | prompt_quality | - |
| 架构, 结构, 模块, 耦合, 扩展 | architecture, structure, module, coupling | architecture | - |
| 错误, 异常, 恢复, 降级, 崩溃 | error, exception, recovery, crash | error_handling | agent_failure |
| 输出, 质量, 格式, 验证, 不完整 | output, quality, validation, incomplete | output_quality | - |
| 交互, 体验, 进度, 反馈, 不清晰 | interaction, ux, progress, feedback | user_experience | - |
| 重复, 冗余, 多处定义, 相同内容 | duplicate, redundant, multiple definitions | doc_redundancy | - |
| 冲突, 不一致, 定义不同, 矛盾 | conflict, inconsistent, mismatch, contradiction | doc_conflict | - |

### Matching Algorithm

```javascript
function matchCategory(keywords) {
  const categoryScores = {};
  
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    
    for (const [category, categoryKeywords] of Object.entries(KEYWORD_MAP)) {
      if (categoryKeywords.some(k => normalizedKeyword.includes(k) || k.includes(normalizedKeyword))) {
        categoryScores[category] = (categoryScores[category] || 0) + 1;
      }
    }
  }
  
  // 返回得分最高的类别
  const sorted = Object.entries(categoryScores).sort((a, b) => b[1] - a[1]);
  
  if (sorted.length === 0) return null;
  
  // 如果前两名得分相同，返回多类别（需澄清）
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return {
      primary: sorted[0][0],
      secondary: sorted[1][0],
      ambiguous: true
    };
  }
  
  return {
    primary: sorted[0][0],
    secondary: sorted[1]?.[0] || null,
    ambiguous: false
  };
}
```

---

## Category → Taxonomy Pattern Mapping

将问题类别映射到 problem-taxonomy.md 中的检测模式。

| Category | Pattern IDs | Detection Focus |
|----------|-------------|-----------------|
| context_explosion | CTX-001, CTX-002, CTX-003, CTX-004, CTX-005 | Token 累积、内容传递模式 |
| memory_loss | MEM-001, MEM-002, MEM-003, MEM-004, MEM-005 | 约束传播、检查点机制 |
| dataflow_break | DF-001, DF-002, DF-003, DF-004, DF-005 | 状态存储、Schema 验证 |
| agent_failure | AGT-001, AGT-002, AGT-003, AGT-004, AGT-005, AGT-006 | 错误处理、结果验证 |
| prompt_quality | - | (无内置检测，需 Agy 分析) |
| architecture | - | (无内置检测，需 Agy 分析) |
| performance | CTX-001, CTX-003 | (复用 context 检测) |
| error_handling | AGT-001, AGT-002 | (复用 agent 检测) |
| output_quality | - | (无内置检测，需 Agy 分析) |
| user_experience | - | (无内置检测，需 Agy 分析) |
| doc_redundancy | DOC-RED-001, DOC-RED-002, DOC-RED-003 | 重复定义检测 |
| doc_conflict | DOC-CON-001, DOC-CON-002 | 冲突定义检测 |

---

## Category → Strategy Mapping

将问题类别映射到 tuning-strategies.md 中的修复策略。

### Core Categories (有完整策略)

| Category | Available Strategies | Risk Level |
|----------|---------------------|------------|
| context_explosion | sliding_window, path_reference, context_summarization, structured_state | Low-Medium |
| memory_loss | constraint_injection, state_constraints_field, checkpoint_restore, goal_embedding | Low-Medium |
| dataflow_break | state_centralization, schema_enforcement, field_normalization | Low-Medium |
| agent_failure | error_wrapping, result_validation, flatten_nesting | Low-Medium |
| doc_redundancy | consolidate_to_ssot, centralize_mapping_config | Low-Medium |
| doc_conflict | reconcile_conflicting_definitions | Low |

### Extended Categories (需 Agy 生成策略)

| Category | Available Strategies | Risk Level |
|----------|---------------------|------------|
| prompt_quality | structured_prompt, output_schema, grounding_context, format_enforcement | Low |
| architecture | phase_decomposition, interface_contracts, plugin_architecture, state_machine | Medium-High |
| performance | token_budgeting, parallel_execution, result_caching, lazy_loading | Low-Medium |
| error_handling | graceful_degradation, error_propagation, structured_logging, error_context | Low |
| output_quality | quality_gates, output_validation, template_enforcement, completeness_check | Low |
| user_experience | progress_tracking, status_communication, interactive_checkpoints, guided_workflow | Low |

---

## Coverage Rules

### Satisfaction Criteria

判断"是否满足需求"的标准：

```javascript
function evaluateSatisfaction(specMatch) {
  // 核心标准：有可用的修复策略
  const hasFix = specMatch.strategy_match !== null && 
                 specMatch.strategy_match.strategies.length > 0;
  
  // 辅助标准：有检测手段
  const hasDetection = specMatch.taxonomy_match !== null;
  
  return {
    satisfied: hasFix,
    detection_available: hasDetection,
    needs_agy: !hasDetection  // 无内置检测时需要 Agy 分析
  };
}
```

### Coverage Status Thresholds

| Status | Condition |
|--------|-----------|
| satisfied | coverage_rate >= 80% |
| partial | 50% <= coverage_rate < 80% |
| unsatisfied | coverage_rate < 50% |

---

## Fallback Rules

当无法匹配到具体类别时的处理：

```javascript
function handleUnmatchedDimension(dimension) {
  return {
    dimension_id: dimension.id,
    taxonomy_match: null,
    strategy_match: {
      strategies: ['custom'],  // Fallback to custom strategy
      risk_levels: ['medium']
    },
    has_fix: true,  // custom 策略视为"可满足"
    needs_agy_analysis: true,
    fallback_reason: 'no_keyword_match'
  };
}
```

---

## Usage Example

```javascript
// 输入：用户描述 "skill 执行太慢，而且有时候会忘记最初的指令"

// Step 1: Agy 拆解为维度
const dimensions = [
  { id: 'DIM-001', description: '执行太慢', keywords: ['慢', '执行'], confidence: 0.9 },
  { id: 'DIM-002', description: '忘记最初指令', keywords: ['忘记', '指令'], confidence: 0.85 }
];

// Step 2: 匹配类别
// DIM-001 → performance (慢)
// DIM-002 → memory_loss (忘记, 指令)

// Step 3: 匹配 Spec
const specMatches = [
  {
    dimension_id: 'DIM-001',
    taxonomy_match: { category: 'performance', pattern_ids: ['CTX-001', 'CTX-003'], severity_hint: 'medium' },
    strategy_match: { strategies: ['token_budgeting', 'parallel_execution'], risk_levels: ['low', 'low'] },
    has_fix: true
  },
  {
    dimension_id: 'DIM-002',
    taxonomy_match: { category: 'memory_loss', pattern_ids: ['MEM-001', 'MEM-002'], severity_hint: 'high' },
    strategy_match: { strategies: ['constraint_injection', 'checkpoint_restore'], risk_levels: ['low', 'low'] },
    has_fix: true
  }
];

// Step 4: 评估覆盖度
// 2/2 = 100% → satisfied
```
