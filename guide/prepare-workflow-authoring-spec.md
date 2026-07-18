# prepare / workflow 内容规范（草案 v2）

> **状态**: 草案 v2，已过 codex 证据审查一轮（2026-07-15）
>
> **v1 → v2**: 修正加载模型事实错误（create 不返回 workflow 全文）；升级为 command / prepare / workflow 三层权责模型；
> contract 唯一源改为「规范性要求 + lint 保障」；判定测试加第 0 问守卫与 table-driven 用例；创建流程补安装同步与 runtime smoke。
>
> **依据**: `src/run/runtime.ts`（createRun / prepareStep / briefRun / skillContent）、`src/run/contract.ts`（extractContract / resolveCommandSource / resolveStepContent）、
> `src/commands/run.ts`（CLI 绑定）、`workflows/run-mode.md`、现存 19 对 prepare↔workflow 文件实态。

---

## 〇、适用范围与三层模型

Maestro 的 step 内容分三层，各有既有规范管辖：

| 层 | 文件 | 管辖规范 |
|----|------|----------|
| command（入口编排） | `.claude/commands/*.md`（maestro-next、maestro、ralph 等入口命令，及 maestro-grill 等独立命令） | `workflows/command-authoring.md` |
| prepare（思考期契约） | `prepare/<step>.md` | **本规范** |
| workflow（执行期手册） | `workflows/<step>.md` | **本规范** + command-authoring.md § 7 的格式规则 |

**关键范围声明**：first-tier step 指有 prepare/workflows 成对文件的 step，现存 **19 对**。其中 **13 个**注册于 maestro-next step registry 且无任何专属 command 文件（经 maestro-next / maestro / ralph 入口调度）；5 个 odyssey-* 经 `/maestro-odyssey` 模式限定命令路由、grill 另有 `/maestro-grill` 独立命令——这两类的**入口命令文件**本身仍受 command-authoring.md 管辖（`maestro-next.md:56` 的 "13 first-tier steps" 指 registry 注册数，与 19 对文件数不矛盾）。

对全部 19 对，step 级错误码 / Success Criteria 由 workflow 文件持有（现状实态，如 `workflows/analyze.md:364,386`）。这是对 command-authoring.md § 7「错误码/Success Criteria/completion 归 command」的**范围限定**——该矩阵适用于有专属 command 文件的命令，其 § 7 已加对应 scope note（见 § 九-8）。

三层所有权总表：

| 内容 | command（入口） | prepare | workflow |
|------|----------------|---------|----------|
| 步骤路由、复杂度分流、Session/Run 生命周期动词 | **唯一源**（+ run-mode.md） | — | — |
| step 机器契约（consumes/produces/gates/refs） | — | **唯一作者源** | 引用 |
| 思考期决策材料（模式判定、边界、风险） | — | **唯一源** | 分辨率对偶（见 § 三） |
| 执行流程、gate 执法条件、schema、agent prompts | — | — | **唯一源** |
| 错误码、Success Criteria（first-tier step） | — | — | **唯一源** |

---

## 一、加载模型 — 规范的全部依据

### 表 A：runtime 实际返回（代码事实，已核验；行号为 2026-07-15 工作区快照）

| 命令 | 返回 | 明确不返回 | 证据 |
|------|------|-----------|------|
| `run prepare <step>` | **prepare 全文**、workflow 路径+行数、run-mode 摘要、refs(path+when) | workflow 全文 | `runtime.ts:884-904` |
| `run create <step>` | session_id、run_id、run_dir、**upstream（alias→artifact 注入）**、entry_gates、**next（渐进提示，指向 brief）** | 任何文件内容 | `runtime.ts:539-620` |
| `run brief <run-id>` | **workflow 全文**、run-mode 摘要、goal、gate 状态、outputs | **prepare** | `runtime.ts:925-968` |
| `run skill <step>` | **prepare + workflow 全文**、refs | run-mode、session 状态 | `runtime.ts:906-923` |
| `run check / complete` | gate 评估、artifact 扫描/注册结果 | 内容 | `runtime.ts:622+` |

