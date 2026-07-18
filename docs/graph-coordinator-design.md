# Graph-Based Autonomous Coordinator Design

## 1. Problem Statement

Current `maestro-coordinate` uses **linear arrays** (`ChainStepDef[]`) as execution chains. This creates several limitations:

| Problem | Current | Impact |
|---------|---------|--------|
| No branching | Array = fixed order | Verify 失败后无法自动跳到修复路径 |
| No real loops | `quality-loop` 是 6 步线性数组 | 跑完即止，不是真闭环 |
| Dual routing | `detectNextAction` (state) + `chainMap` (intent) 两套逻辑 | 维护成本高，无法组合 |
| No mid-execution decisions | 仅入口做一次 intent 分类 | 执行中无法根据结果调整路径 |
| Fragile context | 正则从输出中提取 PHASE/spec_id | 容易丢失 |
| Hard-coded | 改链 = 改代码 + 重编译 | 无法热更新 |

## 2. Design Goal

将**执行链**从硬编码数组提升为**有向图**，节点包含 `command | decision | gate | fork | join | eval | terminal` 七种类型，边携带条件表达式，形成**闭环自主决策**的 Coordinator。

**Core idea**: Coordinator 不再是"选一条链然后顺序跑"，而是"进入一个图然后自主走到终端节点"。

---

## 3. Storage Layout

```
~/.maestro/
  chains/                              # 图定义（全局，用户可编辑）
    chain-graph.schema.json            # JSON Schema for validation
    _router.json                       # 状态路由元图
    _intent-map.json                   # intent → graph ID 映射表
    full-lifecycle.json                # 多步骤图
    spec-driven.json
    brainstorm-driven.json
    roadmap-driven.json
    ui-design-driven.json
    execute-verify.json
    quality-loop.json
    milestone-close.json
    analyze-plan-execute.json
    singles/                           # 单步命令（自动生成 or 手写）
      init.json
      plan.json
      execute.json
      verify.json
      ...

.workflow/.maestro-coordinate/         # 运行时会话（项目级）
  {session_id}/
    walker-state.json                  # WalkerState 完整快照
    graph-snapshot.json                # 本次加载的图副本（不变）
    outputs/
      {node_id}.txt                    # command 节点的原始输出
      {node_id}.analysis.json          # gemini 分析结果
    events.ndjson                      # 事件日志（append-only）
```

---

## 4. Graph Schema (chain-graph.schema.json)

### 4.1 Graph Envelope

```typescript
interface ChainGraph {
  /** JSON Schema pointer */
  $schema?: string;

  /** Unique graph identifier (filename without .json) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Semver for schema evolution */
  version: string;

  /** Tags for discovery/filtering */
  tags?: string[];

  /** Entry node ID — walker starts here */
  entry: string;

  /** Graph-level input parameters */
  inputs?: Record<string, GraphInput>;

  /** All nodes keyed by unique ID */
  nodes: Record<string, GraphNode>;

  /** Graph-level defaults (inherited by all command nodes) */
  defaults?: {
    timeout_ms?: number;       // default: 600000
    analyze?: boolean;         // default: true for multi-node graphs
    max_visits?: number;       // default: 1
    auto_flag?: string;        // injected in auto mode
  };
}

interface GraphInput {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;          // default: false
  default?: string | number | boolean;
  description?: string;
}
```

### 4.2 Node Types

七种节点类型，各司其职：

```
command   ── 执行 maestro 命令
decision  ── 条件分支（expr 或 LLM）
gate      ── 前置条件检查（阻塞 or 失败）
fork      ── 并行分发
join      ── 等待并行完成
eval      ── 轻量上下文变换
terminal  ── 结束（成功/失败/暂停/委托）
```

#### 4.2.1 CommandNode

```typescript
interface CommandNode {
  type: 'command';

  /** maestro 命令名 (e.g. "maestro-plan", "quality-review") */
  cmd: string;

  /** 参数模板，支持 {phase}, {description}, {scratch_dir}, {var.xxx} */
  args?: string;

  /** auto 模式下注入的 flag (e.g. "-y", "--auto") */
  auto_flag?: string;

  /** 成功后的下一个节点 ID */
  next: string;

  /** 失败后的节点 ID (default: 重试 1 次 → terminal:_fail) */
  on_failure?: string;

  /** 此节点最大访问次数 (防无限循环，default: graph.defaults.max_visits) */
  max_visits?: number;

  /** 超时 ms (default: graph.defaults.timeout_ms) */
  timeout_ms?: number;

  /** 是否需要 gemini 步后分析 (default: graph.defaults.analyze) */
  analyze?: boolean;

  /** 从输出中提取到 context 的规则 */
  extract?: Record<string, ExtractionRule>;
}

interface ExtractionRule {
  /** 提取方式 */
  strategy: 'regex' | 'json_path' | 'line_match';
  /** 正则/JSON path/行前缀 */
  pattern: string;
  /** 存储到 context 的路径 (e.g. "inputs.phase", "var.spec_session_id") */
  target: string;
}
```

**extract 示例** — 替代当前脆弱的正则提取：

```json
{
  "extract": {
    "phase": {
      "strategy": "regex",
      "pattern": "PHASE:\\s*(\\d+)",
      "target": "inputs.phase"
    },
    "spec_session": {
      "strategy": "regex",
      "pattern": "(SPEC-[\\w-]+)",
      "target": "var.spec_session_id"
    },
    "scratch_dir": {
      "strategy": "line_match",
      "pattern": "scratch_dir:",
      "target": "var.scratch_dir"
    }
  }
}
```

#### 4.2.2 DecisionNode

```typescript
interface DecisionNode {
  type: 'decision';

  /** 求值策略 */
  strategy?: 'expr' | 'llm';  // default: 'expr'

  // ── expr 模式 ──
  /** 被求值的表达式（取出值用于边匹配） */
  eval?: string;

  // ── llm 模式 ──
  /** LLM 提示词 */
  prompt?: string;
  /** 注入 LLM 的上下文键 */
  context_keys?: string[];

  /** 出边列表（按顺序匹配，第一个命中的生效） */
  edges: DecisionEdge[];
}

interface DecisionEdge {
  /** 精确匹配 eval 结果 */
  value?: string | number | boolean;

  /** 条件表达式 (e.g. "score >= 80", "visit_count < 3") */
  match?: string;

  /** LLM 返回的标签 (strategy: 'llm') */
  label?: string;

  /** 兜底边（其他都不匹配时生效） */
  default?: boolean;

  /** 目标节点 ID */
  target: string;

  /** 边的说明（用于可视化/日志） */
  description?: string;
}
```

**Expression Language** (expr 模式)：

```
// 取值表达式 — eval 字段
ctx.result.status            // 上一个 command 的结构化输出
ctx.result.quality_score     // 数值
ctx.analysis.verdict         // gemini 分析结论
ctx.inputs.phase             // 图的输入参数
ctx.var.xxx                  // eval 节点设置的变量
ctx.project.phase_status     // .workflow/state.json 快照
ctx.project.artifacts.plan   // 阶段产物是否存在
ctx.visits.{node_id}         // 节点访问次数

// 条件表达式 — edges[].match 字段
score >= 80
visit_count < 3
score >= 60 && issues == 0
phase_status == "completed"
```

**边匹配优先级**：
1. `value` — 精确相等
2. `match` — 条件表达式
3. `label` — LLM 标签
4. `default: true` — 兜底

#### 4.2.3 GateNode

```typescript
interface GateNode {
  type: 'gate';

  /** 布尔条件表达式 */
  condition: string;

  /** 条件为 true → 目标 */
  on_pass: string;

  /** 条件为 false → 目标 */
  on_fail: string;

  /** true = 暂停等待条件变化, false = 立即走 on_fail (default: false) */
  wait?: boolean;

  /** 等待时的提示信息 */
  wait_message?: string;
}
```

**Gate vs Decision**:
- `gate` = 二元守卫，关注"能否继续"
- `decision` = 多路分发，关注"走哪条路"

#### 4.2.4 ForkNode / JoinNode

