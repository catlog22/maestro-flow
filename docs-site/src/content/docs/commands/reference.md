---
title: "Maestro Commands Quick Reference"
---

> Auto-generated cross-checked card layout — 66 commands + 16 CLI subcommands, 7 categories

---

## Maestro (31 commands)
*Intelligent coordinator and core workflow commands — init, plan, execute, verify, and lifecycle management*

### `maestro` — 指挥家

**Usage:** `/maestro "intent text" [-y] [-c] [--dry-run] [--exec auto|cli|internal] [--tool <name>] [--super]`

智能协调器 — 分析用户意图，读取项目状态，选择并执行最优命令链

**Flags:** -y (自动模式) · -c (恢复会话) · --dry-run (演练) · --exec auto|cli|internal (执行引擎) · --tool <name> (指定工具) · --super (超级模式)

---

### `maestro-init` — 初始化项目

**Usage:** `/maestro-init [--auto] [--from-brainstorm SESSION-ID]`

自动检测项目状态（空项目/代码库/已有项目），创建 .workflow/ 目录结构，包含 project.md、state.json、config.json 和 specs/

**Flags:** --auto (自动模式) · --from-brainstorm SESSION-ID (从头脑风暴导入)

---

### `maestro-plan` — 规划阶段

**Usage:** `/maestro-plan [milestone] [--collab] [--spec SPEC-xxx] [--auto] [--gaps] [--dir <path>] [--revise [instructions]] [--check <plan-dir>]`

5 阶段规划流水线：探索 → 澄清需求 → 规划 → 检查 → 确认。生成包含波次和任务定义的 plan.json

**Flags:** [milestone] (里程碑编号或名称) · --collab (协作模式) · --spec SPEC-xxx (引用规格) · --auto (自动模式) · --gaps (填补缺口) · --dir <path> (草稿目录模式) · --revise [instructions] (修订计划) · --check <plan-dir> (检查计划)

---

### `maestro-execute` — 执行计划

**Usage:** `/maestro-execute [phase] [--auto-commit] [--method agent|codex|gemini|cli|auto] [--executor <tool>] [--dir <path>] [-y]`

按波次并行执行阶段任务，支持依赖感知调度和原子提交。消费 plan.json 生成的任务定义

**Flags:** [phase] (阶段) · --auto-commit (自动提交) · --method agent|codex|gemini|cli|auto (执行方式) · --executor <tool> (指定执行工具) · --dir <path> (草稿目录模式) · -y (自动模式)

---


### `maestro-quick` — 快速任务

**Usage:** `/maestro-quick [description] [--full] [--discuss]`

快速执行单个任务，跳过规划阶段，同时保持原子提交和验证等工作流质量保证

**Flags:** [description] (任务描述) · --full (包含所有代理) · --discuss (执行前讨论)

---

### `maestro-brainstorm` — 头脑风暴

**Usage:** `/maestro-brainstorm [topic|role-name] [--yes] [--count N] [--session ID] [--update] [--skip-questions] [--include-questions] [--style-skill PKG]`

双模式头脑风暴：自动模式（框架生成 → 多角色并行分析 → 综合输出）或单角色分析。输出 .brainstorming/ 目录中的结构化产物

**Flags:** [topic|role-name] (主题或角色) · --yes (自动模式) · --count N (角色数量) · --session ID (指定会话) · --update (更新现有会话) · --skip-questions (跳过提问) · --include-questions (包含提问) · --style-skill PKG (引入风格记忆包)

---

### `maestro-analyze` — 分析讨论

**Usage:** `/maestro-analyze [milestone|topic] [-y] [-c] [-q] [--gaps [ISS-ID]]`

多维分析：CLI 探索 + 6 维度评分 + 决策记录协议 + 意图覆盖检查。生成 analysis.md 和 context.md，用于后续规划

**Flags:** [milestone|topic] (里程碑或主题) · -y (自动模式) · -c (恢复会话) · -q (快速模式，仅提取决策) · --gaps [ISS-ID] (缺口分析)

---

### `maestro-collab` — 多 CLI 协作

**Usage:** `/maestro-collab "<requirement>" [--tools gemini,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]`

多 CLI 协作分析：将同一需求扇出到多个 CLI 工具并行分析，交叉验证输出中的共识与冲突，合成统一报告和标准下游产物（context.md + conclusions.json）