`next` 是**单一指针** `{command, reason}`（正常 → brief + 「check → complete」收口提示；entry gate 阻塞 → brief + 排障提示），区别于 report frontmatter / handoff 的 `next[]` 数组（`{command, reason, needs}`，`schemas.ts:175-179, 235-239`）——前者指路生命周期下一步，后者声明跨 step 交接。

注意：`create` 是写事务（建会话、注册 gates、解析 upstream、落盘 run.json），它读 step 源文件只为取 contract 和记录溯源哈希（`content_hash` / `resolved_prompt_hash`），原文不进返回值。内容加载由三个只读端点（prepare / skill / brief）负责——读写分离。

### 表 B：标准编排链（约定，由编排方维持上下文连续性）

runtime 只保证各命令的返回 payload，**不保证调用方在同一上下文里**。「①的内容在③时可见」是编排方（maestro-next / maestro / ralph）的责任，不是 runtime 事实。标准链（与 `run-mode.md` 生命周期动词一致）：

```
① maestro run prepare <step>      → 思考期：产出 prep YAML
② maestro run create <step> …     → 建会话：拿 run_id + upstream 注入 + entry gate 结果
③ maestro run brief <run_id>      → 执行期：注入 workflow 全文（跟随 create 返回的 next 提示）
④ 按 workflow 执行
⑤ maestro run check / complete    → 收口
```

- **恢复/续跑**：直接 `brief <run_id>` —— 此时 prepare 必然不在上下文。
- **无状态轻量路径**：`run skill <step>`（manage、spec 等 stateless 命令用，两层全文一次给齐）。
- **渐进提示**：`create` 返回 `next: {command, reason}` 指向 brief；调用方跟随提示即可走通链路，无需背诵流程。

### 解析优先级与安装同步（高影响，容易踩）

`resolveStepContent` 按 **first-hit** 顺序查找（`contract.ts:98-101, 239-245`）：

```
1. 项目域        .workflow/…/prepare/、.workflow/…/workflows/
2. 全局安装      ~/.maestro/prepare/、~/.maestro/workflows/
3. 仓库根        ./prepare/、./workflows/
```

**推论**：全局安装副本存在时，改仓库文件对 runtime 不生效。任何 prepare/workflow 修改后必须：① 执行安装同步（源 → `~/.maestro/`）；② 用 `maestro run prepare <step>` 输出的 `path` 字段核对 resolved path 指向预期副本。

### Gate 双轨制（机器 gate vs 模型 gate）

`contract.gates.exit` 的**声明形式**决定执法主体（`runtime.ts:279-292, 344-357, 445-446`）：

| 声明形式 | runtime 行为 | 执法主体 |
|----------|--------------|----------|
| bare-string ID（如 `self-check-passed`） | 转为 `{check: manual, required: false, blocking: false}`，评估恒为 `skipped`，**永不机器阻断** | **模型** —— workflow Step Gates 的 REQUIRED/BLOCKED 是给执行模型的纪律 |
| 自动 `produce-*` gate（按 contract.produces 生成） | required + blocking，产物文件缺失即阻断 complete | **机器** |
| object 形式声明（file 存在等 check 定义） | 按 check 定义机器评估 | **机器** |

推论：① workflow Step Gates 写可查条件是给**模型**的执法依据，runtime 只机器执法产物存在性；② 声称「gate 保证 X」前先确认执法主体——需要机器强制的条件必须用 object 形式声明或落为产物存在性；③ 「文档口径与机器行为不冲突」≠「机器在执法」（execute 的 `self-check-passed` 即为例：机器只查 `outputs/self-check.json` 存在，不读 `overall` 值）。

### 三条硬约束（后续所有规则的根）

1. **prepare 必须自足支撑思考期**。思考期 workflow 不可见（只有行数），prepare 里凡是「要看了流程才能懂」的内容都是死代码。
2. **workflow 必须自足支撑执行期**。执行期靠 brief 注入，prepare 是否还在上下文取决于编排方；恢复场景必然缺席。执行期必须成立的纪律不能只写在 prepare。
3. **contract 以 canonical prepare frontmatter 为唯一作者维护源**——这是规范性要求，不是实现事实：runtime 实际兼容 `<contract>` 标签、任意 yaml fenced block、frontmatter 三种来源，且 `resolveCommandSource` 有 prepare → 项目 .claude → 全局 .claude 的多级回退（`contract.ts:60-135`）。**规范禁止利用兼容路径**；唯一性需 lint 保障（见 § 八）。refs 独立于 contract schema，仅从 prepare frontmatter 解析（`contract.ts:192-207, 270`）。

