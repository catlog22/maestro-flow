---
name: maestro-universal-workflow
description: Dynamic adversarial workflow generator — scan library, match or generate, execute, persist
argument-hint: "<intent> [--name <slug>] [--depth shallow|standard|deep] [--dry-run] [--from <script>] [--resume <runId>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Workflow
  - AskUserQuestion
---
<purpose>
Dynamic workflow generator: scan library for matches or generate task-specific Workflow scripts
on-the-fly with adversarial patterns. Scripts persist at `~/.maestro/workflows/dynamic/uwf-*.js`.
</purpose>

<context>
$ARGUMENTS — intent text with optional flags.

**Parse:**
```
--name <slug>     → 指定生成脚本名（默认从 intent 自动生成）
--depth <level>   → shallow | standard | deep（默认 standard）
--dry-run         → 只生成脚本，不执行
--from <script>   → 基于已有脚本进行修改（uwf-xxx 或 wf-xxx）
--resume <runId>  → 恢复之前的运行（透传给 Workflow）
Remaining         → intent
```

**Library locations:**
- Fixed scripts: `~/.maestro/workflows/swarm/wf-*.js`
- Dynamic scripts: `~/.maestro/workflows/dynamic/uwf-*.js`

**Output boundary**: ALL file writes MUST target `~/.maestro/workflows/dynamic/` (generated scripts) and `.workflow/scratch/{YYYYMMDD}-uwf-*/` (execution results). Fixed scripts at `~/.maestro/workflows/swarm/` are read-only. NEVER modify source code or `.claude/commands/` files.
</context>

<state_machine>

<states>
S_PARSE       — 解析参数和意图                     PERSIST: —
S_SCAN        — 扫描现有 workflow 库匹配            PERSIST: —
S_DECIDE      — 用户选择：复用现有 / 生成新脚本       PERSIST: —
S_DESIGN      — 分析任务、设计工作流结构              PERSIST: —
S_GENERATE    — 生成脚本 → 写入文件 → node --check 验证  PERSIST: uwf-{slug}.js
S_CONFIRM_EXEC — 确认执行前门控                       PERSIST: —
S_EXECUTE     — 调用 Workflow 工具执行               PERSIST: —
S_PERSIST     — 保存脚本到 dynamic/ 目录              PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_SCAN      WHEN: intent parsed                 DO: A_PARSE_ARGS
  → END         WHEN: no intent

S_SCAN:
  → S_DECIDE    WHEN: matches found                 DO: A_SCAN_LIBRARY
  → S_DESIGN    WHEN: no matches                    DO: A_SCAN_LIBRARY

S_DECIDE:
  → S_EXECUTE   WHEN: user picks existing script    DO: A_CONFIRM_EXECUTE
  → S_DESIGN    WHEN: user wants new script         DO: —
  → S_DESIGN    WHEN: --from specified              DO: —

S_DESIGN:
  → S_GENERATE  DO: A_DESIGN_WORKFLOW

S_GENERATE:
  → S_CONFIRM_EXEC  WHEN: Write + node --check pass AND NOT --dry-run  DO: A_GENERATE_SCRIPT
  → S_PERSIST       WHEN: --dry-run (file already written)             DO: A_GENERATE_SCRIPT
  → S_GENERATE      WHEN: node --check fails (retry ≤2)               DO: A_GENERATE_SCRIPT (fix & retry)
  → END             WHEN: node --check fails after 2 retries          DO: report E003

S_CONFIRM_EXEC:
  → S_EXECUTE   WHEN: user confirms execution      DO: A_CONFIRM_EXECUTE
  → S_PERSIST   WHEN: user declines execution       DO: —
  → END         WHEN: user cancels                  DO: —

S_EXECUTE:
  → S_PERSIST   WHEN: workflow completed             DO: A_EXECUTE_WORKFLOW
  → END         WHEN: workflow failed

S_PERSIST:
  → END         DO: A_PERSIST_SCRIPT

</transitions>

<actions>

### A_PARSE_ARGS

1. 提取 flags: `--name`, `--depth`, `--dry-run`, `--from`, `--resume`
2. 剩余文本作为 intent
3. depth 默认 `standard`
4. 若有 `--resume`，跳到 S_EXECUTE（直接恢复）
5. 若有 `--from`，定位源脚本路径

### A_SCAN_LIBRARY

扫描两个目录，读取每个 `.js` 文件的 `meta` 块提取 `name`、`description`、`whenToUse`：

