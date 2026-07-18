---
title: "Maestro Commands Quick Reference"
---

> **v2 — v0.5.51** ｜ 17 commands + 45 skills, 10 categories
>
> v1 的 65 个独立命令（如 `/maestro-plan`、`/quality-review`、`/manage-status`、`/spec-add`、`/learn-decompose` 等）已在 v0.5.51 中退役并合并为 17 个统一命令。本文档仅收录当前 v2 命令与技能。

---

## Maestro (11 commands)

*智能协调器与核心工作流命令 — 初始化、路由、执行、验证与生命周期管理*

### `maestro` — 指挥家

**Usage:** `/maestro <intent> [-y] [-c] [--dry-run] [--super]`

意图路由器：分析用户意图，读取项目状态，选择并执行最优命令链（默认多步闭环编排）。

**Flags:** -y (自动模式) · -c (恢复会话) · --dry-run (演练) · --super (超级模式) · --compose [--edit \<path\>] (作曲可复用工作流模板) · --play \<slug\> [--context k=v] [--list] [--dry-run] (执行已保存的模板)

---

### `maestro-init` — 初始化项目

**Usage:** `/maestro-init [-y] [--from <source>] [--from-brainstorm SESSION-ID]`

自动检测项目状态（空项目 / 代码库 / 已有项目），创建 `.workflow/` 目录结构，包含 project.md、state.json、config.json 和 specs/。

**Flags:** -y (自动模式，配合 @file 创意文档) · --from \<source\> (从指定来源导入) · --from-brainstorm SESSION-ID (从头脑风暴会话导入)

---

### `maestro-next` — 单步推荐

**Usage:** `/maestro-next <intent>|--list|--suggest [-y] [--dry-run]`

默认交互入口：解析意图 + 项目状态 → 评分候选步骤 → 推荐单个原子步骤 → 确认后执行。多步意图走步进式用户确认链或移交给 `/maestro`，永不自动编排。

**Flags:** -y (跳过确认直接执行) · --dry-run (仅显示推荐) · --top N (显示前 N 个候选，默认 3) · --list (列出所有可用步骤) · --suggest (仅建议模式，永不自动执行) · --note \<text\> (追加结构化笔记到活跃 run) · --promote (将 run 洞察提升到 spec/knowhow) · --lite (强制轻量伴侣通道) · --run (强制创建 run) · --chain (强制创建手动引擎链)

---

### `maestro-ralph` — 自适应生命周期编排器

**Usage:** `/maestro-ralph <intent>|status|continue [-y] [--amend] [--roadmap] [--engine sequential|swarm|universal]`

自适应生命周期编排器：定位步骤 → 解析参数 → 加载上下文 → 派发 executor agent → 提取信号 → 漂移检查 → 评估决策 → 循环。

**Flags:** -y (自动确认) · --amend (目标修订流程) · --roadmap (路线图模式) · --engine sequential|swarm|universal (引擎选择，默认 sequential)

**子命令:**

| 子命令 | 说明 |
|--------|------|
| `status` | 查看当前会话状态 |
| `continue` | 恢复链式执行 |

**引擎专属 Flags**（--engine 为判别器）:

| Flag | 引擎 | 说明 |
|------|------|------|
| --script \<name\> | swarm | 指定 wf-* 脚本 |
| --dims \<d1,d2\> | swarm | 限定分析维度 |
| --roles \<r1,r2\> / --count N | swarm | 限定/设定角色数 |
| --tier quick\|standard | swarm | 审查维度数 |
| --depth shallow\|standard\|deep | universal | 对抗模式深度 |
| --from \<script\> | universal | 基于已有脚本修改 |
| --dry-run | universal | 仅生成脚本不执行 |
| --resume \<runId\> | both | 增量重跑 |

---

### `maestro-impeccable` — UI 生产管线

**Usage:** `/maestro-impeccable build|redesign|improve|enhance|launch|harden|foundation|live [target] [--codify <path>]`

前端 UI 设计、审计、打磨与固化 — 构建、重设计、改进、增强、发布、加固、基础、实时。

**Flags:** [target] (目标组件/页面) · --codify \<path\> (从源码提取设计系统为 tokens 和知识资产)

---

### `maestro-overlay` — 命令叠加层

**Usage:** `/maestro-overlay <intent> | --amend [--scan] [--dry-run] [-y]`

创建或编辑非侵入式命令叠加层（JSON 补丁文件增强 `.claude/commands/*.md`），或从工作流缺陷信号自动生成叠加层。