```typescript
interface ForkNode {
  type: 'fork';

  /** 并行启动的节点 ID 列表 */
  branches: string[];

  /** 汇聚节点 ID（所有分支最终必须到达此节点） */
  join: string;
}

interface JoinNode {
  type: 'join';

  /** 汇聚策略 */
  strategy: 'all' | 'any' | 'majority';

  /** 汇聚后的下一个节点 */
  next: string;

  /** 如何合并分支结果 */
  merge?: 'concat' | 'last' | 'best_score';
}
```

#### 4.2.5 EvalNode

```typescript
interface EvalNode {
  type: 'eval';

  /** key = context 路径, value = 表达式 */
  set: Record<string, string>;

  /** 下一个节点 */
  next: string;
}
```

**示例** — 在进入执行前重写 phase：

```json
{
  "type": "eval",
  "set": {
    "inputs.phase": "ctx.result.resolved_phase",
    "var.retry_count": "0"
  },
  "next": "execute"
}
```

#### 4.2.6 TerminalNode

```typescript
interface TerminalNode {
  type: 'terminal';

  /** 结束状态 */
  status: 'success' | 'failure' | 'paused' | 'delegate';

  /** status=delegate 时跳转到另一个图 */
  delegate_graph?: string;

  /** 传给目标图的输入 */
  delegate_inputs?: Record<string, string>;

  /** 成功时的摘要模板 */
  summary?: string;
}
```

---

## 5. Intent Map (_intent-map.json)

替代当前硬编码的 `INTENT_PATTERNS` + `TASK_TO_CHAIN` + `chainMap`：

```jsonc
{
  "$schema": "intent-map.schema.json",
  "version": "1.0.0",

  "patterns": [
    // 顺序匹配，first match wins
    { "type": "state_continue", "regex": "^(continue|next|go|继续|下一步)$", "flags": "i",
      "route": { "strategy": "state_router" }
    },
    { "type": "status", "regex": "^(status|状态|dashboard)$", "flags": "i",
      "route": { "graph": "singles/status" }
    },
    { "type": "spec_generate", "regex": "spec.*(generat|creat|build)|PRD|产品.*规格", "flags": "i",
      "route": { "graph": "spec-driven" }
    },
    { "type": "brainstorm", "regex": "brainstorm|ideate|头脑风暴|发散", "flags": "i",
      "route": { "graph": "brainstorm-driven" }
    },
    { "type": "analyze", "regex": "analy[sz]e|feasib|evaluat|assess|discuss|分析|评估|讨论", "flags": "i",
      "route": { "graph": "singles/analyze" }
    },
    { "type": "execute", "regex": "execute|implement|build|develop|code|实现|开发", "flags": "i",
      "route": { "graph": "singles/execute" }
    },
    { "type": "verify", "regex": "verif[iy]|validate.*result|验证|校验", "flags": "i",
      "route": { "graph": "singles/verify" }
    },
    { "type": "review", "regex": "\\breview.*code|code.*review|代码.*审查", "flags": "i",
      "route": { "graph": "singles/review" }
    },
    { "type": "debug", "regex": "debug|diagnos|troubleshoot|fix.*bug|调试|排查", "flags": "i",
      "route": { "graph": "singles/debug" }
    },
    { "type": "quick", "regex": "quick|small.*task|ad.?hoc|简单|快速", "flags": "i",
      "route": { "graph": "singles/quick" }
    }
    // ... 其余 patterns
  ],

  "fallback": { "graph": "singles/quick" }
}
```

**route 策略**:
- `{ "graph": "xxx" }` — 直接加载对应图
- `{ "strategy": "state_router" }` — 走 `_router.json` 状态路由图

---

## 6. State Router (_router.json)

将当前 `detectNextAction` 的 if-else 逻辑转为决策图：

```jsonc
{
  "id": "_router",
  "name": "State Router",
  "description": "Route to appropriate graph based on project state",
  "version": "1.0.0",
  "tags": ["internal", "router"],
  "entry": "check_init",
  "inputs": {
    "phase": { "type": "string", "required": false },
    "description": { "type": "string", "required": false }
  },

  "nodes": {
    "check_init": {
      "type": "decision",
      "eval": "ctx.project.initialized",
      "edges": [
        { "value": false, "target": "to_init" },
        { "default": true, "target": "check_has_roadmap" }
      ]
    },

    "check_has_roadmap": {
      "type": "decision",
      "eval": "ctx.project.phases_total",
      "edges": [
        { "match": "phases_total == 0", "target": "check_accumulated_context" },
        { "default": true, "target": "check_phase_status" }
      ]
    },

    "check_accumulated_context": {
      "type": "decision",
      "eval": "ctx.project.accumulated_context",
      "edges": [
        { "match": "accumulated_context != null", "target": "to_next_milestone" },
        { "default": true, "target": "to_brainstorm_driven" }
      ]
    },

    "check_phase_status": {
      "type": "decision",
      "eval": "ctx.project.phase_status",
      "edges": [
        { "value": "pending",    "target": "check_pending_artifacts" },
        { "value": "exploring",  "target": "check_has_plan" },
        { "value": "planning",   "target": "check_has_plan" },
        { "value": "executing",  "target": "check_tasks_done" },
        { "value": "verifying",  "target": "check_verification" },
        { "value": "testing",    "target": "check_uat" },
        { "value": "completed",  "target": "check_all_phases" },
        { "value": "blocked",    "target": "to_debug" }
      ]
    },

    "check_pending_artifacts": {
      "type": "decision",
      "eval": "ctx.project.artifacts.context",
      "edges": [
        { "value": true,  "target": "to_plan" },
        { "default": true, "target": "to_analyze" }
      ]
    },

    "check_has_plan": {
      "type": "decision",
      "eval": "ctx.project.artifacts.plan",
      "edges": [
        { "value": true,  "target": "to_execute_verify" },
        { "default": true, "target": "to_plan" }
      ]
    },

    "check_tasks_done": {
      "type": "decision",
      "eval": "ctx.project.execution.tasks_completed",
      "edges": [
        {
          "match": "tasks_completed >= tasks_total && tasks_total > 0",
          "target": "to_verify"
        },
        { "default": true, "target": "to_execute" }
      ]
    },

    "check_verification": {
      "type": "decision",
      "eval": "ctx.project.verification_status",
      "edges": [
        { "value": "passed", "target": "check_review_after_verify" },
        { "default": true,   "target": "to_quality_loop_partial" }
      ]
    },

    "check_review_after_verify": {
      "type": "decision",
      "eval": "ctx.project.review_verdict",
      "edges": [
        { "value": null,     "target": "to_review" },
        { "default": true,   "target": "check_uat_after_review" }
      ]
    },

    "check_uat_after_review": {
      "type": "decision",
      "eval": "ctx.project.uat_status",
      "edges": [
        { "value": "pending", "target": "to_test" },
        { "value": "passed",  "target": "to_phase_transition" },
        { "default": true,    "target": "to_debug_from_uat" }
      ]
    },

    "check_uat": {
      "type": "decision",
      "eval": "ctx.project.uat_status",
      "edges": [
        { "value": "passed", "target": "to_phase_transition" },
        { "default": true,   "target": "to_debug_from_uat" }
      ]
    },

    "check_all_phases": {
      "type": "decision",
      "eval": "ctx.project.phases_completed",
      "edges": [
        {
          "match": "phases_completed >= phases_total",
          "target": "to_milestone_close"
        },
        { "default": true, "target": "to_phase_transition" }
      ]
    },

    // ── Terminal (delegate) nodes ──

    "to_init":                { "type": "terminal", "status": "delegate", "delegate_graph": "singles/init" },
    "to_analyze":             { "type": "terminal", "status": "delegate", "delegate_graph": "singles/analyze" },
    "to_plan":                { "type": "terminal", "status": "delegate", "delegate_graph": "singles/plan" },
    "to_execute":             { "type": "terminal", "status": "delegate", "delegate_graph": "singles/execute" },
    "to_verify":              { "type": "terminal", "status": "delegate", "delegate_graph": "singles/verify" },
    "to_review":              { "type": "terminal", "status": "delegate", "delegate_graph": "singles/review" },
    "to_test":                { "type": "terminal", "status": "delegate", "delegate_graph": "singles/test" },
    "to_debug":               { "type": "terminal", "status": "delegate", "delegate_graph": "singles/debug" },
    "to_debug_from_uat":      { "type": "terminal", "status": "delegate", "delegate_graph": "singles/debug",
                                "delegate_inputs": { "args_prefix": "--from-uat" } },
    "to_execute_verify":      { "type": "terminal", "status": "delegate", "delegate_graph": "execute-verify" },
    "to_phase_transition":    { "type": "terminal", "status": "delegate", "delegate_graph": "singles/phase-transition" },
    "to_milestone_close":     { "type": "terminal", "status": "delegate", "delegate_graph": "milestone-close" },
    "to_brainstorm_driven":   { "type": "terminal", "status": "delegate", "delegate_graph": "brainstorm-driven" },
    "to_next_milestone":      { "type": "terminal", "status": "delegate", "delegate_graph": "next-milestone" },
    "to_quality_loop_partial": { "type": "terminal", "status": "delegate", "delegate_graph": "quality-loop",
                                  "delegate_inputs": { "entry_override": "plan_gaps" } }
  }
}
```

