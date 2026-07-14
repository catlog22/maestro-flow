---
title: "入口命令拆解与 workflow 合并规划 v2 — prepare/ + workflow/ 双文件结构，回退恢复被压缩的核心流程"
---

> 配套：`session-run-simplification-plan.md` §3.9/§3.9a、`three-entry-migration-plan.md` §2.1/§三、`content-layout-plan.md`。
> **v2 修订记**（推翻 v1 的单文件三层方案，依据四点裁定）：
> ① 上轮迁移（84ae24f8「Session Run 全量迁移」+ 287c4fcc「命令批量收敛」）把核心流程压缩掉了大量重要内容，需**回退恢复**作为合并素材；
> ② step 内容拆为 **prepare 文件**（带 YAML 头）与 **workflow 文件**（核心流程）两份，分放两个文件夹；
> ③ `run-mode.md` 与 `finish-work.md` **保留为共享单源，在合适位置引用**（推翻 v1/简化规划的"run-mode 消亡"决策）；
> ④ prepare 与 workflow 内容**零重复**。

---

## 一、内容流失盘点（回退依据）

上轮迁移对两个内容面做了不对称压缩，实测（b73c6e00 迁移前 → 当前）：

| 文件 | 迁移前 | 当前 | 流失情况 |
|------|---:|---:|------|
| `workflows/analyze.md` | 768 | 43 | 探索/讨论 FSM、六维评分细则、pressure pass 规则全部压成电报体 |
| `workflows/plan.md` | 520 | 42 | 同类流失 |
| `workflows/execute.md` | 631 | 44 | 同类流失 |
| `workflows/verify.md` | 557 | 39 | 同类流失 |
| `workflows/review.md` | 448 | 35 | 同类流失 |
| `workflows/test.md` | 385 | 41 | 同类流失 |
| `workflows/debug.md` | 409 | 45 | 同类流失 |
| `workflows/finish-work.md` | 145 | **4（"Removed Workflow" 占位）** | 收尾归档程序（outputs 检测→片段路由→archive.json→报告）整体消失；**grill/brainstorm/blueprint 三命令至今仍 @ 嵌入这个空壳** |
| `workflows/roadmap-common.md` | 193 | 161 | 轻度削减 |
| 命令文件（maestro-analyze 等 7 个） | 177–202 | 48–74 | 壳中的 deferred_reading 清单、flags 细节被删 |
| `workflows/grill.md` 等形态 B 五份 | ≈现状 | 494–710 | **未被压缩**，仍是核心流程本体 |

结论：**workflow 文件本应是命令的核心流程**（形态 B 至今如此）；形态 A 的"命令自包含"压缩是本次要回退的对象。

---

## 二、目标形态：两文件夹、按文件名配对

```text
D:maestro2                    ──install──▶ ~/.maestro/          ──覆盖── .workflow/
├─ prepare/{name}.md      YAML 头 + 任务前思考材料   → `maestro prepare` 返回
├─ workflows/{name}.md     核心流程（无 YAML 头）      → `run create` 全量返回
└─ ref/{name}.md          共享参考（deferred）        → create 返回清单；prep reads 选中项内嵌
```

- **配对规则**：同名即配对（`prepare/analyze.md` ↔ `workflow/analyze.md`），workflow 文件不设 YAML 头，杜绝头信息双写。
- **prepare 文件 YAML 头**（注册表校验对象，即结构层）：

```yaml
---
name: analyze
description: 多维分析并产出可供 plan 消费的 typed artifacts
argument-hint: "[topic] [-y] [-q] [--from <alias>] [--gaps [ISS-ID]]"
contract:
  consumes: [...]
  produces: [...]
refs:                                  # 参考层声明（含 when 触发条件）
  - { path: ref/boundary-grill.md, when: 边界冲突时 }
gates: [...]                           # 动态门建议词汇（供 prep YAML 选用）
---
```

- **prepare 文件正文**：任务前思考指引——目标塑形问题、风险检查清单、上游选读建议（consumes → reads 候选）、gate 选用建议。LLM 读后产出 prep YAML（goal/approach/scope/risks/gates/reads）。
- **workflow 文件正文**：核心流程本体——阶段/FSM、领域 invariants、输出 JSON 骨架、report frontmatter 模板、收尾引用点。