### prepare 的目标产物：prep YAML

思考期的输出是 prep YAML（maestro-next A_EXECUTE_STEP）：

```yaml
goal:      # 本次运行要产出什么
approach:  # 走哪个模式、带什么 flag
scope:     # 边界内 / 边界外
risks:     # 已知风险与规避
gates:     # 出口 gate 及其判定口径
reads:     # 开工要先读什么
```

**核心判据：prepare 的每一段都必须直接服务于 prep YAML 的某个字段；不服务任何字段的内容不属于 prepare。**

| prepare 段 | 服务字段 |
|------------|----------|
| frontmatter contract | （机器） |
| Purpose | goal |
| Input Interpretation | approach（+ create 的 args/session 命名） |
| Required Context | reads |
| Boundaries and Invariants | scope |
| Risk Checklist | risks |
| Gate Intent | gates |

---

## 二、现状分析

### 做对的（保持）

- 19 个 prepare 文件正文六段（含 frontmatter 计七段）结构完全统一，59–95 行，体量健康。
- workflow 引用 contract 而非复制（如 `workflows/analyze.md` Step 5.3 注明 "declared in prepare/analyze.md contract"）。
- gates.exit **ID** 已收敛到 contract（commit bc56e），两侧围绕同一组 ID 展开。

### 问题（规范要消除的）

| # | 问题 | 实例 | 归类 |
|---|------|------|------|
| 1 | 不变量逐字级双写 | `prepare/analyze.md:48-61` 与 `workflows/analyze.md:376-382` 三条几乎逐字重复 | 漂移风险 |
| 2 | Gate 条件双写 | prepare Gate Intent 写「≥1 code anchor」，workflow Step Gates 再写带文件名的同条件 | 漂移风险 |
| 3 | prepare 泄漏执行细节 | `prepare/odyssey-planex.md:46-52` 的 executor 解析表——S_EXECUTE 时刻才需要 | 层次错位 |
| 4 | 模式判定双写但无分辨率约定 | prepare 表格 vs workflow 伪代码，各写各的 | 缺规则 |
| 5 | **Gate ID 一致 ≠ 语义一致** | execute 的 `self-check-passed` 曾有三种口径（gate 注释 `overall=="passed"` / 散文「gaps_found 不阻断」/ Success Criteria「smoke passed」）——已按散文口径修复（2026-07-15） | 语义漂移 |

问题 5 的教训写入规则：**gate 审计必须分「ID 一致」和「语义一致」两层**；每个 gate 在 workflow 中只允许一处判定口径，注释、散文、Success Criteria 提及同一 gate 时必须同口径。

---

## 三、prepare ↔ workflow 归属矩阵

**「双层」不等于「双写」**：允许同一主题出现在两层，但分辨率不同、且完整表述只归一层（判定见 § 六）。

| 内容 | prepare | workflow |
|------|---------|----------|
| contract（consumes/produces/gates ID/refs） | **frontmatter 唯一作者源** | 引用，不复制 |
| 产物 JSON schema | ✗ | ✓（jsonc 块） |
| 目标定义（产出物是什么/不是什么） | ✓ Purpose（一句定性） | 开头 1–3 行摘要 |
| 输入/模式判定 | **决策级**：表格，输入长相 → 模式 → 对 gate/产物的影响 | **执行级**：伪代码，精确路由优先级 |
| 上下文注入（specs/wiki/架构文档） | ✓ 来源清单 + 必需/可选 + 缺失降级决策 | 仅在用到的 step 处引用命令；执行中的 fallback 路径归 workflow |
| 职责边界（做什么/绝不做什么/与相邻 step 分界） | **✓ 唯一** | 最多一句引用 |
| 执行纪律（证据要求/重试上限/禁止行为） | 最多一句定性 | **✓ 唯一**（Domain Invariants 或内嵌到 step） |
| 风险自检 | ✓ Risk Checklist（问句形式） | ✗（转化为 gate 条件或 step 内检查点） |
| Gate 语义 | **意图级**：每 ID 一条 why + 豁免分支 | **执法级**：REQUIRED 可查条件 + BLOCKED 后果，全文件单一口径 |
| 步骤流程 / FSM / 状态机 | ✗ | ✓ |
| Agent spawn prompts | ✗ | ✓ |
| 交互协议（AskUserQuestion 细节） | ✗（只说哪些 flag 跳过交互） | ✓ |
| 错误码 / Success Criteria（first-tier step） | ✗ | ✓ |
| ref 文件 | frontmatter refs 声明（path + when） | 在触发 step 处引用同一路径 |
| 平台变体（`.codex.md` 等后缀覆盖） | 同名规则适用 | 同名规则适用 |

