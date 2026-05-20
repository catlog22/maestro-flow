---
title: "学习工具集指南"
---

Maestro 学习工具集的完整使用手册，涵盖 5 个 `learn-*` 命令的原理、用法和协作模式。

---

## 一、概述

学习工具集是 Maestro 的**交互式深度学习**模块，专注于从代码、文档、决策历史中提取结构化知识。每个命令都遵循科学方法——假设、证据、验证、沉淀——将隐性的工程经验转化为可复用的显性知识。

### 与 manage-learn 的区别

| 维度 | learn-* 工具集 | manage-learn |
|------|---------------|--------------|
| 交互模式 | 交互式深度学习，多轮引导 | 原子操作，单次捕获 |
| 目标 | 系统化获取深层理解 | 快速记录单个洞察 |
| 产物 | 结构化报告、pattern catalog、evidence trail | 单条 `<spec-entry>` |
| 耗时 | 数分钟，多 Agent 并行 | 数秒，即时完成 |

简单规则：**需要思考用 learn-*，需要记录用 manage-learn**。

---

## 二、命令详解

### 2.1 learn-retro -- 统一复盘

对项目活动进行周期性回顾，从 Git 提交历史和架构决策中提炼洞察。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--lens` | 分析视角：`git` / `decision` / `all` | `all` |
| `--days N` | Git lens 回溯天数 | 7 |
| `--author <name>` | 按作者过滤 | 全部 |
| `--area <path>` | 按目录过滤 | 全部 |
| `--compare` | 与上次复盘对比 | 关闭 |
| `--phase N` | Decision lens 聚焦指定 Phase | 全部 |
| `--tag <tag>` | Decision lens 按标签过滤 | 全部 |
| `--id <id>` | 单独评估指定决策 | -- |

<details>
<summary>命令示例</summary>

```bash
/learn-retro                                    # 默认：两种 lens 全量分析最近 7 天
/learn-retro --lens git --days 14               # 仅 Git 分析，最近 14 天
/learn-retro --lens decision --phase 2          # 仅决策分析，聚焦 Phase 2
/learn-retro --lens all --author alice --compare # 全量分析，按作者过滤，对比上次复盘
```
</details>

#### Git Lens -- 活动分析

| 指标 | 计算方式 | 意义 |
|------|---------|------|
| Test ratio | test_insertions / total_insertions | 测试覆盖投入比例 |
| Churn rate | 变更 >2 次的文件数 / 总文件数 | 代码稳定性 |
| Sessions | 按时间间隔 >2 小时分组的提交聚类 | 工作节奏 |
| LOC/session-hour | 每会话每小时净增代码行 | 开发效率 |

产出：每人统计、高 churn 文件清单、低测试区域警告（< 20%）、与上次复盘的趋势对比。

#### Decision Lens -- 决策质量评估

3 个并行 Agent 从不同维度评估：

| Agent 角色 | 评估维度 | 评级 |
|-----------|---------|------|
| Technical Soundness | 实现是否匹配意图？上下文是否变化？ | sound / degraded / violated |
| Cost Assessment | 增加了多大复杂度？是否引入技术债？ | low-cost / acceptable / expensive / debt-creating |
| Alternative Hindsight | 事后看来是否是正确选择？ | confirmed / questionable / should-revisit |

| 状态 | 含义 | 建议 |
|------|------|------|
| Validated | 技术可靠 + 成本可控 + 事后验证 | 无需行动 |
| Aging | 可靠但成本高 | 安排技术债审查 |
| Questionable | 实现已偏离或决策可疑 | 创建 Issue 追踪 |
| Stale | 环境已变化，需重新评估 | 刷新决策文档 |
| Reversed | 代码行为已与决策矛盾 | 记录反转事实 |

**产物路径**：`KNW-retro-{date}.md`（报告）、`KNW-retro-{date}.json`（指标）、`specs/learnings.md`（沉淀）

---

### 2.2 learn-follow -- 跟读学习

通过逐节引导式阅读，从代码或文档中提取深层理解。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<target>` | 文件路径 / Wiki ID / 主题关键词 | 必填 |
| `--depth shallow\|deep` | 浅层（关键结构和模式）或深层（每个函数、分支） | `shallow` |
| `--save-wiki` | 将阅读笔记保存为 wiki 条目 | 关闭 |

<details>
<summary>命令示例</summary>

```bash
/learn-follow src/auth/jwt.ts                     # 跟读指定文件
/learn-follow src/utils/ --depth deep              # 深度跟读整个目录
/learn-follow arch-auth-design --save-wiki          # 跟读 wiki 文档并保存笔记
```
</details>

