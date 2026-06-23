# Maestro-Flow 工作流诊断报告：意图理解、grill/brainstorm 起手、roadmap 需求漂移

> 分析日期：2026-06-23
> 分析对象：`/maestro`、`/maestro-ralph`（含 `-y`）、`maestro-grill`、`maestro-brainstorm`、`maestro-roadmap` 及其下游 `analyze → plan → execute` 链路
> 方法：通读命令体（`.claude/commands/*.md`）、工作流"大脑"（`workflows/*.md`）、链定义（`chains/*.json`）、程序化路由（`src/coordinator`、`src/ralph`）的一手指令，逐条比对、引用 `文件:行号` 取证。

---

## 0. 执行摘要（先给结论）

用户的核心疑问是：**"是我们 roadmap 的问题，还是某个步骤存在问题？"**

**结论：不是 roadmap 单点的问题。** roadmap 工作流本身设计得相当完整（有最小阶段原则、需求追溯规则、scope 决策段）。真正的病根是**三个系统性缺陷**，roadmap 只是其中一环的放大器，而且在很多链路里 roadmap 会被 `scope_verdict` 直接跳过——也就是说，去掉 roadmap，漂移照样发生。

三个根因：

| # | 根因 | 影响的用户痛点 | 严重度 |
|---|------|----------------|--------|
| **R1** | **三套并存且互相矛盾的意图路由层**——命令体（新架构）、deferred 大脑（旧架构）、regex 路由（第三套词表）同时存在，`/maestro` 甚至把"新旧两套架构"一起塞进同一个 prompt | 意图理解差、分类不稳定 | 🔴 高 |
| **R2** | **上下文逐级"再抽象"，原始需求/意图全链永不回查**——每一步都基于上一步的摘要再解释，`plan`/`execute` 只读 analyze 产出的 `implementation_scope`，从不回读 roadmap 的 `Requirements`、`project.md` 或用户原话 | 需求越来越跑偏、"很多内容不遵守" | 🔴 高 |
| **R3** | **`-y` 全自动模式没有"自动化的意图保真替代"**——`-y` 不需要任何用户交互、自动推进是**设计本意且正确**；问题在于系统的意图保真机制几乎**全部绑定在人工交互上**，`-y`（正确地）去掉交互后，**没有任何自动化手段**接管对意图的锚定，于是 R1/R2 的结构性缺陷在自动模式下无遮挡地放大 | `maestro-ralph -y` 效果最差、grill/brainstorm 起手不好 | 🔴 高 |

> **关于 `-y` 的定性（重要）**：`-y` = 零用户交互 + 自动推进，这是它的设计目的，**本报告不主张给 `-y` 加回任何用户提问**。R3 的缺陷是"**自动化保真缺失**"，不是"没问用户"。修复方向是给 `-y` 一条**非交互的**保真路径（代码探索代答 + 意图锚点自检 + 自动 scope 守卫），而不是把人工闸门塞回自动模式。系统其实**已经有**这个正确模式（见 R2.2 grill 的 `-y` "代码代答"、`interview-mechanics.md` 的 "Search-first / Never ask what code can answer"），只是没有统一应用。

一句话：**问题不在 roadmap 这"一个步骤"，而在"步骤之间的交接"（context handoff）和"入口的架构一致性"。`-y` 本身没错——错在自动模式下缺一条非交互的意图保真路径。**

---

## 0.5 时效性校准（对照最新上游，2026-06-23 fetch）

本报告 R1–R10 写于 master `0.5.3 @4be21744`。fetch 后上游有 4 个非 master 分支,**分两类**(详见 `maestro-hooks-analysis.md §4`):
- ✅ **干净前向**(基于 master、behind 0):`codex/kg-index-stability`(0.5.34)、`codex/switch-kg-maestrograph-cli`——KG 索引稳定 + KG→MaestroGraph + 搜索散文强化 + hooks.json 注册模式。
- ⚠️ **陈旧分叉**(无共同祖先、behind 50):`fix/global-spec-injection`(0.4.24)、`feat-增强自动执行…`(0.1.4)——整体合并会回退,只能 cherry-pick(如 spec-global 修复、review-BLOCK 自动修复)。

**新代码主要改"知识质量"层(KG 索引/搜索/spec)；对 R1–R5 的命令/工作流文件（`.claude/commands/maestro-ralph.md`、`.claude/commands/maestro.md`、`workflows/{grill,brainstorm,analyze,roadmap}.md`，`codex/kg-index-stability` 有重写精简；注意大脑 `workflows/maestro.md` 本身未变）虽改动文件，但未解决任何结构性发现。** 逐条对照（第 2 列＝"新上游是否**解决**该发现"，非"是否改动文件"）:

| 发现 | 新上游是否触及 | 判定 |
|---|---|---|
| R1/R6 路由碎片化 / 三引擎 | **未解决**（无引擎合并；`src/coordinator`/`_intent-map.json` 未动） | **仍现行** |
| R2/R3 交接失真 / roadmap 漂移 | **未解决**（`roadmap-common.md` 等核心未动；`analyze.md`/`roadmap.md` 仅精简） | **仍现行** |
| R4 `-y` 缺非交互保真 | **未解决**（`grill.md`/`brainstorm.md`/`maestro-ralph.md` 被重写，但 `-y` 跳过逻辑 + grill 矛盾仍在） | **仍现行** |
| R5 长跑闭环复利漂移 | **未解决**（`maestro-ralph.md` 被精简，但全量重放 + 无保真门仍在） | **仍现行** |
| R7 不变量只写散文 | 否(hooks.json 是"注册",非"强制") | **仍现行** |
| R8 知识 fail-open | **部分**:KG 索引更稳 + 搜索强调 + spec-global(stale 分支) | **质量层缓解,但根(fail-open 消费、注入≠调用、guard advisory)未动 → 强制/触发层仍现行** |
| R10 监控盲 | 否 | **仍现行** |
| Hooks H1–H6 | 否(最新干净分支只动 injector/workspace,未动 guard) | **仍现行** |

> **结论**:新优化集中在"让知识更好"(KG 索引 / 搜索 / spec),**而非"让 agent 必须用知识 / 必须遵守不变量"(R8 触发率 + R7 强制)**。故 R1–R7、R9、R10 **仍现行**;R8 标注为"质量层部分缓解,强制/触发层未动"。本报告的结构性结论不因新上游而过时。（注：`codex/kg-index-stability` 确实重写/精简了上述 R1–R5 文件，但属表述精简，未解决任一发现；`src/coordinator`/`chains/_intent-map.json`/`roadmap-common.md` 等结构根**未动**。`codex/switch-kg-maestrograph-cli` 在 R1–R5 路径上与 master 完全相同。）

---

## 1. 问题一：意图理解差（`/maestro` 与 `/maestro-ralph`）

### R1.1 ⚠️ 核心证据：三套并存、互相矛盾的意图→链路路由

项目里同一件事（"用户意图 → 选哪条链"）有**三份独立维护、已经各自漂移**的定义：