**Flags:** --amend (信号驱动自动生成模式) · --scan (扫描所有信号来源) · --dry-run (演练) · -y (自动模式)

---

### `maestro-fork` — 创建会话工作树

**Usage:** `/maestro-fork --session <session_id> [--base <branch>] [--sync]`

为会话创建或同步 git worktree，实现并行开发。

**Flags:** --session \<session_id\> (会话 ID，必填) · --base \<branch\> (基准分支) · --sync (同步已有工作树)

---

### `maestro-merge` — 合并会话工作树

**Usage:** `/maestro-merge --session <session_id> [--force] [--dry-run] [--no-cleanup] [--continue]`

将会话工作树分支合并回主分支。

**Flags:** --session \<session_id\> (会话 ID，必填) · --force (强制合并) · --dry-run (演练) · --no-cleanup (不清理) · --continue (继续中断的合并)

---

### `maestro-guard` — 编辑边界管理

**Usage:** `/maestro-guard on|off|status|allow|deny [path]`

配置目录级写入边界，由 workflow-guard PreToolUse hook 强制执行。

**Flags:** on (启用) · off (禁用) · status (查看状态) · allow \<path\> (允许目录) · deny \<path\> (禁止目录)

---

### `maestro-session-seal` — 封存会话

**Usage:** `/maestro-session-seal [--session <session_id>] [-y] [--skip-knowledge]`

封存当前会话：知识提取 + DAG 推进。

**Flags:** --session \<session_id\> (指定会话) · -y (自动模式) · --skip-knowledge (跳过知识提取)

---

### `maestro-update` — 工作流更新

**Usage:** `/maestro-update [--dry-run] [--force] [--setup-only]`

检测当前版本，预览变更差异，应用工作流升级。

**Flags:** --dry-run (仅预览迁移计划) · --force (跳过确认，用于 CI) · --setup-only (仅执行 setup，不迁移)

---

## Specification (1 command)

*项目规格与约定 — 通过统一 /spec 命令添加、加载、删除条目*

### `spec` — 规格管理

**Usage:** `/spec add|load|remove|setup [args...]`

管理项目规格（编码规范、架构约束、质量标准）。可复用知识文档走 `/manage knowledge capture`。

**子命令:**

| 子命令 | 说明 |
|--------|------|
| `add` | 按类别添加规格条目，支持 4-scope 路由（project/global/team/personal） |
| `load` | 按 scope/category/keyword 加载规格到上下文 |
| `remove` | 按条目 ID 删除规格 |
| `setup` | 扫描代码库自动生成约定规范，初始化 specs/ 目录 |

---

## Quality (2 commands)

*技术债务消减与安全审计*

### `quality-refactor` — 重构

**Usage:** `/quality-refactor [<scope>]`

系统性技术债务识别与安全消减：规划 → 确认 → 执行，每步变更后验证测试通过。用于显式重构请求；日常技术债务提及走 `/maestro-next`。

**Flags:** [\<scope\>] (范围：模块路径、功能区域)

---

### `security-audit` — 安全审计

**Usage:** `/security-audit [quick|standard|deep] [--scope <path>]`

系统性安全审计：覆盖 OWASP Top 10、依赖供应链、密钥检测、CI/CD 流水线审查及可选 STRIDE 威胁建模。

**Flags:** [quick\|standard\|deep] (审计深度，默认 quick) · --scope \<path\> (限定扫描目录)

---

## Management (1 command)

*项目状态、问题、知识存储与漂移/重建同步 — 统一 /manage 命令*

### `manage` — 项目管理中枢

**Usage:** `/manage status|issue|knowledge|sync [args...]`

统一项目管理枢纽，路由到四组子命令。

**子命令:**

| 子命令 | 说明 |
|--------|------|
| `status` | 项目仪表板（进度、任务、活跃工作、下一步） |
| `issue [create\|list\|status\|update\|close\|link]` | 问题生命周期 CRUD |
| `issue discover` | 多视角自动问题发现 |
| `knowledge capture` | 按类型捕获可复用知识（knowhow 沉淀） |
| `knowledge knowhow` | 管理 knowhow 条目 |
| `knowledge audit` | 审计/清理 spec、knowhow、artifact 存储 |
| `knowledge harvest` | 从工作流产物提取知识 |
| `knowledge wiki [health\|search\|cleanup\|stats\|connect\|digest]` | 知识图谱管理 |
| `knowledge extractors` | 自动生成 KG 提取器规则 |
| `knowledge domain` | 注册领域术语 |
| `sync codebase` | 增量代码库文档同步 |
| `sync drift` | 检测并重新对齐工件漂移 |
| `sync rebuild` | 全量代码库文档重建 |