**交付时序**（对齐简化规划 §3.9 四动词）：

| 时刻 | CLI 返回 |
|------|------|
| `maestro prepare <step>` | `prepare/{name}.md` 全文（YAML 头 + 思考材料） |
| `run create <step> --prep` | **run-mode.md 全文（协议单源，注入一次）** + `workflow/{name}.md` 全文 + refs deferred 清单 + prep reads 选中项全文 |
| `run brief <run_id>` | Resume Packet 重附 run-mode 要点 + workflow 正文（防压缩遗忘） |
| `run complete <run_id>` | 扫描/求值/定格 |

---

## 三、内容零重复边界（唯一出处表）

每类事实只允许一个诞生地，合并与后续写作均按此裁决：

| 内容 | 唯一出处 | 禁止出现在 |
|------|------|------|
| contract（consumes/produces）、参数、refs 声明 | prepare YAML 头 | workflow 正文、run-mode |
| 任务前思考（目标塑形/风险/选读/gate 建议） | prepare 正文 | workflow 正文 |
| 核心流程、阶段 FSM、领域 invariants、输出骨架、report 模板 | workflow 正文 | prepare 文件 |
| Run 协议（动词序列、产物边界、seal 语义、upstream 消费规则） | `run-mode.md`（create/brief 注入） | prepare、workflow 一律不得复述 |
| 收尾归档程序 | `ref/finish-work.md` | 各 workflow 只写一行引用点 |
| 共享交互机制（访谈/边界拷问） | `ref/*.md` | 各 workflow |
| 产物 schema 权威 | `kinds/` 注册 | workflow 只留书写骨架示例 |
| verdict → 下一步路由 | 共享 scorer 素材（入口层） | workflow 只留 report `next:` 交接语义 |

判别口诀：**prepare 回答"做之前想什么"，workflow 回答"怎么做"，run-mode 回答"在什么规则下做"，finish-work 回答"做完怎么收"。**

---

## 四、run-mode 与 finish-work 的引用位

| 文档 | 处置 | 引用位（"合适地方"） |
|------|------|------|
| `workflows/run-mode.md`（31 行协议契约） | **保留为唯一协议文档**，v1"删除/消亡"决策撤销；按 v1.1 词汇修订（`run check` 删、`gates.json`/`evidence.json` 行删、动词改 prepare/create/brief/complete） | 不被任何 prepare/workflow 文件 @ 引用；由 **create 返回包固定注入一次**，brief 重附要点——单源、零复述 |
| `workflows/finish-work.md`（现为 4 行占位） | **回退恢复 145 行版**（outputs 检测→片段提取路由→领域术语→archive.json→报告），词汇清洗后迁 `ref/finish-work.md` | 消费 step（grill/brainstorm/blueprint 等）的 workflow 收尾阶段写一行引用点：`→ 收尾按 ref/finish-work.md 执行`；create 的 refs 清单携带，deferred Read |

零协议学习的表述随之修正：不是"协议文档死亡"，而是**协议单源 + 时刻注入**——LLM 仍不需要预学协议，因为 create/brief 总会把 run-mode 带到眼前；但协议内容有且只有一份文档承载。

---

## 五、素材来源与回退策略

**不做 git revert**（84ae24f8 之后的提交含 milestone→session 等无关重构，整体回退会连带丢失），改为**定点提取**：

```bash
git show b73c6e00:workflows/{name}.md   # 提取迁移前核心流程作为合并素材
```

素材优先级（同一事实冲突时）：

| 素材 | 充当 | 说明 |
|------|------|------|
| 回退版 workflow（768/520/631… 行） | **流程基线**（workflow/ 正文主体） | 恢复被压缩的 FSM、评分细则、阶段规则 |
| 现版命令文件 | **contract/词汇基线**（prepare YAML 头 + v1.1 术语） | contract 结构、report 5 必学键模板以现版为准 |
| 现版 43 行 twin | 仅回收 Verdict Routing 表 → scorer 素材 | 其余内容是回退版的子集，弃 |
| 旧版命令（177–202 行） | 回收 deferred_reading 清单 → prepare 头 `refs:` 候选 | 如 analyze 的 issue-gaps-analyze/boundary-grill 条件引用 |

**词汇清洗清单**（回退素材写入 workflow/ 前必做，防止旧概念回流）：

