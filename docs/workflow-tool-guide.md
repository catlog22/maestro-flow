# Workflow 工具调用准则

Claude Code 内置的 `Workflow` 工具用于编排多 agent 并行/流水线任务。本文档说明其参数 schema、脚本 API、调用模式和最佳实践。

## 参数 Schema

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `script` | `string` | 三选一 | 内联脚本，最大 524288 字符。必须以 `export const meta = {...}` 开头 |
| `scriptPath` | `string` | 三选一 | 磁盘上的脚本文件路径，优先级最高 |
| `name` | `string` | 三选一 | 预定义 workflow 名称（内置或 `.claude/workflows/` 下） |
| `args` | `any` | 否 | 传给脚本的参数，脚本中通过全局变量 `args` 访问 |
| `resumeFromRunId` | `string` | 否 | 格式 `^wf_[a-z0-9-]{6,}$`，从之前的运行恢复 |
| `title` | `string` | 否 | 已忽略，在脚本 `meta` 块中设置 |
| `description` | `string` | 否 | 已忽略，在脚本 `meta` 块中设置 |

`script`、`scriptPath`、`name` 三者提供其一即可。`scriptPath` 优先级 > `script` > `name`。

### args 传值规则

传数组/对象时使用 JSON 值，**不要传 JSON 编码的字符串**：

```
// 正确
args: ["a.ts", "b.ts"]

// 错误 — 脚本中 args.map 会报错
args: "[\"a.ts\", \"b.ts\"]"
```

## Meta 块

每个脚本必须以 `export const meta = {...}` 开头。`meta` 必须是**纯字面量**——不能使用变量、函数调用、展开运算符或模板字符串。

```js
export const meta = {
  name: 'find-flaky-tests',                              // 必需
  description: 'Find flaky tests and propose fixes',     // 必需
  phases: [                                               // 可选
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix', detail: 'one agent per flaky test' },
  ],
}
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | 是 | kebab-case 标识符 |
| `description` | 是 | 一行描述，显示在权限对话框中 |
| `phases` | 否 | phase 列表，`title` 需与脚本中 `phase()` 调用一致 |
| `whenToUse` | 否 | 显示在 workflow 列表中的使用场景说明 |

## 脚本 API

脚本是纯 JavaScript（非 TypeScript），在 async 上下文中执行，可直接使用 `await`。

### agent(prompt, opts?)

启动一个子 agent 并返回其结果。

```js
const result = await agent('分析 auth 模块的安全性', {
  label: 'auth-review',        // 显示标签
  phase: 'Review',             // 归属的进度阶段
  schema: FINDINGS_SCHEMA,     // JSON Schema，启用结构化输出
  model: 'sonnet',             // 模型覆盖（通常省略，继承父级）
  isolation: 'worktree',       // git worktree 隔离（仅并行写文件时使用）
  agentType: 'Explore',        // 自定义 agent 类型
})
```

- 无 `schema` 时返回字符串，有 `schema` 时返回验证后的对象
- 用户跳过时返回 `null`，用 `.filter(Boolean)` 过滤
- 并发上限 `min(16, CPU 核心数 - 2)`，超出排队等待
- 单个 workflow 生命周期内 agent 总数上限 1000

### parallel(thunks)

并发执行，**barrier 模式**——等待所有 thunk 完成后才返回。

```js
const results = await parallel([
  () => agent('检查 bugs'),
  () => agent('检查 performance'),
  () => agent('检查 security'),
])
// results: [bugsResult, perfResult, secResult]
```

- thunk 抛异常时对应位置为 `null`，整个调用不会 reject
- 使用前用 `.filter(Boolean)` 过滤空结果

### pipeline(items, ...stages)

流水线模式，**无 barrier**——item A 可在 stage 3 时 item B 还在 stage 1。

```js
const results = await pipeline(
  items,
  (item) => agent(`分析 ${item.name}`),                       // stage 1
  (prevResult, originalItem, index) => agent(`验证 ${prevResult.title}`),  // stage 2
)
```

- 每个 stage 回调接收 `(prevResult, originalItem, index)`
- stage 抛异常时该 item 变为 `null` 并跳过后续 stage
- 墙钟时间 = 最慢单个 item 链，而非各 stage 最慢之和

### phase(title)

标记进度阶段，后续 `agent()` 调用归属此阶段。

```js
phase('Scan')
const findings = await agent('扫描代码问题')
phase('Fix')
const fixes = await agent('修复发现的问题')
```

### log(message)

发送进度消息给用户。

```js
log(`已发现 ${bugs.length} 个 bug，继续扫描...`)
```

### workflow(nameOrRef, args?)

嵌套调用另一个 workflow（仅支持一层嵌套）。

```js
const result = await workflow('lint-check', { paths: ['src/'] })
const result2 = await workflow({ scriptPath: './my-script.js' }, { debug: true })
```

### budget

Token 预算控制对象。

```js
budget.total       // number | null，无预算时为 null
budget.spent()     // 已消耗的 output token 数
budget.remaining() // max(0, total - spent())，无预算时为 Infinity
```

## 何时用 pipeline vs parallel

**默认用 `pipeline()`**，仅在需要 barrier 时用 `parallel()`。

### 需要 barrier 的场景

- 跨 item 去重/合并后再进行下游处理
- 总数为零时提前退出（"0 bugs → 跳过验证"）
- 下一阶段的 prompt 引用"其他发现"进行对比

### 不需要 barrier 的场景

- "先 flatten/map/filter" → 放在 pipeline stage 内部处理
- "阶段概念上独立" → 正是 pipeline 的设计目的
- "代码更整洁" → barrier 有真实的延迟代价

### 气味测试

```js
// 有 barrier 浪费 — 中间变换不需要跨 item 上下文
const a = await parallel(...)
const b = transform(a)          // flatten, map, filter
const c = await parallel(b.map(...))