**第 1 层 · regex 路由（程序化 coordinator 路径）**
`src/coordinator/intent-router.ts:21-52` 读取 `chains/_intent-map.json`，用正则逐条匹配，兜底 `DEFAULT_GRAPH = 'singles/quick'`（`intent-router.ts:10`）。
- `chains/_intent-map.json` 里 **没有 grill、没有 blueprint、没有 analyze-macro**；`analyze` 直接映射到单步图 `singles/analyze`（`_intent-map.json:30-34`），`fallback` 是 `singles/quick`（`_intent-map.json:276`）。

**第 2 层 · `workflows/maestro.md`（`/maestro` 的 deferred 大脑，旧架构）**
`.claude/commands/maestro.md:135` 明确："Read `~/.maestro/workflows/maestro.md` from deferred_reading"。这份大脑文件描述的是**老一代架构**：
- `workflows/maestro.md:4`：步骤类型是 `Skill` 与 `CLI (via maestro delegate)`，"All execution dispatched to `maestro-ralph-execute`"。
- `workflows/maestro.md:290`：**"For maestro sessions (source: maestro), there are no decision nodes — execution is purely sequential."**（明确说"无决策节点"）
- `workflows/maestro.md:299-383` 的 `chainMap` 里是 `brainstorm-driven` / `roadmap-driven` / `spec-driven` / `analyze-plan-execute`，**没有 grill、blueprint、analyze-macro**。
- `workflows/maestro.md:238-268` 的 `status.json` schema 里是 `exec_mode` / `type` 字段，**没有** `boundary_contract`、`task_decomposition`、`ralph_protocol_version`、`command_scope`。

**第 3 层 · `.claude/commands/maestro.md`（命令体，新架构 ralph-protocol-v1）**
同一个 `/maestro` 命令的命令体描述的是**新一代架构**：
- `.claude/commands/maestro.md:46-60` 的 invariants 与 `:62-119` 的状态机引入 `boundary_contract`、`execution_criteria`、`task_decomposition`、`scope_verdict`。
- `:170-201` 的 `A_CREATE_SESSION` schema 里有 `ralph_protocol_version: "1"`、`active_step_index`、`command_scope`/`command_path`、`task_decomposition`——**与第 2 层的 schema 完全是两套**。
- `:53` 的链路目录是 `grill / brainstorm / blueprint / analyze-macro / analyze / roadmap / plan(三路径) / execute`；`:162`/`:227` 还在 maestro-source 会话里追加 `decision:post-analyze-scope` / `post-goal-audit` 决策节点（由 ralph handoff 评估）——而第 2 层大脑 `:290` 说"maestro 会话无决策节点、纯顺序"。**两份文档对同一 `source:"maestro"` 会话给出不同执行模型（含决策节点 vs 纯顺序），是命令体↔大脑的架构漂移。**（注：`:290` 仅限定 maestro 会话，不能拿去与 coordinate 引擎 GraphWalker 比——那是另一 runtime，§9 R6 撤回的正是那个误读。）

**这套新架构是"活的"**（不是废弃文档）：`src/commands/ralph.ts`、`src/ralph/cmd-next.ts`、`src/ralph/cmd-skills.ts` 都已实现 `maestro ralph next/skills/complete`。

> **后果**：`/maestro` 运行时，模型同时读到"命令体（新架构）"+"deferred 大脑（旧架构）"两份互相矛盾的剧本——
> - 链路词表不同（grill/blueprint/analyze-macro 在一份里有、另一份里没有）；
> - `status.json` schema 不同（两套字段）；
> - 对同一 `source:"maestro"` 会话的执行模型不一致（命令体新模型含 `decision:*` 节点、大脑 `:290` 是"纯顺序、无决策节点"的旧模型）。
>
> 模型必须"二选一或勉强缝合"，于是分类与建链行为不稳定、不可复现。这是"无法正确理解用户意图"最直接的结构性原因。

**同一句意图在三套系统里走向不同**，举例 "analyze the auth module"：
- 第 1 层 regex → `singles/analyze`（单步分析图）
- 第 2 层 chainMap → `analyze` → `[maestro-analyze {phase}]`（单步）
- 第 3 层 catalog → `analyze-macro`（产 `scope_verdict`，可能再插 roadmap+analyze，或直跳 plan）

三种结果，三种下游。入口不同（slash 命令 vs 程序化 CLI/MCP）行为就分叉。

### R1.2 语义分类本身是"薄弱的一次性 LLM 匹配"

即便只看第 2 层大脑，分类机制也很脆：
- `workflows/maestro.md:75`：**"Use LLM semantic understanding — no rigid keyword lookup."** 纯靠 LLM 一次性语义匹配。
- 匹配目标是 `workflows/maestro.md:88-141` 的 **40+ 个高度重叠的 `task_type`**：`analyze` vs `analyze-plan-execute` vs `quick`；`debug` vs `issue` vs `analyze`；`refactor` vs `quick`……彼此边界模糊。
- `:142-151` 的 "Selection priorities" 很松，最后是 **"Global fallback → `quick`"**（`:151`）。

> **后果**：宽泛或中等的意图很容易被"兜底"成 `quick`，或在几个相近 `task_type` 之间漂移。命令体 `.claude/commands/maestro.md:59` 虽然要求记录 `classification_rationale`（分类理由），但大脑文件里并没有对应的"置信度阈值/消歧步骤"，要求与实现脱节。

### R1.3 `/maestro-ralph` 的"位置推断"是浅层启发式

`/maestro-ralph` 命令体是自包含的（不 defer 到 `workflows/maestro.md`），所以它没有 R1.1 的"新旧矛盾"，但它的意图理解同样浅：
- `.claude/commands/maestro-ralph.md:243-259` 的 `A_INFER_POSITION` 仅靠**关键词 override**（"压力测试/拷问"→grill、"头脑风暴"→brainstorm、"重构/全面/迁移"→analyze-macro）+ **bootstrap 启发式**（有没有 `.workflow/`、有没有源码）来定位生命周期位置。
- 没有真正的"意图抽取/澄清"，只有正则式关键词命中。一句 `-y "build a REST API"` 在空项目上会命中 bootstrap "No `.workflow/` + no source files → `brainstorm`"（`:256`），然后整条链都建立在一次"薄意图 brainstorm"之上（接 R2/R3）。

---

## 2. 问题二：grill / brainstorm "起手"效果差

### R2.1 ⚠️ 架构错配：grill 是"测已有 plan"，不是"澄清空意图"

- `.claude/commands/maestro-grill.md:3`：grill 的定位是 **"stress-testing a plan, idea, or requirement against codebase reality"**——压力测试**一个已存在的方案**对照代码现实。
- `:18`：**"Positioned BEFORE brainstorm in the pipeline: grill stress-tests and sharpens; brainstorm generates and elaborates."**