---

## 四、prepare 文件规范

### 结构（固定七段，顺序不可变）

```markdown
---
name: <step>
description: <一句话：动作 + 产出物>
goal: true                # 可选。长周期 step 声明后，run prepare/skill 按平台返回 goal_mode 创建指引（用户加载即为显式启用；平台无 goal 工具时为 null）
argument-hint: "[args] [flags]"
contract:
  consumes:  [{ kind, alias, required }]
  produces:  [{ path, kind, alias?, role }]
  gates:
    exit: [<gate-id>, ...]
refs:
  - { path: ref/<file>.md, when: <触发条件一句话> }
---

# Pre-task Thinking: <step>

## Purpose
## Input Interpretation
## Required Context
## Boundaries and Invariants
## Risk Checklist
## Gate Intent
```

平台覆盖文件（`prepare/<step>.codex.md` 等）**不继承** base 的 `goal` 标志——覆盖文件需要 goal 指引时须自行声明 `goal: true`。

### 逐段规则

**Purpose**（→ goal，≤6 行）
- 首句沿用现行句式：`The output of X is "…" not "…"` —— 一句话同时定性产出物和最易犯的错。
- 说明下游消费者是谁（哪个 step 吃 primary 产物）。
- 禁止出现步骤编号、阶段名罗列（那是 workflow 摘要的事）。

**Input Interpretation**（→ approach + create args）
- 覆盖 argument-hint 里的**每一个** flag / 入口模式：它改变哪条路径、启停哪些 gate、影响哪个产物。
- 入口模式 ≥3 种时用表格（Mode | Trigger | 效果）。
- 判据：读完此段模型应能确定 create 的完整命令行（session 命名、intent、`--` 后透传 args）。
- 禁止写执行期才需要的解析细节（如「S_EXECUTE 时如何路由 executor」→ workflow）。

**Required Context**（→ reads）
- 列注入源：上游 alias、specs 类别、wiki 检索词、架构文档路径。
- 每条标注 必需/可选 + 缺失时的**降级决策**（继续并记 warning / 阻塞报错）；执行中的 fallback **路径**归 workflow。
- 上游 alias 必须与 contract.consumes 一致，并写明「路径由 create 注入（返回值 upstream 字段），禁止按 mtime 猜」。

**Boundaries and Invariants**（→ scope）
- 只写**职责边界**：本 step 产出什么、绝不做什么、与相邻 step 的分界线（如「self-check 不是验收结论，验收在 verify」）。
- 执行纪律（重试上限、证据格式）不在此展开——最多一句定性 + 指向 workflow 或 ref。
- 判据：每一条都应影响 intent 措辞或 scope 取舍；影响不到的删掉。

**Risk Checklist**（→ risks，4–8 条）
- 问句形式，每条 = 一个自检问题 + 判定标准（阈值/反例）。
- 只列**开工前可预判**的风险；执行中才能观测的检查点写进 workflow 的 step 或 gate。

**Gate Intent**（→ gates）
- 与 contract.gates.exit **一一对应**，不多不少。
- 每条一句：这个 gate 保护什么（why）+ 哪些分支不适用（如 `-q` 分支自动豁免哪些 gate）。
- **禁止写可查条件的完整清单**（文件名、字段名级条件是 workflow Step Gates 的执法内容）；允许出现定义边界的关键阈值（如「3 次失败即停」），但同一阈值不得在两层重复展开。