**目标解析**：文件路径（含 `/` 或 `\`）直接读取；Wiki ID 调用 `wiki get`；主题文字先搜索 wiki 再搜索源码。

#### 4 个强制提问

| # | 提问 | 提取内容 |
|---|------|---------|
| 1 | 这里使用了什么模式？ | 设计模式、惯用法、约定 |
| 2 | 为什么选择这个方案而不是其他方案？ | 权衡取舍、被排除的选项 |
| 3 | 这段代码依赖什么隐含假设？ | 隐式契约、输入形态、执行顺序 |
| 4 | 如果这里发生变更，什么会崩溃？ | 脆弱点、下游影响范围 |

命令自动构建 **1-hop 上下文邻域**（wiki 引用、import 依赖、下游消费者），提取结果与 `coding-conventions.md` 交叉比对：已文档化标记为 "confirmed"，未文档化建议录入规范。

**产物路径**：`KNW-follow-{slug}-{date}.md`（理解图）、`specs/learnings.md`（沉淀）

---

### 2.3 learn-decompose -- 代码模式拆解

将复杂代码系统化拆解为可复用的设计模式目录，4 个维度并行分析。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<target>` | 文件路径 / 目录 / 模块名 | 必填 |
| `--patterns <list>` | 逗号分隔的模式名列表，聚焦分析 | 检测全部 |
| `--save-spec` | 每个新模式自动调用 `spec-add` | 关闭 |
| `--save-wiki` | 按维度创建 wiki 笔记 | 关闭 |

<details>
<summary>命令示例</summary>

```bash
/learn-decompose src/auth/                       # 拆解 auth 模块
/learn-decompose src/utils/ --patterns "Factory,Observer,Strategy"  # 聚焦指定模式
/learn-decompose src/core/ --save-spec --save-wiki  # 拆解并同步到 spec 和 wiki
```
</details>

#### 4 维度并行分析

| Agent | 维度 | 检测内容 |
|-------|------|---------|
| Structural | 结构模式 | 类层次、组合关系、DI/IoC、Factory/Builder/Singleton、barrel exports |
| Behavioral | 行为模式 | 事件流、中间件链、观察者/发布订阅、命令/策略、状态机 |
| Data | 数据模式 | Repository/DAO、DTO 管道、缓存策略（memo/LRU/TTL）、序列化、schema 校验 |
| Error | 错误模式 | 错误边界、重试/退避/熔断、降级链、guard clause、日志策略 |

每个发现携带：模式名称、维度归属、置信度、代码锚点（file:line）、描述、权衡。发现与已有知识比对后标记为 documented / known / new，跨维度重复自动合并。

**产物路径**：`KNW-decompose-{slug}-{date}.md`（Pattern Catalog）、`specs/learnings.md`（沉淀）

---

### 2.4 learn-second-opinion -- 多视角分析

获取对代码、决策或计划的替代视角，避免单一判断的盲区。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<target>` | 文件路径 / Wiki ID / `HEAD` / `staged` / Phase 编号 | 必填 |
| `--mode` | `review` / `challenge` / `consult` | `review` |

<details>
<summary>命令示例</summary>

```bash
/learn-second-opinion src/auth/jwt.ts                    # 默认 review 模式
/learn-second-opinion src/core/ --mode challenge          # 对抗式质疑
/learn-second-opinion HEAD --mode consult                 # 交互式 Q&A
/learn-second-opinion 2 --mode review                     # 审查 Phase 2 的计划
```
</details>

#### 三种模式

**Review（默认）**：3 个 Agent 并行审查

| Agent 角色 | 关注点 | 核心提问 |
|-----------|--------|---------|
| Pragmatist | 简洁性、YAGNI、维护成本 | "最简可行方案？维护负担？" |
| Purist | 正确性、边界情况、类型安全 | "哪些假设可能被违反？" |
| Strategist | 可扩展性、架构一致性 | "支撑未来增长？符合架构？" |

综合为：共识点、分歧点、总判定、Top 3 建议。

**Challenge**：单一对抗 Agent 尝试找最脆弱假设、构造破坏场景、识别最大风险、提出替代方案。

**Consult**：交互式 Q&A 循环——Agent 加载目标后回答用户提问，说 "done" 结束并编译报告。

**产物路径**：`KNW-opinion-{slug}-{date}.md`（分析报告）、`specs/learnings.md`（沉淀）

---

### 2.5 learn-investigate -- 系统化探究

用科学方法探究代码库中的"为什么"和"怎么做"问题——不是修 bug，而是理解系统。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<question>` | 要探究的问题 | 必填 |
| `--scope <path>` | 限制搜索范围 | 整个项目 |
| `--max-hypotheses N` | 最大假设数，超过触发升级 | 3 |

<details>
<summary>命令示例</summary>