但"起手"场景是**全新意图、没有 plan、（greenfield）没有代码可锚定**。grill 的取证机制（`maestro-grill.md:94-99`：质问必须引用具体代码 `{symbol}@{file:line}`）此时无米下锅——`workflows/grill.md` 的代码扫描会触发 W001（扫描为空），随后"所有锁定决策标记为 LOW CONFIDENCE"。

> **后果**：把一个"对照代码拷问已有方案"的工具，用在"还没有方案、也没有代码"的冷启动上，是用途错配。它问的是不存在的方案，锚的是不存在的代码，产出自然空泛。

### R2.2 `-y` 把 grill 的全部价值抽掉（且自身存在矛盾）

- 一方面，orchestrator 规定 **`-y` 直接跳过 grill**：`.claude/commands/maestro.md:54` invariant 8 "Grill is interactive-only — `-y` auto mode MUST skip grill stage and route directly to brainstorm"；`maestro-ralph.md:412` build 规则 3.5 同样在 `auto_confirm` 时删除 grill。
- 另一方面，`maestro-grill.md:34-36` 自己又定义了 `-y` 自动模式："**Auto mode (`-y`): Code exploration answers questions instead of the user**"——用代码探索代替用户作答。

这本身是**自相矛盾**：到底 `-y` 时 grill 是"被跳过"还是"代码代答"？而且即便走"代码代答"，grill 的核心价值是**苏格拉底式追问、逼用户澄清模糊意图**；让代码来回答"你到底想要什么"在逻辑上不成立——代码不知道用户意图。

### R2.3 brainstorm 自动模式：连"自动落地"也一并跳过（不是"没问用户"，而是"也没用代码代答"）

> **先澄清**：`-y` 不问用户是对的。这里的缺陷**不是**"它没向用户提问"，而是**它把本应在无人交互下自动运行的落地机制也一起扔了**。

关键对照证据在 `workflows/interview-mechanics.md`，它本身定义了两条规则：
- **第 4 行 · Search-first**："resolve via state.json → session artifacts → `maestro spec/wiki` → Glob/Grep/Read → Agent(Explore) / delegate. **Never ask what code can answer.**" ←这是一条**非交互、自动**解析决策的机制，正是 `-y` 应当保留的。
- **第 6 行 · Skip**："auto mode (`-y`) … → **skip entire interview.**" ←但 `-y` 把**整段访谈**（连同第 4 行的自动 Search-first 落地）一起跳过。

正确的 `-y` 行为应是"**只跳过面向人的提问，但仍跑 Search-first 用代码/产物把每个决策自动定下来**"（即 grill 的 `-y` "code answers" 模式，见 R2.2）。实际却是整段跳过、退回到对薄主题串的臆测：
- `workflows/brainstorm.md`（auto 模式 / `-y`）：跳过术语与 non-goals 采集；生成 2–4 个探测问题后**既不问用户、也不走 Search-first 用代码回答**，直接由薄主题串推断；并基于未澄清的关键词**自动选角色**（"If `--yes`: auto-select recommended roles"），把分析视角锁死。

> 一句话：`-y` 应该是"**把'问人'换成'问代码'**"，而现在是"**把'问人'直接换成'拍脑袋'**"。

### R2.4 薄意图被"固化"为 `locked` 约束，污染整条下游

brainstorm 产出的 `context-package.json`（`brainstorm.md` schema）里，`constraints[]` 被标成 `status: "locked"`、`terminology[]` 是"auto-generated"。但这些"锁定项"**用户从未确认**。当它们经 `--from brainstorm:ID` 流向 roadmap / analyze / plan 时，最初的误解被"加密、晶体化"为既成约束，下游再也分不清哪些是用户真意、哪些是机器臆测。

> **后果**：起手阶段（grill/brainstorm）本应是"把模糊意图磨清晰"的环节，`-y` 下却变成"在没问清楚的情况下，把臆测固化成 locked 约束往下传"。这正是用户感受到的"起手就不对"。

---

## 3. 问题三：roadmap / 里程碑导致需求漂移

### R3.1 ⚠️ 核心证据：roadmap 的"需求追溯"是只写不读（orphaned）

roadmap 工作流**确实**做了追溯设计：
- `workflows/roadmap-common.md:119-128` 的 phase 格式里有 **`Requirements: <REQ-IDs mapped from project.md Active requirements>`** 字段。
- `:134` 与 `:174` 两处强调 **"Every Active requirement from project.md MUST appear in exactly one phase's Requirements field."**

**问题是：这个字段写进了 `roadmap.md`，但下游没有任何一步去读它。**

追溯证据链（一手）：
1. `workflows/plan.md:127-136`（P1 上下文采集）—— plan 的输入是 `--from` 的 `context-package.json`，否则 **"read `${CONTEXT_DIR}/context.md` if exists, else warn"**。**完全没有读 `roadmap.md` 的 `Requirements` 字段，也没有读 `project.md` 的 REQ 原文。**
2. `workflows/plan.md:155-162`—— 当 analyze 跑过时，plan 把 **`conclusions.json` 的 `implementation_scope` 当作"primary planner input"**：`scope.objective`→任务标题、`scope.acceptance_criteria`→收敛标准。
3. `workflows/analyze.md:633-658`—— 而这个 `implementation_scope` 是 analyze **从它自己的 recommendations 综合出来的**（"Build implementation_scope from accepted/modified recommendations … The planner reads `conclusions.json.implementation_scope`"），**不是**从 phase 的 REQ-IDs 或 `project.md` 原文映射来的。

> **后果**：roadmap 辛辛苦苦建立的 `REQ-ID → phase` 追溯链接是**悬空的（write-only）**。即使 roadmap 阶段追溯做得 100% 正确，`plan` 也不读它——plan 锚定的是 analyze 重新提炼的 `implementation_scope`。需求原文在 roadmap 之后就"断链"了。

### R3.2 真正的漂移发生在 `analyze → plan` 的"二次再解释"，与 roadmap 是否存在无关

把整条链摊开看每一次"再解释"：

```
用户原始需求 / 意图（最丰富）
      │  ① roadmapper 再解释 → phase 只剩 1 行 Goal + 2 条 Success Criteria
      ▼
roadmap.md（Requirements: REQ-IDs —— 但下游不读，悬空）
      │  ② analyzer 再解释 → recommendations → implementation_scope（objective + acceptance）
      ▼
conclusions.json.implementation_scope（plan 的"primary input"）
      │  ③ planner 基于 implementation_scope 拆 task
      ▼
plan.json → execute（只跟 plan 走，无回溯原文的路径）
```

**关键洞察**：漂移的源头是第 ② 步（analyze 把需求再压缩成 `implementation_scope`），而 plan 把这个压缩结果当"主输入"。这一步**在 roadmap 存在与否都会发生**——

而且很多链路**根本不走 roadmap**：`maestro-ralph.md:286-289` 的 `A_RESOLVE_SCOPE_VERDICT` 规定，`scope_verdict ∈ {medium, small}` 时 **"直跳 plan --from analyze:{ANL_ID}（跳过 roadmap + analyze-phase）"**。也就是说中小型需求压根没有 roadmap，plan 直接吃 macro-analyze 的 `implementation_scope`。

