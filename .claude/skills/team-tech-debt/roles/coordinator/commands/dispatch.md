# Command: dispatch

> 任务链创建与依赖管理。根据 pipeline 模式创建技术债务治理任务链并分配给 worker 角色。

## When to Use

- Phase 3 of Coordinator
- Pipeline 模式已确定，需要创建任务链
- 团队已创建，worker 已 spawn

**Trigger conditions**:
- Coordinator Phase 2 完成后
- 模式切换需要重建任务链
- Fix-Verify 循环需要创建修复任务

## Strategy

### Delegation Mode

**Mode**: Direct（coordinator 直接操作 TaskCreate/TaskUpdate）

### Decision Logic

```javascript
// 根据 pipelineMode 选择 pipeline
function buildPipeline(pipelineMode, sessionFolder, taskDescription) {
  const pipelines = {
    'scan': [
      { prefix: 'TDSCAN', owner: 'scanner', desc: '多维度技术债务扫描', blockedBy: [] },
      { prefix: 'TDEVAL', owner: 'assessor', desc: '量化评估与优先级排序', blockedBy: ['TDSCAN'] }
    ],
    'remediate': [
      { prefix: 'TDSCAN', owner: 'scanner', desc: '多维度技术债务扫描', blockedBy: [] },
      { prefix: 'TDEVAL', owner: 'assessor', desc: '量化评估与优先级排序', blockedBy: ['TDSCAN'] },
      { prefix: 'TDPLAN', owner: 'planner', desc: '分阶段治理方案规划', blockedBy: ['TDEVAL'] },
      { prefix: 'TDFIX', owner: 'executor', desc: '债务清理执行', blockedBy: ['TDPLAN'] },
      { prefix: 'TDVAL', owner: 'validator', desc: '清理结果验证', blockedBy: ['TDFIX'] }
    ],
    'targeted': [
      { prefix: 'TDPLAN', owner: 'planner', desc: '定向修复方案规划', blockedBy: [] },
      { prefix: 'TDFIX', owner: 'executor', desc: '债务清理执行', blockedBy: ['TDPLAN'] },
      { prefix: 'TDVAL', owner: 'validator', desc: '清理结果验证', blockedBy: ['TDFIX'] }
    ]
  }
  return pipelines[pipelineMode] || pipelines['scan']
}
```

## Execution Steps

### Step 1: Context Preparation

```javascript
const pipeline = buildPipeline(pipelineMode, sessionFolder, taskDescription)
```

### Step 2: Execute Strategy

```javascript
const taskIds = {}

for (const stage of pipeline) {
  // 构建任务描述（包含 session 和上下文信息）
  const fullDesc = [
    stage.desc,
    `\nsession: ${sessionFolder}`,
    `\n\n目标: ${taskDescription}`
  ].join('')

  // 创建任务
  TaskCreate({
    subject: `${stage.prefix}-001: ${stage.desc}`,
    description: fullDesc,
    activeForm: `${stage.desc}进行中`
  })

  // 记录任务 ID
  const allTasks = TaskList()
  const newTask = allTasks.find(t => t.subject.startsWith(`${stage.prefix}-001`))
  taskIds[stage.prefix] = newTask.id

  // 设置 owner 和依赖
  const blockedByIds = stage.blockedBy
    .map(dep => taskIds[dep])
    .filter(Boolean)

  TaskUpdate({
    taskId: newTask.id,
    owner: stage.owner,
    addBlockedBy: blockedByIds
  })
}
```

### Step 3: Result Processing

```javascript
// 验证任务链
const allTasks = TaskList()
const chainTasks = pipeline.map(s => taskIds[s.prefix]).filter(Boolean)
const chainValid = chainTasks.length === pipeline.length

if (!chainValid) {
  mcp__ccw-tools__team_msg({
    operation: "log", session_id: sessionId, from: "coordinator",  // team must be session ID (e.g., TD-xxx-date), NOT team name
    type: "error",
  })
}
```

## Fix-Verify Loop Task Creation

当 validator 报告回归问题时，coordinator 调用此逻辑追加任务：

```javascript
function createFixVerifyTasks(fixVerifyIteration, sessionFolder) {
  // 创建修复任务
  TaskCreate({
    subject: `TDFIX-fix-${fixVerifyIteration}: 修复回归问题 (Fix-Verify #${fixVerifyIteration})`,
    description: `修复验证发现的回归问题\nsession: ${sessionFolder}\ntype: fix-verify`,
    activeForm: `Fix-Verify #${fixVerifyIteration} 修复中`
  })

  // 创建重新验证任务
  TaskCreate({
    subject: `TDVAL-verify-${fixVerifyIteration}: 重新验证 (Fix-Verify #${fixVerifyIteration})`,
    description: `重新验证修复结果\nsession: ${sessionFolder}`,
    activeForm: `Fix-Verify #${fixVerifyIteration} 验证中`
  })

  // 设置依赖: TDVAL-verify 依赖 TDFIX-fix
  // ... TaskUpdate addBlockedBy
}
```

## Output Format

```
## Task Chain Created

### Mode: [scan|remediate|targeted]
### Pipeline Stages: [count]
- [prefix]-001: [description] (owner: [role], blocked by: [deps])

### Verification: PASS/FAIL
```

## Error Handling

| Scenario | Resolution |
|----------|------------|
| Task creation fails | Retry once, then report to user |
| Dependency cycle detected | Flatten dependencies, warn coordinator |
| Invalid pipelineMode | Default to 'scan' mode |
| Agent/CLI failure | Retry once, then fallback to inline execution |
| Timeout (>5 min) | Report partial results, notify coordinator |