---

## Odyssey (1 command)

*长周期迭代循环 — 一个入口，五种模式*

### `odyssey` — 迭代循环

**Usage:** `/odyssey <intent> --mode debug|improve|planex|review|ui [--auto] [-y] [-c]`

长周期证据驱动迭代循环。单一入口派发到五种模式，共享骨架：发现 → 领域审计 → 修复 → 验证 → 泛化 → 发现同类 → 沉淀知识，穷尽迭代直到退出条件满足。

**Flags:** --mode \<name\> (模式选择，支持意图关键词自动检测) · --auto (跳过委派确认) · -y (自动确认) · -c (恢复最近会话) · --skip-fix (仅审计/诊断) · --skip-generalize (跳过泛化)

**模式:**

| 模式 | 说明 | 专属 Flags |
|------|------|-----------|
| `debug` | 症状 → 根因 → 修复 → 确认 | --template \<name\> |
| `improve` | 6 维质量审计 → 诊断 → 修复 | --dimensions \<list\> · --fix-threshold \<sev\> |
| `planex` | 需求 → 规划 → 执行 → 验证循环 | --max-iterations N · --method agent\|cli\|auto · --executor \<tool\> · --skip-verify · --template \<name\> |
| `review` | 多维深度审查 → 零残留修复 | --dimensions \<list\> · --fix-threshold \<sev\> |
| `ui` | 视觉普查 → 6 维审计 → 发散 → 修复 | --dimensions \<list\> · --fix-threshold \<sev\> |

---

## Learning (1 command)

*引导式阅读、调查、模式提取与第二意见 — 统一 /learn 命令*

### `learn` — 学习工具箱

**Usage:** `/learn follow|investigate|decompose|consult [args...]`

用户主动调用的学习工具箱。手动 `/learn` 专用；代码探索/分析意图路由到 `/maestro-next` 的 analyze 步骤。

**子命令:**

| 子命令 | Usage | 说明 |
|--------|-------|------|
| `follow` | `/learn follow <path\|wiki-id\|topic> [--depth shallow\|deep] [--save-wiki] [-y]` | 逐段引导式阅读，强制提问提取模式与假设，构建理解图 |
| `investigate` | `/learn investigate <question> [--scope <path>] [--max-hypotheses N] [-y]` | 假设驱动科学调查，3 次假设失败后升级询问用户 |
| `decompose` | `/learn decompose <path\|module> [--patterns <list>] [--save-spec] [--save-wiki] [-y]` | 4 维度（结构/行为/数据/错误）并行代理分析，发现可复用设计模式 |
| `consult` | `/learn consult <target> [--mode review\|challenge\|consult] [-y]` | 结构化第二意见：review（3 代理并行评估）/ challenge（对抗性）/ consult（交互式问答） |

---

## Team Skills

*多智能体团队协作技能 — 用于编排并行工作流*

技能存放于 `.claude/skills/`，非命令。以下为 `team-*` 技能组：

| 技能 | 说明 |
|------|------|
| `team-adversarial-swarm` | ACO 蚁群智能 + 模块化 Workflow 组合 + 对抗决策门 |
| `team-arch-opt` | 架构优化团队技能 |
| `team-brainstorm` | 头脑风暴团队技能 |
| `team-coordinate` | 通用团队协调技能，动态角色生成 |
| `team-designer` | 生成 v4 架构团队技能包的元技能 |
| `team-executor` | 轻量级会话纯执行技能，恢复已有会话 |
| `team-frontend` | 前端开发团队技能 |
| `team-frontend-debug` | 前端调试团队（Chrome DevTools MCP） |
| `team-interactive-craft` | 零依赖交互组件制作团队技能 |
| `team-issue` | 问题解决团队技能 |
| `team-lifecycle-v4` | 全生命周期团队技能（规划/开发/测试/审查） |
| `team-motion-design` | 动效设计团队技能 |
| `team-perf-opt` | 性能优化团队技能 |
| `team-planex` | 规划-执行管线团队技能 |
| `team-quality-assurance` | 质量保证团队技能（闭环 QA） |
| `team-review` | 代码审查团队技能（scanner → reviewer → fixer） |
| `team-roadmap-dev` | 路线图驱动开发团队技能 |
| `team-swarm` | 蚁群智能多代理探索团队技能 |
| `team-tech-debt` | 技术债务识别与修复团队技能 |
| `team-testing` | 测试团队技能（Generator-Critic 循环） |
| `team-ui-polish` | UI 打磨团队技能 |
| `team-uidesign` | UI 设计团队技能 |
| `team-ultra-analyze` | 深度协作分析团队技能 |
| `team-ux-improve` | UX 改进团队技能 |
| `team-visual-a11y` | 视觉无障碍 QA 团队技能 |