### 长度参考（warning 级，非阻断）

参考带 **60–100 行**（现状 59–95）。越界不直接判违规，但触发人工检查：超 100 行查是否漏进执行细节或该抽 ref；低于 50 行查 flag 覆盖是否完整。**硬性检查项是内容性的**：flag 全覆盖、gate 一一对应、alias 与 contract 一致（见 § 八清单）。

---

## 五、workflow 文件规范（对 command-authoring.md § 7 的增补）

结构、Phase 命名、格式规则沿用 command-authoring.md § 7，此处只写与 prepare 对接的增量：

### frontmatter（关联声明）

```markdown
---
name: <step>
prepare: <canonical prepare 名，不带 .md 扩展名>   # runtime 会追加 .md；填 "analyze.md" 会解析成 analyze.md.md
commands: [maestro-<step>]                          # alias，需全局唯一
session-mode: inherited | run | none
---
```

示例：`prepare: analyze`、`prepare: odyssey-planex`。

### 对接规则

1. **开头摘要**（H1 下 1–3 行）：目的 + 产出 + 关键约束。这是 prepare Purpose 的执行侧对偶，不重复其「is not」句式。
2. **不复制 contract**。产物路径首次出现时标注 `（declared in prepare/<step>.md contract）`，schema 用 jsonc 块给全。
3. **Step Gates 段**：每个 contract.gates.exit ID 一个块，格式固定：
   ```markdown
   **GATE: <gate-id> (Step N → N+1)**
   - <REQUIRED 可查条件：文件存在/字段非空/计数阈值>
   - ...
   ```
   必须可 grep/文件级判定；意图解释（why）不写——那在 prepare Gate Intent。
4. **每个 gate 全文件单一口径**：Step Gates 块是唯一判定定义；正文注释、散文、Success Criteria 提及同一 gate 时必须与该口径一致（§ 二问题 5 的教训）。复杂 gate 建议给真值表：输入状态 → gate 结论 → 阻断/豁免。
5. **Domain Invariants 段 = 执行纪律的唯一完整表述**（brief 场景 prepare 缺席，此段是恢复执行时的守则）。与 prepare Boundaries 的关系：prepare 写「边界在哪」，此处写「违反时在哪个 step 查、什么后果」。逐字重复超过一句 = 违规。
6. **模式判定用伪代码**（优先级编号），与 prepare 的决策表格构成两级分辨率。
7. **refs 引用**：在触发 step 的正文处写 `→ 按 ref/<file>.md 执行`，路径必须与 prepare frontmatter refs 声明一致；两层都不得内联 ref 内容。
8. **错误码 / Success Criteria**：first-tier step 由 workflow 持有（§ 〇 范围声明）；格式沿用 command-authoring.md 的表格与 checklist 规则。

### 长度校准（warning 级）

沿用 command-authoring.md § 7 Depth Calibration 作为参考带，同样不作硬归属判据——语义完整性检查（flag/schema/gate/错误路径/引用完整）优先于行数。

---

## 六、判定测试 — 一条内容该放哪层

### 第 0 问（守卫，先于两问测试）

> **这条内容是否属于：机器可读元数据（frontmatter/contract）、数据 schema、受保护 XML 标签、completion/routing 块、跨文件引用？**

是 → 按其专属规则处理（contract 归 prepare frontmatter、schema 归 workflow、受保护结构按 `instruction-authoring-guide.md` P1–P5 保留），**不进入两问测试**。这些内容不直接改变 intent 或产物，但支撑 runtime 解析与 overlay 定位，删除即断链。

### 两问测试

1. **「建会话前不知道这条，会写错 intent / session 名 / flag 吗？」** 会 → prepare。
2. **「执行中违反这条，会产出坏产物吗？」** 会 → workflow（Domain Invariants 或对应 step 内嵌）。
3. **两问都「会」** → 拆两级分辨率：prepare 写判断句（影响决策的定性 + 关键阈值），workflow 写执法句（在哪查、查什么、违反后果）。完整表述归 workflow。
4. **两问都「不会」**（且已过第 0 问）→ 删掉。

### Table-driven 用例（校准基准）

