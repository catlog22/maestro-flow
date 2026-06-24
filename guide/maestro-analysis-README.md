# Maestro-Flow 工作流诊断与借鉴 · 分析文集索引

> 一组成体系的分析文档：从「为什么 `maestro` / `maestro-ralph -y` 效果差、需求越跑越偏」的**诊断**，到从姊妹项目 [harness-cli (AIOS)](https://github.com/rexleimo/harness-cli) 提炼的**改进借鉴**。
> **全部经过对抗式多子代理审计 + 对照最新上游校准**，是纯分析（无任何代码改动）。

---

## TL;DR — 统一根因（一句话）

> **Maestro 把保证编码成"只有 LLM 才执行的自然语言不变量"，从不把原始需求带下去，也无法观测由此产生的偏离。**

这一条解释了用户的三个体感：意图理解差（入口三引擎 + 死/错路由）、需求不遵守（原意逐级再抽象、不回读；追溯与不变量都只写散文）、`-y`/长跑越来越偏（终止门与回锚门都是 spec-only，无代码兜底，且监控连"在偏"都看不见）。

---

## 四份文档（建议阅读顺序）

| # | 文档 | 讲什么 | 关键产出 |
|---|------|--------|----------|
| 1 | **[诊断报告](./maestro-workflow-diagnosis.md)** `maestro-workflow-diagnosis.md` | 问题：是什么 / 为什么 | R1–R10 + 统一根因；§0.5 对照最新上游的时效性校准 |
| 2 | **[hooks 分析](./maestro-hooks-analysis.md)** `maestro-hooks-analysis.md` | 已有的强制面在哪、问题在哪 | H1–H6；上游分支评估（§4）；Maestro⟷harness hooks 对比（§5） |
| 3 | **[R5/R7 借鉴](./maestro-r5r7-harness-borrow.md)** `maestro-r5r7-harness-borrow.md` | 长跑 + 验证门怎么修 | 从 3 个 harness skill 借"门"：done_when→退出码、retry 设界、KG→pre-edit 门 |
| 4 | **[ContextDB 之外借鉴](./maestro-harness-borrow-beyond-contextdb.md)** `maestro-harness-borrow-beyond-contextdb.md` | 除存储外还有什么值得借 | SkillOpt 触发率 / data-plane is code / no-injection / router 红线 |

> 读 1 建立全局；读 2 看"已有资产 + 上游现状"；读 3、4 看"怎么借 harness 修"。

---

## 发现地图（R1–R10）

| R | 一句话 | 主文档 |
|---|--------|--------|
| **R1** | 三套并存且互相矛盾的意图路由（命令体新架构 vs deferred 大脑旧架构 vs regex intent-map） | 诊断 §1 |
| **R2** | 上下文逐级再抽象，原始需求/意图全链**永不回读**（plan 只吃 analyze 的 `implementation_scope`） | 诊断 §2/§3 |
| **R3** | roadmap 的 `Requirements` 追溯**只写不读**（悬空）+ `boundary_contract` 不传播 | 诊断 §3 |
| **R4** | `-y` 缺"非交互的意图保真替代"——砍掉了本应自动跑的 Search-first，退回拍脑袋 | 诊断 §4 |
| **R5** | 长跑闭环复利漂移：锚点早冻 + 每轮全量重放 status.json + 自证 + 无回锚门 | 诊断 §5 |
| **R6** | **三套**编排运行时（GraphWalker / Ralph / PhaseOrchestrator）+ 13 状态孤岛 + 3 路由缺陷 | 诊断 §9 |
| **R7（根因）** | ~62%（抽样）最强不变量**只写在散文里**：`retry_count` 死字段 / E007 不暂停 / inv13 零代码 | 诊断 §9 |
| **R8** | 知识子系统 **fail-open**——写了没人读；**真正的差距是"触发率"**（让 agent 真去用） | 诊断 §9 + hooks H3 |
| **R9** | 团队子系统复刻 R2 意图丢失 + 1184 行重复 + 消息总线命名空间分裂 | 诊断 §9 |
| **R10** | 监控**对自身失败视而不见**——E-code 不落盘、dashboard 丢 `retry_count` | 诊断 §9 + hooks H4 |

`H1–H6` 是 R7/R8 在 hook 层的具体表现（guard 火力指向危险命令、保真 guard 拨到 warn/死代码、软注入、静默 fail-open），见 hooks 文档。

---

## 0.5.35 合并后逐条校准 × 设计/缺陷归因（实测）

> 把上文 R1–R10 / H1–H6 全部发现，放回**合并 upstream 后的 master `0.5.35`**（合并 commit `80f2f473`）逐条复核——4 路子代理并行 + R9 codex 交叉复核，按符号/语义重定位（旧行号已漂移），并以 **git 历史取证** 定 A/B 边界。校准日期：2026-06-24。
> **完成情况**：✅ 已修复 · ⚠️ 部分改善（根因仍在）· ❌ 未修复/未改动 · 🔵 确认仍成立（原有机制/分叉）。
> **归因三类**：**A 实现缺陷**（言行不一/死代码/疏漏·该修）· **B 有意设计**（改它=改产品方向·非 bug）· **C 意图对·执行漏一环**（补执行即兑现）。
> **统计**：A 类 16 中 **4 条本批已修**（R6-1/R6-3/R7-2 + R10-2 部分，见下「修复执行记录」）· R9-3 早已修 · **R6-2 经细读为误判**（有意整合，移除）· 余 ❌ 未修。B 类 8（多为「❌ 未改·本属设计」+ 2 🔵 确认）· C 类 8（R1.3/R9-4/H4 ⚠️ 部分，余 ❌）。判定列已反映 `fix/maestro-a-class-cleanup` 分支。

### A 类 · 实现缺陷（无争议·该立刻修）

| 发现 | 判定 | 当前证据 |
|---|:---:|---|
| R1.1-a regex 路由（缺 grill/blueprint/analyze-macro、fallback=quick） | ❌ | `intent-router.ts:10` DEFAULT_GRAPH='singles/quick'；`_intent-map.json` 仍无三链路、fallback singles/quick(276) |
| R1.1-b deferred 大脑（旧架构残留、纯顺序、旧 schema） | ❌ | `workflows/maestro.md:290` "no decision nodes—purely sequential" 仍在；旧大脑未随新命令体退役 |
| R1.1-c 命令体↔大脑架构矛盾（迁移未完成） | ❌ | `.claude/commands/maestro.md` ralph-protocol-v1 与大脑两套并存；运行时仍 Read 那份矛盾大脑 |
| R3.1 roadmap Requirements 悬空（写了不读） | ❌ | 设计了 `Requirements` 追溯字段，但 `plan.md` 下游从不读（0.5.35 未触及） |
| R6 三套编排运行时未合并 + PhaseOrchestrator 死代码 | ❌ | GraphWalker 自称 "unified bridge" 却未取代另两者；PhaseOrchestrator 从未有生产调用（仅测试引用） |
| R6-1 verify.json 死路由 | ✅ 已修 | **本批**：清 `_intent-map`/`_router` 中 3 处指向已删 verify/execute-verify 的死路由 → `singles/execute`；验证门 missing 2→0 |
| ~~R6-2 spec-map.json 错连~~（误判） | ⚠️ 移除 | **细读纠错**：`spec-map.json:18` description 明示 `consolidated into manage-codebase-rebuild`（有意整合），cmd 指向正确，非错连 |
| R6-3 spec-generate.json 孤儿 | ✅ 已修 | **本批**：删除（全仓 0 引用，含 id 误写的 `singles/roadmap-full`） |
| R7-2 E007 不暂停（inv 8·这组唯一真缺陷） | ✅ 已修 | **本批**：`cmd-next` 照 BLOCKED 范本补 pause+持久化，打破无限重试；vitest 断言 `status==='paused'` |
| R9-2 1184 行逐字节重复 | ❌ | team-swarm vs team-adversarial-swarm 下 aco/test_aco/pheromone/scoring 四文件 `diff` 全 IDENTICAL（473+475+144+92） |
| R9-3 消息总线命名空间分裂 | ✅ | 主平台统一 `mcp__maestro__team_msg`（134 处）；`ccw-tools` 仅余 skill-converter.ts:506 死引用 |
| R10-1 E-code 不落盘 | ❌ | RalphSession 无 findings 字段；E006/7/10 仅 stdout/stderr，dashboard 看不到 E007 陷阱 |
| R10-2 dashboard 投影丢字段 | ✅ 部分 | **本批**：`RalphStep` 类型对齐补 `completion_status` 等（投影可达）；但 retry_count 是 B 类空字段、渲染增强后续 |
| R10-3 fs-watcher 静默吞错 | ❌ | `fs-watcher.ts:180-182` 裸 `catch{}` 吞解析错（mid-write 容错合理，但真损坏也一并吞） |
| H2 spec-validator block 死代码 + Edit 旁路 | ❌ | runner `hooks.ts:850` 引入即只传 2 参→block 死代码（commit `f0594770`）；`if(!content) return` Edit 仍旁路 |
| H6 注入器冗余（6 个重叠） | ❌ | 旧注入器全在；新增 kg-unified-injector 是叠加且默认关（opt-in）；想删的 3 个一个没删 |

### B 类 · 有意设计（改它=改产品方向，非 bug）

> 判定栏 ❌ = 「未改动·本属设计」，非待修缺陷。⚠️ 标记的几条，其**风险敞口**正是 3 篇 harness 借鉴文档主张补强制之处。

| 发现 | 判定 | 当前证据（git 取证） |
|---|:---:|---|
| R7-1 retry_count/max_retries「决策交 LLM」 | ❌ | commit `c19cb04a`：invariant 1 "Ralph never executes steps"，字段挂 `RalphStep.decision`=给 LLM 填的槽，`cmd-next.ts:90` 主动拒绝决策节点。⚠️ 无代码兜底 |
| R7-3 confidence_score/parse_failed（inv 13）prose-only | ❌ | commit `93b87da8` 只改 `.md`；ralph 不写 `decisions.ndjson`，由 LLM 散文动作记录。⚠️ LOW-CONFIDENCE 靠 LLM 自觉 |
| R7-4 引擎/Ralph 重试分叉 | 🔵 | `graph-walker.ts:1063-1100` 有界重试真存在；Ralph 侧交 LLM——分叉是有意分层 |
| R7 反证 completion_confirmed 真强制（接线范本） | 🔵 | 同 commit 字段+4 处写入+`status-checker.ts:69` 校验一起接线；反衬 retry_count 不接 CLI 是分层 |
| R8 知识 fail-open（软注入·读侧） | ❌ | commit `78acfcfa` 注释 `Design: advisory rather than rewriting`，出生即 advisory。⚠️ 空库静默、KG 只看未提交改动 |
| H1 guard 火力指向危险命令（保真 guard advisory） | ❌ | 仅 workflow-guard `exit(2)`；PathGuard `enabled:false`、preflight warn、prompt-guard 只警告=有意火力分配 |
| H3 注入 ≠ 调用（软注入） | ❌ | 全部 injector 仍 additionalContext/updatedInput 软拼（同 `78acfcfa` Design 注释） |
| H5 requiresWorkspace 门控 | ❌ | 无 `.workflow/` 不触发=合理 gating；spec/kg-* 全 requiresWorkspace:true（global-spec-injection 未落 master） |

### C 类 · 意图对·执行漏一环（补执行即兑现已有意图）

| 发现 | 判定 | 当前证据 |
|---|:---:|---|
| R1.3 A_INFER_POSITION 浅启发式 | ⚠️ | 词表新增 grill/blueprint/analyze-macro + 前置 A_RESOLVE_PHASE/SCOPE_VERDICT；但关键词 override + bootstrap 机制未除（`maestro-ralph.md:210-234`） |
| R2 上下文逐级再抽象、原文不回读 | ❌ | 管线分层是设计；缺「原文回读/意图锚点」机制。0.5.35 未改 `plan.md`/`analyze.md`（plan 仍吃 implementation_scope） |
| R3.3 boundary_contract 不传播进 roadmap | ❌ | boundary_contract 是好设计，但 `roadmap-common.md` Load Context 不读它=断链（0.5.35 未触及） |
| R4 `-y` 砍多了（连 Search-first 一起跳） | ❌ | 不交互对；但 `interview-mechanics.md` 第 4 行 Search-first 与第 6 行 skip 自相矛盾，自动落地被一并砍 |
| R5 锚点早冻 + 全量重放 + 无回锚门 | ❌ | 「单一真源 status.json」是有意简化（`maestro-ralph.md:721`）；副作用放大漂移（R5.4 认定可修） |
| R9-1 team 意图再派生（缺原话透传执行链） | ❌ | 管线派生是设计；原话以 requirement 透传进 prompt 但执行链不消费（`role-spec-template.md:94,141`） |
| R9-4 角色加载契约分歧 | ⚠️ | 契约已统一只认 role_spec；但来源仍二元（动态 session role-spec vs 静态 roles/<role>/role.md） |
| H4 静默 fail-open + 监控盲 | ⚠️ | 容错是设计；不可观测是漏的一环。新增 3 注入器 outcome/duration 埋点；但 500ms 截断、catch{}、不落 status.json 依旧 |

---

## 设计意图 vs 实现缺陷（git 取证 + 分层归属）

> 承上表的「❌ 未修复」——它们并非同质。本节用**两把尺子**切开未解决项：① 是**有意设计(B)** / **实现缺陷(A)** / **意图对但执行漏一环(C)**；② 落在**哪一层**（skills 散文 / hooks / 纯 js·ts）。A/B 边界由 **git 历史取证**（commit message + 字段出生史 + 代码注释）定夺，非主观。

### 判别钥匙：强制力的物理位置

一条规则最终靠什么保证执行？`进程退出码`（hooks `exit(2)` / CLI `return`）= 硬强制 · `schema 校验` = 半强制 · `纯散文 MUST`（靠 LLM 自觉）= 不强制。**R7/R8 的统一根 = 最强的话（MUST/唯一真源）写在最弱的位置（散文）。**

### git 取证的关键修正（推翻初判一半）

初判把 R7 的 `retry_count`/`confidence_score`/inv13 归为「A 类·半接线假象」。git 取证后修正：

- **`retry_count`/`max_retries`、`confidence_score`/`parse_failed`(inv 13) → 改判 B 类有意设计**。invariant 1 "Ralph never executes steps — only evaluates decisions"；`cmd-next.ts:90` 主动拒绝加载决策节点；字段挂在 `RalphStep.decision` 上 = 给 LLM 填的 schema 槽，`A_APPLY_FIX/ESCALATE` 是散文里的 LLM 动作（commit `c19cb04a`）。代码不自增**不是 bug，是有意把决策层交给 LLM**。
  - ⚠️ 但这正是 R7/R8 的**风险敞口**：有意交 LLM = 无代码兜底。它是 B（设计），却恰是 harness 借鉴文档主张补强制的点。准确表述是「**有意把强制交给 LLM**」，非「假装有强制」。
- **E007 不 pause(inv 8) → 仍是 A，且是这组唯一真缺陷**：同 commit `c19cb04a` 的 BLOCKED 分支真 pause 了，E007 却只 `return 1`——能力在手边却漏接。
- **`completion_confirmed`（正例）→ B**：同 commit 字段+4 处写入+校验一起接线，反衬 retry_count 的「不接 CLI」是分层而非遗忘。
- **软注入 advisory → git 确证 B**：commit `78acfcfa` 注释 `Design: ... advisory rather than rewriting`，出生即 advisory，无转变 commit。
- **三引擎 / PhaseOrchestrator / spec-validator block / verify.json → git 确证 A**：GraphWalker 自称 "unified bridge" 却没取代另两个（演进残留）；PhaseOrchestrator 从未有生产调用（死代码）；spec-validator 引入即只传 2 参（死分支）；`9f270523` 删 verify 没清 `_intent-map` 引用（死路由铁证）。

### 分层归属（这是 skills / hooks / 还是纯 js 的问题？）

| 层 | 承载什么 | 落在这层的发现 | 性质 |
|---|---|---|---|
| **Skills·散文**（`commands/*.md`、`workflows/*.md`、skill specs） | 写给 LLM 的规则 + 编排逻辑 | R1.1-b/c、R1.2/1.3、R2/R3/R4/R5、R7 散文 invariant、R9-1 role.md、retry/confidence「交 LLM」设计 | **根在这**·多为设计哲学(B)+ 演进残留(A)，改它=改 .md |
| **Hooks**（`src/hooks/`） | 唯一能 `exit(2)` 真阻断的强制面 | H1–H6、R8 读侧 | 「本可强制却有意没强制」的缺口：软注入/门控是 B，spec-validator 死代码是 A |
| **纯 JS/TS**（`src/ralph`、`coordinator`、`team`、`dashboard`） | 运行时执行逻辑 | E007 不 pause、死路由、PhaseOrch 死代码、R10 监控、R9-2（实为 python）、R9-3 命名空间 | **无争议铁缺陷集中在这**·数量最少、最该立刻修 |

> **一句话**：问题不均匀分布——**根在 skills 散文层**（架构矛盾、工作流逻辑、不变量全写成散文），**hooks 层是「本可强制却有意没强制」的缺口**，**纯 js/ts 层只有少数铁缺陷**（E007/死路由/死代码/监控丢字段）。最迷惑人的一点：不少**看似 js 代码 bug** 的（retry_count 不自增）其实是 skills 层「决策交 LLM」哲学在代码层的**投影**——代码是**故意留空**的。

### 分析着眼点（方法）

① **言行一致性**（声称的契约 vs 实现，主轴）→ ② **强制力的物理位置**（退出码/schema/散文）→ ③ **契约归属**（CLI 代码 vs LLM 散文兑现，定「没代码=缺陷还是分层」，git 取证专为此）→ ④ **出生史**（出生即空 vs 曾实现后回退）→ ⑤ **系统性 + 意图信号**（孤例还是成片；有无 `Design:` 注释/commit message 佐证有意）。

---

## 修复执行记录（fix/maestro-a-class-cleanup · 2026-06-24）

> A 类逐条修复，每条配**独立确定性验证门**（不依赖全套测试绿——见下「测试体系裂」）。已提交 2 commit（docs + fix）。

### 已修复（4 条，均验证）

| 条目 | 修复 | 验证门 |
|---|---|---|
| R6-1 verify 死路由（×3） | `_intent-map`/`_router` 指向已删 verify/execute-verify → `singles/execute` | 图引用完整性 missing 2→0 |
| R6-3 spec-generate 孤儿 | 删除（全仓 0 引用） | 0 悬空引用 |
| R7-2 E007 不 pause | `cmd-next` 照 BLOCKED 范本补 pause+持久化 | vitest 断言 `status==='paused'` |
| R10-2 dashboard 投影 | `RalphStep` 类型对齐补 `completion_status` 等 | 改动文件 0 类型错 |

### 诊断纠错

- **R6-2「spec-map 错连」实为误判**：`spec-map.json:18` description 明示 `consolidated into manage-codebase-rebuild`（有意整合），cmd 指向正确。已从 A 类移除。**教训：agent 核验会漏读 description，动手前必须再读源**（否则按误判去「修」会引入真 bug）。

### 执行中暴露的 6 个地基问题（比单条缺陷更重）

1. R6-2 误判（见上）。
2. **execute-verify 第三死路由** —— 验证门自动揪出（人工/agent 枚举都漏了），实证「**确定性验证门 > 人工枚举**」。
3. **测试体系分裂** —— 37 `node:test` + 44 `vitest`，无统一 runner、零 CI 测试。
4. **12+ 个 node:test 文件长期红** —— 无人跑，失败累积无人知。
5. **src/ 编译产物污染** —— `graph-loader.js`/`.d.ts`/`.js.map` 混入源码树（coordinator 测试「能跑」竟靠它）。
6. **dashboard tsc 本来就不绿** —— `install-utils`/`embedding` 模块解析错。

### 重排 backlog（地基优先）

- **P0 地基**（挡着所有确定性验证）：测试体系统一（两 runner + CI gate）· 清 src 编译产物 · dashboard tsc 转绿 · 甄别/修 12+ 红测试。
- **P1 剩余 A**：R10-1 E-code 落盘 · R10-3 fs-watcher 区分 mid-write/损坏 · R9-2 python 去重 · PhaseOrchestrator 死代码（引擎，单独评估）。
- **P2 C 类散文层**：R3.1 Requirements 回读 · R2/R3.3/R4/R5/R9-1 · 架构档「正确处理引擎大脑」（R1.1 三路由/三引擎，不退役、单独正确处理）。
- **B 类（设计，需产品决策）**：R7-1/R7-3/R8/H1/H3/H5——是否把 Maestro 从「LLM 灵活」推向「确定性强制」。

---

## 借鉴地图（harness-cli → Maestro）

| 借鉴点 | 治 | 文档 |
|--------|----|------|
| ContextDB（≈ wiki/spec，**不必借**——存储不是差距） | — | beyond-contextdb |
| **SkillOpt**：把"触发率/合规"变成训练出来的数字（Maestro 已有 `skill-iter-tune` 却没用对地方） | R8 | beyond-contextdb §1 |
| **"data plane is code" + metrics 落盘** | R10 / R7 | beyond-contextdb §2 |
| **no-injection 哲学 + 定向召回**（注入正是 R5 漂移之源） | R8 / R5 | beyond-contextdb §3 |
| **long-running harness + verification-loop + pre-edit-gate**（每条 MUST 绑定 命令+BLOCK+回退；状态作证据非重放） | R5 / R7 | r5r7-borrow |
| **workflow-router「只路由不实现」红线** | R1 / R6 | beyond-contextdb §4 |
| **model-router** 按能力/成本选模型 | delegate | beyond-contextdb §5 |

**借鉴内核一句话**：harness 也用 "MUST" 散文，但**总把散文绑定到（命令 + BLOCK 规则 + 回退），并把状态外置成证据而非 prompt 重放**。借的是**门 / 纪律**，不是"又一个存储"。

---

## 跨文档修复优先级

- **P0 · 不变量→代码断言一致性层**：给每条 `<invariants>` 打 `enforced_by`，CI 校验绑定的符号存在且触及所述字段（当前会对 E007/inv13/retry-escalate 直接报错）。一层覆盖 R6–R10 的根。
- **P0 · 贯穿全链的"意图锚点"**：原始需求逐字留不可变 anchor，与有损的 `task_decomposition` 分离；plan/execute 强制回读；长跑加周期性 re-grounding 门。同治 R2/R3/R5。
- **P0 · `done_when`→确定性退出码 + retry per-class 设界**（借 verification-loop + harness Recovery Rules）。治 R7。
- **P1 · hooks 重新瞄准**：把已有 exit-2 阻断从"危险命令"扩到"工作流/知识保真"——PathGuard 默认开（= boundary 强制）、修 spec-validator 死 block + Edit 旁路、把 KG 接成 pre-edit 门。治 R7/R8/R3。
- **P1 · SkillOpt 量触发率**：用 `skill-iter-tune` 建"该搜索/该查 KG 时 agent 是否真做了"的任务集，严格改进门迭代。治 R8。
- **P1 · fail-loud + metrics 落盘**：hook 跳过/超时/空注入落可见信号（抄 harness）。治 R10。

---

## 方法论与可信度

- **对抗蜂群**（team-adversarial-swarm，真实 Python ACO 引擎 + Agent 模拟模块）：2 轮 8 蚁产出 R6–R10，3-投票对抗评分**逐条对照代码核验，0 幻觉、0 路径注水**。
- **4 路独立 fact-check 审计 + 再验证**：发布前对 4 份文档逐条 falsify；查出 3 处问题（决策节点表述自相矛盾、§0.5 措辞、门数枚举）已修复并再验证 PASS。
- **对照最新上游校准**（4 个非 master 分支）：2 个 `codex/*` 干净前向（KG 索引稳定 + 搜索），2 个 `0.4.24`/`0.1.4` 陈旧分叉（无共同祖先、落后 50 提交，只能 cherry-pick）。**新代码改"知识质量"，结构性根（R1–R7/R9/R10）未动**。

---

## 重要边界

- **纯分析，无任何代码改动。** 借鉴的是**模式 / 纪律**，不是代码——代码级移植需查 harness-cli 许可（其 README 未显式声明）。
- **上游合并指引**：`codex/kg-index-stability` / `codex/switch-kg-maestrograph-cli` 可 review 合并；`fix/global-spec-injection`（0.4.24）/ `feat-增强自动执行…`（0.1.4）只 cherry-pick 单个好提交，**勿整体合并**（会回退）。
- 诊断基于 master `0.5.3 @4be21744`；时效性校准见诊断 §0.5。
