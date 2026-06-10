---
name: maestro-swarm-workflow
description: Parallel workflow accelerator — route intent to fixed Workflow scripts for multi-agent concurrent execution
argument-hint: "<intent> [--script <name>] [--dims <d1,d2>] [--roles <r1,r2>] [--count N] [--tier quick|standard] [--resume <runId>]"
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
Parallel accelerator layer for maestro commands. Routes user intent to pre-built Workflow scripts
that leverage `parallel()` / `pipeline()` for multi-agent concurrent execution.

Complements maestro-ralph (sequential decision chain) — ralph manages state + decisions,
swarm-workflow provides parallel compute bursts within individual steps.

Scripts: `~/.maestro/workflows/swarm/wf-*.js`

| Script | Accelerates | Adversarial Pattern |
|--------|-------------|---------------------|
| `wf-analyze` | maestro-analyze | explore → 6-dim scoring → **skeptic cross-verify** → **3-way advocacy (go/no-go/conditional) + referee** |
| `wf-brainstorm` | maestro-brainstorm | multi-role analysis → **3-specialist cross-review** → **3-proposal competition** → **arbitrator** |
| `wf-review` | quality-review | 6-dim scan → **3-vote adversarial verify (prosecutor/defense/judge)** → **3-perspective report + arbitrated verdict** |
| `wf-verify` | maestro-execute (verification gate) | 3-layer + antipattern + convergence → **prosecutor vs defender debate** → **judge verdict** |
| `wf-grill` | maestro-grill | explore → parallel branch stress → **meta-skeptic challenge** → **3-vote verdict (optimist/pessimist/realist)** |
| `wf-plan` | maestro-plan | parallel context → **3-strategy competing proposals** → **judge panel scoring** → **3-critic adversarial check** |
| `wf-execute` | maestro-execute | wave-based parallel execution → **adversarial convergence spot-check** → **3-vote status determination** |
| `wf-milestone-audit` | maestro-milestone-audit | parallel 3-dim audit → **adversarial dimension challenge** → **3-vote verdict (strict/lenient/objective)** |

Integration modes:
- **Standalone**: `/maestro-swarm-workflow "analyze auth module"` — direct invocation
- **Ralph step**: ralph chain 中某个 step 可指定 `swarm-workflow` 作为加速执行器
- **Chained**: 输出 JSON 可被下游命令通过 `--from` 消费
</purpose>

<context>
$ARGUMENTS — intent text with optional flags.

**Parse:**
```
--script <name>  → 强制指定脚本（wf-analyze, wf-brainstorm, wf-review, wf-verify）
--dims <d1,d2>   → 限定分析维度（analyze: architecture,complexity,patterns,risk,testability,performance）
--roles <r1,r2>  → 限定角色（brainstorm: system-architect,product-manager,test-strategist,ux-expert,security-analyst,data-architect）
--count N        → 角色数量（brainstorm 默认 3）
--tier <level>   → review 层级（quick=2 维度, standard=4 维度）
--resume <runId> → 从之前的 workflow 运行恢复（增量重跑）
Remaining        → intent
```

**Script inventory** (`~/.maestro/workflows/swarm/`):

| Script | args 接口 |
|--------|-----------|
| `wf-analyze` | `{ target, scope, context, phase?, dimensions? }` |
| `wf-brainstorm` | `{ topic, context, count?, roles? }` |
| `wf-review` | `{ target, scope, specs?, tier?, dimensions? }` |
| `wf-verify` | `{ goals, plan_dir?, scope?, task_files?, must_haves?, skip_antipattern? }` |
| `wf-grill` | `{ topic, context?, depth?: "shallow"\|"standard"\|"deep" }` |
| `wf-plan` | `{ context_dir?, from?, phase?, scope?, specs?, gaps?, quick? }` |
| `wf-execute` | `{ plan_dir, specs?, codebase_context?, wiki_context?, auto_commit? }` |
| `wf-milestone-audit` | `{ milestone?, is_adhoc? }` |
</context>

<state_machine>

<states>
S_PARSE        — 解析参数和意图                    PERSIST: —
S_ROUTE        — 路由到目标脚本                    PERSIST: —
S_CONTEXT      — 组装 context payload             PERSIST: —
S_DISPATCH     — 调用 Workflow 工具                PERSIST: —
S_INGEST       — 处理返回结果                      PERSIST: —
S_FALLBACK     — 无法路由                         PERSIST: —
</states>