| # | 内容示例 | 归属 | prepare 形态 | workflow 形态 |
|---|---------|------|--------------|---------------|
| 1 | gates.exit ID 列表 | 第 0 问 → prepare frontmatter | contract 字段 | 引用 |
| 2 | 产物 JSON schema | 第 0 问 → workflow | ✗ | jsonc 块 |
| 3 | 受保护 XML 标签 / completion 块 | 第 0 问 → 所在文件保留 | — | — |
| 4 | `-q` 跳过哪些阶段 | 两问都会 → 双层分辨率 | 「-q 只做决策提取，探索/评分 gate 豁免」 | 路由伪代码 + gate 适用性声明 |
| 5 | 重试上限「3 次失败即停」 | 问 2 → workflow 完整 | 最多一句定性（如影响 scope） | 在哪个 step 查、超限后果（blocked + checkpoint） |
| 6 | gate 可查条件（文件存在/字段非空） | 问 2 → workflow Step Gates 唯一 | ✗ | REQUIRED/BLOCKED 块 |
| 7 | gate 为什么存在 + 豁免分支 | 问 1 → prepare Gate Intent 唯一 | 一句 why + 豁免 | ✗ |
| 8 | ref 触发条件 | 第 0 问 + 问 2 | frontmatter refs(when) | 触发 step 处引用 |
| 9 | 上游 alias 缺失时继续还是阻塞 | 问 1 → prepare Required Context | 降级决策 | 执行中 fallback 路径 |
| 10 | executor 路由细节（S_EXECUTE 时刻） | 问 2 → workflow 唯一 | 只写「--method 影响什么」 | 完整解析表/伪代码 |

新增内容先对照用例表找最近邻；找不到近邻再走两问测试。此表可扩充，扩充时须给出 owner + 两层形态 + 理由。

---

## 七、反模式

| 反模式 | 修正 |
|--------|------|
| prepare 出现步骤编号、状态机、agent prompt、产物 schema | 移入 workflow |
| prepare 描述执行期机制（如 executor 路由、GC 循环细节） | 移入 workflow 对应 step；prepare 只留「该 flag 影响什么」 |
| workflow 复述 consumes/produces/gates 清单 | 引用 prepare contract |
| 在 workflow 正文/`<contract>` 标签/yaml block 里另写 contract | contract 只写 prepare frontmatter（runtime 兼容 ≠ 允许） |
| Gate 条件在 Gate Intent 与 Step Gates 双写 | Intent 留 why + 豁免分支；条件只在 Step Gates |
| 同一 gate 在注释/散文/Success Criteria 口径不一 | Step Gates 块为唯一口径，其余处对齐或删除 |
| 不变量在 Boundaries 与 Domain Invariants 逐字双写 | prepare 定边界一句话，workflow 持完整执法表述 |
| Gate Intent 条目与 contract.gates.exit 数量不符 | 一一对应，多删少补 |
| workflow frontmatter 写 `prepare: analyze.md` | 去扩展名：`prepare: analyze` |
| refs 声明了 when 但 workflow 正文无触发点引用 | 在触发 step 处补引用，或删除该 ref |
| 执行纪律只写在 prepare | brief 恢复场景会丢——完整表述移入 workflow |
| 只改仓库文件不安装同步就验证 | 安装同步 + 核对 resolved path（§ 一解析优先级） |
| 把行数当硬归属判据 | 行数是 warning；内容性检查（flag/gate/schema/引用）才是硬项 |

---

## 八、新 step 的创建流程

完整流程：**设计 → 三层写作 → 静态自检 → 安装同步 → runtime smoke → 验证**。

### 1. 设计

- 加载适用 specs：`maestro load --type spec --category arch`（+ 涉及确认门控/wave 的 step 加载相关 knowhow）。
- 定 contract：consumes（上游 kind/alias）、produces（路径/kind/role/alias）、gates.exit（3–5 个出口条件 ID）。
- 定 `commands:` alias 并确认全局唯一（与现有 step、独立命令、skill 无冲突）。

### 2. 三层写作（顺序固定：contract 先行，prepare 最后反推）

