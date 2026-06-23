# ContextDB 之外：harness-cli 还有哪些值得借鉴

> 背景：用户判断 **ContextDB ≈ Maestro 的 wiki/spec(存储,不必借鉴)**;真正的差距是 **R8 触发率**——怎么让 agent 真去用它。本文盘点 ContextDB 之外、按价值排序的可借鉴点,每条映射到 Maestro 的 R 病灶。借的是**机制 / 纪律**,不是"又一个存储"。
> 配套:`maestro-workflow-diagnosis.md`(R1–R10)、`maestro-r5r7-harness-borrow.md`(长跑+验证门)、`maestro-hooks-analysis.md`(hooks)。

---

## 排序总览

| # | 借鉴点 | 来源 | 治 | 价值 |
|---|---|---|---|---|
| 1 | **SkillOpt**——把"触发率/合规"变成训练出来的数字 | `skill-opt-lite` + `.skillopt/*` | R8 | 🔴 最高 |
| 2 | **"data plane is code" + metrics 落盘** | `aios-interception-runtime` | R10 / R7 | 🔴 |
| 3 | **no-injection 哲学 + 定向召回** | `contextdb-autopilot` / `aios-offload-recall` | R8 / R5 | 🔴 |
| 4 | **"只路由不实现"的 router 红线** | `aios-workflow-router` | R1 / R6 | 🟠 |
| 5 | **按能力/成本选模型** | `model-router` | delegate | 🟠 |
| 6 | **CRG 跨客户端 MCP + pre-edit 门** | `aios-codemap-ops` | R7 / R8 | 🟠(部分已在 R5/R7 文档) |
| 7 | versioning-by-impact / find-skills / debug-hub | 同名 skill/包 | 小颗粒 | 🟡 |

---

## 1. SkillOpt —— 把"触发率/合规"变成训练出来的数字（治 R8,最高价值）

**这是对"触发率"问题最直接的解,且 Maestro 已有同类机制却没用对地方。**

- `skill-opt-lite`:像训神经网络权重一样训练 skill 文档——train/valid 任务集 + `ROLLOUT→REFLECT→AGGREGATE→SELECT→UPDATE→GATE` 循环;**门只在 `candidate_hard > current_hard` 严格改进时接受,否则回滚**;"generalize don't memorize";protected region(`SLOW_UPDATE`)只在 epoch 末改。
- `.skillopt/contextdb-no-injection-*/baseline_results.json` 是**真实分数**:`hard`/`soft` + `fail_reason: "missing required pattern…"`,baseline `train 0.5 / valid 0.33` → 迭代到 `best_score 1`。即:**skill 是否触发/合规,是被任务集测出来、被优化器调出来的指标。**
- **对 Maestro**:已有 `skill-iter-tune`(对标 skill-opt-lite),但没拿来量"触发率"。借鉴 = 建一个"该搜索 / 该查 KG / 该走 verify 时,agent 是否真做了"的任务集,用严格改进门迭代 skill 的 `description` + body,把 R8 从"写了没人读"变成**被测量、被优化的数字**。这正是用户点出的"触发率"问题的工程化解法。

## 2. "data plane is code" + metrics 落盘（治 R10 / R7）

- `aios-interception-runtime`:**"Data plane is code, not prompt"**——必做的(token 压缩、refs、shell 拦截)做成确定性数据面(proxy + 进程级 shim),**不靠 agent 触发**;`metrics 强制落 .aios/interception/metrics/<session>.jsonl(saved_bytes / saving_ratio)`;红线 **"Do not answer with prompt-only advice when a deterministic interception surface is available"**。
- **对 Maestro**:这是 R10(监控盲)+ Hooks H4(静默 fail-open)的解——把 hook 跳过 / 超时 / 注入结果**落成可见 metrics**(而不是 `catch{}` 吞掉);把"必做"从 prompt 提示升级为确定性面。Maestro 有 `bin/maestro-context-monitor.js` 但没有这套"拦截即代码 + 强制 metrics"。

## 3. no-injection 哲学 + 定向召回（治 R8 / R5）

- `contextdb-autopilot`:**有意砍掉 auto-injection**("no longer a prompt-injection layer",废弃 `--startup-mode inject` / `CTXDB_AUTO_PROMPT`),因为注入 = token 膨胀 + **重放漂移(=R5)**;改"显式 search-first + 用户点名 resume"。
- `aios-offload-recall`:先看 Mermaid canvas(`canvas show`),再 `refs grep`/`refs read` **只读匹配节点的证据**,不重放全历史。
- **对 Maestro**:这是 Hooks H3(重注入,正是 harness 抛弃的路线)+ R5(`/goal` 全量重放)的解——别再加注入器,把检索做成**窄而显式的 skill + 节点级定向召回**(锚点与证据分离)。

## 4. "只路由不实现"的 router 红线（治 R1 / R6）

- `aios-workflow-router` 开宗明义:**"routing layer ONLY — it classifies tasks and dispatches… It MUST NOT implement any workflow logic itself."** 外加 cross-client skill 名解析(`superpowers:brainstorming` → `brainstorming`)。
- **对 Maestro**:R1(三套路由)+ R6(三引擎)的病根之一就是**路由与执行纠缠**(GraphWalker 既路由又执行、ralph 既建链又推进)。借鉴这条**架构红线**(router 永不实现、只分派),能从源头防止路由层各自长出执行逻辑、避免引擎再分裂。

## 5. 按能力/成本选模型（治 delegate 静态）

- `model-router`:**"不要把所有任务都默认塞给实现模型"**;按 profile / 能力 / 成本选 codex(GPT-5.5)/ gemini(Gemini-3-Pro)/ claude,并生成调用指令。
- **对 Maestro**:`delegate` / `cli_tool` 选择现在基本静态。借鉴 = 给 delegate / team 加一层"按任务类型选模型"的路由(分析→便宜快模型、实现→强模型、审查→对抗模型)。

## 6. CRG 跨客户端 MCP + pre-edit 门（治 R7 / R8,部分已在 R5/R7 文档）

- `aios-codemap-ops`:把 **CRG(代码关系图)作为 MCP** 装到所有客户端(`~/.codex/config.toml`、`.mcp.json`、`.gemini/settings.json`);`pre-edit-safety-gate` 拿它做**强制门**(`get_impact_radius` risk=high→STOP、`tests_for` 无测试→先写)。
- **对 Maestro**:已有 KG(`src/graph/kg`),缺的是**"把 KG 当 pre-edit 强制门"+ 跨客户端 MCP 服务**。详见 `maestro-r5r7-harness-borrow.md` §C。

## 7. 小颗粒

- **`versioning-by-impact`**:按"实际变更影响"(none/patch/minor/major 规则)而非任务大小定 semver → `maestro-milestone-release` 可借这套判定。
- **`find-skills`**:技能发现/安装("find a skill for X")→ `maestro-help` 可借交互。
- **debug-hub(`packages/debug-hub`)**:evidence-first debug server(HTTP API、log 注入、collection)→ R10 可借作"证据收集面"。

---

## 一句话

ContextDB 不必借(= wiki/spec)。**最该借的是"让能力真被触发 / 被强制 / 可观测"的那一层**:
① **SkillOpt** 把触发率变成训练指标(治 R8——用户自己的洞察);
② **"data plane is code" + metrics 落盘**(治 R10);
③ **no-injection + 定向召回**(治 R8/R5);
④ **router 只路由不实现**(治 R1/R6)。

这四条都是**机制 / 纪律**,改的是"agent 会不会用、能不能被挡、出问题看不看得见"——而不是再加一个更强的存储。
