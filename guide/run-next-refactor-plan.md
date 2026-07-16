---
title: "ralph next → run next 重构规划 — 渐进式控制注入 + 共享上下文"
status: in-progress
---

# ralph next → run next 重构规划

> 目标：把 `ralph next` 的通用步进主干下沉为 `maestro run next`，以统一注入 Builder 实现渐进式控制注入，并修复/增强跨 run 的共享上下文。
> 基线事实（2026-07-16 勘察）：
> - `session.json.orchestration`（engine/chain/decision_points）已是通用 schema（`src/run/schemas.ts:41-46`），非 ralph 私有。
> - `ralph next`（`src/ralph/cmd-next.ts`）主干 = 找 pending step → `createRun()` → 更新 chain → 拼 prompt；ralph 专属仅 ralph-meta.json 读取（task_decomposition/step_details/lease）与完成动词。
> - **Bug**：`emitPrompt` 丢弃 `createRun` 返回的 upstream 映射，executor 拿不到上游 alias→path。
> - **协议冲突**：`ralph next` 注入 run-mode.md 全文，其中指示 "Run `maestro run create` before domain work"，但 Run 已创建；`createRun` 非幂等（`runtime.ts:552-554` 每调必建新目录）→ executor 每步多余裁决 + 重复空壳 Run 风险。
> - 上下文三通道重叠：CLI anchor（cmd-next.ts:187-296）、`run create/brief` 返回包（create 有 upstream 无正文，brief 有正文无 upstream）、maestro-ralph.md A_STEP_DISPATCH 手工拼装（与 anchor 的 Execution Progress/Accumulated Signals 逐字段重复）。
> - **`completeRun` 注册侧已完整**（`runtime.ts:807-880`）：scanOutputs → registerArtifacts（artifacts.json + aliases）→ deriveHandoff（report.md frontmatter → `run.json.handoff`）→ evidence 记录 → seal，并更新 `latest_completed_run_id`。缺口在**读侧**：prepare 无状态看不到上一步注册内容，brief 不带 upstream。
> - `createRun` 返回 `next: { command: "maestro run brief <runId>" }`——brief 本就是设计中的"下一步指引/注入点"。

---

## 一、目标架构

```
src/run/
├── next.ts        # 新：薄步进驱动 maestro run next [--session <id>] —— 继续触发 prepare→create 流程
├── inject.ts      # 新：统一注入 Builder（brief / next 出生包 / ralph 适配层共用的 section 组装）
├── runtime.ts     # brief 成为唯一 skill 文本注入点；complete 增加参数化补充注册
└── ...
src/ralph/
└── cmd-next.ts    # 瘦身为适配层：lease 校验 + next 核心 + brief 内容组合单发 + ralph 扩展段
```

### 生命周期即渐进式控制注入 — 动词各司其职（v2 修订）

**不新增第四条注入通道。** 渐进式控制注入 = 每个动词只返回当前状态需要的控制指令，`next` 指针指向下一动词（`createRun` 返回 `next: { command: "maestro run brief <runId>" }` 已是该模式）：

| 动词 | 职责 | 注入内容 | 现状 → 目标 |
|------|------|---------|------------|
| `run next` | 薄步进驱动：定位 chain pending step → create（内含 entry gates + upstream 收集） | **紧凑出生包**：run_id / run_dir / goal / upstream 表 / entry gates / 上一步 handoff 摘要 + `next: run brief {id}`。**不含 workflow 全文** | 新增 |
| `run prepare` | 任务前思考（只读、幂等） | 静态 prepare 正文 + refs；**新增 `--session <id>`**：附上一步 complete 注册的内容（latest_completed_run_id 的 handoff + contract.consumes 命中的 aliases） | 读侧补齐 |
| `run brief` | **唯一 skill 文本注入点** | workflow 全文 + run-mode 要点（现有）＋ **upstream 映射**（按 run.input.consumes 反查 registry）＋ 上一步 handoff ＋ session anchor 通用段（Intent/Boundary/Progress，用 P0 Builder） | 增强 |
| `run complete` | 注册与封存 | 自动扫描规范产物注册（**已完整**：registerArtifacts + aliases + deriveHandoff + evidence + seal）；**新增参数化补充注册**：`--note "<注意事项>"`（合入 handoff.concerns，供下一步 prepare/brief 注入）、`--artifact <run内相对路径>`（补注册 outputs 扫描外的产物，kind 取文件名 stem） | 参数增强 |
| engine 扩展位 | ralph 适配 | Goals Overview / Current Goal / Execution Criteria（读 ralph-meta）作为 Builder extension sections | P2 |