```bash
/learn-investigate "JWT 刷新令牌的完整生命周期是什么"
/learn-investigate "为什么队列消费有时会重复处理" --scope src/queue/
/learn-investigate "缓存失效策略有哪些" --max-hypotheses 5
```
</details>

#### 假说测试流程

```
定义问题 → 收集证据 → 模式匹配 → 生成假设 → 测试假设 → 综合报告
                                                        ↑
                                               3-strike 升级机制
```

**收集证据**：4 条通道并行——代码搜索（Grep）、文件检查、依赖追踪（import 链）、Git 历史。

**生成假设**：基于证据生成排序列表，如 `[HIGH] JWT 刷新使用轮转策略 — Evidence: src/auth/jwt.ts:42`。

**测试假设**：按优先级逐一测试，标记 confirmed / disproved / inconclusive。所有证据以 NDJSON 格式记录到 `evidence.ndjson`。

**3-strike 升级**：全部 inconclusive 时，向用户提问——扩大范围重新假设，或标记为 INCONCLUSIVE 生成已知未解报告。

**产物路径**：`KNW-investigate-{slug}/`（含 `evidence.ndjson`、`understanding.md`、`report.md`）、`specs/learnings.md`（沉淀）

---

## 三、学习数据流

### 产物结构

所有学习命令的产物遵循统一的存储约定：

```
.workflow/knowhow/                         # 学习产物主目录
├── KNW-retro-{date}.md / .json            # 复盘报告
├── KNW-follow-{slug}-{date}.md            # 跟读笔记
├── KNW-decompose-{slug}-{date}.md         # 模式目录
├── KNW-opinion-{slug}-{date}.md           # 第二意见
└── KNW-investigate-{slug}/                # 探究目录
    ├── evidence.ndjson
    ├── understanding.md
    └── report.md
specs/learnings.md                         # 统一学习沉淀
```

### learnings.md 结构

使用 `<spec-entry>` 闭合标签格式，包含 `category`、`keywords`、`date`、`source` 属性，确保可溯源。

### 知识流转

- 所有命令**自动**写入 knowhow 报告和 `specs/learnings.md`
- `--save-spec` / `--save-wiki` 控制是否进一步同步到规范系统和 wiki
- 重复发现自动去重——已有知识标记为 documented/known，仅 new 条目进入沉淀

---

## 四、使用场景速查

### 按意图选择命令

| 你想做什么 | 使用命令 | 示例 |
|-----------|---------|------|
| 回顾过去一周的工作质量 | `learn-retro` | `--lens git --days 7` |
| 检查架构决策是否仍然有效 | `learn-retro` | `--lens decision --phase 2` |
| 理解一个陌生模块的设计 | `learn-follow` | `src/auth/ --depth deep` |
| 学习某段代码的隐含约定 | `learn-follow` | `src/utils/logger.ts` |
| 盘点模块的设计模式 | `learn-decompose` | `src/core/ --save-spec` |
| 提取可复用的 pattern library | `learn-decompose` | `src/ --save-wiki` |
| 审查代码质量（多视角） | `learn-second-opinion` | `src/api/` |
| 对方案进行压力测试 | `learn-second-opinion` | `HEAD --mode challenge` |
| 就某个实现向 AI 请教 | `learn-second-opinion` | `plan.json --mode consult` |
| 理解"为什么会这样工作" | `learn-investigate` | `"缓存穿透的原因是什么"` |
| 探究某条调用链的完整路径 | `learn-investigate` | `"请求从入口到数据库的路径"` |

### 典型工作流组合

| 场景 | 步骤 |
|------|------|
| **新成员 Onboarding** | `learn-follow src/` → `learn-decompose src/core/ --save-wiki` → `learn-retro --lens git --days 30` |
| **架构决策前** | `learn-follow src/auth/ --depth deep` → `learn-second-opinion --mode review` → `learn-second-opinion --mode challenge` → `learn-investigate "影响范围"` |
| **迭代复盘** | `learn-retro --lens all --days 14 --compare` → `learn-investigate "高 churn 原因"` → `learn-decompose --save-spec` |
| **问题排查（理解而非修复）** | `learn-investigate "延迟原因"` → `learn-follow 关键文件` → `learn-second-opinion --mode consult` |

### 命令间的自然衔接

```
learn-follow → learn-decompose      # 从理解到模式提取
learn-follow → learn-second-opinion  # 从理解到多视角验证
learn-decompose → spec-add           # 从模式发现到规范录入
learn-retro → learn-investigate      # 从复盘发现到深入探究
learn-investigate → learn-follow     # 从问题定位到深入阅读
learn-second-opinion → learn-decompose  # 从质疑到系统化拆解
```