| 旧表述 | 改为 |
|------|------|
| `maestro run check` / `--stage exit` | 删（产物门由 contract 派生，complete 自动求值） |
| `seal` / `run start` | `complete` / `create` |
| `gates.json` `evidence.json` `_meta` 必填 | v1.1：内联 GateRecord、事实归位、文件名即 kind |
| phase / milestone 词汇 | session / run 词汇 |
| `templates/*.json` 引用（plan.json/task.json/state.json） | 产物 schema 归 `kinds/` 注册；书写骨架内嵌 workflow 正文 |
| 协议性段落（动词序列、产物边界） | 删，归 run-mode 单源 |

---

## 六、合并规则（按形态分治）

三种配对形态的盘点不变（形态 A 双胞胎对 / 形态 B 壳+重文档对 / 形态 C 共享支撑文档），合并动作改为双文件产出：

**规则 A（analyze/plan/execute/verify/review/test/debug 七对）——回退恢复为主**
1. `workflow/{name}.md` ← 回退版 workflow 全文为基线，做词汇清洗 + 协议段落剥离；
2. `prepare/{name}.md` ← 现版命令 contract frontmatter + 旧版命令 deferred_reading 回收进 `refs:`；正文的思考材料从回退版 workflow 的"入口判定/模式解析"章节抽取改写；
3. 现版 43 行 twin 与现版命令文件下线；Verdict Routing 表数据化进 scorer。

**规则 B（grill/brainstorm/blueprint/roadmap/quick/auto-test/retrospective 七对）——现状即素材**
1. `workflow/{name}.md` ← 现版 workflow 文档（未被压缩，即核心流程），剥离协议段落与 required_reading 块；
2. `prepare/{name}.md` ← 壳命令的 contract/flags/invariants 中属"任务前"的部分 + 思考材料；
3. 壳中与文档重复的 execution 复述删除；壳文件下线。

**规则 C（共享支撑文档）**
- `interview-mechanics.md`、`boundary-grill.md`、回退恢复后的 `finish-work.md`、`templates/roadmap.md` → `ref/`；
- 仅被保留档 skill 引用的（issue/learn/knowhow/sync/refactor/init/fork/merge/overlays）→ 原位保留；
- `run-mode.md` → 原位保留为协议单源（§四）。

---

## 七、逐文件映射表（14 个第一档 step）

| # | step | prepare/{name}.md 素材 | workflow/{name}.md 素材 | refs（deferred） | 下线 |
|---|------|------|------|------|------|
| 1 | analyze | 现命令 contract + 旧命令 refs（issue-gaps-analyze、boundary-grill） | **回退版 analyze.md（768 行）** | boundary-grill | 现命令、twin |
| 2 | plan | 现命令 contract + 旧命令 refs（boundary-grill） | **回退版 plan.md（520 行）** | boundary-grill | 同上 |
| 3 | execute | 现命令 contract | **回退版 execute.md（631 行）** | — | 同上 |
| 4 | verify | 现命令 contract（旧无独立命令，无回收项） | **回退版 verify.md（557 行）** | — | 同上 |
| 5 | review | 现命令 contract | **回退版 review.md（448 行）**，产物统一改名 review-findings.json | — | 同上 |
| 6 | test | 现命令 contract | **回退版 test.md（385 行）** | — | 同上 |
| 7 | debug | 现命令 contract | **回退版 debug.md（409 行）** | — | 同上 |
| 8 | grill | 壳 contract/flags | 现版 grill.md（495 行） | interview-mechanics、finish-work | 壳命令 |
| 9 | brainstorm | 壳 contract/flags | 现版 brainstorm.md（509 行） | interview-mechanics、boundary-grill、finish-work | 壳命令 |
| 10 | blueprint | 壳 contract/flags | 现版 blueprint.md（409 行） | interview-mechanics、finish-work | 壳命令 |
| 11 | roadmap | 壳 contract/flags | 现版 roadmap-common.md（161 行；与回退版 193 行 diff，补回削减项） | interview-mechanics、roadmap-template | 壳命令 |
| 12 | quick | 壳 contract/flags | 现版 quick.md（345 行） | — | 壳命令 |
| 13 | auto-test | 壳 contract/flags | 现版 auto-test.md（710 行） | — | 壳命令 |
| 14 | retrospective | 壳 contract/flags | 现版 retrospective.md（465 行）；review/verify schema 指针改指 kinds/ | — | 壳命令 |