**执行者流程（通用链式 run）**：`run next` → 出生包 → `run brief {run_id}` → 干活（Write outputs/ + report.md）→ `run check` → `run complete [--note ...]` → 下一轮 `run next` 出生包自动带上刚注册的 handoff/aliases/notes。控制指令随状态渐进下发，LLM 无需预学完整协议；frontmatter 仍是 handoff 首选来源，CLI 参数为**补充通道**（executor 未写 frontmatter 时兜底，亦是 ralph complete 信号的透传承接点）。

---

## 二、分阶段实施

每阶段独立可编译、可测（`npm run lint` + `npx vitest run src/run src/ralph`）、不破坏兼容。

### P0 — 提取 Builder（纯重构，零行为变更）

- `cmd-next.ts` 的 `emitPrompt` / `buildSessionAnchor` / `truncate` / `capList` 迁入 `src/run/inject.ts`。
- 拆分形态：`buildEnvelope(input: EnvelopeInput): string`，anchor 通用段（Intent/Boundary/Progress/Signals）与 ralph 扩展段（Goals/Current Goal/Criteria）分离为 core sections + extension sections（`extensions: EnvelopeSection[]` 参数）。
- `cmd-next.ts` 改调新模块，**输出逐字节等价**。
- 新增 `src/run/inject.test.ts` 锁定输出格式（anchor 结构、truncation caps、completion meta 注释格式）。

验收：现有测试全绿；inject.test.ts 覆盖 anchor 各 section 的有/无分支；`ralph next` 输出与重构前 diff 为空（用固定 session fixture 对比）。

### P1 — 生命周期动词补齐（next 步进 + brief 单注入点 + prepare/complete 读写增强）

**P1a `run next`（薄步进驱动）**：
- `src/run/next.ts` + `src/commands/run.ts` 注册 `next [--session <id>]`。
- Session 解析策略：显式 `--session` > `state.json.active_session_id` > 唯一含 pending chain step 的 running session；多义 → 报错列出候选。
- 主干（与 ralph next 对齐）：single-running guard（exit 3）、decision 节点提示（exit 2）、无 pending（exit 2）、`createRun` + chain 状态更新（`updateChainStepStatus` 逻辑通用化到 src/run）。
- 输出**紧凑出生包**（不含 workflow 全文）：run_id / run_dir / goal / upstream 表（修复丢弃 bug）/ entry gates / 上一步 handoff 摘要（`latest_completed_run_id` 反查）/ `next: maestro run brief {run_id}`。

**P1b `run brief` 增强（唯一 skill 文本注入点）**：
- 补 `upstream` 字段（按 run.input.consumes 反查 registry，alias → path/kind/status）。
- 附上一步 run 的 handoff（summary/decisions/concerns）。
- 前置 session anchor 通用段（Intent / Boundary Contract / Execution Progress，用 P0 Builder core sections）。
- run-mode 要点保持摘要注入，不再依赖命令侧 @ 全文嵌入。

**P1c `run prepare --session <id>`（读侧补齐）**：
- 保持无状态默认行为；带 `--session` 时附加"上一步 complete 注册的内容"：latest_completed_run_id 的 handoff + contract.consumes 命中的 aliases 现状（存在/缺失/draft）。只读、幂等、不建目录。