1. **Fixed scripts**: 展开 `~/.maestro/workflows/swarm/wf-*.js` 为绝对路径
   - Glob 查找所有匹配文件
   - 读取每个文件前 10 行，提取 `meta.name`、`meta.description`、`meta.whenToUse`
2. **Dynamic scripts**: 展开 `~/.maestro/workflows/dynamic/uwf-*.js`
   - 同上
3. **匹配评分**：对每个脚本，评估其 description/whenToUse 与 intent 的语义相关度
4. **输出**：
   - 匹配度 > 70% 的脚本列表（最多 3 个）
   - 每个列出：name、description、scriptPath、匹配理由
   - 无匹配则直接跳 S_DESIGN

若有匹配，用 AskUserQuestion 让用户选择：
- 选项 1-3: 使用现有脚本（附 preview 显示脚本 meta）
- 最后选项: "生成全新脚本"

### A_DESIGN_WORKFLOW

分析任务，确定工作流结构。这是核心设计步骤。

**Step 1 — 任务分解**

将 intent 分解为：
```
work_items: 需要完成的具体工作单元
  - { id, description, type: 'explore'|'analyze'|'create'|'verify'|'decide' }
decision_points: 需要做出判断的节点
  - { id, question, type: 'go-nogo'|'pass-fail'|'select-best'|'resolve-conflict'|'assess-quality' }
data_flow: 数据在工作单元间如何流动
  - { from, to, data_shape }
```

**Step 2 — 阶段编排**

将 work_items 组织为执行阶段：
```
phases: [
  { title, work_items[], parallel: true|false },
  ...
]
```

规则：
- 无依赖的 work_items 放同一阶段（parallel）
- 有依赖的放后续阶段
- 每个 decision_point 后紧跟一个对抗决策阶段

**Step 3 — 对抗模式选择**

根据 decision_point.type 和 --depth 选择对抗模式（参考 ADVERSARIAL_PATTERNS）：

| decision_type | shallow | standard | deep |
|--------------|---------|----------|------|
| go-nogo | 1 skeptic | 3-way advocacy + referee | cross-verify + 3-way advocacy + meta-skeptic |
| pass-fail | 1 challenger | prosecutor/defender/judge | cross-verify + prosecutor/defender + 3-vote |
| select-best | 1 critic | N proposals + judge panel | N proposals + judge + 3-critic challenge |
| resolve-conflict | 1 mediator | 3 philosophy proposals + arbitrator | 3 proposals + arbitrator + meta-skeptic |
| assess-quality | 1 skeptic | 3-vote (strict/lenient/objective) | cross-verify + 3-vote + meta-skeptic |

**Step 4 — Schema 设计**

为每个 agent 调用设计 JSON Schema：
- 工作 agent: 任务特定 schema
- 对抗 agent: 使用标准对抗 schema（见 ADVERSARIAL_PATTERNS）

**Step 5 — 产出蓝图**

```
blueprint: {
  name: 'uwf-{slug}',
  description: string,
  phases: [{ title, detail }],
  agents: [{ id, prompt_outline, schema_name, agentType?, phase }],
  adversarial_gates: [{ decision_id, pattern, agents[] }],
  estimated_agent_count: number,
}
```

向用户展示蓝图摘要，包含预估 agent 数量。
若 `--dry-run` 则在 S_GENERATE 后停止。

### A_GENERATE_SCRIPT

根据蓝图生成完整的 JavaScript 脚本。**先写文件，再通过 scriptPath 执行**（避免内联 script 字符串的编码/转义问题）。

若 `--from` 指定了基础脚本，先 Read 源脚本，然后在其基础上修改。

**脚本结构模板：**

```javascript
export const meta = {
  name: '{blueprint.name}',
  description: '{English description}',
  whenToUse: '{English usage scenario}',
  phases: [
    { title: '{EnglishTitle}', detail: '{English detail}' },
  ],
}

// --- Schemas (top-level constants, never inline) ---
const WORK_SCHEMA = { type: 'object', properties: { ... }, required: [...] }
const CHALLENGE_SCHEMA = { ... }

// --- Args ---
const target = args?.target || 'default'

// --- Phase 1: {title} ---
phase('{title}')
const results = await parallel([
  () => agent('prompt text', { label: 'work:1', phase: '{title}', schema: WORK_SCHEMA }),
])

// --- Phase 2: Adversarial Gate ---
phase('{adversarial_phase_title}')
// 对抗模式代码 — 从 ADVERSARIAL_PATTERNS 模板生成

return { ... }
```

