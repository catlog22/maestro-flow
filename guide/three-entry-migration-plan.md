---
title: "三入口迁移规划 — 多 skill 收敛为 maestro-next / maestro / maestro-ralph"
---

> 依据：`session-run-simplification-plan.md` §七（入口层重组）+ §7.8 分阶段；本文件将其**细化为可执行的文件级迁移方案**，并把入口从"2 个"修订为"3 个"——保留 `maestro` 作为静态链入口（修订说明见 §1.1）。
> 前置：基线指南已修订至 v1.1（见 `session-run-guide-v1.1-revision-checklist.md`）；CLI 收敛（简化规划 §八步骤 2）是本迁移的依赖项。

---

## 一、三入口定位

三个入口是**同一 step driver 的三种编排形态**，区别只在"链由谁定、何时定"：

| | `maestro-next` | `maestro` | `maestro-ralph` |
|---|------|------|------|
| 编排形态 | **无链**：单步 | **静态链**：先定整链再执行 | **自适应链**：边跑边决策 |
| 链的来源 | 路由 scorer 推荐一步 | 意图分类 → chain catalog 选链 | 初始链 + decision points 动态重建 |
| 人工确认 | 每步确认 | 链确认一次，随后连跑 | 无确认，blocked 才升级问人 |
| `orchestration.engine` | `manual`（不建 chain） | `maestro` | `ralph` |
| 典型场景 | 探索、单点修复、人主导 | 需求明确的完整管线 | 目标明确、路径不确定的长任务 |

### 1.1 对简化规划 §七 的两处修订

1. **入口 2 → 3**：`maestro` 保留。理由：静态链（一次决策、全链可预览、`--dry-run`）与自适应链是不同的信任模型——用户要"先看完整计划再放手"时静态链不可替代；且 `maestro` 现有的意图分类 + chain catalog 是路由 scorer 的直接素材，弃之重建更贵。
2. **engine 枚举**：简化规划 §3.2 的 `'ralph' | 'coordinator' | 'manual'` 修订为 `'ralph' | 'maestro' | 'manual'`——现 coordinator 语义（静态链编排）由 maestro 承接，不留两个名字。

### 1.2 共享内核（三入口都不自带领域逻辑）

```text
共享路由 scorer（简化规划 §7.3）：意图匹配 + 产物就绪（consumes dep-ready）+ 上游 handoff.next 建议
共享 step driver（简化规划 §7.4）：prepare（可选）→ create --prep → 执行正文 → complete → handoff
共享注册表（简化规划 §7.2）：steps/ gates/ kinds/，CLI 唯一加载者
```

- `next` = driver 单次调用 + 确认；
- `maestro` = 意图 → chain[] → for step in chain: driver(step)，链写 `session.json.orchestration.chain[]`；
- `ralph` = loop { scorer 选步 → driver → decision point 裁决 }，chain 动态追加。

### 1.3 companion 融入 next：轻量路由与 sidecar 模式

`maestro-companion` 命令**取消**，四个模式全部融入 next——next 成为唯一的人工侧工具入口，入口总数仍为 3：

| companion 原模式 | next 中的形态 | 副作用 |
|------|------|------|
| route（推荐下一步） | `next --suggest`：共享 scorer 推荐 + 理由，**不执行**——**suggest only, NEVER auto-execute**（项目 spec 既有约束保留） | **零**：不建 session/run |
| before（知识装载） | 被 **prepare 吸收**：driver 的 prepare 阶段本就返回思考材料 + 知识上下文；`--suggest` 时附带输出 | 零 |
| note（结构化记录） | `next --note "<内容>"`：直记 knowhow/scratch | 一条知识记录 |
| after（洞见提升） | `next --promote`：交互式提升到 spec/knowhow（session seal 的 finish-work 仍是批量出口） | 知识条目 |

路由能力三级不变，全部共享同一 scorer：`next --suggest`（零副作用建议）→ `next "<intent>"`（推荐 + 确认 + 执行一步）→ `maestro`/`ralph`（链）。从建议升级到执行只需去掉 `--suggest`（或 `--step` 直取被推荐步骤）。

**复杂度判断——轻量任务路由 companion 通道**：scorer 增加复杂度维度，next 按判定结果三路分流：

| 复杂度 | 判定信号 | 通道 | 协议开销 |
|------|------|------|------|
| **轻量** | 单点查询/小修：涉及 ≤1–2 文件、无产物交接需求、无门禁价值 | **companion 通道**：直接处理，不建 session/run，可选 `--note` 留痕 | **零** |
| **标准** | 产生 typed 产物、需交接下游或需门禁 | step driver 完整管线（prepare 可选 → create → complete） | 一个 run |
| **超步** | 意图含多阶段（如"分析 + 实现 + 验证"） | 不执行——推荐升级 `maestro`（路径明确）或 `ralph`（路径不确定） | 零（仅建议） |