**可视化**:

```
[check_init]
  │ false → [to_init]
  │ true ↓
[check_has_roadmap]
  │ phases=0 → [check_accumulated_context]
  │                │ has_ctx → [to_next_milestone]
  │                │ null    → [to_brainstorm_driven]
  │ phases>0 ↓
[check_phase_status]
  ├─ pending   → [check_pending_artifacts] → analyze | plan
  ├─ exploring → [check_has_plan] → execute-verify | plan
  ├─ planning  → [check_has_plan]
  ├─ executing → [check_tasks_done] → verify | execute
  ├─ verifying → [check_verification] → review chain | quality-loop
  ├─ testing   → [check_uat] → phase-transition | debug
  ├─ completed → [check_all_phases] → milestone-close | phase-transition
  └─ blocked   → [to_debug]
```

---

## 7. Example Graphs

### 7.1 quality-loop.json (真闭环)

```jsonc
{
  "id": "quality-loop",
  "name": "Quality Loop",
  "description": "Verify → Review → Test → Debug → Fix → re-Verify cycle",
  "version": "1.0.0",
  "tags": ["quality", "loop"],
  "entry": "verify",
  "inputs": {
    "phase": { "type": "string", "required": true }
  },
  "defaults": {
    "timeout_ms": 600000,
    "analyze": true
  },

  "nodes": {
    "verify": {
      "type": "command",
      "cmd": "maestro-verify",
      "args": "{phase}",
      "next": "check_verify",
      "max_visits": 4
    },
    "check_verify": {
      "type": "decision",
      "eval": "ctx.result.verification_status",
      "edges": [
        { "value": "passed", "target": "review",    "description": "Verification passed" },
        { "default": true,   "target": "plan_gaps",  "description": "Verification failed" }
      ]
    },

    "review": {
      "type": "command",
      "cmd": "quality-review",
      "args": "{phase}",
      "next": "check_review"
    },
    "check_review": {
      "type": "decision",
      "eval": "ctx.result.review_verdict",
      "edges": [
        { "value": "BLOCK", "target": "plan_gaps", "description": "Review blocked" },
        { "default": true,  "target": "test",      "description": "Review passed/warned" }
      ]
    },

    "test": {
      "type": "command",
      "cmd": "quality-test",
      "args": "{phase}",
      "auto_flag": "--auto-fix",
      "next": "check_test"
    },
    "check_test": {
      "type": "decision",
      "eval": "ctx.result.uat_status",
      "edges": [
        { "value": "passed", "target": "done",  "description": "UAT passed" },
        { "default": true,   "target": "debug", "description": "UAT failed" }
      ]
    },

    "debug": {
      "type": "command",
      "cmd": "quality-debug",
      "args": "--from-uat {phase}",
      "next": "plan_gaps",
      "max_visits": 2
    },

    "plan_gaps": {
      "type": "command",
      "cmd": "maestro-plan",
      "args": "{phase} --gaps",
      "auto_flag": "--auto",
      "next": "re_execute"
    },
    "re_execute": {
      "type": "command",
      "cmd": "maestro-execute",
      "args": "{phase}",
      "next": "verify",
      "max_visits": 3
    },

    "done": {
      "type": "terminal",
      "status": "success",
      "summary": "Quality loop completed for phase {phase}"
    }
  }
}
```

```
     ┌─────────────────────────────────────────┐
     │                                         │
     ▼                                         │
  [verify] ──→ <check_verify>                  │
                 │passed     │fail              │
                 ▼           ▼                  │
            [review]    [plan_gaps] → [re_execute]
                 │                      ↑
                 ▼                      │
           <check_review>               │
             │ok      │BLOCK ───────────┘
             ▼
           [test]
             │
             ▼
         <check_test>
           │passed    │fail
           ▼          ▼
        (done)     [debug] → [plan_gaps] → ...
```

### 7.2 full-lifecycle.json (带决策的完整生命周期)

```jsonc
{
  "id": "full-lifecycle",
  "name": "Full Lifecycle",
  "description": "Plan → Execute → Verify → Review → Test → Transition with decision points",
  "version": "1.0.0",
  "tags": ["lifecycle", "phase"],
  "entry": "plan",
  "inputs": {
    "phase": { "type": "string", "required": true },
    "description": { "type": "string" }
  },
  "defaults": { "analyze": true },

  "nodes": {
    "plan": {
      "type": "command",
      "cmd": "maestro-plan",
      "args": "{phase}",
      "auto_flag": "--auto",
      "next": "execute"
    },
    "execute": {
      "type": "command",
      "cmd": "maestro-execute",
      "args": "{phase}",
      "next": "verify"
    },
    "verify": {
      "type": "command",
      "cmd": "maestro-verify",
      "args": "{phase}",
      "next": "check_verify",
      "max_visits": 3
    },
    "check_verify": {
      "type": "decision",
      "eval": "ctx.result.verification_status",
      "edges": [
        { "value": "passed", "target": "review" },
        { "default": true,   "target": "fix_plan" }
      ]
    },

    "fix_plan": {
      "type": "command",
      "cmd": "maestro-plan",
      "args": "{phase} --gaps",
      "auto_flag": "--auto",
      "next": "fix_execute"
    },
    "fix_execute": {
      "type": "command",
      "cmd": "maestro-execute",
      "args": "{phase}",
      "next": "verify",
      "max_visits": 3
    },

    "review": {
      "type": "command",
      "cmd": "quality-review",
      "args": "{phase}",
      "next": "check_review"
    },
    "check_review": {
      "type": "decision",
      "eval": "ctx.result.review_verdict",
      "edges": [
        { "value": "BLOCK", "target": "fix_plan" },
        { "default": true,  "target": "test" }
      ]
    },

    "test": {
      "type": "command",
      "cmd": "quality-test",
      "args": "{phase}",
      "auto_flag": "--auto-fix",
      "next": "check_test"
    },
    "check_test": {
      "type": "decision",
      "eval": "ctx.result.uat_status",
      "edges": [
        { "value": "passed", "target": "transition" },
        { "default": true,   "target": "debug" }
      ]
    },

    "debug": {
      "type": "command",
      "cmd": "quality-debug",
      "args": "--from-uat {phase}",
      "next": "fix_execute",
      "max_visits": 2
    },

    "transition": {
      "type": "command",
      "cmd": "maestro-phase-transition",
      "next": "done"
    },
    "done": {
      "type": "terminal",
      "status": "success"
    }
  }
}
```

### 7.3 singles/plan.json (单步命令图)

```jsonc
{
  "id": "singles/plan",
  "name": "Plan",
  "version": "1.0.0",
  "entry": "plan",
  "inputs": {
    "phase": { "type": "string", "required": true }
  },
  "nodes": {
    "plan": {
      "type": "command",
      "cmd": "maestro-plan",
      "args": "{phase}",
      "auto_flag": "--auto",
      "next": "done",
      "analyze": false
    },
    "done": {
      "type": "terminal",
      "status": "success"
    }
  }
}
```

---

## 8. Dual-Endpoint Binding (CLI + Dashboard)

### 8.1 Problem

当前存在两个独立的执行路径，逻辑重复：