**生成规则（必须全部遵守）：**

| # | 规则 | 原因 |
|---|------|------|
| 1 | **纯 JavaScript** — 无 TypeScript 类型注解（`: string`、`interface`、泛型） | 解析器不支持 TS |
| 2 | **meta 块全英文** — `name`、`description`、`whenToUse`、`phases[].title/detail` 只用 ASCII 字符 | 中文在 script 字符串序列化时触发 `\uXXXX` 解析错误 |
| 3 | **禁用 API** — 不用 `Date.now()`、`Math.random()`、无参 `new Date()` | 破坏 resume 缓存匹配 |
| 4 | **Schema 独立声明** — 所有 JSON Schema 在文件顶部声明为 `const XXX_SCHEMA = {...}`，agent 调用中用 `schema: XXX_SCHEMA` 引用 | 内联大 Schema 易出括号匹配错误 |
| 5 | **字符串用 `+` 拼接** — agent prompt 中嵌入变量用 `'text ' + variable + ' more text'`，**不用模板字符串** | 反引号嵌套和 `${}` 转义是最常见的解析错误源 |
| 6 | **回调用 `function`** — `array.filter(function(x) { return x })` 而非箭头函数 | 箭头函数隐式返回对象 `() => ({})` 易遗漏外层括号 |
| 7 | **`phase` 不做变量名** — 不遮蔽全局 `phase()` 函数 | 遮蔽后 `phase('X')` 调用会崩溃 |
| 8 | **路径用正斜杠** — 字符串中路径用 `src/auth/` 不用 `src\\auth\\` | `\a`、`\u` 等被解析为转义序列 |
| 9 | **`agentType`** — 仅在有明确匹配时设置（如 `Explore`、`workflow-analyzer`） | 无效 agentType 导致运行时错误 |
| 10 | **null 安全** — 链式访问用 `?.`，数组操作前加 `.filter(Boolean)` | agent 返回 null（用户跳过）时链式调用崩溃 |

**常见错误对照：**

```javascript
// BAD — meta 中文导致 \uXXXX 解析错误
export const meta = { name: 'uwf-x', description: '参数审计' }
// GOOD
export const meta = { name: 'uwf-x', description: 'Parameter audit for unused/ambiguous/dead params' }

// BAD — 模板字符串嵌套
agent(`Analyze ${item.name} for ${reason}`)
// GOOD — 字符串拼接
agent('Analyze ' + item.name + ' for ' + reason)

// BAD — Schema 内联在 agent 调用中
agent('prompt', { schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', properties: { ... } } } } } })
// GOOD — Schema 顶部声明
const MY_SCHEMA = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }
agent('prompt', { schema: MY_SCHEMA })

// BAD — 箭头函数隐式返回对象
results.map(r => ({ ...r, verified: true }))
// GOOD — function + 显式 return
results.map(function(r) { return Object.assign({}, r, { verified: true }) })

// BAD — 反斜杠路径
const path = 'C:\Users\project\src'
// GOOD
const path = 'C:/Users/project/src'  // 或直接不在脚本中硬编码路径
```

**Step 1 — 生成脚本内容**

按蓝图结构 + 上述规则生成完整 JavaScript 字符串。agent prompt 内部可以使用中文（prompt 是运行时字符串，不影响解析）。

**Step 2 — 写入文件**

```
Write({
  file_path: expandPath('~/.maestro/workflows/dynamic/uwf-{slug}.js'),
  content: generatedScript
})
```

**Step 3 — 语法验证**

```
Bash({ command: 'node --check "path/to/uwf-{slug}.js"' })
```

若验证失败：
1. 读取错误信息中的行号和错误类型
2. 针对性修复（常见：遗漏逗号、括号不匹配、保留字冲突）
3. 重新 Write + 验证（最多重试 2 次）
4. 仍失败则报 E003，展示脚本内容和错误信息

验证通过后进入 S_EXECUTE（若非 `--dry-run`）。

### A_CONFIRM_EXECUTE

Use `AskUserQuestion` to confirm before executing the generated or selected script:

```
question: "脚本已就绪，是否执行？"
options:
  - label: "执行"
    description: "调用 Workflow 工具运行 {script_name}（预估 {agent_count} 个 agent）"
  - label: "仅保存，不执行"
    description: "保存脚本到 dynamic/ 目录，稍后手动执行"
  - label: "取消"
    description: "不执行也不保存"
```