**Flags:** "<requirement>" (需求描述) · --tools <list> (指定 CLI 工具，逗号分隔) · --mode analysis|write (委派模式) · --rule <template> (共享规则模板) · -y (跳过确认)

---

### `maestro-roadmap` — 路线图

**Usage:** `/maestro-roadmap <requirement> [-y] [-c] [-m progressive|direct|auto] [--from-brainstorm SESSION-ID] [--revise [instructions]] [--review]`

交互式路线图创建：消费 analyze 宏观产出 → 里程碑规划 → 迭代精化 → 阶段确认。纯编排层，需要上游 context

**Flags:** <requirement> (需求描述，必填) · -y (自动模式) · -c (恢复会话) · -m progressive|direct|auto (模式) · --from-brainstorm SESSION-ID (从头脑风暴导入) · --revise [instructions] (修订路线图) · --review (审查模式)

---

### `maestro-impeccable` — UI 生产管线

**Usage:** `/maestro-impeccable <command|intent> [target] [--chain build|redesign|improve|enhance|launch|harden|foundation|live] [--enhance <cmd>] [--threshold <N>] [--max-loops <n>] [--skip-design] [--styles <N>] [-y]`

UI 设计命令：直接单命令、链式多步骤（带质量门禁）、或搜索设计知识。支持 20+ 子命令（craft/shape/critique/audit/polish/animate/colorize 等）

**Flags:** <command|intent> (命令或意图) · --chain <name> (链式模式: build|redesign|improve|enhance|launch|harden|foundation|live) · --enhance <cmd> (增强命令) · --threshold <N> (质量门禁分数，默认 26/40) · --max-loops <n> (最大迭代次数，默认 3) · --skip-design (跳过设计阶段) · --styles <N> (生成风格数量) · -y (自动模式)

---

### `maestro-blueprint` — 规格文档

**Usage:** `/maestro-blueprint <idea or @file> [-y] [-c] [--count N] [--from brainstorm:ID]`

7 阶段正式规格文档链：产品简报 → PRD → 架构文档 → 史诗故事 → 用户故事 → 验收标准。独立于 roadmap 的收敛文档化命令，产出到 `.workflow/blueprint/`

**Flags:** <idea or @file> (必填) · -y (自动模式) · -c (恢复会话) · --count N (并行角色数) · --from brainstorm:ID (从头脑风暴导入)

---

### `maestro-milestone-audit` — 里程碑审计

**Usage:** `/maestro-milestone-audit [milestone, e.g., 'v1.0']`

审核当前里程碑的跨阶段集成差距，检查功能完整性和接口一致性

**Flags:** [milestone] (可选，如 'v1.0')

---

### `maestro-milestone-complete` — 完成里程碑

**Usage:** `/maestro-milestone-complete [milestone, e.g., 'v1.0']`

归档已完成的里程碑，提取经验教训，准备下一个里程碑的工作目录

**Flags:** [milestone] (可选，如 'v1.0')

---


### `maestro-amend` — 修补命令

**Usage:** `/maestro-amend [description] [--from-verify <dir>] [--from-review <dir>] [--from-session <id>] [--from-issues ISS-xxx,...] [--scan] [--dry-run]`

从工作流产物、会话和用户报告中收集缺陷信号，生成叠加层修补工作流命令。支持从验证结果、审查报告、会话和问题中提取改进信号

**Flags:** [description] (缺陷描述) · --from-verify <dir> (从验证结果提取) · --from-review <dir> (从审查结果提取) · --from-session <id> (从会话提取) · --from-issues ISS-xxx,... (从问题提取) · --scan (扫描所有来源) · --dry-run (演练)

---

### `maestro-companion` — 知识伴侣

**Usage:** `/maestro-companion [before|note|after|route] [--task <description>] [--type <task_type>] [--category <cat>]`

任务伴侣工具：加载知识上下文（before）、记录结构化条目（note）、提升洞察到 spec/knowhow（after）、或路由到下一命令（route）

**Flags:** [before|note|after|route] (模式) · --task <description> (当前任务描述) · --type <task_type> (任务类型: implement|debug|analyze|design) · --category <cat> (规格类别: coding|arch|test|review|debug|learning|ui)

---

### `maestro-grill` — 压力测试

**Usage:** `/maestro-grill <topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]`

苏格拉底式压力测试：将计划/想法与代码库现实进行交叉验证。产出 grill-report.md + terminology.md + context-package.json，供下游 brainstorm/analyze/roadmap 使用

