# 借鉴 harness-cli 修复 Maestro-Flow 的 R5 / R7

> 配套文档：`guide/maestro-workflow-diagnosis.md`（问题诊断 R1–R10）。本文是**解决方案设计**——从 [harness-cli (AIOS)](https://github.com/rexleimo/harness-cli) 的三个 skill 提炼可移植模式，定点修 Maestro 的 **R5（长跑闭环复利漂移）** 与 **R7（~62% 最强不变量只写在散文里）**。
> 来源 skill：`aios-long-running-harness`、`verification-loop`、`pre-edit-safety-gate`（均读自 harness-cli `skill-sources/`）。

---

## 0. 一句话内核（最大的借鉴）

> **harness 也用 "MUST" 散文，但它总是把每条散文绑定到 `(命令 + BLOCK 规则 + 回退协议)`，并把状态外置成"证据"而非"prompt 重放"。**

Maestro 的 R7 根因正是"散文不绑定机器信号"，R5 根因正是"每 tick 全量重放有损快照"。harness 的两条工程纪律恰好对症：**把 LLM 自我约束的散文，降级为运行时可检的门 + 外置证据。**

---

## 1. 三个借鉴源的机制提炼

### A. `aios-long-running-harness` —— 有界循环 + 证据 + 检查点（治 R5 主力）
7 步循环：Preflight（锁定 objective/stop 条件/预算/必产物）→ Plan（**幂等步 + 显式成败证据**）→ Execute（一次一步 + 工具输出捕获）→ Verify（**从证据断言完成，不靠假设**）→ Checkpoint（持久化状态/产物/下一步）→ Recover（失败先分类，**只改一个变量再重试**）→ Complete（终验 + 摘要）。

关键纪律（对 Maestro 直接有用）：
- **Context Boundary**：`SKILL.md:37` "Use ContextDB as storage and evidence, **not as prompt replay**"；resume 要**显式意图**，"**Load only the selected handoff / checkpoint needed for the next step**"，"**Do not feed `context:pack` output into a model prompt**"（`:39-45`）。→ 与 Maestro 的 `/goal` "每轮以 status.json 为唯一行动手册（全量重放）" **正相反**。
- **Required Controls**（`:52-57`）：per-step / per-run 时间预算；**per-failure-class 重试预算**；human-gate 检查点；stage 跟踪（research/requirements/planning/development/validation/handoff）+ 具体证据；每个转换有结构化日志。
- **Recovery Rules**（`harness-checklist.md:15-19`）：**"Never apply two fixes at once. On each retry, change only one variable. After two failed retries in same class, escalate for human decision. Persist context before any manual handoff."**
- **Completion Gate**（`:66-71`）：**全部为真才宣布成功**——目标动作成功 + 期望产物存在 + **证据快照/日志存在** + runbook 已更新观测到的漂移。
- **Failure Classes**（`:59-64`）：显式失败分类（UI 漂移 / 认证丢失 / 策略拒绝 / 网络 / 工具错误）。

### B. `verification-loop` —— 断言前先有证据（治 R7 完成自证）
- 触发（`:17-22`）：改了运行时行为、**将要说 "done/fixed/works/passes"、将要 bump 版本** 时。
- 规则（`:24-25`）：**"Prefer commands with deterministic exit codes over 'it looks fine'. If you cannot run verification, say exactly what you could not run and why."**
- 证据捕获（`:42-44`）：记录**确切命令 + 成败 + 首条可执行错误行**。

### C. `pre-edit-safety-gate` —— 把 "MUST" 绑定到运行时工具（治 R7 强制 + R8 复用 KG）
- 开宗明义（`:17`）：**"This skill gates ALL code modifications. It is NOT optional. Skip it and your edits are invalid."**
- 每个检查 = **命令 + BLOCK 规则**（`:37-54`）：`get_impact_radius` → **risk=high → STOP**；`query_graph(tests_for)` → **No tests → write tests FIRST**；post-edit 必跑 typecheck + tests。
- **Fallback Protocol**（`:93-105`）：CRG 图工具不可用时用 `rg`/`git diff` 回退，**但 Style / Typecheck / Tests 仍不可跳**。
- **Red Flags 反合理化表**（`:107-116`）："This is just a one-liner" → "One-liners cause regressions."
- 它用 **CRG（代码关系图）** 做强制门。**关键洞察：Maestro 已经有 KG（`src/graph/kg`），但 R8 显示它 fail-open、没人读、与代码漂移——已有图却不拿来当门。** harness 证明同样的图可以做强制 pre-edit 门。

---

## 2. 借鉴映射 → Maestro 具体改造

### 治 R7（不可执行不变量）
**核心：把 `maestro-ralph.md` 的 `<invariants>` 改造成 pre-edit-safety-gate 式的"检查表"——每条不变量配 `(命令 + BLOCK 规则 + 回退 + 不可跳子集)`。** 这与诊断文档 P0 的"不变量→代码断言一致性层"同向，harness 给了成熟模板。

| Maestro 病灶（已验证代码位） | harness 解法 | 落地改造 |
|---|---|---|
| `retry_count` 是死字段（`src/ralph` 从不自增），`max_retries` 不可执行 | Failure Classes + Recovery Rules（一次一变量 / 同类 2 次升级） | `cmd-complete.ts` 真正自增并设界；按 `failure_class` 分桶计数；同类满 2 次 → `status='paused'` 升级 |
| `done_when` 自证（goal-audit 让 delegate 自由判定） | verification-loop：确定性退出码 | `done_when` 必须是**可执行命令**；`A_GOAL_AUDIT_EVALUATE` 不再让 delegate 主观判，而是**跑 done_when 命令看 exit code**，证据落盘 |
| inv 8 "missing required → pause" 未实现（`cmd-next.ts:104-109` 不暂停） | "Human-gate checkpoint" + "persist context before handoff" | 失败先 **checkpoint** 再 `status='paused'`（先持久化再 handoff） |
| inv 6 `completion_confirmed`（已是唯一真强制） | Completion Gate（证据齐全才算成功） | 升级：CLI 写 flag 之外，**要求 evidence snapshot/log 文件存在**才算 DONE |
| `<invariants>` 全是散文、无命令 | 每条 MUST 配 命令+BLOCK+回退 | 不变量检查表 + CI 一致性层；并把 **KG（`src/graph/kg`）接成 execute 前的 impact 门**（risk=high→STOP / 无测试→先写）——一并治 R8 |

### 治 R5（长跑复利漂移）
**核心：照搬 harness 的 "ContextDB 作证据不作 prompt 重放" + "只加载下一步所需节点级证据" + "有界循环、一次改一个变量"。**

Maestro 现状（已验证）：`/goal` "每轮以 status.json 为唯一行动手册"（`maestro-ralph.md:721`）= 全量重放有损快照 → 复利漂移；fix-loop 无界、myopic。

借鉴改造：
1. **停止全量重放**：每 tick 不再把整个 `status.json` 当行动手册，而是像 `aios refs grep/read` 那样**只加载"下一步 step 所需的节点级证据 + 不可变 objective anchor"**。
2. **锚点 / 证据分离**：harness 把 `objective`（不可变）与 `checkpoint evidence`（可增）分开——这正是诊断文档 P0 "意图锚点与代理目标分离"的成熟实现。Maestro 应把"原始需求 anchor"独立于会不断被 fix-loop 改写的 `task_decomposition`。
3. **证据型检查点 + 定向 resume**：每步写 checkpoint（stage + 具体 evidence）；resume 只取最新 checkpoint + 下一步，**显式意图触发**，不重放全历史。
4. **一次改一个变量 + 同类 2 次升级**：把 Recovery Rules 写进 ralph 的 fix-loop，替换现在的无界 myopic fix（同时缓解 R5 的"局部修复累积全局不一致"）。
5. **Completion Gate 证据齐全才停**：替换"done_when 自证 + 监控看不见"；success 必须有 evidence snapshot + log，并**落进 status.json 让 dashboard 看得见**（一并治 R10）。

---

## 3. 一张"现状 → 借鉴 → 改造"总表

| Maestro 病 | 现状（代码位） | harness 模式（出处） | 落地改造 | 优先级 |
|---|---|---|---|---|
| R7 retry 死 | `retry_count` 从不自增 | per-class 预算 + 一次一变量 + 2 次升级（harness-checklist:15-19） | `cmd-complete.ts` 自增设界 + Failure Classes 表 | **P0** |
| R7 done_when 自证 | delegate 主观判定 | 确定性退出码（verification-loop:24） | done_when=可执行命令；goal-audit 跑命令看 exit code | **P0** |
| R5 全量重放漂移 | `/goal` 全量 status.json（ralph:721） | 证据非重放 + 节点级 recall（harness SKILL:37,43） | 锚点/证据分离 + 只加载下一步证据 | **P0** |
| R5 myopic fix | 无界 fix-loop | 一次一变量 + 持久化再 handoff | fix-loop 套 Recovery Rules | P1 |
| R7 invariant 散文 | `<invariants>` 无命令 | 每条配 命令+BLOCK+回退（pre-edit-gate:37-54,93-105） | 不变量检查表 + CI 一致性层 | P1 |
| R8 KG fail-open | KG 没人读、与代码漂移 | CRG 做强制 pre-edit 门 | 把 `src/graph/kg` 接成 execute 前 impact 门 | P1 |
| R10 监控盲 | E-code 不落盘 | 结构化日志 + evidence 落盘（completion gate） | checkpoint evidence 写 status.json | P1 |

---

## 4. 设计哲学对照（为什么 harness 不漂而 Maestro 漂）

| 维度 | Maestro 现状 | harness 做法 |
|---|---|---|
| 不变量 | 散文 MUST，LLM 自我执行 | 散文 **+ 命令 + BLOCK 规则 + 回退** |
| 完成判定 | `done_when` 由 delegate 主观判 | **确定性退出码 + 证据快照存在** |
| 长跑状态 | 每 tick **全量重放** 有损 status.json | **证据外置、定向 recall、不重放 prompt** |
| 重试 | `retry_count` 死字段、无界 fix | **per-class 预算、一次一变量、2 次升级** |
| 已有图 | KG fail-open、没人读 | 图是**强制 pre-edit 门** |

> 同样面对"长跑 + 多模型 + 部分失败"，harness 把它当**系统问题**（外置状态、有界循环、确定性包裹、可观测优先、人门兜底——见 `anthropic-mapping.md`，源自 Anthropic 长跑 agent harness 工程文）；Maestro 当**prompt 问题**（靠一份 status.json 全量重放 + LLM 守散文）。**这就是 R5/R7 的根，也是最值得借鉴的内核。**

---

## 5. 落地优先级（最小改动、最高杠杆优先）

1. **P0 · `done_when` → 确定性退出码命令**（verification-loop）：goal-audit 跑命令看 exit code，不再主观判。直接拔掉 R7 的"自证完成"。
2. **P0 · retry per-class 预算 + 一次一变量 + 2 次升级**（harness Recovery Rules）：在 `cmd-complete.ts` 让 `retry_count` 变真并设界。拔掉 R7 的"无界循环"。
3. **P0 · `/goal` 停止全量重放 → 锚点/证据分离 + 节点级 recall**：拔掉 R5 复利漂移的根。
4. **P1 · 不变量检查表**（pre-edit-gate 模板）+ **把 KG 接成 pre-edit 门**：一并治 R7+R8。
5. **P1 · checkpoint evidence 落 status.json**：让监控看得见（治 R10）。

---

## 6. 注意事项

- harness-cli 是独立项目；本文借的是**模式**，不是代码。代码级移植需查其 license（其 README 以 CHANGELOG 占位，未显式声明，**移植前必须确认许可**）。
- harness 的 pre-edit-gate 依赖 CRG MCP + Fallback。Maestro 已有 KG，适配成本低，**但要先修 KG 的 fail-open/drift（R8）才能当门**。
- 更大的借鉴是 **ContextDB**（SQLite 记忆 + genealogy + checkpoint + context-pack）——本文只用了它"证据非重放"的循环原则，**未涉及 schema 移植**，作为单独话题。
- harness 自身也带 R7 风险（同样用 "MUST 必须 invoke skill" 散文）——它的优势不在"没有散文"，而在"散文背后有运行时门"。借鉴时要借**门**，不是借更多散文。