User confirms → S_EXECUTE; user declines → S_PERSIST (save only); user cancels → END.

### A_EXECUTE_WORKFLOW

**必须用 scriptPath 调用**（不用 script 内联字符串）：

```
Workflow({
  scriptPath: expandPath('~/.maestro/workflows/dynamic/uwf-{slug}.js'),
  args: taskSpecificArgs,   // 从 intent 推断
  resumeFromRunId: resumeId // 若有
})
```

记录返回的 `runId`。脚本已在 A_GENERATE_SCRIPT 中写入文件，无需再次持久化。

### A_PERSIST_SCRIPT

脚本已在 A_GENERATE_SCRIPT Step 2 写入 `~/.maestro/workflows/dynamic/uwf-{slug}.js`。

1. 确认文件存在（Glob 检查）
2. 展示保存路径和使用方式：
   ```
   Saved: ~/.maestro/workflows/dynamic/uwf-{slug}.js
   Reuse: /maestro-universal-workflow --from uwf-{slug} "{new intent}"
   Resume: /maestro-universal-workflow --resume {runId}
   Via swarm: /maestro-swarm-workflow --script uwf-{slug}
   ```

</actions>

</state_machine>

<adversarial_patterns>

以下是对抗决策模式的代码模板库。A_GENERATE_SCRIPT 时按 decision_type 和 depth 选用。

### PATTERN: Skeptic CrossVerify (shallow+)

用于：对并行分析结果逐项挑战。

```javascript
// 每个结果被 skeptic 挑战
const challenges = await pipeline(
  results,
  (result) => agent(
    `You are an adversarial SKEPTIC. Challenge this assessment.
Original: ${JSON.stringify(result)}
Your job: find counter-evidence, check for biases, verify claims against actual code.
Default to challenge_result="weakened" if uncertain.`,
    { label: `challenge:${result.id}`, phase: '{phase}', schema: CHALLENGE_SCHEMA }
  )
)
```

CHALLENGE_SCHEMA:
```javascript
const CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    challenge_result: { type: 'string', enum: ['confirmed', 'weakened', 'overturned'] },
    adjusted_assessment: { type: 'string' },
    counter_evidence: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    reasoning: { type: 'string' },
  },
  required: ['target', 'challenge_result', 'confidence', 'reasoning'],
}
```

### PATTERN: 3-Way Advocacy + Referee (standard+ go-nogo)

用于：go/no-go 类决策。

```javascript
const advocacies = await parallel([
  () => agent('You are the GO ADVOCATE. Argue FOR proceeding...', { label: 'advocate:go', schema: ADVOCACY_SCHEMA }),
  () => agent('You are the NO-GO ADVOCATE. Argue AGAINST proceeding...', { label: 'advocate:nogo', schema: ADVOCACY_SCHEMA }),
  () => agent('You are the CONDITIONAL ADVOCATE. Argue for proceeding ONLY under conditions...', { label: 'advocate:conditional', schema: ADVOCACY_SCHEMA }),
])
const decision = await agent('You are the REFEREE. Resolve the debate...', { label: 'referee', schema: DECISION_SCHEMA })
```

ADVOCACY_SCHEMA:
```javascript
const ADVOCACY_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string' },
    argument: { type: 'string' },
    key_evidence: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] } }, required: ['point'] } },
    weaknesses_acknowledged: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['stance', 'argument', 'confidence'],
}
```

### PATTERN: Prosecutor/Defender/Judge (standard+ pass-fail)

用于：通过/失败类判定。

```javascript
const debate = await parallel([
  () => agent('You are the PROSECUTOR. Argue this should FAIL...', { label: 'prosecutor', schema: ARGUMENT_SCHEMA }),
  () => agent('You are the DEFENDER. Argue this should PASS...', { label: 'defender', schema: ARGUMENT_SCHEMA }),
])
const verdict = await agent('You are the JUDGE. Resolve the debate...', { label: 'judge', schema: VERDICT_SCHEMA })
```

ARGUMENT_SCHEMA:
```javascript
const ARGUMENT_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    stance: { type: 'string', enum: ['pass', 'fail'] },
    argument: { type: 'string' },
    key_points: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, evidence: { type: 'string' }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] } }, required: ['point', 'evidence'] } },
    concessions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['role', 'stance', 'argument', 'key_points', 'confidence'],
}
```