**P1d `run complete` 参数化补充注册**：
- `--note "<注意事项>"`（可重复）：合入 `run.json.handoff.concerns`，下一步 prepare/brief/next 出生包可见。
- `--artifact <run 内相对路径>`（可重复）：补注册 outputs 自动扫描之外的产物（如 evidence/ 下文件），kind 取文件名 stem，role 默认 evidence；路径必须在 run_dir 内，越界报错。
- frontmatter 仍为首选来源；CLI 参数与 frontmatter 合并（concerns 追加去重），不新建第二真相源。

验收：集成测试覆盖——`run next` 出生包含 upstream 表 + 上一步 handoff、不含 workflow 全文；exit code 0/2/3 与 ralph next 一致；brief 含 upstream + anchor 段；prepare --session 展示上一步注册内容；complete --note/--artifact 落入 handoff/registry 且下一轮 next/prepare 可见（跨 run 闭环测试）。

### P2 — `ralph next` 降为适配层

- CLI 表面完全不变：命令名、`--session/--execution-owner/--owner-epoch/--lease-id` 标志、exit code 0/2/3、completion meta 注释格式（maestro-ralph.md FSM 与 ralph-executor 依赖，一个不动）。
- 内部改为 **next 核心 + brief 内容的组合单发**：lease 校验（ralph 专属）→ 调 run next 步进核心 → 组装 = 出生包（upstream/gates/上一步 handoff）＋ brief 注入内容（workflow 全文 + anchor 通用段）＋ ralph 扩展段（Goals/Criteria，读 ralph-meta）→ 完成动词仍为 `maestro ralph complete N --session ...`。executor 单 prompt 拿全，无需自己调 brief。
- `ralph complete` 的 `--summary/--caveats/--deferred` 信号透传到 `run complete` 的参数化注册（P1d 通道），为 P3 handoff 单源化铺路。
- 删除 cmd-next.ts 与 next.ts/inject.ts 重复的主干代码。
- **有意的行为增强（超出"逐字节等价"红线的唯一例外）**：步进核心的 reconcile 路径会自动推进"running 但 run 已 sealed"的孤儿 step（两个独立事务间被中断的残留态），旧 ralph next 在该场景返回 exit 3 阻塞；新版自动恢复。审查确认（F3）后保留为改进。

验收：ralph 现有测试全绿；fixture session 下 `ralph next` 输出与 P0 基线相比仅新增 upstream 表 + 上一步 handoff 差异（anchor 段不变）；lease 冲突路径行为不变。

### P2.5 — 渐进式补齐（审计 G8/G3/G4，立即实施）

> 来源：2026-07-16 流程审计（flow-gap-audit）。三项均为 P3/P4 未覆盖的新缺口，按收益/成本排序。

**G8 — ralph 注入 run-mode 摘要 + 状态感知控制行（替代全文 raw）**
- `cmd-next.ts` emitPrompt 的 `content.runMode.raw` 全文前置改为 `summarizeRunMode`（与 brief/prepare 对齐，runtime.ts 导出）；
- 同时注入一段生成式控制行（补偿全文中丢失的产物边界指引）：`Run already created: {run_id} — 正式产物写 {run_dir}/outputs/，人类叙述写 {run_dir}/report.md`；
- 顺带消除 G9：run-mode "Start or Resume" 的 `run create` 指令文案不再进入被编排 executor 的上下文；
- **这是继 reconcile 之后第二处对 P2"逐字节等价"红线的有意例外**——协议常量不逐步重发，属渐进式原则的直接落实。