---

## Wiki

*知识图谱管理、连接发现与摘要生成*

Wiki 操作通过 `/manage knowledge wiki` 子命令访问：

| 操作 | 说明 |
|------|------|
| `health` | 知识图谱健康仪表板（连通性、孤立条目检测） |
| `search` | 条目搜索 |
| `cleanup` | 孤立条目清理 |
| `stats` | 图谱统计 |
| `connect` | 连接外部知识源 |
| `digest` | 生成知识摘要 |

---

## Scholar Skills

*学术写作与研究技能 — 论文写作、引用验证、实验分析、答辩*

技能存放于 `.claude/skills/`，非命令。以下为 `scholar-*` 技能组：

| 技能 | 说明 |
|------|------|
| `scholar-anti-ai-writing` | 移除学术散文中的 AI 写作模式 |
| `scholar-citation-verify` | 四层引用验证（LaTeX/BibTeX 扫描 + WebSearch 验证） |
| `scholar-experiment` | ML/AI 实验结果分析与出版就绪 Results 章节 |
| `scholar-ideation` | 从文献搜索到研究规划的研究构思工作流 |
| `scholar-latex-organizer` | 会议 LaTeX 模板整理为 Overleaf 就绪结构 |
| `scholar-publish` | 录用后会议准备（演示、海报、宣传） |
| `scholar-rebuttal-pro` | 增强型审稿回复工作流（多视角讨论） |
| `scholar-review` | 系统性论文审查工作流（投稿前自审 + 答辩） |
| `scholar-thesis-docx` | 学位论文 Word 文档创建、修订与格式控制 |
| `scholar-writing` | 端到端学术论文写作工作流（顶会 LaTeX 手稿） |

---

## Meta Skills

*技能工具与提示工程 — 创建、简化、调优技能、生成提示、检查委派契约*

技能存放于 `.claude/skills/`，非命令。以下为元技能组：

| 技能 | 说明 |
|------|------|
| `codify-to-knowhow` | 清单驱动的知识资产生成器（结构化包 → knowhow + spec） |
| `delegation-check` | 检查工作流委派提示与 agent 角色定义的内容分离冲突 |
| `insight-challenge` | 代码质量发现的对抗性审查（反证验证） |
| `maestro-help` | Maestro Flow 命令帮助系统（搜索命令、浏览技能、新手引导） |
| `prompt-generator` | 生成或转换 Claude Code 提示文件（命令/技能/agent） |
| `skill-generator` | 创建新 Claude Code 技能的元技能（顺序/自主模式） |
| `skill-iter-tune` | 迭代技能调优（执行-评估-改进反馈循环） |
| `skill-simplify` | SKILL.md 简化与功能完整性验证 |
| `skill-tuning` | 通用技能诊断与优化（上下文爆炸、长尾遗忘等） |
| `workflow-skill-designer` | 设计编排器+阶段结构化工作流技能的元技能 |

---

> **v1 命令迁移说明**：v1 的 65 个独立命令（如 `/maestro-plan`、`/maestro-execute`、`/quality-review`、`/manage-status`、`/spec-add`、`/manage-knowhow-capture`、`/learn-decompose`、`/odyssey-debug` 等）已在 v0.5.51 中合并为上述 17 个统一命令。旧工作流引用请参考 v1 命令清单。主要替换关系：
>
> - `/maestro-plan`、`/maestro-execute`、`/maestro-quick` → `/maestro` 或 `/maestro-next` 或 `/maestro-ralph`
> - `/quality-review`、`/quality-test`、`/quality-debug` → `/maestro-ralph --engine swarm` 或 `/odyssey`
> - `/spec-add`、`/spec-load`、`/spec-remove`、`/spec-setup` → `/spec` 子命令
> - `/manage-status`、`/manage-knowhow`、`/manage-issue`、`/manage-harvest`、`/manage-wiki` 等 → `/manage` 子命令
> - `/learn-decompose`、`/learn-follow`、`/learn-investigate`、`/learn-second-opinion` → `/learn` 子命令
> - `/odyssey-debug`、`/odyssey-improve`、`/odyssey-planex` 等 → `/odyssey --mode <name>`
