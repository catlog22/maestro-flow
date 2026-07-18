# 命令上下文继承优化规划

> 基于 team-swarm 多 Agent 分析（5 蚁并行 × 1 轮收敛，最优评分 0.93）产出。
> 分析对象：`D:\maestro2\.claude\commands\`（68 个命令文件）
> 源报告：`docs/session-context-layer-proposal.md`

---

## 一、背景与目标

### 1.1 现状问题

当前 `.claude/commands/` 下的命令在**同一会话内**各自独立完成上下文发现（context discovery），不存在共享继承机制。每条命令被调用时都会：

1. 重新读取 spec 文件（`maestro load --type spec --category <cat>`）
2. 重新搜索知识库（`maestro search --category <cat>` → `maestro load --type knowhow --id`）
3. 重新扫描 `state.json` 查找上游产物
4. 重新读取 `ARCHITECTURE.md` / 代码库文档
5. 重新执行 collab preflight 预检

在一次完整的 maestro 生命周期链（collab → plan → execute → quality-review）中，spec/knowledge 会被重复加载多达 **8 次**。

### 1.2 优化目标

**修改命令核心流程，使得针对一个会话，同一文件夹下的不同命令继承上下文发现结果，而非各自重建。**

具体目标：
- 引入统一的会话上下文层（session-context layer），命令**消费**而非**重建**
- 保持向后兼容：独立调用时回退到现有行为
- 复用已有部分机制（`--from`/context-package.json、`maestro ralph next`、`spec-load`）

---

## 二、核心发现（5 蚁独立确认）

### 2.1 结构性结论

5 个蚁从 5 个**互不重叠**的命令家族（maestro 核心生命周期、ralph 编排器、learn-*、odyssey-*、specs+tools）独立进入，均得出同一结论：

> 每个命令家族在每次调用时独立重新发现稳定的项目上下文；集中式只读加载器 `spec-load` 已存在，但被其消费者绕过/内联。

这是结构性问题，而非某条路径的偶然现象。

### 2.2 17 个重复缺口（分组 A–E）

| 分组 | 缺口 | 严重度 | 涉及命令数 | 典型证据 |
|------|------|--------|-----------|---------|
| **A. Spec + Role-Knowledge 发现** | GAP-1 / GAP-6 / GAP-9 | HIGH | 18 / 13 / ~30 | `maestro-execute.md:57-62` 重复 `maestro load --type spec` + `maestro search` |
| **B. State/artifact-registry 发现** | GAP-3 / GAP-8 / GAP-14 | HIGH/MED | 10 / 7 / 4 | 10 条命令各自重搜 `state.json`；odyssey 在链边界丢失上下文 |
| **C. 代码库文档 + 历史会话发现** | GAP-11 / GAP-7 / GAP-12 | HIGH/MED | 4 / 4 / 4 | 4 个 odyssey 命令复制粘贴同一 4 层 A_INTAKE |
| **D. 预检 / 门控 / 冷启动** | GAP-2 / GAP-4 / GAP-16 / GAP-17 / GAP-15 | MED | 2 / 6 / 4 / ~40 / 2 | ~40+ 命令每次调用冷启动 `<required_reading>` |
| **E. 编排器 / 共享动作结构性** | GAP-5 / GAP-13 / GAP-10 | MED/LOW | 2 / 4 / 2 | ralph-cli vs ralph 近乎逐字 FSM；共享动作已存在却被复制粘贴 |

**关键收敛信号**：GAP-1（18 命令）、GAP-6（13 命令）、GAP-9（~30 命令）是三个蚁从不同入口对**同一底层重复**的三次独立测量，命令数差异仅源于枚举粒度不同。

### 2.3 已有的部分共享机制（可复用，非发明）

| 机制 | 覆盖范围 | 缺口 |
|------|---------|------|
| `--from` / context-package.json 握手 | 会话内上游→下游的显式链 | 仅限显式链，不覆盖 spec/Role-Knowledge 发现 |
| `maestro ralph next` CLI | 集中解析 `<required_reading>/<deferred_reading>` | 仅限 ralph 编排会话 |
| `spec-load` 命令 | 集中 spec 加载（只读、context-injection 不变量） | 被消费者绕过/内联 |
| `odyssey-base.md <shared_actions>` | 共享 A_GENERALIZE/A_DISCOVER/A_RECORD | A_INTAKE/A_RESUME 被 conspicuously 漏掉 |

---

## 三、优化方案设计

### 3.1 总体架构：一层两作用域

```
┌─────────────────────────────────────────────────────────────┐
│  .workflow/session-context.json  （项目稳定上下文）          │
│  ├─ resolved_specs: {arch, coding, test, review, debug, ui} │
│  ├─ resolved_knowhow: [id, id, ...]                         │
│  ├─ codebase_doc_index: {ARCHITECTURE.md, FEATURES.md, ...} │
│  ├─ specs_init: {initialized: bool}                         │
│  └─ hash: <specs/knowhow 目录 mtime 哈希，用于失效判断>      │
└─────────────────────────────────────────────────────────────┘
              │                              │
              │  磁盘读取                     │  ralph 编排会话注入
              ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│  非编排命令（独立调用）   │   │  ralph 编排会话              │