> **直接回答用户**：需求漂移**不是 roadmap 引入的**，它发生在"每一级把上一级的摘要再摘要、且原文永不回查"的交接机制里。roadmap 只是在链条中**又叠加了一次**有损再解释（第 ① 步），并把唯一的追溯锚点（REQ-IDs）写成了悬空字段。把 roadmap 删掉，漂移依旧。

### R3.3 `boundary_contract`（out_of_scope）不传播进 roadmap → scope 重新膨胀

- `maestro-ralph.md:344-379`（`A_DECOMPOSE_TASKS`）在前期把用户澄清的边界写进 `boundary_contract.in_scope / out_of_scope / constraints`。
- 但 `workflows/roadmap-common.md:23-47`（Load Project Context）roadmap 只读 `project.md` + `state.json.accumulated_context` + 代码文档 + `--from` 的 context-package，**从不读 session 的 `boundary_contract`**。
- roadmap 模板 `roadmap-common.md:163-166` 虽有 "Out of scope" 段，但其内容来源不接 `boundary_contract`。

> **后果**：用户明确说"X 不在范围内"，被 decomposition 记进了 `boundary_contract.out_of_scope`，但 roadmapper 看不到这条边界，于是可能把 X 重新拆成一个 phase——**scope 重新膨胀**，正是"很多内容不遵守"的一种表现。

### R3.4 最小阶段原则与追溯校验都是"软约束"，`-y` 下自动接受

- `roadmap-common.md:77-128` 的 Minimum-Phase Principle 标了 **MANDATORY**，但它是写给 LLM 看的散文规则，没有可执行校验；`:99-102` 的 "Phase sizing checklist" 也是"建议在呈现前应用"，无强制。
- `roadmap.md:60`（Strategy Selection）与 `:83`（Gather Feedback）都标注 **"skip if `-y`"**。于是 `-y` 下：分解策略自动选、roadmap 自动接受、用户多轮细化（最多 5 轮）整段跳过。
- 唯一的"闸门"是 approve 时跑一次 minimum-phase checklist（`roadmap.md:87`），但它同样是软指令。

> **后果**：`-y` 下 roadmapper 可以自由地多拆 phase、或把 out_of_scope 重新纳入，而没有任何强制校验或用户纠偏——过度分解 / 镀金（gold-plating）/ scope 膨胀就此固化进 `state.json.milestones`，成为后续所有阶段的"事实来源"。

### R3.5 漂移检测工具其实存在，但没接进自动回路

`workflows/roadmap.md:162-200` 有一个 `--review` 模式，专门做 **"Drift detection: Completed phases deviating from original scope"** 和 **"Relevance check: Pending phases still aligned with current project goals (from project.md)"**。

> 也就是说，**系统已经意识到"漂移"是个问题、并且写了检测器**——但它是一个**需要手动调用的独立命令**，没有被编织进 `maestro-ralph` 的自动闭环。`ralph` 的自动闸门有质量门（`post-execute`/`post-review`/`post-test`）、目标门（`post-goal-audit`）、scope-sizing 门（`post-analyze-scope`）、结构门（`maestro-ralph.md:164-185`），但**没有"需求保真/漂移门"**——scope 门只管链路尺寸，不对照原始意图。

---

## 4. 横切根因：`-y` 全自动模式缺少"非交互的意图保真替代"

> **定性前提（呼应用户）**：`-y` = 零用户交互 + 自动推进，这是设计本意，**完全正确**。下面**不是**在批评 `-y` 不交互，而是指出：系统的对齐机制几乎全绑定在交互上，所以 `-y`（正确地）拿掉交互后，**没有任何自动化机制接管**——这才是缺陷。

把三个问题串起来看，`-y` 是共同的放大器。它的正确语义应是"**把'问人'换成'问代码/产物'（Search-first 自动落地）**"；当前实现却是"**把'问人'直接换成'拍脑袋'（退回薄主题串臆测）**"。下表第 3 列不是"应该问用户"，而是"**本该有、却缺失的自动化保真手段**"：

| 阶段 | 交互模式下靠什么对齐 | `-y` 下缺的"自动化替代"（≠ 应加回交互） | 证据 |
|------|---------------------|------------------------------------------|------|
| 意图澄清 / 边界 | broad/medium 向用户澄清 | **broad 仍强制澄清**（`-y` 也不跳，`:352`）；medium 自动派生但**不做深度 Search-first**（`:354`）；narrow 仅靠轻量 Glob/Grep 派生（`:364`） | `maestro-ralph.md:352,354,364` |
| grill | 苏格拉底交互拷问 | grill 被整段跳过，其"代码代答"能力（R2.2）未被任何阶段继承 | `maestro.md:54`、`maestro-ralph.md:412` |
| brainstorm 访谈 | 提问 + 用户选角色 | **连 Search-first 自动落地一起跳过**（`interview-mechanics.md:4` vs `:6`），退回臆测 | `interview-mechanics.md:4,6`、`brainstorm.md` |
| roadmap 细化 | 最多 5 轮用户反馈 | 自动接受 roadmap，但**没有自动 scope/追溯校验**兜底（最小阶段原则是软指令） | `roadmap.md:60,83,87` |
| boundary 传播 | （本就缺失，见 R3.3） | （本就缺失，与是否 `-y` 无关） | `roadmap-common.md:23-47` |
| scope/需求保真门 | 仅手动 `--review` | 现成的漂移检测器**未接进自动回路** | `roadmap.md:162-200` |

> 这解释了为什么用户感觉 **"`maestro-ralph -y` 效果最差"**：`-y` 是合理的全自动推进，但**自动路径上没有铺设非交互的保真轨道**——于是 R1（架构未消歧）、R2（起手未落地）、R3（scope 未校验）的结构性缺陷在自动模式下无遮挡地全程放大。修复方向是**给自动路径补保真轨道**（代码代答 + 意图锚点自检 + 自动 scope 守卫），**绝非把人工提问塞回 `-y`**。

### R4.1 关键澄清：`maestro` / `maestro-ralph` 命令**自身**在 `-y` 下会"拍脑袋"吗？

会，但**范围比下游窄得多**，而且 **`ralph` 比 `maestro` 更不容易拍脑袋**。必须区分"编排层（路由+分解）"和"下游被分派的 skill"——重灾区在后者。

**① 编排层有几个"即使 `-y` 也不拍脑袋"的硬护栏：**
- **broad 意图强制澄清**：`重构/全面/重写/迁移/overhaul/migrate/rewrite` 这类，`maestro-ralph.md:352` 明确 **"MUST (ignores auto_confirm)"**；maestro 命令体同 guard（`.claude/commands/maestro.md:96`）。→ 大改类意图 `-y` 也会问，不拍脑袋。
- **ralph 的 phase 歧义即使 `-y` 也问**：`maestro-ralph.md:126` **"auto_confirm does NOT skip phase ambiguity"**。
- **ralph 的 position/scope 是产物锚定的**：`A_INFER_POSITION` 读 `state.json`（`.workflow/`、源码、artifact 存在性），`A_RESOLVE_SCOPE_VERDICT` 读 `analyze` 的 `conclusions.json.scope_verdict`（`maestro-ralph.md:276-289`）。浅启发式，但有锚、非凭空。