**Flags:** <topic|plan> (主题或计划) · -y (自动模式) · -c (恢复会话) · --from <source> (上游输入源) · --depth shallow|standard|deep (分析深度)

---

### `maestro-guard` — 编辑边界管理

**Usage:** `/maestro-guard <on|off|status|allow <path>|deny <path>>`

配置目录级写入边界，由 workflow-guard PreToolUse hook 强制执行。控制哪些目录允许或禁止编辑

**Flags:** <on|off|status|allow|deny> (子命令) · <path> (目标路径，allow/deny 时必填)

---

### `maestro-next` — 单命令推荐

**Usage:** `/maestro-next <intent> [-y] [--dry-run] [--top N] [--list]`

单命令推荐引擎：解析 intent + project state → 路由表评分 → 推荐单个原子命令 → 确认后执行。不创建 session、不构建 chain

**Flags:** <intent> (意图文本) · -y (跳过确认直接执行) · --dry-run (仅显示推荐) · --top N (显示前 N 个候选，默认 3) · --list (列出可推荐命令池)

---

### `maestro-ralph` — 自适应生命周期引擎

**Usage:** `/maestro-ralph <intent> [-y] | status | continue`

闭环决策引擎：读取项目状态 → 推断位置 → 构建自适应链 → 委派执行。Ralph 构建/评估；ralph-execute 执行步骤

**Flags:** <intent> (意图文本) · -y (自动确认) · status (查看会话状态) · continue (恢复会话)

---

### `maestro-ralph-execute` — Ralph 步骤执行器

**Usage:** `/maestro-ralph-execute [-y] [session-id]`

Ralph 和 maestro 会话的单步执行器。每次调用：定位会话 → 找到下一步 → 解析参数 → 执行 → 更新 → 自我调用下一步

**Flags:** -y (自动模式) · [session-id] (会话 ID，可选)

---

### `maestro-swarm-workflow` — 并行工作流加速器

**Usage:** `/maestro-swarm-workflow <intent> [--script <name>] [--dims <d1,d2>] [--roles <r1,r2>] [--count N] [--tier quick|standard] [--resume <runId>]`

并行加速器：将意图路由到预构建的 Workflow 脚本（wf-*.js），支持多智能体并发执行和对抗性决策模式。补充 ralph 的顺序链

**Flags:** <intent> (意图文本) · --script <name> (指定脚本: wf-analyze|wf-brainstorm|wf-review|wf-verify) · --dims <d1,d2> (限定分析维度) · --roles <r1,r2> (限定角色) · --count N (角色数量) · --tier quick|standard (审查层级) · --resume <runId> (恢复之前的运行)

---

### `maestro-ui-codify` — 设计系统提取

**Usage:** `/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]`

从源代码提取设计系统为 tokens、参考包和知识资产。4 阶段流水线：validate → extract → package → knowhow

**Flags:** <source-path> (源代码路径，必填) · --package-name <name> (包名称) · --output-dir <path> (输出目录) · --overwrite (覆盖已有输出)

---

### `maestro-universal-workflow` — 动态工作流生成器

**Usage:** `/maestro-universal-workflow <intent> [--name <slug>] [--depth shallow|standard|deep] [--dry-run] [--from <script>] [--resume <runId>]`

动态工作流生成器：扫描库匹配或按需生成任务特定的 Workflow 脚本（含对抗性模式）。脚本持久化到 `~/.maestro/workflows/dynamic/uwf-*.js`

**Flags:** <intent> (意图文本) · --name <slug> (指定脚本名) · --depth shallow|standard|deep (深度，默认 standard) · --dry-run (仅生成脚本不执行) · --from <script> (基于已有脚本修改) · --resume <runId> (恢复之前的运行)

---

### `maestro-composer` — 工作流作曲

**Usage:** `/maestro-composer "workflow description" [--resume] [--edit <template-path>]`

语义工作流作曲器：将自然语言描述解析为 DAG（有向无环图），自动注入检查点，持久化为可复用 JSON 模板。支持 skill/CLI/agent 三类节点

**Flags:** "workflow description" (工作流描述) · --resume (恢复设计会话) · --edit <template-path> (编辑现有模板)

---

### `maestro-player` — 工作流播放器

**Usage:** `/maestro-player <template-slug|path> [--context key=value...] [-c [session-id]] [--list] [--dry-run]`