```
CLI 路径:
  maestro cli -p "..." --tool claude --mode write
    → CliAgentRunner.run()
      → assemblePrompt()        ← CLI 独有的 prompt 组装
      → createAdapter()         ← 动态加载 adapter
      → adapter.spawn()
      → adapter.onEntry()       ← 同步等待完成

Dashboard 路径:
  coordinate:start (WebSocket)
    → WorkflowCoordinator.start()
      → buildStepPrompt()       ← Dashboard 独有的 prompt 组装
      → agentManager.spawn()    ← AgentManager 管理
      → agent:stopped event     ← 事件驱动
```

**两套 prompt 组装 + 两套 agent 交互 = 维护地狱**

### 8.2 Solution: Shared Core, Pluggable Executor

Walker 引擎是纯状态机，通过 `CommandExecutor` 接口与外部通信。CLI 和 Dashboard 各实现一个 Executor：

```
┌─────────────────────────────────────────────────────┐
│                    graph-walker.ts                    │
│                   (pure state machine)                │
│                                                       │
│  walk(state, graph) {                                │
│    ...                                                │
│    case 'command':                                    │
│      result = await executor.execute(request)  ◄──┐  │
│    ...                                            │  │
│  }                                                │  │
└───────────────────────────────────────────────────┘  │
                                                    │  │
           ┌────────────────────────────────────────┘  │
           │  CommandExecutor interface                 │
           │                                           │
    ┌──────┴──────┐                    ┌───────┴───────┐
    │ CliExecutor  │                    │ DashExecutor  │
    │              │                    │               │
    │ CliAgentRunner                    │ AgentManager  │
    │ + CliHistory │                    │ + EventBus    │
    │ sync wait    │                    │ event-driven  │
    └──────────────┘                    └───────────────┘
```

### 8.3 CommandExecutor Interface

```typescript
/** Walker 向 Executor 发出的执行请求 */
interface ExecuteRequest {
  /** 组装好的最终 prompt（由 PromptAssembler 生成） */
  prompt: string;

  /** Agent 类型 */
  agent_type: AgentType;

  /** 工作目录 */
  work_dir: string;

  /** 审批模式 */
  approval_mode: 'suggest' | 'auto';

  /** 超时 ms */
  timeout_ms: number;

  /** 节点元数据（用于日志/事件） */
  node_id: string;
  cmd: string;
}

/** Executor 返回的执行结果 */
interface ExecuteResult {
  /** 是否成功 */
  success: boolean;

  /** Agent 原始输出（完整文本） */
  raw_output: string;

  /** 执行 ID (MAESTRO_EXEC_ID) */
  exec_id: string;

  /** 执行耗时 ms */
  duration_ms: number;

  /** Agent 进程 ID（Dashboard 用于关联事件） */
  process_id?: string;
}

/** Walker 用来执行命令的抽象接口 */
interface CommandExecutor {
  /** 执行命令并等待完成 */
  execute(request: ExecuteRequest): Promise<ExecuteResult>;

  /** 中止当前执行 */
  abort(): Promise<void>;
}
```

### 8.4 CliExecutor (for `maestro coordinate`)

```typescript
// src/coordinator/cli-executor.ts
// 复用现有 CliAgentRunner 的 adapter 工厂

class CliExecutor implements CommandExecutor {
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const adapter = await createAdapter(req.agent_type);
    const process = await adapter.spawn({
      type: req.agent_type,
      prompt: req.prompt,
      workDir: req.work_dir,
      approvalMode: req.approval_mode,
    });

    // 同步等待完成（CLI 是阻塞式）
    const output = await this.waitForCompletion(adapter, process.id, req.timeout_ms);

    return {
      success: !output.hasError,
      raw_output: output.text,
      exec_id: output.execId,
      duration_ms: output.durationMs,
    };
  }
}
```

### 8.5 DashboardExecutor (for Dashboard WebSocket)

```typescript
// dashboard/src/server/coordinator/dashboard-executor.ts
// 复用现有 AgentManager

class DashboardExecutor implements CommandExecutor {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly eventBus: DashboardEventBus,
  ) {}

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const process = await this.agentManager.spawn(req.agent_type, {
      type: req.agent_type,
      prompt: req.prompt,
      workDir: req.work_dir,
      approvalMode: req.approval_mode,
    });

    // 事件驱动等待（Dashboard 是异步的）
    const output = await new Promise<RawOutput>((resolve) => {
      const handler = (event: SSEEvent) => {
        const payload = event.data as AgentStoppedPayload;
        if (payload.processId === process.id) {
          this.eventBus.off('agent:stopped', handler);
          resolve(this.extractOutput(process.id));
        }
      };
      this.eventBus.on('agent:stopped', handler);
    });

    return {
      success: !output.hasError,
      raw_output: output.text,
      exec_id: process.id,
      duration_ms: output.durationMs,
      process_id: process.id,
    };
  }
}
```

### 8.6 新的 `maestro coordinate` CLI 命令

注册到 `src/cli.ts`，与 `maestro cli` 平级：

```typescript
// src/commands/coordinate.ts

export function registerCoordinateCommand(program: Command): void {
  program
    .command('coordinate [intent]')
    .alias('coord')
    .description('Graph-based autonomous workflow coordinator')
    .option('-y, --yes', 'Auto mode')
    .option('-c, --continue [sessionId]', 'Resume session')
    .option('--chain <name>', 'Force graph')
    .option('--tool <tool>', 'Agent tool', 'claude')
    .option('--dry-run', 'Show graph traversal plan')
    .action(async (intent, opts) => {
      const chainsRoot = resolve(homedir(), '.maestro', 'chains');
      const workflowRoot = process.cwd();

      // 核心组件
      const loader = new GraphLoader(chainsRoot);
      const router = new IntentRouter(loader);
      const assembler = new PromptAssembler(workflowRoot);
      const executor = new CliExecutor();

      const walker = new GraphWalker(loader, assembler, executor);

      if (opts.continue) {
        await walker.resume(opts.continue === true ? undefined : opts.continue);
      } else {
        const graphId = router.resolve(intent, opts.chain);
        await walker.start(graphId, intent, {
          tool: opts.tool,
          autoMode: opts.yes,
          dryRun: opts.dryRun,
          workflowRoot,
        });
      }
    });
}
```

### 8.7 Module Layout (Shared Core)

```
src/coordinator/                     # ← 新目录，共享核心
  ├── graph-types.ts                 # 纯类型
  ├── graph-loader.ts                # 加载 ~/.maestro/chains/*.json
  ├── graph-walker.ts                # 核心状态机（不依赖 CLI 或 Dashboard）
  ├── prompt-assembler.ts            # Prompt 组装管线
  ├── expr-evaluator.ts              # 表达式引擎
  ├── intent-router.ts               # Intent → Graph ID
  ├── output-parser.ts               # 解析 COORDINATE RESULT + extract 规则
  ├── cli-executor.ts                # CLI 端的 CommandExecutor
  └── __tests__/

dashboard/src/server/coordinator/    # Dashboard 端
  ├── dashboard-executor.ts          # Dashboard 端的 CommandExecutor
  ├── workflow-coordinator.ts        # 改为 thin wrapper over GraphWalker
  └── ...（其余不变）
```

**关键设计**：`graph-walker.ts` 在 `src/coordinator/` 下，CLI 和 Dashboard 都依赖它。Walker 通过构造函数注入 `CommandExecutor`，不感知执行环境。

---

## 9. Prompt Assembly Pipeline

### 9.1 Problem

当前 prompt 组装散落在多处，逻辑不同：

| 位置 | 做了什么 | 问题 |
|------|----------|------|
| `coordinate-step.txt` 模板 | 简单占位符替换 | 无法传递上步结果的结构化数据 |
| `WorkflowCoordinator.buildStepPrompt` | 注入 previousHints + snapshot | Dashboard 独有，CLI 没有 |
| `CliAgentRunner.assemblePrompt` | protocol + prompt + rule | 与 coordinate 无关，只服务 `maestro cli` |
| workflow `maestro-coordinate.md` Step 6b | 手动拼接 analysis hints | Claude Code 命令端的逻辑，与 TS 实现不同 |

**需求**：统一的 `PromptAssembler`，在每个 command 节点执行前，将图节点定义 + walker context + 上步结果组装为最终 prompt。

### 9.2 Assembly Pipeline