// 改为 pipeline
const results = await pipeline(items, stageA, r => transform([r]).flat(), stageB)
```

## 调用模式

### 基础模式：内联脚本

```js
Workflow({
  script: `
export const meta = {
  name: 'quick-review',
  description: 'Quick code review',
  phases: [{ title: 'Review' }],
}
phase('Review')
const result = await agent('Review the auth module for security issues')
return result
`
})
```

### 文件模式：scriptPath

首次调用自动持久化脚本文件。后续迭代时编辑文件并通过 `scriptPath` 重新调用：

```js
Workflow({ scriptPath: 'path/to/persisted-script.js' })
```

### 恢复模式：resumeFromRunId

未变更的 `agent()` 调用返回缓存结果，从第一个变更/新增处开始重跑：

```js
Workflow({ scriptPath: 'path/to/script.js', resumeFromRunId: 'wf_abc123' })
```

### 命名模式：预定义 workflow

```js
Workflow({ name: 'review-changes', args: { dimension: 'security' } })
```

## 质量模式

### 对抗性验证

```js
const votes = await parallel(Array.from({ length: 3 }, () => () =>
  agent(`尝试反驳: ${claim}。不确定时默认 refuted=true`, { schema: VERDICT })
))
const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
```

### 多视角验证

给每个验证者不同的审查维度（正确性、安全性、性能、可复现性），而非 N 个相同的反驳者。

### 评委面板

N 个独立方案（从不同角度生成），并行评分，综合最优方案。

### Loop-until-dry

未知规模的发现任务，连续 K 轮无新发现时停止：

```js
let dry = 0
while (dry < 2) {
  const found = await agent('查找 bug', { schema: BUGS })
  const fresh = found.bugs.filter(b => !seen.has(key(b)))
  if (!fresh.length) { dry++; continue }
  dry = 0
  fresh.forEach(b => seen.add(key(b)))
}
```

### Loop-until-budget

根据用户 token 预算动态扩展深度：

```js
while (budget.total && budget.remaining() > 50_000) {
  const result = await agent('查找 bug', { schema: BUGS })
  bugs.push(...result.bugs)
  log(`${bugs.length} found, ${Math.round(budget.remaining() / 1000)}k remaining`)
}
```

## 完整示例

### 多维度 Review + 流水线验证

```js
export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}

const DIMENSIONS = [
  { key: 'bugs', prompt: 'Find correctness bugs in changed files' },
  { key: 'perf', prompt: 'Find performance issues in changed files' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['title', 'file'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['isReal', 'reasoning'],
}

const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  review => parallel(review.findings.map(f => () =>
    agent(`Adversarially verify: ${f.title}`, { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v }))
  ))
)

const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
return { confirmed }
```

## 脚本动态修改与增量恢复

### 可变性边界

| 时机 | 是否可修改 | 机制 |
|------|-----------|------|
| 运行期间 | 不可修改 | 脚本在调用时解析，作为不可变单元执行 |
| 两次运行之间 | 可以修改 | 编辑持久化文件 + `resumeFromRunId` 增量重跑 |
| 运行中动态调整行为 | 有限支持 | 通过脚本内 `budget`、循环条件、分支逻辑实现 |

### 增量恢复机制

每次 `Workflow({ script })` 调用会自动将脚本持久化到磁盘文件并返回 `scriptPath` 和 `runId`。编辑该文件后通过 `resumeFromRunId` 重新调用时，运行时按 `(prompt, opts)` 的**最长不变前缀**匹配缓存：

- 未变更的 `agent()` 调用 → 返回缓存结果（瞬间完成）
- 第一个变更或新增的 `agent()` → 从此处开始实际执行
- 相同 script + 相同 args → 100% 缓存命中

```
Workflow({ script: "..." })
  → 返回 { scriptPath: ".../script.js", runId: "wf_abc123" }