工作流模板播放器：加载 JSON 模板 → 绑定变量 → 按 DAG 顺序执行节点 → 检查点持久化状态 → 支持恢复。maestro-composer 的执行搭档

**Flags:** <template-slug|path> (模板名称或路径) · --context key=value... (上下文变量) · -c [session-id] (恢复会话) · --list (列出所有模板) · --dry-run (演练)

---

### `maestro-update` — 工作流更新

**Usage:** `/maestro-update [--dry-run] [--force]`

交互式工作流迁移：检测当前版本 → 预览变更差异 → 应用升级。确保 .claude/commands/ 和工作流配置保持最新

**Flags:** --dry-run (仅预览变更) · --force (强制覆盖)

---

### `maestro-fork` — 创建工作树

**Usage:** `/maestro-fork -m <milestone-number> [--base <branch>] [--sync]`

为整个里程碑创建 git worktree，实现里程碑间并行开发。显式复制项目上下文和阶段目录到工作树

**Flags:** -m <milestone-number> (里程碑编号，必填) · --base <branch> (基准分支) · --sync (同步工作树)

---



### `maestro-merge` — 合并工作树

**Usage:** `/maestro-merge -m <milestone-number> [--force] [--dry-run] [--no-cleanup] [--continue]`

两阶段合并：先 git merge（源代码），成功后再同步工作流产物（工件）。防止合并冲突时的部分状态损坏

**Flags:** -m <milestone-number> (里程碑编号) · --force (强制合并) · --dry-run (演练) · --no-cleanup (不清理) · --continue (继续中断的合并)

---

### `maestro-milestone-release` — 里程碑发布

**Usage:** `/maestro-milestone-release [<version>] [--bump patch|minor|major] [--dry-run] [--no-tag] [--no-push]`

版本号递增、变更日志生成和 git 标签创建。支持 semver 自动递增和自定义版本号

**Flags:** [<version>] (显式版本号) · --bump patch|minor|major (semver 递增) · --dry-run (演练) · --no-tag (不创建标签) · --no-push (不推送)

---

### `maestro-overlay` — 命令叠加层

**Usage:** `/maestro-overlay <intent>`