**② 编排层仍会拍脑袋的两个点（窄）：**
- **`/maestro -y` 的链路分类**：`A_CLASSIFY_INTENT` 是**一次性 LLM 语义猜**、无代码消歧，而 `workflows/maestro.md` Step 2c 澄清 **"skip if autoYes"** → `-y` 跳澄清；只要给出一个（哪怕错的）匹配就照走（只有"完全无匹配"才 fallback）。再叠加 R1 双架构矛盾，**这个猜本身就不稳**。这是 maestro 编排层真正的拍脑袋点。
- **medium 意图的边界派生**：`maestro-ralph.md:354` medium → "clarify unless auto_confirm"，`-y` 下自动派生、不做深度 Search-first。

**③ 真正的"重灾区"在下游 `-y` skill，不在 maestro/ralph 自身：**
maestro/ralph 主要做路由+分解；把"薄主题串"捏造成 `locked` 约束的，发生在它们用 `-y` 调起的 `maestro-brainstorm` / `maestro-analyze` 里（R2.3）。编排层把一个可能没消歧的意图**原样 `-y` 灌给下游**，下游再无 grounding 地放大。

> **结论**：`/maestro-ralph -y` 在编排层基本不拍脑袋（broad 强制问、phase 强制问、scope 读产物）；`/maestro -y` 的链路分类会拍脑袋（一次性 LLM 猜 + R1 不稳 + 跳澄清）；最重的拍脑袋在下游 `-y` skill。**因此"把问人换成问代码"的落地优先级 = ① 给 `/maestro` 分类加代码消歧 + 置信门 → ② 给下游 `-y` skill 铺 Search-first。**

---

## 5. 长程闭环漂移（goal loop）：为什么"跑得越久越偏"

> 前四节讲的是**空间维度**的失真——意图在 `分类 → grill/brainstorm → roadmap → analyze → plan → execute` 的**逐级交接**里被一次性损耗。本节讲**时间维度**：当 `maestro-ralph` 挂在一个长跑的 `/goal` 闭环里反复迭代时，初始失真为什么会被**复利放大**、且**无人拉回**。

### R5.1 闭环被设计成"自己考自己"——一个 closed-loop self-verification 系统

把 goal loop 的三个关键事实摆在一起，结论是必然的：

| 事实 | 证据 | 含义 |
|------|------|------|
| **锚点早冻 + 有损**：`task_decomposition`（`done_when` 子目标组）**一次性生成**、之后**不删不改** | `maestro-ralph.md:346`（"Runs once before chain build"）、`:657`（"既有字段名不删不改"） | 目标在意图尚未被搞清时就被固定为**代理目标(proxy)**——派生自可能已失真的意图（R1+R2） |
| **每轮只回 `status.json`，从不回原始需求** | `maestro-ralph.md:721`（"每轮以 status.json 为唯一行动手册"）、`maestro.md:167`；**grep 整个 ralph 循环无任何 `project.md`/原始需求/原文 的重读** | 每轮"重新锚定"锚的是**有损快照** → 重锚 = **强化漂移**，而非纠正漂移 |
| **完成判定只对自己的 `done_when`，不对原始意图** | `maestro-ralph.md:512`（"打开 evidence 产物，对照 done_when 严格判定"）、`:375`（"done_when 必须引用 ralph 已产出的 artifact"）、`:516-518`（审计 delegate 只拿 evidence/execution_criteria/boundary_contract，**唯独没有原始需求**） | **自己出题、自己判卷**的闭环：可以"内部完全自洽"，同时整体已偏离原意 |

### R5.2 复利机制：Goodhart 定律在长程循环里的体现

```
原始需求 ──(R2 逐级抽象，一次性损耗)──▶ 冻结的 done_when 代理目标
                                              │
          ┌───────────────────────────────────┘
          ▼  每一轮 goal loop：
   优化"done_when 达成"（代理），而非"原始意图"（真值）
   修复是局部的（goal-fix 按单个 unmet 子目标 scoped，maestro-ralph.md:570）
   从不回查原始需求 → 偏差只被复利，从不被纠正
          │
          ▼
   跑得越久 = 越自信地收敛到"错的目标" = 越来越偏
```

- **初始偏移**来自 R2（每次交接丢一点细节）。
- **循环阶段**对冻结的代理目标做优化：每一轮把收敛"拧"得更紧——**拧向代理，不是拧向真需求**。
- **修复是近视的**：`A_APPLY_GOAL_FIX` 的 fix-loop 按单个 unmet 子目标 `goal_ref` scoped（`maestro-ralph.md:568-573`），局部满足 `done_when`，累积成全局不一致。

### R5.3 循环里**没有任何"意图保真门"**

- ralph 的自动门有四类（`maestro-ralph.md:164-185`）：**质量门**（`post-execute`/`post-review`/`post-test`——代码能跑吗）、**目标门**（`post-goal-audit`——`done_when` 达成吗）、**scope 门**（`post-analyze-scope`——只读 `scope_verdict` 决定链路大小）、**结构门**（`post-milestone`/`post-debug-escalate`）。但**没有一类做"意图保真/漂移"检查**——scope 门只管链路尺寸（large/medium/small），不对照原始意图；故仍**没有"这还是当初要的东西吗"的门**。
- **没有一个门问"这还是当初要的东西吗"**。现成的漂移检测器 `--review`（`roadmap.md:162-200`，本可对照 `project.md` 做 relevance check）**没有接进自动回路**（R3.5）。
- 唯一的熔断是 `retry_count >= max_retries → escalate`（`maestro-ralph.md:185`）——那是给"质量修不好"兜底，**不是给"意图跑偏"兜底**。

### R5.4 定性：是项目的问题，但**可修**

- **固有风险部分**（非 maestro 独有）：任何长程自主循环都会因代理目标优化 / 上下文侵蚀而漂移——这是"长跑的天性"。
- **项目放大并锁死的部分（这才是 maestro 的问题）**：闭环自证 + `status.json 唯一真源` + 锚点早冻 + 无 re-grounding 门，这套设计选择把"会漂"主动放大成**"锁死地、单调地漂"**。别的设计可以缓解，maestro 选择了放大。
- **可修，且有界**：见第 7 节 P0 的"意图锚点 + 周期性 re-grounding 门"。这不是"LLM 干不了长任务"，而是"循环被设计成只对自己负责、不对原始需求负责"。

---

## 6. 综合结论

**回答用户的问题"是 roadmap 的问题，还是某个步骤的问题？"：**