1. 写 workflow 骨架：frontmatter（`prepare:` 不带扩展名）+ H1 摘要 + Pipeline/FSM 图 + Step Gates（每个 gates.exit ID 一个 REQUIRED/BLOCKED 块）。
2. 填 workflow Process：逐 step 输入输出、agent prompt、jsonc schema、错误码、Success Criteria、Domain Invariants。
3. 反推 prepare 六段：从 contract 和 workflow 提取决策级内容——每段对照 prep YAML 字段自问「思考期缺这条会怎样」。
4. 如入口编排需要感知新 step（step registry、路由表），同步更新对应入口命令。

### 3. 静态自检

- [ ] gates.exit ID 在 contract / Gate Intent / Step Gates 三处一一对应
- [ ] 每个 gate 全文件单一口径（注释/散文/Success Criteria 无第二种表述）
- [ ] prepare 无步骤编号、无 agent prompt、无 schema
- [ ] workflow 无 contract 复制；frontmatter `prepare:` 无扩展名
- [ ] 两层间逐字重复不超过一句
- [ ] refs 的每个 when 在 workflow 正文有触发点
- [ ] argument-hint 每个 flag 在 Input Interpretation 有着落
- [ ] 假想只拿到 brief（无 prepare）：执行纪律是否完整？
- [ ] 假想只拿到 prepare（无 workflow）：能否写出完整 create 命令行和 prep YAML？

### 4. 安装同步

- 执行安装（源 → `~/.maestro/prepare/`、`~/.maestro/workflows/`）；镜像目录按 `npm run build:mirrors` / `lint:codex-skills` 校验。
- 平台变体（`.codex.md` 等）如有，一并安装。

### 5. runtime smoke

```bash
maestro run prepare <step> --workflow-root .   # ① path 字段指向预期副本 ② refs 完整 ③ workflow line_count 非零
maestro run skill <step>                        # 两层全文可解析
maestro run prepare <alias>                     # workflow frontmatter commands: 里声明的每个 alias 各测一次
```

注意：`prepare`/`skill` **不做 `maestro-` 前缀归一化**（归一化只在 create 走的 `resolveCommandSource`，`contract.ts:93-96`）；alias 可达性完全取决于 frontmatter `commands:` 声明值，且不保证是 `maestro-<step>` 形式（如 review 的 alias 是 `quality-review`）。

### 6. 验证

- 建一次真实 run：create → brief → 走通最短路径 → check → complete，确认 produces 声明的产物路径可注册、gates 按预期执法——bare-string gate 是模型纪律（机器恒 skipped）；需要机器强制的条件必须是 object 形式声明或产物存在性（见 § 一 Gate 双轨制）。
- 平台变体走一遍 `run prepare <step> --platform <name>`。

---

## 九、存量修复清单

| # | 事项 | 状态 |
|---|------|------|
| 1 | `maestro-next.md` A_EXECUTE_STEP 陈旧注释（create 返回 workflow content）→ 改为 prepare→create→brief→complete 链 + next 提示（.claude 源 + .codex 镜像） | ✅ 2026-07-15 |
| 2 | `run create` 增加渐进式 `next` 提示（`CreateRunResult.next`，blocking 时给排障提示） | ✅ 2026-07-15 |
| 3 | `workflows/execute.md` self-check-passed 三口径 → 统一为「smoke 已执行 + 无未处理 critical 违规；gaps_found 不阻断」 | ✅ 2026-07-15 |
| 4 | analyze 等文件的不变量逐字双写 → prepare 一句定界 + workflow 完整执法 | 待办 |
| 5 | `prepare/odyssey-planex.md` 的 S_EXECUTE 细节下放 workflow | 待办 |
| 6 | Gate Intent 中的条件清单收敛为 why + 豁免 | 待办 |
| 7 | contract 唯一源 lint（检测 workflow/命令文件中的多余 contract 来源） | 待办 |
| 8 | command-authoring.md 增加适用范围注记（first-tier step 的错误码/Success Criteria 归 workflow） | ✅ 2026-07-15 |
| 9 | `next` reason 补 check 步骤 + `CreateRunResult.next` 测试断言（多 agent review 修订） | ✅ 2026-07-15 |
| 10 | 需要机器执法的 gate（如 self-check-passed 强制 critical violation 阻断）改 object 形式声明 | 待议 |