```
 CommandNode                  WalkerContext
     │                             │
     ▼                             ▼
┌─────────────────────────────────────────┐
│            PromptAssembler               │
│                                          │
│  Phase 1: Resolve Args                   │
│    {phase} → "3"                         │
│    {description} → "implement auth"      │
│    {var.xxx} → context.var.xxx           │
│                                          │
│  Phase 2: Build Command Block            │
│    /{cmd} {resolved_args} {auto_flag}    │
│                                          │
│  Phase 3: Inject Previous Context        │
│    ← result (上步 COORDINATE RESULT)     │
│    ← analysis.next_step_hints            │
│    ← analysis.cautions                   │
│    ← analysis.context_to_carry           │
│                                          │
│  Phase 4: Inject State Snapshot          │
│    ← project.phase_status                │
│    ← project.artifacts                   │
│    ← project.execution progress          │
│                                          │
│  Phase 5: Apply Template                 │
│    Load coordinate-step-v2.md            │
│    Fill all sections                     │
│                                          │
│  Phase 6: Auto Directive                 │
│    "Auto-confirm all prompts..."         │
│                                          │
└─────────────────────────────────────────┘
                    │
                    ▼
             Final Prompt (string)
                    │
                    ▼
            CommandExecutor.execute()
```

### 9.3 PromptAssembler Interface

```typescript
// src/coordinator/prompt-assembler.ts

interface PromptAssembler {
  /**
   * 为一个 command 节点组装最终 prompt。
   * Walker 在每次执行 command 前调用此方法。
   */
  assemble(request: AssembleRequest): Promise<string>;
}

interface AssembleRequest {
  /** 当前 command 节点定义 */
  node: CommandNode;

  /** Walker 的完整上下文（包含上步结果、分析、变量等） */
  context: WalkerContext;

  /** 图元数据 */
  graph: { id: string; name: string };

  /** 当前是图中第几个 command（用于 step N/M 显示） */
  command_index: number;
  command_total: number;

  /** 是否 auto 模式 */
  auto_mode: boolean;

  /** 执行历史中最近的 command 节点（用于"上一步"引用） */
  previous_command?: {
    node_id: string;
    cmd: string;
    outcome: 'success' | 'failure';
    summary?: string;
  };
}
```

### 9.4 PromptAssembler Implementation

```typescript
class DefaultPromptAssembler implements PromptAssembler {
  constructor(
    private readonly workflowRoot: string,
    private readonly templateDir: string,  // ~/.maestro/templates/cli/prompts/
  ) {}

  async assemble(req: AssembleRequest): Promise<string> {
    const { node, context, graph, auto_mode } = req;

    // ── Phase 1: Resolve args ──
    const args = this.resolveArgs(node.args ?? '', context);
    const autoFlag = auto_mode ? (node.auto_flag ?? '') : '';
    const fullArgs = [args, autoFlag].filter(Boolean).join(' ');

    // ── Phase 2: Build command block ──
    const commandLine = `/${node.cmd} ${fullArgs}`.trim();

    // ── Phase 3: Build previous context section ──
    const previousContext = this.buildPreviousContext(context, req.previous_command);

    // ── Phase 4: Build state snapshot section ──
    const stateSnapshot = this.buildStateSnapshot(context);

    // ── Phase 5: Apply template ──
    const template = await this.loadTemplate('coordinate-step-v2');
    const prompt = this.render(template, {
      COMMAND: commandLine,
      STEP_N: `${req.command_index + 1}/${req.command_total}`,
      GRAPH_NAME: graph.name,
      GRAPH_ID: graph.id,
      NODE_ID: node.cmd,
      PREVIOUS_CONTEXT: previousContext,
      STATE_SNAPSHOT: stateSnapshot,
      AUTO_DIRECTIVE: auto_mode
        ? 'Auto-confirm all prompts. No interactive questions. Skip clarifications.'
        : '',
      INTENT: context.inputs['description'] as string ?? '',
    });

    return prompt;
  }

  // ── Phase 1 detail ──

  private resolveArgs(template: string, ctx: WalkerContext): string {
    return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (_, path: string) => {
      // {phase} → ctx.inputs.phase
      // {description} → ctx.inputs.description
      // {var.xxx} → ctx.var.xxx
      // {scratch_dir} → ctx.var.scratch_dir
      if (path.startsWith('var.')) {
        return String(this.resolvePath(ctx.var, path.slice(4)) ?? '');
      }
      return String(ctx.inputs[path] ?? this.resolvePath(ctx.var, path) ?? '');
    });
  }

  // ── Phase 3 detail ──

  private buildPreviousContext(
    ctx: WalkerContext,
    prev?: AssembleRequest['previous_command'],
  ): string {
    const sections: string[] = [];

    // 3a: Previous step result summary
    if (prev) {
      sections.push(
        `### Previous Step: ${prev.cmd} (${prev.outcome})`,
        prev.summary ?? '(no summary)',
      );
    }

    // 3b: Structured result from COORDINATE RESULT block
    if (ctx.result) {
      const r = ctx.result;
      const parts: string[] = [];
      if (r.status) parts.push(`Status: ${r.status}`);
      if (r.phase) parts.push(`Phase: ${r.phase}`);
      if (r.artifacts) parts.push(`Artifacts: ${r.artifacts}`);
      if (r.summary) parts.push(`Summary: ${r.summary}`);
      if (parts.length) {
        sections.push('### Previous Result', parts.join('\n'));
      }
    }

    // 3c: Analysis hints (from gemini step analysis)
    if (ctx.analysis) {
      const a = ctx.analysis;
      const hints: string[] = [];

      if (a.next_step_hints) {
        const h = a.next_step_hints as Record<string, unknown>;
        if (h.prompt_additions) hints.push(String(h.prompt_additions));
        if (Array.isArray(h.cautions) && h.cautions.length) {
          hints.push('**Cautions:** ' + h.cautions.join('; '));
        }
        if (h.context_to_carry) {
          hints.push('**Context from prior step:** ' + String(h.context_to_carry));
        }
      }

      if (hints.length) {
        sections.push('### Analysis Hints', hints.join('\n'));
      }

      if (typeof a.quality_score === 'number') {
        sections.push(`Previous step quality: ${a.quality_score}/100`);
      }
    }

    return sections.length > 0
      ? sections.join('\n\n')
      : '';
  }

  // ── Phase 4 detail ──

  private buildStateSnapshot(ctx: WalkerContext): string {
    const p = ctx.project;
    if (!p.initialized) return 'Project not initialized.';

    const lines = [
      `Phase ${p.current_phase ?? '?'} | Status: ${p.phase_status}`,
      `Progress: ${p.phases_completed}/${p.phases_total} phases`,
    ];

    if (p.execution.tasks_total > 0) {
      lines.push(`Tasks: ${p.execution.tasks_completed}/${p.execution.tasks_total}`);
    }
    if (p.verification_status !== 'pending') {
      lines.push(`Verification: ${p.verification_status}`);
    }
    if (p.review_verdict) {
      lines.push(`Review: ${p.review_verdict}`);
    }
    if (p.uat_status !== 'pending') {
      lines.push(`UAT: ${p.uat_status}`);
    }

    // Artifacts available
    const available = Object.entries(p.artifacts)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (available.length) {
      lines.push(`Artifacts: ${available.join(', ')}`);
    }

    return lines.join('\n');
  }
}
```

### 9.5 New Template: coordinate-step-v2.md

替代当前的 `coordinate-step.txt`，结构更丰富：

```markdown
# Coordinate Step {{STEP_N}} — {{GRAPH_NAME}}

## Command
{{COMMAND}}