### PATTERN: 3-Vote Majority (standard+ assess-quality)

用于：质量评估、状态判定。

```javascript
const votes = await parallel([
  () => agent('You are the STRICT voter...', { label: 'vote:strict', schema: VOTE_SCHEMA }),
  () => agent('You are the LENIENT voter...', { label: 'vote:lenient', schema: VOTE_SCHEMA }),
  () => agent('You are the OBJECTIVE voter...', { label: 'vote:objective', schema: VOTE_SCHEMA }),
])
const majority = resolveVotes(votes) // majority wins, tie → objective
const report = await agent('Arbitrate final report from votes...', { label: 'arbitrate', schema: REPORT_SCHEMA })
```

VOTE_SCHEMA:
```javascript
const VOTE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    verdict: { type: 'string' },
    rationale: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['perspective', 'verdict', 'rationale', 'confidence'],
}
```

### PATTERN: Competing Proposals + Judge (standard+ select-best)

用于：方案选择。

```javascript
const proposals = await parallel([
  () => agent('Strategy A: ...', { label: 'proposal:A', schema: PROPOSAL_SCHEMA }),
  () => agent('Strategy B: ...', { label: 'proposal:B', schema: PROPOSAL_SCHEMA }),
  () => agent('Strategy C: ...', { label: 'proposal:C', schema: PROPOSAL_SCHEMA }),
])
const scores = await parallel(proposals.filter(Boolean).map(p => () =>
  agent(`Score this proposal: ${p.strategy}...`, { label: `judge:${p.strategy}`, schema: SCORE_SCHEMA })
))
// select highest score
```

### PATTERN: Meta-Skeptic (deep only)

用于：挑战挑战者本身的发现。

```javascript
const metaChallenge = await agent(
  `You are the META-SKEPTIC. Challenge the challengers themselves.
Findings: ${digest}
1. Which findings are OVERBLOWN? (theatrical, unlikely, missing context)
2. What did they MISS? (blind spots, interactions, real risks obscured)
3. Rate overall challenge quality (1-5).`,
  { label: 'meta-skeptic', schema: META_CHALLENGE_SCHEMA }
)
```

</adversarial_patterns>

<invariants>
1. **先查后建** — 必须先扫描现有库，避免重复生成相同功能的脚本
2. **对抗必选** — 每个 decision_point 必须有对应的对抗模式，不允许单 agent 决策
3. **depth 递进** — shallow ⊂ standard ⊂ deep，高 depth 包含低 depth 的所有模式
4. **纯 JS** — 生成的脚本必须是纯 JavaScript，不含 TypeScript 类型注解
5. **meta 全英文** — meta 块中 name/description/whenToUse/phases 只用 ASCII 字符（agent prompt 内可用中文）
6. **Schema 完整** — 每个 agent 调用必须有 schema，且 Schema 在文件顶部声明为独立常量
7. **先写后跑** — 脚本必须先 Write 到文件 → `node --check` 验证 → 再通过 `scriptPath` 执行（禁止内联 script 字符串）
8. **幂等命名** — 同名脚本覆盖（uwf-{slug}.js），用户可通过 --name 控制
9. **禁用 API** — 脚本内不使用 Date.now()、Math.random()、无参 new Date()
10. **变量安全** — 不使用 `phase` 作为变量名（避免遮蔽 phase() 函数）
11. **无模板字符串** — agent prompt 用 `+` 拼接，不用反引号模板（避免嵌套转义错误）
12. **无反斜杠路径** — 字符串中路径用正斜杠（`\u`、`\a` 等会被解析为转义序列）
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Scan**
- REQUIRED: Intent text or `--from`/`--resume` flag parsed.
- BLOCKED if: no intent and no flags (E001).

**GATE 2: Scan → Design/Execute**
- REQUIRED: Library scan completed (both `swarm/` and `dynamic/` directories).
- REQUIRED: User decision if matches found (reuse existing vs generate new).
- BLOCKED if: scan fails to read script directories.

**GATE 3: Design → Generate**
- REQUIRED: Task decomposition completed with work_items, decision_points, data_flow.
- REQUIRED: Phase orchestration and adversarial pattern selection determined by depth.
- BLOCKED if: task cannot be decomposed (E002).