共享文档迁移：`interview-mechanics.md`/`boundary-grill.md` → `ref/`（首个消费方迁移时）；`finish-work.md` **先回退恢复 145 行版再迁** `ref/`；`templates/roadmap.md` → `ref/roadmap-template.md`；`run-mode.md` 原位保留（协议单源）。

---

## 八、残留引用修复清单

| 引用方 | 现引用 | 改为 |
|------|------|------|
| grill/brainstorm/blueprint 三命令 | `@workflows/finish-work.md`（现为空壳占位） | 随壳命令下线消除；新 workflow 文件收尾阶段引用 `ref/finish-work.md`（恢复版） |
| `quality-retrospective` | `workflows/review.md`/`verify.md` schema 指针 | `kinds/review-findings.yaml`、`kinds/verification.yaml` |
| `quality-retrospective` | `workflows/issue.md`、`learn.md` | 保留（消费方在保留档），路径不变 |
| `maestro-collab`（保留档） | `workflows/boundary-grill.md` | `ref/boundary-grill.md` |
| 全部 14 命令 | `required_reading` 块 | 整块消失（协议由 create 注入，流程即 workflow 文件本体） |
| `run-mode.md` 自身 | 文件头自引用的 `required_reading` 块 | 删除（历史遗留笔误） |
| `.codex/skills/*` 镜像 | 旧 workflow 路径 | Wave 5 手动重做 |

---

## 九、上游传导点（v2 设计对既有文档的修订，待同步）

| 文档 | 位置 | 现表述 | 应改为 | 状态 |
|------|------|------|------|:---:|
| `content-layout-plan.md` | §二行 2/4、§三分流表、判定规则 | 单文件 steps/{name}.md；run-mode 删除 | 双文件夹；run-mode 协议单源 | **本次已同步** |
| `session-run-simplification-plan.md` | §3.9a | 三层拆分承载于单一 step 文件；run-mode.md 消亡 | 结构+思考层=prepare 文件、执行层=workflow 文件；run-mode 单源注入 | 待同步 |
| `session-run-structure-guide.md`（v1.1） | §7.1a 流程注、§十一废除表 "run-mode.md 协议文档" 行 | 协议文档废除 | 改"协议单源，create/brief 注入"（触发 v1.2 修订位） | 待同步 |
| `three-entry-migration-plan.md` | §三六步程序、§2.1 目标路径 | 迁入 steps/{name}.md 单文件 | 迁入 prepare/+workflow/ 双文件；素材含回退提取步骤 | 待同步 |

---

## 十、Waves 对齐与验收

| Wave | 动作 |
|------|------|
| 0 | 注册表加载序支持 `steps/{prepare,workflow,ref}/` 三目录；run-mode.md 按 v1.1 词汇修订；finish-work.md 回退恢复并迁 ref/ |
| 1 | 形态 A 七对：`git show b73c6e00` 提取 → 词汇清洗 → 双文件产出；scorer 收编 7 张路由表 |
| 2–3 | 形态 B 七对：现状素材双文件产出；共享文档随首个消费方入 ref/；collab 引用改径 |
| 5 | 壳命令/twin 下线核销；`.codex/` 镜像重做 |

**验收**：

1. 14 对 `prepare/{name}.md` + `workflow/{name}.md` 存在且同名配对齐全；prepare YAML 头通过注册表校验；workflow 文件无 YAML 头。
2. **零重复抽查**：任取一 step，contract 只出现在 prepare 头；协议动词（create/complete/upstream 规则）只出现在 run-mode.md；收尾程序只出现在 finish-work.md；prepare 正文与 workflow 正文无交叠段落。
3. **回退完整性**：形态 A 的 workflow 文件行数量级恢复到迁移前水平（数百行），且全文无词汇清洗清单中的旧表述（`run check`/`seal`/`gates.json`/phase 等）。
4. 全仓 grep：`required_reading`、空壳 finish-work 引用、被下线文件名 → 零命中（guide/ 除外）；`ref/` 无孤儿。

---

> 本文件 v2 取代 v1 的单文件三层方案；与 `content-layout-plan.md` 已同步，§九所列其余上游文档待按批次传导。