**G3 — refs 延迟加载通道补齐（next/brief/ralph 三路径）**
- `NextResult` 与 `BriefRunResult` 增加 `refs: Array<{path, when}>`（源自 resolveStepContent 的 prepare refs）；
- `run next` 出生包渲染"**按需参考（Read when needed）**"清单段；brief JSON 返回含 refs 字段；
- ralph emitPrompt 追加 deferred-reading 清单段（path + when），兑现 ralph-executor.md "按需 Read" 的悬空指令；
- 原则：**清单入包、正文按需**——refs 正文永不内嵌。

**G4 — brief 补 next 指针，闭合 next→brief→check→complete 四段链**
- `BriefRunResult` 增加 `next: { command: "maestro run check {run_id}", reason }`，reason 说明 check 为"完成前预检、不封存，通过后 run complete"。

验收：`npm run lint` + `npx vitest run src/run src/ralph` 全绿；adapter 测试更新——ralph 输出含 run-mode 摘要与控制行、不含 "Start or Resume" 段、含 deferred-reading 清单；next/brief 测试断言 refs 与 next 指针。

### P3 — 共享上下文增强（P2 稳定后）

1. **进度信号单源化**：`ralph complete` 同时派生 `run.json.handoff`（summary/decisions/concerns）；anchor 的 Execution Progress / Accumulated Signals 改读 handoff，**handoff 缺失时回退 step_details**（双写过渡期）；跑完整 ralph session 验证后删旧读取路径。
2. **session 级 priors 共享**：约定首个 run 写 `outputs/priors.json`（spec/doc-index/wiki 命中），注册 alias `session-priors`；后续命令 contract `consumes` 加 `{ kind: priors, alias: session-priors, required: false }`——零新 schema、零新真相源。
3. **文档同步**：`workflows/run-mode.md` "Start or Resume" 补充"被编排器派发时 Run 已创建，直接使用注入的 run_id/upstream"；`prepare/*.md` Input Interpretation 提及 `session-priors`；改动后跑 `npm run sync:codex-skills`（.codex 镜像）。
4. **审计归并（G1/G7；G2 撤销）**：prepare 文档的 Required Context 改条件式（"注入了 session-priors 则不重复 load"，随 P3.2）；anchor 基于 identity_revision 对未变 boundary_contract 发指针而非全文（G7，可选）。**G2（brief 裁 upstream）撤销**：pi-maestro-flow 桥接（bridge.ts/extension）以 `maestro run brief` 为压缩后唯一重锚入口，brief 必须自足——upstream 重叠是刻意冗余，保留。

### P4（可选）— 决策点分级

- 新增 `maestro run decide <point>`：决定性证据（verification.json passed 布尔、exit code）CLI 直接裁决写 decisions.ndjson；仅 PARTIAL/DONE_WITH_CONCERNS/解析失败升级评估 Agent，且注入已解析的 STATUS/summary。
- `maestro-ralph.md`：S_DECISION_EVAL 加 CLI fast-path 分支；A_STEP_DISPATCH 的 loaded_step_context 加 protocol v2 guard（与 goal context 同款）。

---

## 三、兼容性红线

- **不 bump schema**：P0–P3 全程 `session/1.0` 不变；priors 走 artifact 机制。
- **`ralph next` 永不下线**：maestro-ralph.md invariant 9/13、ralph-executor、.codex 镜像引用它；P2 后为适配器，行为等价。
- 只改 `D:\maestro2` 源码，不直接改 `~/.maestro/` 安装副本。

## 四、风险

| 风险 | 缓解 |
|------|------|
| P0 输出不等价导致 executor 解析漂移 | fixture 逐字节 diff 测试 |
| P3 双写期 handoff 与 step_details 不一致 | anchor 读取 fallback + 完整 session 冒烟后再删旧路径 |
| run-mode.md 改动破坏 codex 镜像 | 仅 P3 动文档，改后跑 `npm run lint:session-run` + `sync:codex-skills` |
| createRun 在 run next 与手动 create 双入口并发 | 复用现有 SessionStore 事务（store.update），无新增写路径 |
