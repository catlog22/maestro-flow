
> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。


# Skill Authoring Principles

Skill 撰写首要准则。所有诊断和优化以此为纲。

---

## 核心原则

```
简洁高效 → 去除无关存储 → 去除中间存储 → 上下文流转
```

---

## 1. 简洁高效

**原则**：最小化实现，只做必要的事

| DO | DON'T |
|----|-------|
| 单一职责阶段 | 臃肿的多功能阶段 |
| 直接的数据路径 | 迂回的处理流程 |
| 必要的字段 | 冗余的 schema 定义 |
| 精准的 prompt | 过度详细的指令 |

**检测模式**：
- Phase 文件 > 200 行 → 需拆分
- State schema 字段 > 20 个 → 需精简
- 同一数据多处定义 → 需去重

---

## 2. 去除无关存储

**原则**：不存储不需要的数据

| DO | DON'T |
|----|-------|
| 只存最终结果 | 存储调试信息 |
| 存路径引用 | 存完整内容副本 |
| 存必要索引 | 存全量历史 |

**检测模式**：
```javascript
// BAD: 存储完整内容
state.full_analysis_result = longAnalysisOutput;

// GOOD: 存路径 + 摘要
state.analysis = {
  path: `${workDir}/analysis.json`,
  summary: extractSummary(output),
  key_findings: extractFindings(output)
};
```

**反模式清单**：
- `state.debug_*` → 删除
- `state.*_history` (无限增长) → 限制或删除
- `state.*_cache` (会话内) → 改用内存变量
- 重复字段 → 合并

---

## 3. 去除中间存储

**原则**：避免临时文件和中间状态文件

| DO | DON'T |
|----|-------|
| 直接传递结果 | 写文件再读文件 |
| 函数返回值 | 中间 JSON 文件 |
| 管道处理 | 阶段性存储 |

**检测模式**：
```javascript
// BAD: 中间文件
Write(`${workDir}/temp-step1.json`, step1Result);
const step1 = Read(`${workDir}/temp-step1.json`);
const step2Result = process(step1);
Write(`${workDir}/temp-step2.json`, step2Result);

// GOOD: 直接流转
const step1Result = await executeStep1();
const step2Result = process(step1Result);
const finalResult = finalize(step2Result);
Write(`${workDir}/final-output.json`, finalResult);  // 只存最终结果
```

**允许的存储**：
- 最终输出（用户需要的结果）
- 检查点（长流程恢复用，可选）
- 备份（修改前的原始文件）

**禁止的存储**：
- `temp-*.json`
- `intermediate-*.json`
- `step[N]-output.json`
- `*-draft.md`

---

## 4. 上下文流转

**原则**：通过上下文传递而非文件

| DO | DON'T |
|----|-------|
| 函数参数传递 | 全局状态读写 |
| 返回值链式处理 | 文件中转 |
| prompt 内嵌数据 | 指向外部文件 |

**模式**：
```javascript
// 上下文流转模式
async function executePhase(context) {
  const { previousResult, constraints, config } = context;

  const result = await spawn_agent({
    task_name: 'execute_phase',
    message: `
      [CONTEXT]
      Previous: ${JSON.stringify(previousResult)}
      Constraints: ${constraints.join(', ')}

      [TASK]
      Process and return result directly.
    `,
    fork_turns: "none"
  });

  return {
    ...context,
    currentResult: result,
    completed: ['phase-name']
  };
}

// 链式执行
let ctx = initialContext;
ctx = await executePhase1(ctx);
ctx = await executePhase2(ctx);
ctx = await executePhase3(ctx);
// ctx 包含完整上下文，无中间文件
```

**State 最小化**：
```typescript
// 只存必要状态
interface MinimalState {
  status: 'pending' | 'running' | 'completed';
  target: { name: string; path: string };
  result_path: string;  // 最终结果路径
  error?: string;
}
```

---

## 应用场景

### 诊断时检查

| 检查项 | 违反时标记 |
|--------|-----------|
| Phase 内写入 temp 文件 | `unnecessary_storage` |
| State 包含 *_history 无限数组 | `unbounded_state` |
| 文件写入后立即读取 | `redundant_io` |
| 多阶段传递完整内容 | `context_bloat` |

### 优化策略

| 问题 | 策略 |
|------|------|
| 中间文件过多 | `eliminate_intermediate_files` |
| State 膨胀 | `minimize_state_schema` |
| 重复存储 | `deduplicate_storage` |
| 文件中转 | `context_passing` |

---

## 合规检查清单

```
□ 无 temp/intermediate 文件写入
□ State schema < 15 个字段
□ 无重复数据存储
□ Phase 间通过上下文/返回值传递
□ 只存最终结果文件
□ 无无限增长的数组
□ 无调试字段残留
```