创建或编辑非侵入式命令叠加层：JSON 补丁文件增强 .claude/commands/*.md，存储于 ~/.maestro/overlays/，自动应用

**Flags:** <intent> (自然语言意图描述)

---

## Specification (6 commands)
*Project specifications, conventions, and codebase knowledge management*

### `spec-setup` — 规格设置

**Usage:** `/spec-setup`

扫描项目结构，自动生成代码约定、架构决策记录（ADR）和技术选型规范文件，初始化 specs/ 目录

---

### `spec-add` — Add Spec Entry

**Usage:** `/spec-add [--scope project|global|team|personal] <category> <content>`

Add knowledge entries to the spec system with role tagging. Supports tools category for reusable process definitions, and ref mode for long procedures.

**Flags:** --scope (scope) · <category> (target file) · --ref (knowhow reference) · --knowhow-type (knowhow document type: asset|blueprint|document|template|recipe|reference|decision)

---

### `spec-load` — Load Specs by Role

**Usage:** `/spec-load [--category <category>] [--keyword <word>]`

Load specs by role: primary role doc in full + cross-file entries with matching roles attribute. Role-based loading replaces category-based loading.

**Flags:** --category <category> (implement|plan|test|review|analyze) · --keyword <word> (keyword filter) · --with-lessons (include learning records)

---

### `maestro-tools-register` — Register Tool Spec

**Usage:** `/maestro-tools-register <description>`

Codify reusable business processes as tool specs (e.g. payment reconciliation, OAuth integration, E2E verification). Register during planning, after execution, before testing, or during retrospective. Auto-discovered by agents via spec load and spec-injector.

**Modes:** extract (from code/docs) · generate (from description) · optimize (improve existing)

---

### `maestro-tools-execute` — Execute Tool Spec

**Usage:** `/maestro-tools-execute [tool-name | --category <category>]`

Load registered tool specs and execute step-by-step. Supports direct invocation by name or role-based recommendation with interactive selection.

**Flags:** <tool-name> (direct) · --category <category> (list available tools for role)

---

### `spec-remove` — 删除规范

**Usage:** `/spec-remove <entry-id>`

通过条目 ID 从规范文件中删除指定条目。用于清理过时或错误的规范记录

**Flags:** <entry-id> (必填，条目 ID)

---

## Quality (8 commands)
*Testing, debugging, code review, refactoring, and quality assurance*

### `quality-review` — 代码审查

**Usage:** `/quality-review <phase> [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]`

分层代码审查：quick（5 分钟）/ standard（全面）/ deep（深度，含安全审计）。并行代理审查，自动创建 BLOCK/WARN/INFO 分级问题

**Flags:** <phase> (必填) · --level quick|standard|deep (审查级别) · --dimensions security,architecture,... (审查维度) · --skip-specs (跳过规格检查)

---

### `quality-test` — UAT 测试

**Usage:** `/quality-test [phase] [--smoke] [--auto-fix]`

对话式用户验收测试：会话持久化 → 自动诊断失败 → 差距修复计划 → 闭环执行。支持烟雾测试和自动修复模式

**Flags:** [phase] (阶段) · --smoke (仅冒烟测试) · --auto-fix (自动修复失败)

---

### `quality-auto-test` — 统一自动测试

**Usage:** `/quality-auto-test <phase> [-y] [-c N] [--max-iter <N>] [--layer <L0-L3>] [--strategy <name>] [--dry-run] [--re-run]`

统一自动测试 via CSV 层级管线：智能路由（spec/gap/code）→ 发现基础设施 → 构建 scenarios.csv → 按层并行写测试（spawn_agents_on_csv）→ 执行 → 并行诊断失败 → 迭代收敛

**Flags:** <phase> (必填) · --max-iter <N> (最大迭代次数，1=单次生成) · --layer <L0-L3> (限制层级) · --strategy conservative|aggressive|surgical|reflective (覆盖策略) · --dry-run (仅生成计划) · --re-run (仅重跑失败场景) · -c N (并发数)

---

### `quality-debug` — 调试

**Usage:** `/quality-debug [issue description] [--from-uat <phase>] [--parallel]`

并行假设驱动调试 via CSV wave：Wave 1 并行假设验证，Wave 2 并行修复确认假设，可从 UAT 失败直接触发

**Flags:** [issue description] (问题描述) · --from-uat <phase> (从 UAT 触发) · --parallel (并行调试模式)

---

### `quality-refactor` — 重构

**Usage:** `/quality-refactor [scope: module path, feature area, or 'all']`

技术债务减少：识别债务 → 评估影响 → 制定重构计划 → 反思驱动迭代执行，保证现有测试全部通过

**Flags:** [scope] (范围：模块路径、功能区域或 'all')

---

### `quality-sync` — 文档同步

**Usage:** `/quality-sync [--full] [--since <commit|HEAD~N>] [--dry-run]`

代码变更后同步文档：检测 git diff → 追踪组件/功能/需求影响链 → 更新 .workflow/codebase/ 受影响文档

**Flags:** --full (全量同步) · --since <commit|HEAD~N> (指定起点) · --dry-run (演练，不写入)

---

### ~~`quality-business-test`~~ — 已合并

> **已废弃**：功能已合并入 `quality-auto-test`（spec 路由模式）。使用 `/quality-auto-test <phase>` 替代，当检测到 REQ-*.md 时自动进入 spec 路由。

---

### ~~`quality-integration-test`~~ — 已合并

> **已废弃**：功能已合并入 `quality-auto-test`（统一自动测试）。使用 `/quality-auto-test <phase>` 替代。

---

### `quality-retrospective` — 质量复盘

**Usage:** `/quality-retrospective [phase|N..M] [--lens technical|process|quality|decision] [--all] [--no-route] [--compare N] [--auto-yes]`

执行后多视角复盘：技术/流程/质量/决策 4 个并行视角，提取可复用洞察，路由到 spec/memory/issue 存储

**Flags:** [phase|N..M] (阶段或范围) · --lens technical|process|quality|decision (视角) · --all (所有阶段) · --no-route (不路由到存储) · --compare N (与阶段 N 对比) · --auto-yes (自动模式)

---

### `security-audit` — 安全审计

**Usage:** `/security-audit [quick|standard|deep] [--scope <path>]`

系统性安全审计：覆盖 OWASP Top 10、依赖供应链、密钥检测、CI/CD 流水线审查，以及可选的 STRIDE 威胁建模。三级深度控制速度与覆盖范围

**Flags:** [quick|standard|deep] (审计深度，默认 quick) · --scope <path> (限定扫描目录，默认项目根)

---

## Management (10 commands)
*Project status, memory management, codebase documentation, and issue tracking*

### `manage-status` — 项目状态

**Usage:** `/manage-status`

显示项目仪表板：当前阶段进度、活跃任务状态、里程碑完成度和推荐的下一步操作

---

### `manage-knowhow` — 记忆管理

**Usage:** `/manage-knowhow [list|search|view|edit|delete|prune] [query|id|file] [--store workflow|system|all] [--type compact|tip]`

管理两类记忆存储：工作流记忆（.workflow/knowhow/，项目级）和系统记忆（~/.claude/projects/*/memory/，跨项目）