│  Pre-load 点读盘          │   │  <execution_context> 内新增  │
│                          │   │  <project_context> 块        │
└──────────────────────────┘   └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  会话运行时上下文（扩展现有 --from / <execution_context>）   │
│  ├─ current_milestone / phase                               │
│  ├─ latest_upstream_artifact_refs                           │
│  ├─ preflight_verdict（GAP-2 解决）                         │
│  └─ artifact_registry_snapshot（GAP-3 解决）                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 消费契约：consume-or-fallback

所有命令采用统一的消费契约：

- **共享层存在且新鲜**（编排会话，或 `session-context.json` 存在且 hash 匹配）→ 消费，跳过 Pre-load / Role-Knowledge / GATE 重新发现
- **共享层缺失**（独立直接调用）→ 回退到现有 `maestro load` / `maestro search` 行为，**零行为变更**

这保证了向后兼容：非会话场景不受影响。

### 3.3 共享工作流：`context-discover.md`

将重复的发现逻辑参数化为 `@~/.maestro/workflows/context-discover.md`，以 `<category>` 为参数，匹配已有的共享工作流模式（`roadmap-common.md`、`odyssey-base.md`、`interview-mechanics.md`）。

命令声明所需类别（如 `needs: [arch, coding]`）而非重新实现 load+search 调用。

### 3.4 四项核心提案

| # | 提案 | 解决缺口 | 核心变更 |
|---|------|---------|---------|
| 1 | `session-context.json` + `context-discover.md` | GAP-1/6/9 | 命令在 Pre-load/Role-Knowledge/Phase-Gate-P1 点消费共享层 |
| 2 | 共享 preflight | GAP-2 | `maestro collab preflight` 移入 resolve 步骤，plan/execute 读缓存 |
| 3 | 参数化 spec 发现 | GAP-1/7/11 | 18 个重复块折叠为 1 个参数化共享工作流 + 每命令类别声明 |
| 4 | 泛化 ralph load 契约 | GAP-4/17 | `maestro ralph next` 的 `<required_reading>` 集中化推广为非 ralph 的 `maestro context load` |

---

## 四、实施路线图

按依赖关系与风险分级，分 4 个阶段推进。

### 阶段 0：验证与准备（前置）

> 目标：补齐 swarm 分析的未验证项，确认方案可行。

| 任务 | 说明 | 产出 |
|------|------|------|
| 0.1 验证 GAP-1 的 18 命令清单 | 逐条 Read 确认 file:line（swarm 为 Grep 枚举，未逐一深读） | 标注清单：确认 / 修正 / 剔除 |
| 0.2 探查 `maestro-ralph-v2` | swarm 未探索；可能已部分解决 GAP-5 | 确认 v2 是否已统一编排器 FSM |
| 0.3 探查 `maestro-universal-workflow` | 可能已是共享层抽象 | 确认是否可复用 / 需新建 |
| 0.4 确认 `~/.maestro/workflows/` 共享机制 | `<shared_actions>` 语义、include 语法 | 设计定稿：`context-discover.md` 如何被引用 |
| 0.5 `spec-load` 消费者审计 | 确认哪些命令内联了 spec-load 逻辑 | 修改清单基线 |

### 阶段 1：最小可用层（MVP）