1. **不是 roadmap 这一个步骤的问题。** roadmap 工作流本身设计完整（最小阶段原则、Requirements 追溯字段、scope 决策段、甚至 `--review` 漂移检测器都有）。它的缺陷是**追溯链接悬空（只写不读，R3.1）**和**不接收 boundary_contract（R3.3）**——但即便修好这两点，只要 `analyze → plan` 的"再抽象、不回查"机制还在（R3.2），漂移依旧。而且中小需求根本不走 roadmap，照样漂。

2. **真正的根因是"步骤之间"，不是"某个步骤之内"：**
   - **入口处**（R1）：三套路由 + 新旧架构同 prompt 共存 → 意图一开始就理解不稳。
   - **交接处**（R2、R3）：每一级只消费上一级的摘要、把原始需求/意图/边界逐级丢弃，且全链没有"回查原文"的锚点 → 需求逐级跑偏、"很多内容不遵守"。
   - **`-y`**（R4 横切）：`-y` 全自动推进本身正确；缺陷是自动路径上没有"非交互的保真轨道"接管人工闸门 → 上述缺陷在自动模式下被最大化放大。
   - **长跑闭环**（R5 时间维度）：goal loop 把初始失真**复利放大**，且循环里没有"回到原始需求重新校准"的门 → 跑得越久越偏。这是项目设计缺陷，可修。

3. **优先级排序**：R1（架构一致性）和 R2-handoff/R3.1（意图锚点贯通）是必须先解决的地基；给 `-y` 补"非交互保真轨道"（R4）是性价比最高的"止血"点——注意是补自动化，不是加回交互；长跑场景（R5）必须加"周期性 re-grounding 门"，否则前面修得再好，长跑仍会复利漂移。

---

## 7. 修复建议（按优先级 / 影响 / 成本）

### P0 · 统一意图路由架构（治 R1）
- **单一事实来源**：让 `/maestro` 的命令体与其 deferred 大脑 `workflows/maestro.md` 对齐到**同一套架构**。当前命令体已是 ralph-protocol-v1（新），应把 `workflows/maestro.md` 重写为与之一致（链路目录含 grill/blueprint/analyze-macro、decision 节点、新 `status.json` schema），或反之删除其中一份、命令体直接内联。统一 maestro 会话的执行模型（消除 `workflows/maestro.md:290`"纯顺序、无决策节点"与命令体在 maestro 会话追加 `decision:*` 节点之间的不一致）。
- **regex 路由对齐**：把 `chains/_intent-map.json` 的词表与新链路目录对齐（至少补 grill/blueprint/analyze-macro，或显式声明它"只服务程序化/MCP 入口、不覆盖 lifecycle 链"），消除"同一意图三种走向"。
- **加一个一致性测试**：CI 里校验"命令体链路目录 ⊇ 大脑 chainMap ⊇ intent-map 类型"，防止再次漂移。

### P0 · 建立贯穿全链的"意图锚点"（治 R2-handoff / R3.1，最关键）
- 在 session 里固化一份**不可变的 `original_intent` / `requirements_anchor`**（用户原话 + 关键 REQ 原文），随 `status.json` 全程携带。
- 让 `plan.md` P1 与 `execute` **强制回读**该锚点（而不仅是 analyze 的 `implementation_scope`）：plan 的收敛标准必须能映射回锚点里的具体 REQ。
- 把 roadmap 的 `Requirements: REQ-IDs` 从"悬空字段"变成"被消费字段"：`analyze {phase}` / `plan {phase}` 必须读取该 phase 的 `Requirements` 并在 `conclusions.json` / `plan.json` 里保留 `traces_to: [REQ-...]` 回链。

### P0 · 给长跑闭环加"周期性 re-grounding 门"（治 R5，长跑场景必需）
> 没有这一条，前面所有修复在长跑时仍会被复利漂移抵消。
- **锚点与代理目标分离**：`original_intent` / `requirements_anchor`（上一条 P0）保持**不可变**，独立于会被 fix-loop 不断改写的 `task_decomposition`。loop 永远能拿到"真值"对照。
- **周期性意图保真门**：把现成的 `--review` 漂移检测（`roadmap.md:162-200`，含 relevance check 对照 `project.md`）**接进 ralph 自动回路**，按节奏触发（每 N 个 step / 每 milestone / 每 K 次 fix-loop），拿**当前轨迹对照原始 anchor**，而不只对 `done_when`。判定"偏离"则插入 re-align step 或 escalate。
- **goal-audit 也喂原始需求**：`A_GOAL_AUDIT_EVALUATE` 的 delegate 上下文（`maestro-ralph.md:516-518`）当前只有 evidence/criteria/boundary，**补上 `requirements_anchor`**，让它能判"done_when 达成但已偏离原意"。
- **给"意图漂移"也加熔断**：现有 `retry>=max → escalate`（`:185`）只兜底质量；新增"连续 K 轮 re-grounding 判定偏离 → 暂停升级人工"。

### P1 · 让 `boundary_contract` 流过 roadmap 与 plan（治 R3.3）
- `roadmap-common.md` 的 Load Project Context 增加"读取当前 ralph/maestro session 的 `boundary_contract`"，并把 `out_of_scope` 强制注入 roadmap 模板的 "Out of scope" 段。
- 新增一个**scope 保真闸门**（参考已有 `--review` 的 drift detection）：在 `post-analyze-scope` 或 roadmap 之后插一个 decision 节点，校验"phase 集合 ⊆ in_scope 且 ∩ out_of_scope = ∅"，违反则回退澄清。

### P1 · 修正 grill 的"起手"语义（治 R2.1 / R2.2）
- **模式守卫**：当 grill 被当作冷启动第一命令（无 plan、无相关代码）时，应识别为用途错配，提示"建议先 brainstorm 产出方案，再 grill 压力测试"，或自动降级为一个轻量"意图澄清"前置。
- **消除 `-y` 矛盾**：在 grill/orchestrator 之间统一 `-y` 行为——要么一致"跳过"，要么一致"代码代答 + 标 LOW CONFIDENCE"，不要两份文档各说一套（`maestro.md:54` vs `maestro-grill.md:34-36`）。

### P1 · 给 `-y` 补"非交互的意图保真轨道"（治 R4，性价比最高的止血）
> 前提：`-y` = 零交互、自动推进**不变**。以下全部是**自动化**手段，**不向用户提问**。
- **把"问人"改成"问代码"，而不是"跳过"**：`-y` 下不要 `skip entire interview`，而应继续跑 `interview-mechanics.md:4` 的 **Search-first**——用 state.json / 产物 / Glob-Grep / Explore-agent 自动把每个待定决策定下来（即把 grill 的 `-y` "代码代答"模式推广到 brainstorm / decomposition / 角色选择）。决策来源标注 `code` 而非 `user`，置信不足标 LOW CONFIDENCE。
- **非交互的意图回显 + 自检**：即使 `-y`，把推断出的 scope/boundary/角色选择写回 `status.json` 并在日志显式可见，供事后审计、一键纠偏——这不是交互，是留痕。
- **把现成的自动门接进 `-y` 回路**：`goal-audit`（`maestro-ralph.md:501-535`）和 `--review` 的 drift detection（`roadmap.md:162-200`）都是**非交互的 delegate 评估**，应作为"跑完一轮后对照原始意图锚点自检"的兜底门接进自动闭环。