<transitions>

S_PARSE:
  → S_ROUTE     WHEN: intent parsed                DO: A_PARSE_ARGS
  → S_FALLBACK  WHEN: no intent

S_ROUTE:
  → S_CONTEXT   WHEN: script resolved              DO: A_ROUTE_SCRIPT
  → S_FALLBACK  WHEN: ambiguous intent              DO: AskUserQuestion

S_CONTEXT:
  → S_DISPATCH  DO: A_ASSEMBLE_CONTEXT

S_DISPATCH:
  → S_INGEST    WHEN: workflow completed            DO: A_DISPATCH_WORKFLOW
  → S_FALLBACK  WHEN: workflow failed

S_INGEST:
  → END         DO: A_INGEST_RESULTS

S_FALLBACK:
  → S_PARSE     WHEN: user provides input
  → END         WHEN: user cancels

</transitions>

<actions>

### A_PARSE_ARGS

1. 提取 flags（--script, --dims, --roles, --count, --tier, --resume）
2. 剩余文本作为 intent
3. 若有 --resume，记录 resumeRunId

### A_ROUTE_SCRIPT

Intent-to-script routing（按关键词匹配，--script 优先级最高）：

| Keywords | Script |
|----------|--------|
| 分析 / analyze / 探索 / explore / 架构 / architecture / 复杂度 / 风险 | `wf-analyze` |
| 头脑风暴 / brainstorm / 方案 / 设计 / 评估 / evaluate / 多角度 | `wf-brainstorm` |
| 审查 / review / 代码审查 / code review / 质量 / quality | `wf-review` |
| 验证 / verify / 检查 / check / 反模式 / antipattern | `wf-verify` |
| 拷问 / grill / 压力测试 / stress-test / 挑战 / challenge | `wf-grill` |
| 规划 / plan / 任务分解 / decompose / 分波 / wave | `wf-plan` |
| 执行 / execute / 实现 / implement / 开发 / develop | `wf-execute` |
| 里程碑审计 / milestone-audit / 集成检查 / integration | `wf-milestone-audit` |

多命中 → AskUserQuestion 让用户选择。

### A_ASSEMBLE_CONTEXT

根据目标脚本组装 args payload：

**wf-analyze:**
1. Read `.workflow/state.json` 获取当前 phase/milestone 信息
2. `target` = intent 中的目标描述
3. `scope` = 从 intent 推断文件范围，或读 roadmap 获取 phase scope
4. `context` = 拼接相关上下文（上游 artifact 摘要、specs）
5. `dimensions` = --dims 解析结果（可选）

**wf-brainstorm:**
1. `topic` = intent 文本
2. `context` = 读取相关代码文件摘要 + 已有 specs
3. `count` = --count 或默认 3
4. `roles` = --roles 解析结果（可选）

**wf-review:**
1. `target` = 读 git diff 描述变更范围
2. `scope` = 变更文件列表
3. `tier` = --tier 或 "standard"
4. `dimensions` = --dims 解析结果（可选）

**wf-verify:**
1. `goals` = 读最近的 plan artifact 提取目标列表
2. `plan_dir` = 定位最近的 plan scratch 目录
3. `scope` = plan 涉及的文件范围
4. `skip_tests` / `skip_antipattern` = 从 flags 提取

### A_DISPATCH_WORKFLOW

1. 确定 scriptPath = `~/.maestro/workflows/swarm/{script}.js`（展开为绝对路径）
2. 构建 Workflow 调用：
   ```
   Workflow({
     scriptPath: absoluteScriptPath,
     args: assembledArgs,
     resumeFromRunId: resumeRunId  // 若有
   })
   ```
3. 等待 Workflow 返回结果
4. 记录 runId 用于潜在的后续 resume

### A_INGEST_RESULTS

Workflow 返回 JSON 后：