规则：判定结果连同理由**展示给用户**，可显式覆盖（`--lite` / `--run` 强制指定通道）；边界原则**宁标准勿轻量**——复杂度不确定时走 run（有据可查、可交接），companion 通道仅在明确无交接价值时选择。这保留了 companion "轻量伴随"的原始价值：小事不背协议开销。

---

## 二、迁移对象总表（现有 skill → 去向）

### 2.1 第一档：迁为 step（删除 Skill 入口，共 14 个）

> 目标为 `prepare/{name}.md`（结构+思考）+ `workflows/{name}.md`（核心流程），同名配对。下表"目标 step"列简写为 `{name}`。

| 现有命令 | 目标 step | 备注 |
|------|------|------|
| `maestro-analyze` | `analyze` | 核心链，Wave 1；形态 A（从 b73c6e00 回退提取 workflow 正文） |
| `maestro-plan` | `plan` | 核心链，Wave 1；形态 A |
| `maestro-execute` | `execute` | 核心链，Wave 1；形态 A |
| `maestro-verify` | `verify` | 核心链，Wave 1；形态 A |
| `quality-review` | `review` | 产物改名 `review-findings.json`；形态 A |
| `quality-test` | `test` | 形态 A |
| `quality-debug` | `debug` | 形态 A |
| `quality-auto-test` | `auto-test` | 形态 B（现版 workflow 文件） |
| `quality-retrospective` | `retrospective` | 形态 B |
| `maestro-collab` | `collab` | 形态 B |
| `maestro-grill` | `grill` | 形态 B |
| `maestro-brainstorm` | `brainstorm` | 其多角色编排逻辑内聚在正文，不拆；形态 B |
| `maestro-blueprint` | `blueprint` | 形态 B |
| `maestro-roadmap` | `roadmap` | 产 session DAG 写 state.json 的例外语义保留；形态 B |

### 2.2 合并进三入口（共 9 个 → 3 个）

| 现有命令 | 去向 |
|------|------|
| `maestro-next` | **重写**：通用 step driver 的单步投影（路由表逻辑并入共享 scorer） |
| `maestro` | **重写**：意图分类 + chain catalog 保留，执行体换共享 driver；`--dry-run`/`-y`/`-c`/`--super` 语义保留 |
| `maestro-ralph` | **重写合并基线**（以 ralph-v2 语义为准） |
| `maestro-ralph-v2` | 并入 ralph：`--engine agent`（Agent(ralph-executor) 路径） |
| `maestro-ralph-cli` | 并入 ralph：`--engine cli`（delegate 路径） |
| `maestro-ralph-execute` | 成为 driver 内部实现，命令删除 |
| `maestro-ralph-cli-execute` | 成为 `--engine cli` 内部包装，命令删除 |
| `maestro-quick` | 并入预设：`maestro --preset quick` / `ralph --preset quick`，命令删除 |
| `maestro-companion` | **并入 next**：route→`--suggest`、before→prepare 吸收、note→`--note`、after→`--promote`（§1.3），命令删除 |

### 2.3 不迁移（第二/三档 + session 动词，入口保留）

| 类别 | 命令 | 说明 |
|------|------|------|
| Run-aware Skill | `odyssey-*`、`learn-*`、team-* 全家 | 保留入口，自己调 run 生命周期 |
| Plain Skill | `maestro-overlay`/`amend`/`composer`/`player`/`swarm-workflow`、`manage-*`、`spec-*`、scholar-* | 不进 run 体系 |
| session 动词 | `maestro-init`/`session-seal`/`fork`/`merge` | 独立保留；ralph/maestro 可在 seal 决策点自动触发 seal |
| 已下线 | `maestro-milestone-*` | 按指南 §8.1，不迁 |

---

## 三、step 文件迁移规程（每个第一档命令的机械步骤）

对 §2.1 每个命令执行同一套操作（产出 `prepare/{name}.md` + `workflow/{name}.md` 双文件，对应简化规划 §3.9a 三层拆分）：

```text
1. 素材提取：
   · 形态 A（analyze/plan/execute/verify/review/test/debug 等被压缩的 workflow）
     用 `git show b73c6e00:workflows/{name}.md` 提取回退版作为 workflow 正文素材
   · 形态 B（其余现版未被压缩者）直接用现版 workflow 文件
2. prepare 文件（prepare/{name}.md，带 YAML 头）：
   从现版命令 contract frontmatter（consumes/produces；删空 gates 样板、
   require_status、与文件名重复的 kind）+ 旧版 deferred_reading 组装——
   · `<purpose>` 压缩为 frontmatter purpose: 一句话
   · `<invariants>` 列表化为 frontmatter invariants: []
   · 领域 workflow 文档（如 brainstorm.md）改列 frontmatter refs:（path + 一句摘要），
     由 create 组装 deferred 清单
   · `<required_reading>` 中的思考材料落为 prepare 正文
3. workflow 文件（workflows/{name}.md，无 YAML 头，核心流程正文）：
   对回退版/现版 workflow 做词汇清洗——
   · `run check` → 删；`seal` → `complete`；`gates.json` → 内联 GateRecord；
     `phase` → `session`；协议段落 → 删除，归 run-mode.md
   · 内联 JSON 模板删 _meta
4. 参考层：共享文档迁 ref/；run-mode.md 保留原位（由 create 注入）
5. 落位：源码仓 `{prepare/,workflows/,ref/}` → install → `~/.maestro/steps/{prepare,workflow}/`
6. 原 .claude/commands/{name}.md 替换为 3 行 deprecation stub：
   指向 `maestro-next --step {name}`，一个过渡版本后删除
7. 零重复与词汇清洗核对：frontmatter 模板换 5+2 键块式 YAML、
   禁令列表删 gates.json/evidence.json 字样（规划 §六映射表）
```