> 目标：落地 `session-context.json` + consume-or-fallback，解决最痛的 GAP-1（18 命令）。

| 任务 | 文件 | 变更 |
|------|------|------|
| 1.1 新建 `context-discover.md` | `~/.maestro/workflows/context-discover.md` | 定义参数化发现逻辑（category 入参 → load+search → 写 session-context.json） |
| 1.2 新建 `maestro context resolve` CLI | maestro 主程序 | 一次性构建/刷新 `session-context.json`（hash 失效判断） |
| 1.3 改造 `maestro-execute` Pre-load | `maestro-execute.md:53-59` | 4 个 Bash 调用 → 读 `session-context.json`；缺失则 resolve 一次 |
| 1.4 改造 `maestro-execute` Role Knowledge | `maestro-execute.md:61-62` | 消费 `resolved_knowhow` 而非重跑 `maestro search` |
| 1.5 改造 `maestro-plan` Role Knowledge + state 搜索 | `maestro-plan.md:51,57-58` | 消费 `resolved_knowhow` + `latest_analyze_artifact` |
| 1.6 改造 `maestro-collab` Pre-load | `maestro-collab.md:28` | 注入 `resolved_specs.arch` 到 delegate prompts |

**验收**：在 collab → plan → execute 链中，spec/knowledge 加载次数从 ~6 次降至 1 次（首次 resolve），后续命令均消费缓存。

### 阶段 2：扩展覆盖 + 共享 preflight

> 目标：覆盖 13 生命周期技能 + 解决 GAP-2/3。

| 任务 | 文件 | 变更 |
|------|------|------|
| 2.1 推广到 13 生命周期技能 | analyze, blueprint, brainstorm, grill, roadmap, milestone-audit, composer, quick, impeccable, ui-codify 等 | 统一 Pre-load 头为 `### Project context (inherited or discovered)`，套用 consume-or-fallback |
| 2.2 共享 preflight | `maestro-plan.md:66`, `maestro-execute.md:70` | 移入 resolve；plan/execute 读 `session-context.json.preflight` |
| 2.3 state.json 产物注册表快照 | `session-context.json` 新增 `artifact_registry` 字段 | 10 条命令读快照而非重搜 state.json（GAP-3） |
| 2.4 ralph 编排会话注入 | `maestro-ralph-cli.md:488-504,518-542` | A_LOAD_STEP_CONTEXT 新增 step 0 构建 `project_context`；`<execution_context>` 新增 `<project_context>` 块 |

**验收**：13 技能在 ralph 编排链中零重复 spec/knowledge 加载；preflight 每阶段仅运行 1 次。

### 阶段 3：odyssey / learn / specs 家族迁移

> 目标：解决 GAP-8/11/12/13/14（家族内复制粘贴）。

| 任务 | 文件 | 变更 |
|------|------|------|
| 3.1 odyssey A_INTAKE 提升为共享动作 | `odyssey-base.md:142-200` | 新增 `A_INTAKE_SHARED(slug, type, spec_categories)`；Pre-load 从 optional 升级为 mandatory shared |
| 3.2 odyssey 4 命令替换内联 A_INTAKE | `odyssey-ui.md:178`, `odyssey-debug.md:137`, `odyssey-review-test-fix.md:176`, `odyssey-improve.md:201` | 调用 `A_INTAKE_SHARED` + 命令特有 delta |
| 3.3 odyssey 链到 /spec load | 上述 4 处内联 `spec load` | 替换为 `/spec load --category <cat>` |
| 3.4 odyssey A_RESUME 提升为共享动作 | `odyssey-base.md` | 新增 `A_RESUME_SHARED(type)` |
| 3.5 odyssey 跨命令会话继承 | `odyssey-base.md <shared_schemas>` | 新增 `context.json` schema；链式调用时读取上游 context.json |
| 3.6 learn-* 消费 session_context | `learn-follow.md:34,142`, `learn-decompose.md:62`, `learn-investigate.md:99`, `learn-second-opinion.md:34,67` | S_DEDUP/S_PATTERN/S_CONTEXT 改为缓存检查 |
| 3.7 spec-* + tools 家族 | `maestro-tools-register.md:20-22,178`, `maestro-tools-execute.md:20-22`, `spec-load.md:81-92`, `spec-add.md:71` | 替换 tools-spec 重读 + specs 存在性探测为 `$SESSION_CONTEXT` 读取 |