**Flags:** [list|search|view|edit|delete|prune] (操作) · [query|id|file] (查询或标识) · --store workflow|system|all (存储类型) · --type compact|tip (记忆类型)

---

### `manage-knowhow-capture` — 捕获记忆

**Usage:** `/manage-knowhow-capture [type] [description] [--lang <lang>] [--source <url>] [--tag tag1,tag2]`

将当前会话的经验捕获为记忆：compact（会话压缩摘要）或 tip（单个专业提示）。带 JSON 索引便于后续检索

**Flags:** [type] (知识类型: session|tip|template|recipe|reference|decision) · [description] (描述) · --lang <lang> (编程语言) · --source <url> (来源URL) · --tag tag1,tag2 (标签) · --title <title> (显式标题)

---

### `manage-codebase-rebuild` — 重建代码库文档

**Usage:** `/manage-codebase-rebuild [--focus <area>] [--force] [--skip-commit]`

全量重建 .workflow/codebase/ 文档系统：扫描整个项目 → 识别组件/功能/需求/ADR → 并行生成所有文档产物（覆盖已有文档）

**Flags:** --focus <area> (聚焦区域) · --force (强制重建，跳过确认) · --skip-commit (不提交变更)

---


### `manage-issue` — 问题管理

**Usage:** `/manage-issue <create|list|status|update|close|link> [options]`

交互式问题管理：创建（记录 bug/功能需求）、查询（按状态/标签过滤）、更新、关闭、链接到任务

**Flags:** <create|list|status|update|close|link> (操作，必填) · [options] (操作相关选项)

---

### `manage-issue-discover` — 问题发现

**Usage:** `/manage-issue-discover [multi-perspective | by-prompt "what to look for"] [-y|--yes] [--scope=src/**] [--depth=standard|deep]`

自动发现潜在问题：多视角分析（安全/性能/可用性/可维护性）或提示驱动探索。批量创建待跟踪问题