> **单源红线**：同名配对的 prepare + workflow 双文件是唯一内容源（零重复：prepare 持有结构/思考，workflow 持有核心流程）；入口命令与 CLI 不复制 step 内容，只按标记切分返回。

---

## 四、三入口改造要点

| 入口 | 保留 | 删除 | 新增 |
|------|------|------|------|
| `maestro-next` | 意图解析、推荐-确认交互 | 自带路由表（评分细则移入共享 scorer 素材） | `--step` 显式覆盖；driver 调用；companion 四模式（`--suggest`/`--note`/`--promote`/prepare 吸收 before）；复杂度三路分流（§1.3，`--lite`/`--run` 覆盖） |
| `maestro` | 意图分类、chain catalog、`--dry-run`/`-y`/`-c`/`--super`、分解契约（invariant 4） | "dispatch via ralph-execute"（invariant 1，driver 取代）；`.maestro/*/status.json`（→ `session.json.orchestration`） | `--preset quick`；chain 写 orchestration.chain[] |
| `maestro-ralph` | 决策点模型、drift check、3-strike 升级 | v2/cli 变体文件、execute 包装、status.json | `--engine inline\|agent\|cli`；`--preset quick` |

三入口共同约束（承简化规划 §7.7）：**入口只含路由 + 生命周期驱动，零领域内容**——以 delegation-check 内容分离标准验收。

---

## 五、分批实施（细化简化规划 §7.8 A–D）

| Wave | 内容 | 验收门 |
|------|------|------|
| **0 依赖** | CLI 收敛完成（简化规划 §八步骤 2：prepare/brief/create --prep/complete + 分页器 + 注册表加载） | `maestro steps list` 可枚举；`run create` 返回出生包 |
| **1 核心链试点** | analyze/plan/execute/verify 按 §三迁为 step；`next` 重写为 driver 单步投影（含 companion 四模式融入 + 复杂度三路分流，§1.3） | `next --step analyze → plan → execute → verify` 人工驱动全闭环；`--suggest` 零副作用；轻量意图走 companion 通道不建 run |
| **2 静态链** | `maestro` 重写（chain catalog 接 driver）；quick 并入 preset | `maestro "<intent>" --dry-run` 出链、`-y` 连跑核心链闭环 |
| **3 自适应链** | ralph 合并 5 变体（先 `--engine inline`，再 agent，再 cli 逐个迁移验证） | 同一任务三 engine 各跑通一次；decision point 升级路径可触发 |
| **4 铺开** | 其余 10 个第一档 step 迁移（quality-* → 上游 grill/brainstorm/blueprint/roadmap/collab） | 每个 step 至少被 next 驱动跑通一次 |
| **5 收尾** | 入口文件换 stub；`.codex/`/`.agy/` 镜像重做（只余 3 入口 + 第二/三档）；一个过渡版本后删 stub | 全仓 grep 无失效引用；`maestro-help` 路由表更新 |

回滚策略：Wave 1–4 期间原命令文件未删（stub 在 Wave 5）——任何 step 迁移失败可即时回退为原入口，与简化规划 §7.6"降档兼容"一致。

---

## 六、风险与对策（增补项）

| 风险 | 对策 |
|------|------|
| `maestro` 的 12 条 invariants 部分依赖旧协议（status.json、ralph-execute 派发、`maestro ralph next/complete` CLI） | 改造时逐条映射：invariant 1/6/10 → driver 与 run 生命周期取代；2/5 → session.json；4（分解契约）语义保留、载体改 boundary_contract + prep |
| 三入口间行为漂移（同一 step 三处驱动结果不同） | driver 只有一份实现；入口差异仅限"链从哪来 + 确认策略"，以 Wave 3 三 engine 对照验收 |
| `.codex/` 手动镜像滞后 | Wave 5 一次性重做，期间 .codex 侧继续用旧命令（stub 未删，兼容） |

---

> 执行顺序依赖：本迁移 = 简化规划 §八步骤 3（第一档部分）+ 步骤 4 的合并执行；步骤 2（CLI）是 Wave 0 前置。命令与 CLI 的实际修改按用户指令另行启动。