**验收**：odyssey 链（ui → debug → review → improve）中 ARCHITECTURE.md 只读 1 次；learn-* 间 learnings.md 已知模式集不再重建。

### 阶段 4：编排器统一 + 收尾

> 目标：解决 GAP-5（FSM 复制），长期收编。

| 任务 | 文件 | 变更 |
|------|------|------|
| 4.1 提取共享 FSM 逻辑 | 新建 `~/.maestro/workflows/session-bootstrap.md` | 从 ralph-cli/ralph 提取 phase-resolution/scope-verdict/bootstrap |
| 4.2 评估退役 LEGACY 编排器 | `maestro-ralph.md`, `maestro-ralph-cli.md` | 若 `maestro-ralph-v2` 已覆盖，标记 LEGACY 为 deprecated |
| 4.3 泛化 `maestro context load` | maestro 主程序 | 非编排命令也走集中化 `<required_reading>` 加载（GAP-4/17） |
| 4.4 文档与迁移指南 | `docs/` | 更新命令作者指南：新命令应声明 `needs: [cat]` 而非内联 load+search |

**验收**：`maestro ralph next` 的集中化能力推广到所有调用路径；新命令默认消费共享层。

---

## 五、具体修改清单（14 项，按阶段映射）

| # | 文件:位置 | 变更 | 阶段 | 解决缺口 |
|---|----------|------|------|---------|
| 1 | `maestro-execute.md:53-59` | Pre-load 4 Bash → 读 session-context.json | 1 | GAP-1,6 |
| 2 | `maestro-execute.md:61-62` + `maestro-plan.md:57-58` | Role Knowledge 消费 resolved_knowhow | 1 | GAP-1,9 |
| 3 | `maestro-plan.md:51` | state.json 搜索 → 读 latest_analyze_artifact | 1 | GAP-3 |
| 4 | `maestro-plan.md:66` + `maestro-execute.md:70` | preflight → 读缓存 | 2 | GAP-2 |
| 5 | `maestro-collab.md:28` | Pre-load → 注入 resolved_specs.arch | 1 | GAP-1 |
| 6 | `maestro-ralph-cli.md:488-504` | A_LOAD_STEP_CONTEXT 新增 step 0 | 2 | GAP-6 |
| 7 | `maestro-ralph-cli.md:518-542` | `<execution_context>` 新增 `<project_context>` | 2 | GAP-6 |
| 8 | 13 生命周期技能 Pre-load | 统一 consume-or-fallback 契约 | 2 | GAP-1,6 |
| 9 | `spec-load.md:24-31` + 新不变量 | 新增 `--session-cache` 模式 | 1 | GAP-1,7,9 |
| 10 | `odyssey-base.md:142-200` | 提升 A_INTAKE/A_RESUME 为 `<shared_actions>` | 3 | GAP-11,12,13 |
| 11 | `odyssey-{ui,debug,review,improve}.md` A_INTAKE | 替换为 A_INTAKE_SHARED + delta | 3 | GAP-11,14 |
| 12 | learn-* 5 命令 | S_*/S_CONTEXT 改为缓存检查 | 3 | GAP-7,8,9 |
| 13 | `maestro-tools-{register,execute}.md` + `spec-{load,add}.md` | 替换重读 + 存在性探测 | 3 | GAP-15,16,17 |
| 14 | `maestro-ralph.md` + `maestro-ralph-cli.md` FSM | 提取共享 session-bootstrap.md | 4 | GAP-5 |

---

## 六、风险与注意事项

