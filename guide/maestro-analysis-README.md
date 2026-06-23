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