Edit(scriptPath, ...)  // 修改 prompt 或逻辑

Workflow({ scriptPath: ".../script.js", resumeFromRunId: "wf_abc123" })
  → 未变更部分秒回，变更部分重跑
```

### 迭代开发循环

典型的 workflow 迭代流程：

```
┌─────────────────────────────────────────────┐
│  Workflow({ script })                       │
│  → 拿到 scriptPath + runId                  │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│  审查结果 → 不满意                            │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│  Edit(scriptPath) → 调整 prompt / 逻辑       │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│  Workflow({ scriptPath, resumeFromRunId })   │
│  → 增量重跑                                  │
└──────────────┬──────────────────────────────┘
               ↓
          重复直到满意
```

### 实际场景示例

多维度 review 中仅修改某一维度的 prompt：

```js
const DIMENSIONS = [
  { key: 'bugs', prompt: 'Find correctness bugs' },
  { key: 'perf', prompt: 'Find performance issues' },
  { key: 'security', prompt: 'Deep security audit with OWASP Top 10 coverage' },
  //                          ↑ 仅修改此 prompt
]

// resumeFromRunId 重跑时：
// bugs     → 缓存命中，秒回
// perf     → 缓存命中，秒回
// security → prompt 变更，重新执行
```

### 禁用 API 的原因

`Date.now()`、`Math.random()`、无参 `new Date()` 在脚本中被禁用，是因为它们的**不确定性会破坏恢复时的缓存匹配**。如果 agent 的 prompt 包含时间戳或随机数，每次运行产生不同的值，导致无法与缓存的 `(prompt, opts)` 匹配。

替代方案：

| 需求 | 做法 |
|------|------|
| 时间信息 | 通过 `args` 传入，或在 workflow 返回后打戳 |
| 多样性 | 通过 agent prompt/label 中的 `index` 变化实现 |

### 运行中的动态行为

虽然脚本本身不可修改，但可以通过内置控制流实现运行时的动态调整：

```js
// 基于 budget 的动态深度
while (budget.total && budget.remaining() > 50_000) {
  const result = await agent('继续查找问题', { schema: BUGS })
  if (result.bugs.length === 0) break  // 条件退出
  bugs.push(...result.bugs)
}

// 基于中间结果的分支
const severity = findings.filter(f => f.severity === 'critical')
if (severity.length > 0) {
  phase('Deep-Dive')
  await parallel(severity.map(f => () =>
    agent(`深入分析 critical 问题: ${f.title}`)
  ))
}
```

## Maestro Ralph Swarm 集成

### 架构定位

`/maestro-ralph --engine swarm` 是基于 Workflow 工具的并行加速层，与 `/maestro-ralph`（顺序决策链）互补：

```
┌─ Ralph（外层决策闭环）──────────────────────────────┐
│  intent → lifecycle position → step chain           │
│  decision nodes → quality gates → fix loops         │
│                                                     │
│  某些 step 调用 ralph --engine swarm 加速：          │
│  ┌─ Swarm Workflow（内层并行加速）────────────────┐  │
│  │  parallel agents → structured output → JSON    │  │
│  │  无状态、无决策、纯计算                          │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  Ralph 消费 JSON → 写 artifact → 推进 step          │
└─────────────────────────────────────────────────────┘
```

### 固定脚本清单

脚本源码位于 `workflows/swarm/`，安装后位于 `~/.maestro/workflows/swarm/`：

| 脚本 | 加速命令 | 对抗决策模式 | args 接口 |
|------|---------|-------------|-----------|
| `wf-analyze.js` | /maestro-ralph --engine swarm --script wf-analyze | 探索 → 6 维度评分 → **skeptic 逐维挑战** → **3 方 advocacy (go/no-go/conditional) + referee** | `{ target, scope, context, phase?, dimensions? }` |
| `wf-brainstorm.js` | /maestro-ralph --engine swarm --script wf-brainstorm | N 角色分析 → **3 专项 reviewer** → **3 哲学方案竞标** → **arbitrator 仲裁** | `{ topic, context, count?, roles? }` |
| `wf-review.js` | /maestro-ralph --engine swarm --script wf-review | 6 维度扫描 → **3 票对抗验证 (prosecutor/defense/judge)** → **3 视角报告 + 仲裁裁决** | `{ target, scope, specs?, tier?, dimensions? }` |
| `wf-verify.js` | (retired in v0.5.51, integrated into maestro-ralph decision gate) | 3 层 + 反模式 + 收敛 → **prosecutor vs defender 辩论** → **judge 裁决** | `{ goals, plan_dir?, scope?, task_files?, must_haves?, skip_antipattern? }` |
| `wf-grill.js` | /maestro-ralph --engine swarm --script wf-grill | 探索 → N 分支压力 → **meta-skeptic 反向挑战** → **3 票裁决 (optimist/pessimist/realist)** | `{ topic, context?, depth? }` |
| `wf-plan.js` | /maestro-next or /maestro-ralph | 并行上下文 → **3 策略竞标 (breadth/depth/risk)** → **judge 评分选优** → **3 专项 critic 挑战** | `{ context_dir?, from?, phase?, scope?, specs?, gaps?, quick? }` |
| `wf-execute.js` | /maestro-ralph continue | wave 并行执行 → **对抗性收敛抽查** → **3 票状态裁决 (optimist/pessimist/realist)** | `{ plan_dir, specs?, codebase_context?, auto_commit? }` |
| `wf-milestone-audit.js` | /maestro-session-seal | 3 维度审计 → **对抗性维度挑战** → **3 票裁决 (strict/lenient/objective)** | `{ milestone?, is_adhoc? }` |

### 路由命令使用

```bash
# 直接调用
/maestro-ralph --engine swarm "analyze auth module"
/maestro-ralph --engine swarm --script wf-brainstorm "brainstorm 实时协作方案" --count 5
/maestro-ralph --engine swarm --script wf-review --tier quick

