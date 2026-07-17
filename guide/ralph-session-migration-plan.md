# Ralph → Session 架构完全迁移规划

> 续接 `guide/run-next-refactor-plan.md`(P0-P3 已落地)。本规划将 Ralph 的状态与 CLI 动词完全收敛到
> Session/Run 架构;编排智能(FSM、建链、决策评估)留在 prompt 层。
>
> 用户裁定的边界(2026-07):
> - "编排逻辑层 仍然在 prompt 中,只不过 cli 替换、合并重构到 session"
> - "使 session 支持预定义链"
> - "类似 ralph run complete 也就是完成当前 run 步骤"(免 index)
> - "run next 显示当前步骤简要信息,如何调用"
> - "后续 next 命令也可以推荐多个 run"

## 实施与审查状态（2026-07-17）

| 阶段 | 当前状态 | 证据 / 未完成项 |
|------|----------|-----------------|
| M1–M4 | 已实现并审查加固 | `62bec6fd` 落地；`957e1954` 补齐迁移幂等、路径边界、chain 完整性与 Protected Data Store |
| M5 | 已实现并审查加固 | Prompt/镜像已切通用动词；`49892e57` 收敛 Run/chain/lease 单事务并让 Ralph alias 优先读取 Session 1.1 |
| M6（maestro2） | 已实现 | ledger 独立、consumer fallback、Codex 镜像已落地 |
| M6（pi 镜像） | **待验收** | `D:\pi-maestro-flow` 当前有并行未提交改动；未获得可归因的 clean test 证据前不得宣称全量完成 |

本文 §0 是 `62bec6fd` 实施前基线，§1–§5 保留目标设计与执行分解；上表是当前事实来源。

## 0. 实施前基线事实（2026-07-16 盘点）

| 事实 | 位置 |
|------|------|
| 双真相源:session.json orchestration.chain(极简 6 字段)+ ralph-meta.json(step_details/task_decomposition/execution_criteria/goal_changelog/lease/position/verification_ledger) | `src/run/schemas.ts` / `src/ralph/status-schema.ts` |
| `run next` 已是薄步进驱动:reconcileSealedSteps 使 happy path 上通用 next+complete 可驱动预定义链 | `src/run/next.ts:223-245` |
| `run next` session 解析无 engine 过滤,可能绕 lease 误驱 ralph session(已知隐患) | `src/run/next.ts:110-142` |
| `ralph complete <index>` 携带 verdict 四态 + 信号参数,写 step_details + 调 completeStandardRun | `src/ralph/cmd-complete.ts` / `src/commands/ralph.ts:104-166` |
| `maestro session` 顶层命令不存在;建链只有内部 `createRalphSession(chain, decisionPoints)` | `src/ralph/session-adapter.ts` |
| ralph-meta 代码消费方(src/ralph 之外)仅 1 处:coordinator-tracker 读 lifecycle_position/phase/passed_gates(existsSync 兜底) | `src/hooks/coordinator-tracker.ts` 的 `orchestration.position` fallback block |
| prompt 层消费方:`.claude/commands/maestro-ralph.md`(FSM)+ `.claude/commands/maestro.md`(/maestro 主协调器,6 处 ralph next/complete 引用)+ `.codex/` 镜像 | `.claude/commands/maestro.md:61,65,96,336,385,466` |
| 前一规划的"不 bump schema"红线在此废止:完全迁移必然演进 schema,以 1.0 兼容读取替代 | 本文 §5 |

## 1. 目标形态

### 1.1 Schema 演进:`session/1.1`(消灭 ralph-meta 双源)

ralph-meta 字段按性质归位,session.json 成为唯一编排真相源:

```ts
orchestration: {
  engine: 'ralph' | 'coordinator' | 'manual',
  quality_mode, auto_mode,                        // 不变
  chain: Array<{
    step_id, command, status, run_id,
    inserted_by, decision_ref,                    // 不变
    args?: string,                                // ← step_details.args(建链时定,next 透传 createRun)
    stage?: string | null,                        // ← step_details.stage(信号提取/展示)
    goal_ref?: string | null,                     // ← step_details.goal_ref
    retry?: { count: number, max: number },       // ← RalphStep.retry_count(默认对齐现行 ralph 行为)
  }>,
  decision_points: [...],                         // 不变
  position?: {                                    // ← ralph-meta 顶层定位字段
    lifecycle: string, phase: number | null, phase_is_new: boolean,
    milestone: string, planning_mode: string | null,
    passed_gates: string[], scope_verdict: string | null,
  } | null,
  decomposition?: {                               // ← ralph-meta 自适应态,整块提升
    execution_criteria: string[],
    goals: TaskDecompositionItem[],               // task_decomposition
    changelog: GoalChangelogEntry[],              // goal_changelog
  } | null,
  lease?: { owner: string | null, epoch: number, id: string | null } | null,
  executor?: { platform: string, cli_tool: string } | null,
}
```

**明确废弃(不迁移)**:
- `step_details.completion_*` — P3 已确立 run.json.handoff 为进度单源,读路径彻底删除;
- `context.{analysis_dir, plan_dir, ...}` — 已被 artifacts aliases 替代;
- `protocol_version` — 由 schema_version 承担。

**verification_ledger**:不属于编排态(是验证缓存)。M1 迁移期间留在 ralph-meta.json(降级为
ledger 专用文件),M6 独立为 `verification-ledger.json` 并切换 cmd-ledger 读写,ralph-meta 退役为 `.bak`。

所有新增字段 optional + default,`session/1.0` 文件可被 1.1 schema 无损读取(见 §5 兼容策略)。

### 1.2 动词面:通用链驱动(ralph 语义内化为参数)

| 动词 | 新能力 | 替代的 ralph 旧面 |
|------|--------|------------------|
| `maestro session create <slug> --intent <text> --chain-file <json> [--engine ralph] [--quality] [--auto]` | 预定义链建 session。链定义 JSON(steps + decision_points + position + decomposition)从文件/stdin 传入避免转义;非 ralph engine 亦可用 | A_CREATE_SESSION 手写文件 |
| `maestro session chain insert/skip/replace --session <id> ...` | 动态链编辑 CLI 化 — fix-loop 插步、goal-audit mini-loop 均经此。**prompt 层不再直写 session.json** | A_APPLY_FIX 等隐式写 |
| `maestro session migrate [--session <id>]` | 幂等迁移:合并存量 ralph-meta → session/1.1;拒绝迁移"有 running step"的 session | — |
| `run next [--session] [--pick <step_id>]` | ① 无 running step → 推进 + 出生包;② **有 running step → 当前步信息卡**(run_id/command/started 摘要 + 如何调用:`run brief {id}` 继续 / `run complete --verdict ...` 完成),exit 3 保留但 message 变指引;③ 下一节点是 decision → 决策卡(point/retry/evidence 期望);④ 多候选推荐段(§1.3);⑤ lease 守卫(§1.4) | ralph next |
| `run complete [run-id] --verdict done\|done-with-concerns\|needs-retry\|blocked [--summary] [--decision]* [--note]* [--evidence]* [--reason]` | **免参调用**:缺 run-id 时解析当前 running chain step 的 run;**verdict 驱动链推进**:done/done-with-concerns → step completed+seal、needs-retry → step 回 pending + retry.count++ + run_id=null、blocked → step failed + session paused;非链 run 时 verdict 仅落 handoff。完成后输出 `next: maestro run next` 指针闭环 | ralph complete / ralph retry |
| `run decide <point_id> --verdict proceed\|fix\|escalate --confidence high\|medium\|low [--summary] [--evidence <path>]` | decision 裁决落盘 CLI 化 — **评估仍由 prompt 层做**,裁决经 CLI 写 decision_point 状态并按 verdict 推进;fix 时配合 `session chain insert` | A_APPLY_VERDICT 隐式写 |
| `maestro session meta update --session <id> [--position-file <path\|->] [--decomposition-file <path\|->]` | position/decomposition 整块替换(schema 校验)— goal-audit / task_decomposition 状态翻转 / goal_changelog 追加的唯一 CLI 写入口,prompt 层重建整块提交 | ralph-meta 隐式写 |