**GATE 4: Generate → Execute**
- REQUIRED: Script written to `~/.maestro/workflows/dynamic/uwf-{slug}.js`.
- REQUIRED: `node --check` syntax validation passed.
- REQUIRED: User confirmation via AskUserQuestion (unless resuming).
- BLOCKED if: syntax validation fails after 2 retries (E003).

**GATE 5: Execute → Persist**
- REQUIRED: Workflow execution completed via `scriptPath` invocation.
- BLOCKED if: Workflow execution failed (E004) — offer `--resume`.

</execution>

<appendix>

### 使用示例

```bash
# 自动匹配或生成
/maestro-universal-workflow "评估数据库迁移方案的可行性和风险"

# 指定深度
/maestro-universal-workflow "审查 auth 模块的安全性" --depth deep

# 只生成不执行
/maestro-universal-workflow "对比 3 种缓存策略" --dry-run --name cache-eval

# 基于已有脚本修改
/maestro-universal-workflow "类似 analyze 但加入成本维度" --from wf-analyze

# 恢复之前的运行
/maestro-universal-workflow --resume wf_abc123
```

### 生成脚本示例

用户 intent: "评估 3 种 API 认证方案（JWT/OAuth2/API Key），选出最优"

生成的脚本结构：
```
Phase 1: Explore — 探索代码库现有认证实现
Phase 2: Evaluate — 3 个 agent 分别深入评估每种方案
Phase 3: CrossVerify — skeptic 挑战每个评估结果
Phase 4: Compete — 3 个 advocate 各持一种方案立场辩论
Phase 5: Arbitrate — referee 根据辩论结果选出最优方案
```

预估 agent 数: 1(explore) + 3(evaluate) + 3(cross-verify) + 3(advocates) + 1(referee) = 11

### 与 swarm-workflow 的关系

| 维度 | swarm-workflow | universal-workflow |
|------|---------------|-------------------|
| 脚本来源 | 固定 8 个预写脚本 | 动态生成 + 积累库 |
| 适用范围 | 对应 8 个 maestro 命令 | 任意任务 |
| 决策模式 | 脚本内硬编码 | 按 depth 动态选择 |
| 持久化 | 不生成新脚本 | 保存到 dynamic/ 复用 |
| 推荐场景 | 已有匹配的标准命令 | 非标准任务、新领域 |

universal-workflow 扫描时会同时检查 swarm/ 和 dynamic/ 目录，
若 swarm 脚本匹配度高则推荐使用 swarm-workflow 代替。

### Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| E001 | 无 intent | 提示用户输入 |
| E002 | 设计阶段无法分解任务 | 要求更具体的 intent |
| E003 | 生成的脚本语法错误 | `node --check` 失败时：读取行号+错误类型 → 针对性修复 → 重试（最多 2 次）→ 仍失败则展示脚本+错误让用户手动修改 |
| E004 | Workflow 执行失败 | 展示错误，提供 --resume |
| E005 | 持久化失败 | 展示脚本内容，让用户手动保存 |

</appendix>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No intent and no --from/--resume flag | Prompt user for intent text |
| E002 | error | Task decomposition failed — cannot identify work_items | Require more specific intent description |
| E003 | error | Generated script syntax error after 2 retries | Show script content + error for manual fix |
| E004 | error | Workflow execution failed | Show error, offer --resume with runId |
| E005 | error | Script persistence failed (filesystem write error) | Show script content for manual save |
| W001 | warning | No matching scripts found in library scan | Proceed directly to S_DESIGN |
| W002 | warning | Adversarial gate confidence < 50% | Flag low-confidence decision, suggest --depth deep |
</error_codes>

<success_criteria>
- [ ] Intent parsed and flags extracted (--name, --depth, --dry-run, --from, --resume)
- [ ] Library scan completed across both swarm/ and dynamic/ directories
- [ ] User decision captured if matching scripts found (reuse vs generate)
- [ ] Task decomposition produced: work_items, decision_points, data_flow
- [ ] Adversarial pattern selected per decision_point according to depth level
- [ ] Blueprint presented to user with estimated agent count
- [ ] Script generated as pure JavaScript with all 12 generation rules enforced
- [ ] `node --check` syntax validation passed
- [ ] User confirmation obtained before execution (unless --resume)
- [ ] Workflow executed via scriptPath (not inline script string)
- [ ] Script persisted to `~/.maestro/workflows/dynamic/uwf-{slug}.js`
- [ ] Completion summary displayed with reuse/resume commands
</success_criteria>