1. **摘要输出**：按脚本类型格式化关键指标（含对抗决策结果）
   - analyze: overall_score, scope_verdict, adversarial_outcome (go/no-go/conditional advocacy + referee), scores_challenged count
   - brainstorm: role count, conflict/synergy count, 3-proposal competition result, arbitration notes
   - review: verdict (APPROVE/REQUEST_CHANGES/BLOCK), 3-vote tally, confirmed vs false-positive count, adversarial_verdict
   - verify: overall_status, prosecutor vs defender confidence, adversarial_outcome, gap count
   - grill: overall_verdict, meta-skeptic quality rating, 3-vote verdict tally, overblown findings count
   - plan: selected_strategy (breadth/depth/risk), judge panel scores, 3-critic adversarial check verdict
   - execute: 3-vote status (DONE/DONE_WITH_CONCERNS/NEEDS_RETRY), convergence trust %, discrepancy count
   - milestone-audit: 3-vote verdict, dimensions_overturned count, next_step

2. **Artifact 写入**（可选）：
   - 若当前在 ralph session 中（检测 `.workflow/.maestro/ralph-*/status.json` 状态为 running）：
     将结果写入对应 step 的 scratch 目录，格式兼容命令产出
   - 否则写入 `.workflow/scratch/{YYYYMMDD}-swarm-{script}-{slug}/results.json`

3. **Ralph 兼容产出**：
   - analyze → `analysis.md` + `context.md`（decisions）+ `conclusions.json` + `adversarial-debate.json`
   - brainstorm → `guidance-specification.md` + `proposals-competition.json`
   - review → `review.json`（含 adversarial_verdict + 3-vote tally）
   - verify → `verification.json`（含 adversarial_outcome: prosecutor/defender debate）
   - grill → `grill-results.json`（含 meta-challenge + 3-vote verdict）
   - plan → `plan.json`（含 competition scores + critic feedback）
   - execute → `execution-report.json`（含 convergence_checks + 3-vote status）
   - milestone-audit → `audit-report.json`（含 dimension challenges + 3-vote verdict）

4. **RunId 提示**：显示 `Resume: /maestro-swarm-workflow --resume {runId}` 用于增量重跑

</actions>

</state_machine>

<invariants>
1. **只做并行加速，不做状态决策** — 不修改 ralph status.json，不推进 step
2. **args 预编译** — 所有 FS 读取在 A_ASSEMBLE_CONTEXT 完成，脚本内 agent 通过工具自行读取补充
3. **产出格式兼容** — 写入的 artifact 格式必须与对应命令（analyze/brainstorm/review/verify）的产出一致
4. **resume 透传** — resumeFromRunId 直接透传给 Workflow 工具，利用内置缓存机制
5. **脚本只读** — 路由命令不修改 `~/.maestro/workflows/swarm/wf-*.js` 脚本文件
6. **结果必须展示** — Workflow 返回后必须向用户展示格式化摘要，不得静默完成
</invariants>

<appendix>

### 与 Ralph 集成

Ralph 可以在 A_BUILD_STEPS 中将某些 step 的执行方式标记为 `swarm-workflow`：

```json
{
  "index": 2,
  "skill": "maestro-swarm-workflow",
  "args": "--script wf-analyze {phase}",
  "stage": "analyze",
  "command_scope": "project",
  "command_path": "<resolved by maestro ralph skills --platform claude>"
}
```

ralph-execute 正常通过 `maestro ralph next` 加载并执行，swarm-workflow 内部再调 Workflow 工具。

### 输出示例

```
┌─ wf-analyze ──────────────────────────────────────┐
│  Explore  [████████████████████] 6/6 dimensions    │
│  Synthesize  [████████████████] done               │
├────────────────────────────────────────────────────┤
│  Score: 7.2/10  Scope: medium  Verdict: go         │
│  Findings: 23 total (2 critical, 5 high)           │
│  Cross-cutting: 3 themes                           │
│  Decisions: 4 locked, 2 free, 1 deferred           │
├────────────────────────────────────────────────────┤
│  Output: .workflow/scratch/20260530-swarm-analyze/  │
│  Resume: /maestro-swarm-workflow --resume wf_abc123 │
└────────────────────────────────────────────────────┘
```

### Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| E001 | No intent and no --script | Prompt for intent |
| E002 | Ambiguous routing | AskUserQuestion |
| E003 | Script file not found | Check .claude/workflows/ |
| E004 | Workflow execution failed | Show error, suggest --resume |
| E005 | Result ingestion failed | Write raw JSON to scratch |

</appendix>