**verdict 词汇正交性(关键决策)**:`--verdict` 是**链推进指令**(step 怎么走),与 `handoff.verdict`
(产物质量:ready/blocked/failed)正交,不合并 — DONE_WITH_CONCERNS 完全可能配 handoff.ready。

### 1.3 `run next` 多候选推荐(分两档)

- **V1(本次)**:出生包/信息卡新增推荐段,三路数据源合并 —
  (a) chain 后续 pending 队列 preview(截前 3,让编排器看见"接下来是什么");
  (b) 上一步 `handoff.next[]`(命令建议 + needs);
  (c) 无链 session → 纯 handoff.next 推荐。
  `--pick <step_id>` 允许推进指定 pending step 而非队首(为并行铺路;非 pending 报错)。
- **V2(后续,不在本次)**:并行执行 — 放宽 single-running guard 为 `orchestration.allow_parallel`
  门控。牵动 reconcile/免参 complete 解析/lease 语义,单独规划。

### 1.4 Lease 内化

`orchestration.lease` 存在时,`run next`/`run complete` 校验 `--execution-owner/--owner-epoch/--lease-id`
(语义与 exit code 对齐现行 `src/ralph/cmd-next.ts` 的 lease 拒绝路径);无 lease 字段的 session 零影响。
这同时修复"run next 无 engine 过滤绕 lease"隐患 — 过滤依据从 engine 换成 lease 本身。
(M2 已落地校验;M6 补认领:`run next --execution-owner` 在 lease 为空或 owner 匹配时写入/续持
orchestration.lease,语义镜像 cmd-next 现行认领路径。)

### 1.5 编排逻辑层:maestro-ralph.md 只换动词不换脑

FSM、建链规则(A_BUILD_STEPS)、决策评估(A_AGENT_EVALUATE / GOAL_AUDIT / REGROUND)、drift 分析
**全部留在 prompt**。仅两点变化:
1. 所有状态读写改经新动词(session create --chain-file / session chain insert / run next /
   run complete --verdict / run decide),不再读写 ralph-meta.json;
2. A_STEP_DISPATCH 手工上下文拼装删除(anchor + 出生包已覆盖,流程审计确认的重复通道)。

`ralph` CLI:`next/complete/retry` 变**弃用别名**(内部直调 run 动词 + stderr 弃用提示),
`skills/check/session/ledger` 保留(领域功能非编排),其中 session/check 改读 session.json。

## 2. 分阶段实施(M1-M6)

| 阶段 | 内容 | 主要文件 | 验收 |
|------|------|---------|------|
| **M1 Schema + 迁移** | session/1.1 schema(1.0 兼容读、写回 1.1);`maestro session migrate`(新建 `src/commands/session.ts`);defaults/store 适配 | schemas.ts, store.ts, 新 migrate.ts, 新 commands/session.ts | 1.0 读写往返无损;migrate 幂等;拒迁 running-step session |
| **M2 complete 内化** | 免参解析 + `--verdict` 四态链推进 + `--decision/--evidence/--reason` 信号参数汇入 handoff;完成输出 next 指针;lease 校验 | runtime.ts, chain.ts, commands/run.ts | 与 ralph complete 四态语义等价的测试;免参闭环测试 |
| **M3 next 增强** | running → 信息卡;decision → 决策卡;推荐段(三源);`--pick`;lease 校验 | next.ts, commands/run.ts | 各分支输出 fixture 断言;exit code 0/2/3 不变 |
| **M4 链动词** | session create --chain-file;chain insert/skip/replace(校验 goal_ref/retry/decision 插入规则);createRalphSession 委托通用创建器 | commands/session.ts, 新 chain-admin.ts, session-adapter.ts | 建链→执行→插步→完成 全链 CLI 冒烟 |
| **M5 prompt 层切换** | maestro-ralph.md **与 maestro.md** 全部动词替换 + 借新能力做瘦身优化(FSM 逻辑不动、invariant 编号保留;删除已被出生包/信息卡/anchor 覆盖的手工上下文拼装与重复调度说明);ralph-executor.md 更新;ralph next/complete/retry 别名化 + 弃用提示;run decide 实装 | .claude/commands/maestro-ralph.md, .claude/commands/maestro.md, agents/ralph-executor.md, commands/ralph.ts, 新 decide.ts | 完整 ralph 冒烟:建链→执行→decision→fix 插步→seal；对 `.claude/commands/maestro-ralph.md`、`.claude/commands/maestro.md`、`.claude/agents/ralph-executor.md`、`.codex/skills/maestro-ralph/SKILL.md`、`.codex/agents/ralph-executor.toml` 全量检查：零 direct authority-file write 指令、零 executable `ralph next/complete/retry` 旧动词 |
| **M6 清理 + 镜像** | coordinator-tracker 改读 orchestration.position(ralph-meta 兜底);cmd-session/cmd-check 改读 session.json;verification-ledger 独立文件;session-adapter 收缩;codex sync;pi 镜像对齐 | hooks/coordinator-tracker.ts, ralph/cmd-*.ts, .codex/, D:\pi-maestro-flow | lint + vitest + build 全绿;lint:session-run 无新增;pi 测试全绿 |