### P2 · 减少"再抽象"层数（治 R3.2 的结构性根因）
- 评估能否让 `plan` 在有 phase `Requirements` 时**直接以 REQ 原文为主输入**，把 analyze 的 `implementation_scope` 降级为"补充上下文"而非"primary input"（`plan.md:155-162`），从而砍掉一次有损再解释。

---

## 8. 证据索引（`文件:行号`）

**R1 三套路由 / 架构矛盾**
- `src/coordinator/intent-router.ts:10,21-52` — regex 路由，兜底 `singles/quick`
- `chains/_intent-map.json:30-34,276` — 无 grill/blueprint/analyze-macro，fallback quick
- `.claude/commands/maestro.md:135` — `/maestro` deferred 加载 `workflows/maestro.md`
- `workflows/maestro.md:4,238-268,290,299-383` — 旧架构：`maestro delegate`、旧 schema、"无决策节点"、旧 chainMap
- `.claude/commands/maestro.md:46-119,170-201` — 新架构：boundary_contract / task_decomposition / ralph_protocol_version / 决策节点
- `src/commands/ralph.ts`、`src/ralph/cmd-next.ts`、`src/ralph/cmd-skills.ts` — 新架构已实现（活的）
- `workflows/maestro.md:75,142-151` — 纯 LLM 语义匹配、40+ 重叠类型、兜底 quick
- `.claude/commands/maestro-ralph.md:243-259` — A_INFER_POSITION 浅层关键词+bootstrap

**R2 grill / brainstorm 起手**
- `.claude/commands/maestro-grill.md:3,18,34-36,94-99` — 定位"测已有 plan"、`-y` 代码代答、取证需代码
- `.claude/commands/maestro.md:54`、`maestro-ralph.md:412` — `-y` 跳过 grill（与上条矛盾）
- `workflows/interview-mechanics.md` — `-y` 跳过整段访谈
- `workflows/brainstorm.md`（auto 模式）— 生成问题不问、自动选角色、术语自动生成、locked 约束

**R3 roadmap / 漂移**
- `workflows/roadmap-common.md:119-128,134,174` — Requirements 追溯字段 + MUST（软约束）
- `workflows/plan.md:127-136,155-162` — plan 只读 context.md / `implementation_scope`，不读 roadmap/project.md
- `workflows/analyze.md:633-658,554,571` — `implementation_scope` 由 analyze 自身 recommendations 综合
- `maestro-ralph.md:286-289` — medium/small 直跳 plan、跳过 roadmap
- `workflows/roadmap-common.md:23-47` — roadmap 不读 boundary_contract
- `workflows/roadmap-common.md:77-128` — 最小阶段原则（软）
- `workflows/roadmap.md:60,83,87,162-200` — `-y` 跳过策略选择/反馈；`--review` 漂移检测（未接自动回路）

**R4 `-y` 横切**
- `maestro-ralph.md:352,354,364,126`（broad/phase 硬护栏、medium/narrow 派生）、`:164-185`（含质量/目标/scope-sizing/结构门，但无意图保真门）、`:501-535`（goal-audit）

**R5 长程闭环漂移**
- `maestro-ralph.md:346,657` — 锚点一次性生成、既有字段不删不改（早冻 + 有损）
- `maestro-ralph.md:721`、`maestro.md:167` — "每轮以 status.json 为唯一行动手册"；grep 全循环无原始需求重读
- `maestro-ralph.md:512,375,516-518` — 完成判定对照 done_when/产物，审计 delegate 无原始需求
- `maestro-ralph.md:568-573` — goal-fix 按单个子目标 scoped（局部修复）
- `maestro-ralph.md:164-185` — 循环仅质量门 + 目标门，无意图保真门；`roadmap.md:162-200` — `--review` 漂移检测未接自动回路

---

*报告完。核心判断：问题不在 roadmap 单步，而在"入口架构一致性"（R1）+"步骤间意图保真度"（R2/R3）+"长跑闭环复利漂移"（R5）；`-y`（R4）放大但本身无错。建议从 P0（统一路由 + 贯穿全链的意图锚点 + 长跑 re-grounding 门）入手——锚点是同一把钥匙，既治空间失真也治时间复利。*

---

## 9. 蜂群深挖增补（R6–R10）+ 统一根因

> 来源：`team-adversarial-swarm` 对抗蜂群（真实 Python ACO 引擎 + Agent 模拟 4 模块）。2 轮 · 8 只蚁 · 14/14 节点覆盖 · 对抗三投票评分 · **0 幻觉、0 路径注水**。全局最优 ANT-1-1（0.9175）`intent-routing → coordinator-graph-walker`。完整产物：`.workflow/.team/TAS-maestro-deepdive-20260623/artifacts/best-solution.md`。
>
> 前五节（R1–R5）讲的是**编排剧本（markdown 层）的意图保真**。本节是蜂群对**实现层（TypeScript 引擎）**的深挖：八只从不同节点出发的蚁，全部收敛到同一个根。

### R6 — 引擎碎片化：**三套**编排运行时 + 13 个状态孤岛 `[ANT-1-1/ANT-2-2]`
R1 把路由描述为"3 份不一致的*定义*"。实情更深——是**三套互不可读的执行*运行时***：
- **引擎 A · GraphWalker**（`src/coordinator/graph-walker.ts`，经 `maestro coordinate`，`src/cli.ts:43`）：图链 + LLM 决策节点（`handleDecision:373`）；会话 `coord-*`。`IntentRouter`+`_intent-map.json` **只**喂这台引擎（`src/commands/coordinate.ts:257`）——`/maestro` 从不碰它。
- **引擎 B · Ralph 顺序**（`src/ralph/`，经 `/maestro`、`/maestro-ralph`）：线性步进；会话 `maestro-*` 与 `ralph-*`。
- **引擎 C · PhaseOrchestrator**（`src/team/phase-orchestrator.ts:46`，经所有 `team-*` skill）：beat/相位门模型；会话 `.workflow/.team/`。
- 引擎 A **派发进** 引擎 C（`chains/singles/team-coordinate.json`）却不共享会话状态。`.workflow/` 下 **13 个状态孤岛**，无统一会话索引。
- **3 个 `_intent-map.json` 路由缺陷（共 45 条）**：`singles/verify.json` **缺失**（死路由，图加载期失败）；`singles/spec-map.json` **错连** `cmd: manage-codebase-rebuild`；`singles/spec-generate.json` **孤儿**。
- *（对抗层已修正 ANT-2-2 两处过度声称：所谓 "maestro.md:290 与 **coordinate 引擎 GraphWalker** 决策节点矛盾" 是误读——`:290` 仅限定 `source:"maestro"` 会话，与 coordinate 是不同 runtime，不能直接对比；"verify 回退到 singles/quick" 机制有误，实为图加载期失败。三引擎结论本身独立成立。注：命令体↔大脑对 maestro 会话执行模型的不一致是另一回事，见 R1.1，真实存在。）*