{{#AUTO_DIRECTIVE}}
**Mode:** {{AUTO_DIRECTIVE}}
{{/AUTO_DIRECTIVE}}

{{#PREVIOUS_CONTEXT}}
## Context from Previous Step
{{PREVIOUS_CONTEXT}}
{{/PREVIOUS_CONTEXT}}

{{#STATE_SNAPSHOT}}
## Current State
{{STATE_SNAPSHOT}}
{{/STATE_SNAPSHOT}}

{{#INTENT}}
## Original Intent
{{INTENT}}
{{/INTENT}}

## Return Format

Output MUST end with this exact block:

\```
--- COORDINATE RESULT ---
STATUS: <SUCCESS or FAILURE>
PHASE: <number, or "none">
VERIFICATION_STATUS: <passed or failed or pending, if applicable>
REVIEW_VERDICT: <PASS or WARN or BLOCK, if applicable>
UAT_STATUS: <passed or failed or pending, if applicable>
ARTIFACTS: <comma-separated file paths, or "none">
SUMMARY: <one-line what was accomplished>
\```

Rules:
- Execute the command as-is — it is a maestro slash command with arguments
- Do not modify files outside the command's intended scope
- Fill all applicable status fields in the result block
- PHASE must reflect the phase number referenced during execution
```

### 9.6 Data Flow: Step N → Step N+1

完整的步骤间数据流：

```
Step N (e.g., maestro-verify)
  │
  │ Agent completes
  ▼
┌──────────────────────────────────────┐
│ OutputParser                          │
│                                       │
│ 1. Parse COORDINATE RESULT block      │
│    → { status, phase, verification_   │
│        status, review_verdict, ... }  │
│                                       │
│ 2. Apply extract rules (from node)    │
│    → update ctx.inputs / ctx.var      │
│                                       │
│ 3. Store raw output to file           │
│    → outputs/{node_id}.txt            │
└──────────────────────────────────────┘
  │
  │ ctx.result = parsed structured data
  ▼
┌──────────────────────────────────────┐
│ StepAnalyzer (optional gemini)        │
│                                       │
│ 1. Send output + context to gemini    │
│ 2. Parse quality_score, issues,       │
│    next_step_hints                    │
│ 3. Store to outputs/{node_id}.json    │
└──────────────────────────────────────┘
  │
  │ ctx.analysis = { quality_score,
  │   next_step_hints: {
  │     prompt_additions: "...",
  │     cautions: [...],
  │     context_to_carry: "..."
  │   }
  │ }
  ▼
┌──────────────────────────────────────┐
│ Decision Node (e.g., check_verify)    │
│                                       │
│ eval: ctx.result.verification_status  │
│ → "passed" → target: "review"         │
└──────────────────────────────────────┘
  │
  ▼
Step N+1 (e.g., quality-review)
  │
  ▼
┌──────────────────────────────────────┐
│ PromptAssembler                       │
│                                       │
│ Phase 1: Resolve args                 │
│   "{phase}" → "3"                     │
│                                       │
│ Phase 3: Inject previous context      │
│   ← ctx.result (verify passed)        │
│   ← ctx.analysis.next_step_hints      │
│     "Focus on edge cases in auth      │
│      module, verification passed but   │
│      coverage was only 72%"            │
│   ← ctx.analysis.cautions             │
│     ["Low test coverage on error       │
│      paths", "No integration tests"]   │
│                                       │
│ Phase 4: Inject state snapshot        │
│   "Phase 3 | verifying | 2/5 phases"  │
│                                       │
│ Phase 5: Apply template               │
│   coordinate-step-v2.md filled        │
└──────────────────────────────────────┘
  │
  ▼
Final prompt sent to review agent:

  ┌──────────────────────────────────────────────────────────┐
  │ # Coordinate Step 4/6 — Full Life..                      │
  │                                                          │
  │ ## Command                                               │
  │ /maestro-ralph --engine swarm --script wf-review 3       │
  │                                                          │
  │ **Mode:** Auto-confirm all prompts                       │
  │                                                          │
  │ ## Context from Previous Step                            │
  │ ### Previous Step: maestro-verify (retired in v0.5.51)   │
  │ Status: SUCCESS                                          │
  │ Verification: passed                                     │
  │                                                          │
  │ ### Analysis Hints                  │
  │ Focus on edge cases in auth module  │
  │ **Cautions:** Low test coverage...  │
  │ **Context:** Verification passed    │
  │ but coverage was only 72%           │
  │ Previous step quality: 78/100       │
  │                                     │
  │ ## Current State                    │
  │ Phase 3 | Status: verifying         │
  │ Progress: 2/5 phases                │
  │ Verification: passed                │
  │                                     │
  │ ## Return Format                    │
  │ ...                                 │
  └─────────────────────────────────────┘
```

### 9.7 Walker 调用 Assembler 的位置

在 Walker 主循环的 `command` 分支中：

```typescript
// graph-walker.ts — command 节点处理

case 'command': {
  // 找到上一个 command 历史
  const prevCmd = this.findPreviousCommandInHistory(state);

  // 组装 prompt
  const prompt = await this.assembler.assemble({
    node,
    context: state.context,
    graph: { id: state.graph_id, name: graph.name },
    command_index: this.countCommandsBefore(state, node_id),
    command_total: this.countCommandNodes(graph),
    auto_mode: state.auto_mode,
    previous_command: prevCmd,
  });

  // 执行
  state.status = 'waiting_command';
  this.save(state);

  const result = await this.executor.execute({
    prompt,
    agent_type: resolveAgentType(state.tool),
    work_dir: state.context.inputs['work_dir'] as string ?? process.cwd(),
    approval_mode: state.auto_mode ? 'auto' : 'suggest',
    timeout_ms: node.timeout_ms ?? graph.defaults?.timeout_ms ?? 600_000,
    node_id,
    cmd: node.cmd,
  });

  // 解析输出 → 更新 context
  const parsed = this.outputParser.parse(result.raw_output, node);
  state.context.result = parsed.structured;

  // 可选 gemini 分析
  if (node.analyze !== false && this.countCommandNodes(graph) > 1) {
    state.context.analysis = await this.stepAnalyzer.analyze(
      node, result.raw_output, state.context, prevCmd,
    );
  } else {
    state.context.analysis = null;
  }

  // 更新历史
  const entry = state.history[state.history.length - 1];
  entry.exited_at = new Date().toISOString();
  entry.outcome = result.success ? 'success' : 'failure';
  entry.exec_id = result.exec_id;
  entry.quality_score = (state.context.analysis as any)?.quality_score;
  entry.summary = parsed.structured?.summary as string;

  // 状态转移
  if (result.success) {
    state.current_node = node.next;
    state.status = 'running';
  } else {
    state.current_node = node.on_failure ?? '_fail';
    state.status = node.on_failure ? 'running' : 'failed';
  }
  break;
}
```

### 9.8 COORDINATE RESULT Block 扩展

当前的 RESULT block 只有 4 个字段，信息不足以支撑 decision 节点。扩展为：

```
--- COORDINATE RESULT ---
STATUS: SUCCESS
PHASE: 3
VERIFICATION_STATUS: passed
REVIEW_VERDICT: PASS
UAT_STATUS: pending
ARTIFACTS: .workflow/phases/03-auth/verification.json, .workflow/phases/03-auth/review.json
SUMMARY: Verification passed with 85% convergence, all critical criteria met
```

OutputParser 解析规则：

```typescript
interface ParsedResult {
  structured: {
    status: 'SUCCESS' | 'FAILURE';
    phase: string | null;
    verification_status: string | null;
    review_verdict: string | null;
    uat_status: string | null;
    artifacts: string[];
    summary: string;
    // extract 规则追加的字段
    [key: string]: unknown;
  };
}
```

Decision 节点直接引用这些字段：

```jsonc
{
  "type": "decision",
  "eval": "ctx.result.verification_status",  // ← 直接用
  "edges": [
    { "value": "passed", "target": "review" },
    { "default": true,   "target": "fix_loop" }
  ]
}
```

---

## 10. Walker State Machine (Runtime)

### 10.1 WalkerState

```typescript
interface WalkerState {
  /** Session identifier */
  session_id: string;

  /** Graph being executed */
  graph_id: string;

  /** Current node ID */
  current_node: string;

  /** Walker status */
  status: 'running' | 'waiting_command' | 'waiting_gate' | 'waiting_fork'
        | 'paused' | 'completed' | 'failed';

  /** Shared context — all nodes read/write this */
  context: WalkerContext;

  /** Ordered execution history */
  history: HistoryEntry[];

  /** Parallel branch tracking (for fork/join) */
  fork_state: Record<string, ForkBranchState> | null;

  /** Delegate stack (for graph-to-graph delegation) */
  delegate_stack: DelegateFrame[];

  /** Session metadata */
  created_at: string;
  updated_at: string;
  tool: string;
  auto_mode: boolean;
  intent: string;
}

interface WalkerContext {
  /** Graph input parameters (resolved) */
  inputs: Record<string, unknown>;

  /** Snapshot of .workflow/state.json (read at session start) */
  project: {
    initialized: boolean;
    current_phase: number | null;
    phase_status: string;
    artifacts: Record<string, boolean>;
    execution: { tasks_completed: number; tasks_total: number };
    verification_status: string;
    review_verdict: string | null;
    uat_status: string;
    phases_total: number;
    phases_completed: number;
    accumulated_context: unknown | null;
  };

  /** Last command node's structured result */
  result: Record<string, unknown> | null;

  /** Last gemini analysis result */
  analysis: Record<string, unknown> | null;

  /** Per-node visit counter */
  visits: Record<string, number>;

  /** User-defined variables (set by eval nodes) */
  var: Record<string, unknown>;
}

interface HistoryEntry {
  node_id: string;
  node_type: string;
  entered_at: string;
  exited_at?: string;
  outcome?: 'success' | 'failure' | 'skipped';
  exec_id?: string;         // command 节点的 maestro exec ID
  quality_score?: number;   // gemini 分析分数
  summary?: string;
}

interface ForkBranchState {
  branches: Record<string, 'pending' | 'running' | 'completed' | 'failed'>;
  join_node: string;
  results: Record<string, unknown>;
}

interface DelegateFrame {
  parent_graph_id: string;
  parent_node_id: string;
  return_inputs: Record<string, unknown>;
}
```

### 10.2 Walker Algorithm (Pseudocode)

```
function walk(state: WalkerState, graph: ChainGraph):
  while state.status == 'running':
    node = graph.nodes[state.current_node]
    node_id = state.current_node

    // ── Visit count guard ──
    max = node.max_visits ?? graph.defaults?.max_visits ?? Infinity
    if (state.context.visits[node_id] ?? 0) >= max:
      log("max_visits reached for " + node_id)
      if node.type == 'command' && node.on_failure:
        state.current_node = node.on_failure
      else:
        state.current_node = '_fail'  // implicit terminal
        state.status = 'failed'
      continue

    // ── Record visit ──
    state.context.visits[node_id] = (state.context.visits[node_id] ?? 0) + 1
    state.history.push({ node_id, node_type: node.type, entered_at: now() })

    // ── Dispatch by type ──
    switch node.type:

      case 'command':
        state.status = 'waiting_command'
        save(state)
        result = await executeCommand(node, state)
        //   → spawn agent, wait for agent:stopped callback
        //   → parse output, run extract rules
        //   → optionally run gemini analysis
        state.context.result = result.structured
        state.context.analysis = result.analysis
        last_history().outcome = result.success ? 'success' : 'failure'
        last_history().exec_id = result.exec_id
        last_history().quality_score = result.analysis?.quality_score

        if result.success:
          state.current_node = node.next
          state.status = 'running'
        else:
          state.current_node = node.on_failure ?? '_fail'
          state.status = node.on_failure ? 'running' : 'failed'

      case 'decision':
        target = evaluateDecision(node, state.context)
        if !target:
          state.status = 'failed'  // no edge matched, no default
          break
        last_history().outcome = 'success'
        last_history().summary = "→ " + target
        state.current_node = target
        // status stays 'running' — no async work

      case 'gate':
        passed = evaluateExpr(node.condition, state.context)
        if passed:
          state.current_node = node.on_pass
          last_history().outcome = 'success'
        else if node.wait:
          state.status = 'waiting_gate'
          last_history().summary = node.wait_message
          save(state)
          return  // 暂停，外部恢复时重新进入
        else:
          state.current_node = node.on_fail
          last_history().outcome = 'skipped'

      case 'eval':
        for [key, expr] in node.set:
          setContextValue(state.context, key, evaluateExpr(expr, state.context))
        state.current_node = node.next
        last_history().outcome = 'success'

      case 'fork':
        state.fork_state[node_id] = {
          branches: Object.fromEntries(node.branches.map(b => [b, 'pending'])),
          join_node: node.join,
          results: {}
        }
        state.status = 'waiting_fork'
        save(state)
        // launch all branches in parallel
        for branch_id in node.branches:
          launchBranch(state, graph, branch_id, node_id)
        return  // 等待所有分支完成

      case 'join':
        // fork handler 会在所有分支完成后跳到这里
        mergeResults(node, state)
        state.current_node = node.next
        last_history().outcome = 'success'

      case 'terminal':
        if node.status == 'delegate' && node.delegate_graph:
          // Push current frame, load new graph
          state.delegate_stack.push({
            parent_graph_id: graph.id,
            parent_node_id: node_id,
            return_inputs: { ...state.context.inputs }
          })
          newGraph = loadGraph(node.delegate_graph)
          // Merge delegate_inputs
          if node.delegate_inputs:
            for [k, v] in node.delegate_inputs:
              state.context.inputs[k] = resolveTemplate(v, state.context)
          state.current_node = node.entry_override
            ?? state.context.inputs['entry_override']
            ?? newGraph.entry
          graph = newGraph  // switch active graph
          state.graph_id = newGraph.id
          // status stays 'running'
        else:
          state.status = node.status == 'success' ? 'completed' : 'failed'
          last_history().outcome = node.status == 'success' ? 'success' : 'failure'
          last_history().summary = resolveTemplate(node.summary, state.context)

    save(state)
    emit('coordinate:walker', { state })
```

### 10.3 Command Execution Detail

详见 Section 9.7 — Walker 调用 `PromptAssembler.assemble()` → `CommandExecutor.execute()` → `OutputParser.parse()` → 可选 `StepAnalyzer.analyze()` 的完整流程。

---

## 11. Expression Evaluator

轻量级表达式引擎，不需要完整的 JS eval：

```typescript
// 支持的语法:
//   ctx.result.status          → 属性访问
//   ctx.visits.verify          → 访问次数
//   "passed"                   → 字符串字面量
//   42                         → 数字字面量
//   true / false / null        → 布尔/空
//   a == b, a != b             → 相等比较
//   a > b, a >= b, a < b, a <= b  → 数值比较
//   a && b, a || b             → 逻辑运算
//   !a                         → 逻辑非

interface ExprEvaluator {
  /** 取值：解析路径表达式，返回 context 中的值 */
  resolve(expr: string, ctx: WalkerContext): unknown;

  /** 求值：解析条件表达式，返回布尔值 */
  evaluate(expr: string, ctx: WalkerContext): boolean;

  /** 匹配：用于 decision edges */
  match(edge: DecisionEdge, resolvedValue: unknown, ctx: WalkerContext): boolean;
}
```

**实现策略**：用简单的 tokenizer + recursive descent parser，不用 `eval()`。支持的操作符固定，安全可控。

**Context 路径解析**：
```
ctx.result.verification_status
 → state.context.result?.verification_status

ctx.project.phase_status
 → state.context.project.phase_status

ctx.visits.verify
 → state.context.visits['verify'] ?? 0

ctx.var.retry_count
 → state.context.var.retry_count

ctx.inputs.phase
 → state.context.inputs.phase
```

---

## 12. Event System

Walker 在每次状态变化时发送事件：

```typescript
// 事件类型
type CoordinateEvent =
  | { type: 'walker:started';    session_id: string; graph_id: string; intent: string }
  | { type: 'walker:node_enter'; session_id: string; node_id: string; node_type: string }
  | { type: 'walker:node_exit';  session_id: string; node_id: string; outcome: string }
  | { type: 'walker:decision';   session_id: string; node_id: string; resolved_value: unknown; target: string }
  | { type: 'walker:command';    session_id: string; node_id: string; cmd: string; status: 'spawned' | 'completed' | 'failed' }
  | { type: 'walker:delegate';   session_id: string; from_graph: string; to_graph: string }
  | { type: 'walker:completed';  session_id: string; status: 'success' | 'failure'; history_summary: string[] }
  | { type: 'walker:error';      session_id: string; error: string }
```

事件同时：
1. 写入 `events.ndjson`（持久化）
2. 通过 `eventBus.emit()` 推送给 Dashboard WebSocket

---

## 13. TypeScript Module Structure

详见 Section 8.7。核心布局：

```
src/coordinator/                       # 共享核心（CLI + Dashboard 都依赖）
  ├── graph-types.ts                   # 纯类型：ChainGraph, nodes, WalkerState, interfaces
  ├── graph-loader.ts                  # 加载/验证 ~/.maestro/chains/*.json
  ├── graph-walker.ts                  # Walker 状态机（不依赖执行环境）
  ├── prompt-assembler.ts              # Prompt 组装管线（Section 9）
  ├── output-parser.ts                 # 解析 COORDINATE RESULT + extract 规则
  ├── step-analyzer.ts                 # 可选的 gemini 步后分析
  ├── expr-evaluator.ts                # 表达式解析 & 求值
  ├── intent-router.ts                 # Intent → Graph ID（加载 _intent-map.json）
  ├── cli-executor.ts                  # CLI 端 CommandExecutor（同步等待）
  └── __tests__/

src/commands/coordinate.ts             # `maestro coordinate` CLI 命令注册

dashboard/src/server/coordinator/
  ├── dashboard-executor.ts            # Dashboard 端 CommandExecutor（事件驱动）
  ├── workflow-coordinator.ts          # Thin wrapper → GraphWalker + DashboardExecutor
  ├── chain-map.ts                     # [DEPRECATED] 迁移期保留
  └── ...
```

### 13.1 Module Responsibilities

| Module | Responsibility | Depends On |
|--------|---------------|------------|
| `graph-types.ts` | 纯类型，零运行时 | None |
| `graph-loader.ts` | 读 JSON，schema 校验，缓存 | `graph-types` |
| `expr-evaluator.ts` | 表达式 tokenize + evaluate | `graph-types` |
| `intent-router.ts` | 加载 `_intent-map.json`，intent → graph ID | `graph-loader` |
| `output-parser.ts` | 解析 COORDINATE RESULT block + extract 规则 | `graph-types` |
| `prompt-assembler.ts` | 6 阶段 prompt 组装管线 | `graph-types` |
| `step-analyzer.ts` | Gemini 步后分析 | `graph-types`, executor |
| `graph-walker.ts` | 核心 walk 循环，注入 assembler + executor | All above |
| `cli-executor.ts` | `CliAgentRunner` 的 adapter 工厂 | `CliAgentRunner` |
| `dashboard-executor.ts` | `AgentManager` 的事件驱动等待 | `AgentManager`, `EventBus` |

### 13.2 GraphWalker Constructor (依赖注入)

```typescript
export class GraphWalker {
  constructor(
    private readonly loader: GraphLoader,
    private readonly assembler: PromptAssembler,
    private readonly executor: CommandExecutor,
    private readonly analyzer: StepAnalyzer | null,  // null = skip analysis
    private readonly outputParser: OutputParser,
    private readonly evaluator: ExprEvaluator,
    private readonly emitter?: WalkerEventEmitter,   // optional event emission
  ) {}

  async walk(state: WalkerState, graph: ChainGraph): Promise<void> { ... }
  runSync(state: WalkerState, graph: ChainGraph): string { ... }  // for _router
  async resume(state: WalkerState): Promise<void> { ... }
}
```

### 13.3 CLI vs Dashboard Wiring

**CLI (`maestro coordinate`)**:

```typescript
const loader     = new GraphLoader(chainsRoot);
const evaluator  = new ExprEvaluator();
const parser     = new OutputParser();
const assembler  = new DefaultPromptAssembler(workflowRoot, templateDir);
const executor   = new CliExecutor();
const analyzer   = new GeminiStepAnalyzer(executor);  // reuse same executor

const walker = new GraphWalker(loader, assembler, executor, analyzer, parser, evaluator);
```

**Dashboard (`WorkflowCoordinator`)**:

```typescript
const loader     = new GraphLoader(chainsRoot);
const evaluator  = new ExprEvaluator();
const parser     = new OutputParser();
const assembler  = new DefaultPromptAssembler(workflowRoot, templateDir);
const executor   = new DashboardExecutor(agentManager, eventBus);
const analyzer   = new GeminiStepAnalyzer(executor);

const walker = new GraphWalker(loader, assembler, executor, analyzer, parser, evaluator, eventBus);
```

唯一的差异是 `executor` 实例 — Walker 完全不感知执行环境。

---

## 14. Migration Plan

### Phase 1: Shared Core Foundation

- [ ] Create `src/coordinator/` directory
- [ ] Create `graph-types.ts` — all interfaces (ChainGraph, nodes, WalkerState, CommandExecutor, PromptAssembler)
- [ ] Create `chain-graph.schema.json` in `~/.maestro/chains/`
- [ ] Create `expr-evaluator.ts` with tests
- [ ] Create `output-parser.ts` — parse COORDINATE RESULT block + extract rules
- [ ] Create `graph-loader.ts` — JSON loading + validation + cache
- [ ] Convert existing `CHAIN_MAP` entries to `~/.maestro/chains/*.json` graph files

### Phase 2: Prompt Assembly + Executor Interface

- [ ] Create `prompt-assembler.ts` — 6-phase assembly pipeline (Section 9)
- [ ] Create `coordinate-step-v2.md` template (replace `coordinate-step.txt`)
- [ ] Create `cli-executor.ts` — extract from `CliAgentRunner`, implement `CommandExecutor`
- [ ] Create `dashboard-executor.ts` — extract from `WorkflowCoordinator.executeStep`, implement `CommandExecutor`
- [ ] Create `step-analyzer.ts` — gemini analysis via executor

### Phase 3: Walker Engine

- [ ] Create `graph-walker.ts` — core walk loop with DI (assembler, executor, parser, evaluator)
- [ ] Create `intent-router.ts` + `_intent-map.json`
- [ ] Write walker tests with mock graph + mock executor
- [ ] Test prompt assembly: verify step N output flows into step N+1 prompt

### Phase 4: Dual Endpoint Integration

- [ ] Create `src/commands/coordinate.ts` — `maestro coordinate` CLI command
- [ ] Register in `src/cli.ts`
- [ ] Rewrite `WorkflowCoordinator` as thin wrapper over `GraphWalker` + `DashboardExecutor`
- [ ] Update `coordinate-handler.ts` for new walker events
- [ ] Update `coordinate-types.ts` (shared types)
- [ ] Create `_router.json` (state routing graph, replace `detectNextAction`)

### Phase 5: Advanced Features

- [ ] LLM decision strategy (`strategy: 'llm'`)
- [ ] Fork/join parallel execution
- [ ] Graph-to-graph delegation with `delegate_stack`
- [ ] Hot-reload of chain JSON files

### Phase 6: Cleanup

- [ ] Remove `CHAIN_MAP`, `INTENT_PATTERNS` from `chain-map.ts`
- [ ] Remove old `CoordinateRunner` class
- [ ] Update workflow `maestro-coordinate.md`
- [ ] Update command `maestro-coordinate.md`
- [ ] Dashboard graph visualization (show nodes + edges + current position)

---

## 15. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Graph format** | JSON files | 可热更新，可版本控制，可用户编辑 |
| **Expression language** | Custom mini-evaluator | 安全（不用 eval），够用，可预测 |
| **Loop protection** | `max_visits` per node | 简单有效，比全局 iteration count 更精确 |
| **Graph composition** | `terminal.delegate` | 比 subgraph embedding 更简单，图保持独立 |
| **State routing** | 独立 `_router.json` 图 | 统一 state-based 和 intent-based 路由 |
| **Single-step commands** | `singles/*.json` | 保持与多步图相同的执行模型 |
| **Analysis** | Per-command opt-in | `analyze: false` 可跳过，避免单步图的额外开销 |
| **Fork/join** | Phase 5 | 初期不需要并行，先做好串行+分支+循环 |
| **Dual endpoint** | `CommandExecutor` 接口 | Walker 不感知 CLI/Dashboard，通过 DI 切换 |
| **Prompt assembly** | 6-phase `PromptAssembler` | 上步 result + analysis + snapshot → 下步 prompt，统一管线 |
| **RESULT block** | 扩展为 7 字段 | Decision 节点直接引用 `ctx.result.verification_status` 等 |
| **Shared core location** | `src/coordinator/` | CLI 和 Dashboard 都依赖此目录，不放在 dashboard/ 下 |