**Flags:** [multi-perspective] (多视角分析模式) · [by-prompt "what to look for"] (提示驱动模式) · -y|--yes (自动模式) · --scope=src/** (限定范围) · --depth=standard|deep (分析深度)

---

### `manage-harvest` — 知识收获

**Usage:** `/manage-harvest [<session-id|path>] [--to wiki|spec|issue|auto] [--source <type>] [--recent N] [--dry-run] [-y]`

从工作流产物（分析结果、头脑风暴输出、调试会话、规划/修复结果）提取知识片段，路由到 wiki/spec/issue 三类存储

**Flags:** [<session-id|path>] (会话或路径) · --to wiki|spec|issue|auto (路由目标) · --source <type> (产物类型) · --recent N (最近 N 个) · --dry-run (演练) · -y (自动模式)

---


### `manage-wiki` — 知识图谱管理

**Usage:** `/manage-wiki [health|search|cleanup|stats] [options]`

知识图谱管理工具：健康仪表板（连通性、孤立条目检测）、条目搜索、孤立清理和图谱统计

**Flags:** [health] (健康仪表板) · [search] (条目搜索) · [cleanup] (孤立清理) · [stats] (图谱统计) · [options] (子命令选项)

---

### `manage-kg-extractors` — 知识图谱提取器

**Usage:** `/manage-kg-extractors [--scan-only] [--append] [--language <lang>]`

分析代码库模式，自动生成 `.workflow/kg/extractors.yaml` — 声明式配置，教 MaestroGraph 的代码图提取器识别项目特定符号

**Flags:** --scan-only (仅报告检测到的模式，不写入) · --append (追加到已有 extractors.yaml) · --language <lang> (限定语言: python|typescript|java 等)

---

### `manage-knowledge-audit` — 知识审计

**Usage:** `/manage-knowledge-audit --scope <spec|knowhow|artifact|all> [--level P0|P1|P2] [--since YYYY-MM-DD] [--milestone <name>] [--interactive] [--mark|--delete|--purge] [--dry-run] [--report]`

审查 spec/knowhow/artifact 存储，识别矛盾/失效/孤儿条目，通过 keep/deprecate/delete 三态清理。对称于 `manage-harvest`（写入入口）

**Flags:** --scope <spec|knowhow|artifact|all> (审查范围，必填) · --level P0|P1|P2 (优先级过滤) · --since YYYY-MM-DD (起始日期) · --milestone <name> (里程碑过滤) · --interactive (交互模式) · --mark (标记废弃) · --delete (删除条目) · --purge (彻底清除) · --dry-run (演练) · --report (生成报告)

---

## Learning (4 commands)
*Pattern extraction, guided reading, investigation, retrospectives, and multi-perspective analysis*

### `learn-decompose` — 代码分解

**Usage:** `/learn-decompose <path|module> [--patterns <list>] [--save-spec] [--save-wiki]`

系统性模式提取：4 维度（结构/行为/数据/错误）分析代码，并行代理探索，发现可复用设计模式并编目

**Flags:** <path|module> (目标路径或模块) · --patterns <list> (指定模式类型) · --save-spec (保存到规格) · --save-wiki (保存到知识图谱)

---

### `learn-follow` — 跟读理解

**Usage:** `/learn-follow <path|wiki-id|topic> [--depth shallow|deep] [--save-wiki]`

引导式阅读体验：逐段遍历代码或知识图谱条目，通过强制提问提取模式、识别假设、构建结构化理解图

**Flags:** <path|wiki-id|topic> (目标) · --depth shallow|deep (深度) · --save-wiki (保存到知识图谱)

---

### `learn-investigate` — 系统调查

**Usage:** `/learn-investigate <question> [--scope <path>] [--max-hypotheses N]`

系统性调查工作流：假设生成 → 测试验证 → 结构化证据记录，3 次假设失败后升级询问用户

**Flags:** <question> (调查问题) · --scope <path> (限制范围) · --max-hypotheses N (最大假设数，默认 3)

---


### `learn-second-opinion` — 第二意见

**Usage:** `/learn-second-opinion <target> [--mode review|challenge|consult]`

结构化第二意见：review（3 个并行代理独立评估）、challenge（对抗性代理寻找隐藏假设）、consult（交互式问答）

**Flags:** <target> (目标：文件路径/wiki ID/HEAD/staged) · --mode review|challenge|consult (模式)

---

## Odyssey (5 commands)
*Long-running deep-cycle commands — exhaustive iteration with archaeology, diagnosis, fix, generalization, and knowledge persistence*

### `odyssey-debug` — 深度调试

**Usage:** `/odyssey-debug "<issue>" [--skip-fix] [--skip-generalize] [--auto] [--template <name>] [-y] [-c]`

长周期闭环调试：考古（git 变更溯源）→ 探索（调用链、错误间隙）→ 诊断（假设驱动）→ 修复确认 → 泛化（举一反三）→ 发现同类 → 沉淀学习。三句哲学约束：零遗留 / 穷尽迭代 / 改进即标准

**Flags:** "<issue>" (问题描述) · --skip-fix (仅分析) · --skip-generalize (跳过泛化) · --auto (自动模式) · --template performance|memory-leak|race-condition|regression|crash (调查策略模板) · -y (跳过确认) · -c (恢复会话)

---

### `odyssey-improve` — 深度改进

**Usage:** `/odyssey-improve "<target>" [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]`

代码质量深度提升：基线测量 → 6 维审计（性能/安全/架构/可靠性/可观测性/可维护性）→ 根因诊断 → 逐轮修复 → 验证 → 泛化 → 沉淀。按 severity 从高到低穷尽修复，直到 0 remaining actionable findings

**Flags:** "<target>" (目标路径/模块) · --dimensions <list> (审计维度) · --skip-fix (仅审计) · --skip-generalize (跳过泛化) · --auto (自动模式) · -y (跳过确认) · -c (恢复会话)

---

### `odyssey-planex` — 需求交付闭环

**Usage:** `/odyssey-planex "<requirement>" [--max-iterations N] [--skip-generalize] [--auto] [--method agent|cli|auto] [--executor <tool>] [--skip-verify] [--template <name>] [-y] [-c]`

需求到交付闭环：解析需求 → 定义严格验收标准 → 分解任务 → 执行 → 验证 → 修复差距 → 迭代直到 ALL 标准通过。验收标准神圣不可侵犯，不允许"接近通过"

**Flags:** "<requirement>" (需求描述) · --max-iterations N (最大迭代) · --skip-generalize (跳过泛化) · --auto (自动模式) · --method agent|cli|auto (执行方式) · --executor <tool> (执行工具) · --skip-verify (跳过验证) · --template feature|bugfix|refactor|migration|api-endpoint (需求模板) · -y (跳过确认) · -c (恢复会话)

---

### `odyssey-review-test-fix` — 深度审查修复

**Usage:** `/odyssey-review-test-fix "<target>" [--dimensions <list>] [--fix-threshold critical|high|medium|low|all] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]`

多维度深度代码审查 + 穷尽修复：考古 → 探索 → 多维审查 → 全 severity 逐轮修复 + re-review gate → 泛化到全项目。每次修复后重审同区域，发现新问题继续修

**Flags:** "<target>" (目标路径/模块) · --dimensions <list> (审查维度) · --fix-threshold critical|high|medium|low|all (修复阈值) · --skip-fix (仅审查) · --skip-generalize (跳过泛化) · --auto (自动模式) · -y (跳过确认) · -c (恢复会话)

---

### `odyssey-ui` — UI 深度优化

**Usage:** `/odyssey-ui "<target>" [--dimensions <list>] [--skip-fix] [--skip-generalize] [--auto] [-y] [-c]`

UI 深度打磨循环：视觉普查 → 6 维审计 → 发散探索（创意改进）→ 修复 → 浏览器验证 → 泛化到兄弟组件 → 沉淀设计知识。按 impact×severity 递降穷尽修复每个像素

**Flags:** "<target>" (目标组件/页面) · --dimensions <list> (审计维度) · --skip-fix (仅审计) · --skip-generalize (跳过泛化) · --auto (自动模式) · -y (跳过确认) · -c (恢复会话)

---

## CLI Commands (16 subcommands)
*Terminal commands via `maestro <command>` — workspace sharing, domain knowledge, and component toggling*

### `maestro workspace` — 跨工作区知识共享

**Usage:** `maestro workspace <link|unlink|list|status> [options]`

管理跨工作区知识共享链接，支持 spec/knowhow/domain/codebase 四类共享

**子命令:**

- `maestro workspace link <path> [--name <n>] [--share spec,knowhow,domain]` — 链接外部工作区
- `maestro workspace unlink <name>` — 取消链接
- `maestro workspace list [--json]` — 列出所有链接
- `maestro workspace status [--json]` — 查看共享状态

---

### `maestro domain` — 领域知识管理

**Usage:** `maestro domain <subcommand> [options]`

项目领域术语表管理（glossary.json）。支持术语的发现、注册、搜索、导入和生命周期管理

**子命令 (11 个):**

- `maestro domain init [--project <name>]` — 初始化领域术语表
- `maestro domain add <canonical> <definition> [--aliases <csv>] [--keywords <csv>] [--tier core|extended|peripheral]` — 添加术语
- `maestro domain list [--json] [--status active|deprecated]` — 列出所有术语
- `maestro domain show <id> [--json] [--full]` — 查看术语详情
- `maestro domain update <id> [--definition <text>] [--add-alias <csv>] [--remove-alias <csv>] [--tier <tier>]` — 更新术语
- `maestro domain remove <id>` — 删除术语
- `maestro domain search <query> [--json]` — 搜索术语（名称+别名+定义+关键词）
- `maestro domain discover [--scope <dir>] [--recent <days>] [--min-freq <n>] [--limit <n>]` — 扫描代码库发现候选术语
- `maestro domain import --from context-package|@<file> [--session <path>]` — 从外部源导入术语
- `maestro domain deprecate <id> [--reason <text>] [--successor <id>]` — 废弃术语（软删除）
- `maestro domain validate` — 验证 glossary.json schema 和关系完整性

---

### `maestro install toggle` — 组件开关管理

**Usage:** `maestro install toggle [--global] [--path <dir>] [--type <type>] [--enable <names>] [--disable <names>] [--list]`

启用/禁用单个命令、skill 和 agent。支持交互式 TUI 和非交互式批量操作

**Flags:** --global (全局安装，默认) · --path <dir> (项目级安装) · --type <type> (按类型过滤: command|skill|agent) · --enable <names> (启用指定项，逗号分隔) · --disable <names> (禁用指定项，逗号分隔) · --list (列出所有项状态)

---