### R7 — 不变量只写在散文里：引擎信任 LLM 去遵守 `[ANT-2-3/ANT-1-2/ANT-1-5]` —— **根因**
抽样最强的"运行时强制"声称：**2 条真强制 / 1 条部分 / 5 条仅散文（≈62% spec-only）**，覆盖 87 个文件里约 304 个 `MUST/必须/唯一真源/BLOCK/invariant` 词元。
- **`retry_count` 是死字段**——`status-schema.ts:31` 声明，但 `src/ralph` 全程**从不自增**；`retry_count>=max_retries→escalate`（`maestro-ralph.md:185`）永不触发。外加第二条未计数的 `NEEDS_RETRY` 循环（`cmd-complete.ts:96-104`）。`max_retries` **结构性不可执行** → 修复循环无界。
- **E007 不暂停**——`cmd-next.ts:104-109` 只 `return 1`，从不 `status='paused'`（对照 `cmd-complete.ts:113` 确实暂停），违背 invariant 8。**无限重试陷阱**。
- **invariant 13（`parse_failed`/`confidence_score`）零代码**——`src/coordinator`+`src/ralph` 全无此字段。LOW-CONFIDENCE 是装饰。
- **分叉真相**：引擎 A 的 GraphWalker **确实**有界重试（`graph-walker.ts:335-347`），prose 驱动的 Ralph 路径没有——而最密集的强制散文恰好压在最不强制的那条路径上。
- **反证（平衡）**：`completion_confirmed` 是真 CLI-only 强制（`cmd-complete.ts:75-116`）；`output-parser.ts:163-173` 拒绝从自由文本臆断 SUCCESS。引擎在**写路径**不变量上扎实，在**失败路径**不变量上漏。

### R8 — 知识子系统 fail-OPEN（R3 的读侧镜像）`[ANT-1-3]`
- `spec-injector.ts:193` 每次注入都 `if (specResult.content)` 把关，**无 else/告警**——空库即静默空操作。"ALWAYS search before acting"（`claude-instructions.md:14`）是装饰。
- KG 同步**只在未提交改动时**触发（`kg-sync-hook.ts:68`）；已提交代码需手动 symlink 的 `post-commit` 钩子 → **KG 与已提交代码漂移**。
- `plan.md`/`execute.md` 把 `maestro spec load` 结果"当约束上下文"传下去却**不校验非空**。实测本仓库：**无 `.workflow/specs`、无 `.workflow/kg`、无 `post-commit`**——知识实际**从未被读**，而管线照报成功。

### R9 — 团队子系统复刻 R2 + 重度重复 `[ANT-1-4]`
- **意图再派生（R2 同类）**：coordinator 先做"纯文本分析"再**自行编出** worker 目标（`team-coordinate/.../role.md:158,237`）；worker 拿到的是有损转述，非用户原话。
- **1,184 行逐字节相同**（`aco.py` 等）跨 `team-swarm`/`team-adversarial-swarm` 复制，而二者 spec **已经分叉**——copy-fork 漂移中（一处修复另一处收不到）。
- **消息总线命名空间分裂**：worker 发 `mcp__maestro__team_msg`，coordinator 读 `mcp__ccw-tools__team_msg`；`skill-converter.ts:506` 还会从转换后的 agent 里剥掉总线工具 → 静默丢消息。
- 同一个 `team-worker` agent 上**角色加载契约分歧**（静态 `roles/` vs 运行时动态 role-spec）。

### R10 — 监控对自身失败视而不见 `[ANT-2-1]` —— **收尾**
- E-code（E006/E007/E010）只由 `ralph check` 打到 **stdout**；`RalphSession` **无 `findings` 字段** → 不落盘 → 读 `status.json` 的 dashboard **看不到 E007 无限重试陷阱**。
- dashboard 的 `RalphStep` 类型（`maestro-session-types.ts:16-26`）**丢掉 `retry_count`/`max_retries`/`completion_status`** → "重试 1 次" 与 "重试 50 次" 渲染相同。
- 团队消息是 REST 拉取（不在 fs-watcher 推送集）→ 卡死的 worker 显示陈旧信箱；`fs-watcher.ts:181` 静默吞掉写半截的解析错误。
- **一套自身监控看不见自身失败模式的编排系统——是设计使然，不是 bug。**

### 统一根因（仲裁结论）

> **R1–R10 是同一个缺陷在十个地方：Maestro 把保证编码成只有 LLM 才执行的自然语言不变量，从不把原始需求带下去，也无法观测由此产生的偏离。**

这正好对上你的三个体感：意图理解差 = 三引擎 + 死/错路由（R6）；需求不遵守 = 原意被再抽象且不回读、追溯与不变量都是只写散文（R2/R7/R8/R9）；`-y`/长 `/goal` 越跑越偏 = 循环的"终止门"与"回锚门"都是 spec-only（R7），无代码兜底，且监控连"在偏"都显示不出来（R10）。

### 修复增补（接 P0–P2）
- **P0 · 不变量→代码断言一致性层**：给每条 `<invariants>` 打 id + `enforced_by: <file#symbol> | NONE(llm-self)`；CI 校验绑定的符号存在且触及所述字段。当前会对 inv 8（pause）、inv 13、retry-escalate **直接报错**——把"只写散文的保证"变成硬性构建失败。这一条同时治 R6–R10 的根。
- **P0 · 让 `retry_count` 变真 + 统一两条重试路径**（`cmd-complete.ts` 自增并设界；fix-loop 重排时带着计数）。消除无界循环（R7）。
- **P1 · 把 E-code 落进 `status.json` + 加宽 dashboard 投影**（补 `findings`、`retry_count`）。让监控看得见失败（R10）。
- **P1 · 定下引擎故事**（R6）：要么 `/maestro` 走单一引擎，要么显式把 `maestro coordinate` 降级为内部 + CI 守 `_intent-map.json` 与 slash 目录一致；修掉 3 条死/错路由。
- **P1 · 知识加载 fail-CLOSED-带信号**（R8）；**P2 · 团队 swarm 去重 + 统一总线 + 向 worker 透传原话**（R9）。

*（蜂群方法说明：本环境无该 skill 依赖的 `Workflow({scriptPath})` 运行时；故用真实 Python ACO 引擎 + Agent 工具忠实模拟 explore/score/converge/synthesize 四模块——架构、契约、优化数学均真实。）*

---

*报告完（含蜂群增补）。统一根因一句话：**保证写在散文里、原意不回读、偏离看不见**。先做 P0 的"不变量→代码断言一致性层 + 意图锚点"，是同一把钥匙，覆盖 R1–R10。*