**依赖序**:M1 → {M2, M3, M4} → {M5, M6}。M5 之前 ralph 旧路径全程可用(别名 + 双 schema 读),
可停在任意阶段 — 向后兼容红线不变。

**并行波次**:
- Wave 1:M1 ∥ M3(M3 只用 1.0 已有字段,与 schema 演进无耦合;文件集不相交)
- Wave 2:M2 ∥ M4(M2 动 runtime/chain/run.ts,M4 动 session.ts/chain-admin/adapter)
- Wave 3:M5-prompt(纯 .md)∥ M5/M6-code(aliases、decide、lease、consumers)
- Wave 4:review agent + 全量测试

## 3. 迁移与兼容策略

1. **双版本读取**:store 接受 `session/1.0` 与 `session/1.1`;1.0 读入即内存升级(新字段补默认),
   仅在写回时落 1.1。不做静默批量重写。
2. **migrate 命令**:显式、幂等;合并 ralph-meta → session.json;原 ralph-meta 保留
   (M6 前作 ledger 载体,M6 后 `.bak`)。status=running 且有 running step 的 session 拒迁,提示先 complete。
3. **别名过渡**:`ralph next/complete/retry` 保留一个版本周期,**实现不动**(未迁移 ralph-meta session
   继续原行为),仅 stderr 打弃用提示指向 run 动词。新建 session 一律走新动词。
   verification_ledger:cmd-ledger 写入切到 `verification-ledger.json`,读取合并 legacy
   ralph-meta.verification_ledger 兜底;不做 `.bak` 更名(避免破坏性操作)。
4. **completion_* 单源**:迁移不搬运 step_details.completion_*(handoff 已覆盖);历史查询走 run.json。

## 4. 风险

1. **maestro-ralph.md 重写面大**(千行级 FSM):M5 单独成段,逐 action 替换动词,invariant 编号保留,
   完整冒烟护航;验收含"prompt 文件零 session.json/ralph-meta.json 直写指令"检查。
2. **schema 读取方长尾**:动手前 grep 全量消费面(已盘点:coordinator-tracker 是唯一 src/ralph 外
   代码消费方);dashboard 经 session.json 无 ralph-meta 依赖。
3. **迁移窗口半迁移态**:migrate 拒绝 running-step session;别名期内 cmd-complete 双写?——否,
   M5 起别名直调 run 动词,单写 session.json;M5 前旧路径原样保留,不做双写。
4. **decision CLI 化的遗漏直写**:A_APPLY_* 系列全部换 run decide + chain insert;M5 验收 lint 检查。
5. **并行 Claude 会话**:全程 pathspec 提交,不回滚他人变更。

## 5. 红线

- 向后兼容:1.0 session 全程可读;ralph 动词过渡期不删。
- 只改 D:\maestro2 源(及 M6 的 pi 镜像仓),不碰 ~/.maestro/ 安装副本。
- src/run 不得 import src/ralph(方向不变:ralph → run)。
- 编排智能不下沉:任何 FSM/评估逻辑不得写入 runtime 代码。
- 跨仓验收不得借用脏工作树结果：M6 的 pi 镜像必须在可归因的提交或隔离 worktree 中完成测试后再标记完成。