# 限定维度/角色
/maestro-ralph --engine swarm "analyze" --dims architecture,security,performance
/maestro-ralph --engine swarm "brainstorm" --roles system-architect,ux-expert,security-analyst

# 增量恢复
/maestro-ralph --engine swarm --resume wf_abc123
```

### 路由规则

| 关键词 | 目标脚本 |
|--------|---------|
| 分析 / analyze / 探索 / 架构 / 复杂度 / 风险 | `wf-analyze` |
| 头脑风暴 / brainstorm / 方案 / 设计 / 评估 | `wf-brainstorm` |
| 审查 / review / 代码审查 / 质量 | `wf-review` |
| 验证 / verify / 检查 / 反模式 | `wf-verify` |

`--script` 参数可跳过路由直接指定脚本。

### 与 Ralph 的集成方式

Ralph 的 `A_BUILD_STEPS` 可以将 step 的执行器设为 `maestro-ralph`（配合 `--engine swarm`）：

```json
{
  "index": 2,
  "skill": "maestro-ralph",
  "args": "--engine swarm --script wf-analyze {phase}",
  "stage": "analyze",
  "command_scope": "project",
  "command_path": ".claude/commands/maestro-ralph.md"
}
```

执行流程不变：`ralph-execute` → `maestro ralph next` 加载 → 内联执行 → ralph swarm 内部调 Workflow 工具。

### 产出兼容性

每个脚本的返回 JSON 由路由命令转写为对应命令的标准 artifact 格式：

| 脚本 | 产出文件 | 兼容命令 |
|------|---------|---------|
| `wf-analyze` | `analysis.md` + `context.md` + `conclusions.json` | /maestro-ralph --engine swarm --script wf-analyze |
| `wf-brainstorm` | `guidance-specification.md` | /maestro-ralph --engine swarm --script wf-brainstorm |
| `wf-review` | `review.json` | /maestro-ralph --engine swarm --script wf-review |
| `wf-verify` | `verification.json` | (retired in v0.5.51, integrated into maestro-ralph decision gate) |

## 限制与注意事项

| 项目 | 说明 |
|------|------|
| 语言 | 纯 JavaScript，不支持 TypeScript 类型注解 |
| 禁用 API | `Date.now()`、`Math.random()`、无参 `new Date()` 会抛异常（影响恢复） |
| 无文件系统 | 脚本内无法访问 Node.js API 或文件系统 |
| 并发上限 | `min(16, CPU 核心数 - 2)`，超出排队 |
| Agent 总数 | 单 workflow 最多 1000 个 agent |
| 嵌套深度 | `workflow()` 仅支持一层嵌套 |
| 时间戳 | 需要时间信息通过 `args` 传入，或在 workflow 返回后打戳 |
| 随机性 | 通过 agent prompt/label 的 index 变化实现多样性 |