| # | 风险 | 缓解措施 |
|---|------|---------|
| 1 | **单轮分析、路径排序为软排序** | swarm 在 1 轮后因 target_score 触发收敛，信息素未学习。*发现*是稳健的（5 蚁独立确认），*路径排序*是临时的。阶段 0 先做验证再动工。 |
| 2 | **GAP-1 的 18 命令清单为 Grep 枚举** | 未逐一深读验证。阶段 0.1 逐条确认。 |
| 3 | **`maestro-ralph-v2` / `maestro-universal-workflow` 未探查** | 可能已部分解决 GAP-5。阶段 0.2/0.3 先确认。 |
| 4 | **提议的文件尚不存在** | `context-discover.md`、`session-context.json`、`session-bootstrap.md`、`<project_context>` 均为新建，需对照 `~/.maestro/workflows/` 内部机制（include 语法、`<shared_actions>` 语义）做设计验证。 |
| 5 | **向后兼容性** | consume-or-fallback 契约保证独立调用零行为变更；但需为每个被改造命令增加回退路径测试。 |
| 6 | **hash 失效边界** | session-context.json 的 hash 需覆盖 specs/knowhow 目录写入；若命令运行中写 spec（如 spec-add），需主动失效缓存。 |
| 7 | **odyssey 跨会话继承的隔离风险** | context.json 跨链传递可能引入上游污染；需明确 schema 与只读契约。 |

---

## 七、验证计划

### 7.1 阶段验证

| 阶段 | 验证方法 | 通过标准 |
|------|---------|---------|
| 0 | 逐条 Read 确认 file:line；探查 v2/universal-workflow | 清单准确率 ≥ 95%；v2 覆盖度评估完成 |
| 1 | collab → plan → execute 链中计数 `maestro load --type spec` / `maestro search` 调用 | 调用次数从 ~6 降至 1 |
| 2 | ralph 编排链中 13 技能 spec 加载计数 + preflight 计数 | spec 加载 0 重复；preflight 每阶段 1 次 |
| 3 | odyssey 链 ARCHITECTURE.md 读取计数 + learn-* learnings.md 重建计数 | ARCHITECTURE.md 读 1 次；learnings.md 不重建 |
| 4 | ralph-cli vs ralph FSM 重复行数 | 提取后重复行数 ≤ 5% |

### 7.2 回归验证

- 独立直接调用每条被改造命令（无 session-context.json）→ 行为与改造前一致
- `spec-add` / `spec-setup` 写入 spec 后 → session-context.json hash 失效，下次 resolve 重新加载
- ralph 编排会话与独立调用混合场景 → consume-or-fallback 正确切换

### 7.3 度量指标

| 指标 | 基线 | 目标 |
|------|------|------|
| 完整生命周期链中 spec 加载次数 | ~8 | 1 |
| 完整生命周期链中 `maestro search` 次数 | ~8 | 1 |
| `state.json` 重搜次数 | ~10 | 0（读快照） |
| preflight 运行次数 | 2+ | 1（每阶段） |
| odyssey 链中 ARCHITECTURE.md 读取 | 4 | 1 |

---

## 八、附录

### 8.1 swarm 会话元数据

- 会话 ID：`TS-cmd-context-inherit-20260711`
- 会话路径：`.workflow/.team/TS-cmd-context-inherit-20260711/`
- 配置：5 蚁 × 3 轮上限，LLM Judge 评分，target_score 0.85
- 收敛：1 轮触发（best 0.93 > target 0.85）
- 最优路径：`maestro-collab → maestro-plan → maestro-execute → spec-load → maestro-init`（ANT-1-1，0.93）
- Top 3：ANT-1-1 (0.93) / ANT-1-2 (0.90) / ANT-1-3 (0.88)

### 8.2 关键产物索引

| 产物 | 路径 |
|------|------|
| 分析报告（英文） | `docs/session-context-layer-proposal.md` |
| 最优解 JSON | `.workflow/.team/TS-cmd-context-inherit-20260711/best.json` |
| 完整 swarm 报告 | `.workflow/.team/TS-cmd-context-inherit-20260711/artifacts/swarm-report.json` |
| 蚁产物（5 个） | `.workflow/.team/TS-cmd-context-inherit-20260711/artifacts/ant-1-{1..5}.json` |
| 评分输出 | `.workflow/.team/TS-cmd-context-inherit-20260711/scores/iter-1-scores.json` |
| 本规划 | `docs/session-context-layer-plan-zh.md` |

### 8.3 未探索节点（建议后续轮次覆盖）

- `maestro-ralph-v2`（首选非 LEGACY 编排器，可能已统一 GAP-5）
- `maestro-universal-workflow`（可能是共享层抽象）
- `maestro-ralph-execute`（内联执行器上下文发现）
- `quality-retrospective`（learnings.md 共享状态的另一消费者）
