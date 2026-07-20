# Maestro Commands Quick Reference

> Auto-generated cross-checked card layout — 65 active commands + 4 deprecated, 9 categories

---

## Maestro (25 commands)
*Intelligent coordinator and core workflow commands — init, plan, execute, verify, and lifecycle management*

### `maestro` — 指挥家

**Usage:** `/maestro "intent text" [-y] [-c] [--dry-run] [--exec auto|cli|internal] [--tool <name>] [--super]`

智能协调器 — 分析用户意图，读取项目状态，选择并执行最优命令链

**Flags:** -y (自动模式) · -c (恢复会话) · --dry-run (演练) · --exec auto|cli|internal (执行引擎) · --tool <name> (指定工具) · --super (超级模式)

---

### `maestro-init` — 初始化项目

**Usage:** `/maestro-init [--auto] [--from <source>]`

自动检测项目状态（空项目/代码库/已有项目），创建 .workflow/ 目录结构，包含 project.md、state.json、config.json 和 specs/

**Flags:** --auto (自动模式) · --from <source> (导入上游 context package)

---

### `maestro-plan` — 规划阶段

**Usage:** `/maestro-plan [phase] [--collab] [--spec SPEC-xxx] [--auto] [--gaps] [--dir <path>] [--revise [instructions]] [--check <plan-dir>]`

5 阶段规划流水线：探索 → 澄清需求 → 规划 → 检查 → 确认。生成包含波次和任务定义的 plan.json

**Flags:** [phase] (阶段编号或名称) · --collab (协作模式) · --spec SPEC-xxx (引用规格) · --auto (自动模式) · --gaps (填补缺口) · --dir <path> (草稿目录模式) · --revise [instructions] (修订计划) · --check <plan-dir> (检查计划)

---

### `maestro-execute` — 执行计划

**Usage:** `/maestro-execute [phase] [--auto-commit] [--method agent|codex|gemini|cli|auto] [--executor <tool>] [--dir <path>] [-y]`

按波次并行执行阶段任务，支持依赖感知调度和原子提交。消费 plan.json 生成的任务定义

**Flags:** [phase] (阶段) · --auto-commit (自动提交) · --method agent|codex|gemini|cli|auto (执行方式) · --executor <tool> (指定执行工具) · --dir <path> (草稿目录模式) · -y (自动模式)

---

### `maestro-brainstorm` — 头脑风暴

**Usage:** `/maestro-brainstorm [topic|role-name] [--yes] [--count N] [--session ID] [--update] [--skip-questions] [--include-questions] [--style-skill PKG]`

双模式头脑风暴：自动模式（框架生成 → 多角色并行分析 → 综合输出）或单角色分析。输出 .brainstorming/ 目录中的结构化产物

**Flags:** [topic|role-name] (主题或角色) · --yes (自动模式) · --count N (角色数量) · --session ID (指定会话) · --update (更新现有会话) · --skip-questions (跳过提问) · --include-questions (包含提问) · --style-skill PKG (引入风格记忆包)

---

### `maestro-analyze` — 分析讨论

**Usage:** `/maestro-analyze [phase|topic] [-y] [-c] [-q] [--gaps [ISS-ID]] [--from <source>]`

双层分析：Macro（文本参数）宏观需求探索产出 scope_verdict，Micro（数字参数）Phase 级 6 维度深度分析。生成 analysis.md 和 context.md，用于后续规划

**Flags:** [phase|topic] (阶段或主题) · -y (自动模式) · -c (恢复会话) · -q (快速模式，仅提取决策) · --gaps [ISS-ID] (缺口分析)

---

### `maestro-collab` — 多 CLI 协作

**Usage:** `/maestro-collab "<requirement>" [--tools gemini,qwen,claude] [--mode analysis|write] [--rule <template>] [-y]`

多 CLI 协作分析：将同一需求扇出到多个 CLI 工具并行分析，交叉验证输出中的共识与冲突，合成统一报告和标准下游产物（context.md + conclusions.json）

**Flags:** "<requirement>" (需求描述) · --tools <list> (指定 CLI 工具，逗号分隔) · --mode analysis|write (委派模式) · --rule <template> (共享规则模板) · -y (跳过确认)

---

### `maestro-roadmap` — 路线图

**Usage:** `/maestro-roadmap <requirement> [-y] [-c] [-m progressive|direct|auto] [--from <source>] [--revise [instructions]] [--review]`

交互式路线图创建：需求分解 → 里程碑规划 → 迭代精化 → 阶段确认

**Flags:** <requirement> (需求描述，必填) · -y (自动模式) · -c (恢复会话) · -m progressive|direct|auto (模式) · --from <source> (导入上游 context package) · --revise [instructions] (修订路线图) · --review (审查模式)

---

### `maestro-impeccable` — UI 生产管线

**Usage:** `/maestro-impeccable <intent|target> [--chain build|improve|enhance|harden|live] [--enhance <cmd>] [--threshold <score>] [--max-loops <n>] [-y]`

通过 ui-ux-pro-max 生成多种风格的 UI 设计原型，用户选择最佳方案，固化为代码参考文档

**Flags:** <phase|topic> (阶段或主题) · --styles N (生成风格数量) · --stack <stack> (技术栈) · --targets <pages> (目标页面) · --layouts N (布局数量) · --refine (精化模式) · --persist (持久化结果) · --full (完整模式) · -y (自动模式)

---

### `maestro-blueprint` — 规范蓝图

**Usage:** `/maestro-blueprint <idea or @file> [-y] [-c] [--from <source>]`

6 阶段规范文档链：产品简报 → PRD → 架构文档 → 史诗故事。与 brainstorm 并行的正式规范路径，产出 `.workflow/blueprint/` 包

**Flags:** <idea or @file> (必填) · -y (自动模式) · -c (恢复会话) · --from <source> (导入上游 context package)

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

### ~~`maestro-coordinate`~~ — 已废弃

> **已废弃**：功能已由 `maestro-ralph` 和 `maestro-next` 替代。使用 `/maestro-ralph` 或 `/maestro-next` 替代。

---

### `maestro-amend` — 修补命令

**Usage:** `/maestro-amend [description] [--from-verify <dir>] [--from-review <dir>] [--from-session <id>] [--from-issues ISS-xxx,...] [--scan] [--dry-run]`

从工作流产物、会话和用户报告中收集缺陷信号，生成叠加层修补工作流命令。支持从验证结果、审查报告、会话和问题中提取改进信号

**Flags:** [description] (缺陷描述) · --from-verify <dir> (从验证结果提取) · --from-review <dir> (从审查结果提取) · --from-session <id> (从会话提取) · --from-issues ISS-xxx,... (从问题提取) · --scan (扫描所有来源) · --dry-run (演练)

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

### `maestro-universal-workflow` — 动态对抗工作流

**Usage:** `/maestro-universal-workflow <intent> [--name <slug>] [--depth shallow|standard|deep] [--dry-run] [--from <script>] [--resume <runId>]`

动态工作流生成器：扫描库 → 匹配或设计 → 生成脚本 → 执行 → 持久化。每个决策点注入对抗性 agent 模式（skeptic/prosecutor/defender/judge），生成的脚本积累在 ~/.maestro/workflows/dynamic/ 构建可复用库

**Flags:** <intent> (任务描述) · --name <slug> (脚本名) · --depth shallow|standard|deep (对抗深度) · --dry-run (仅生成不执行) · --from <script> (基于已有脚本) · --resume <runId> (恢复运行)

---

### `maestro-swarm-workflow` — 并行工作流加速

**Usage:** `/maestro-swarm-workflow <intent> [--script <name>] [--dims <d1,d2>] [--roles <r1,r2>] [--count N] [--tier quick|standard] [--resume <runId>]`

并行加速层：将意图路由到预构建的 Workflow 脚本，利用 parallel()/pipeline() 实现多代理并发执行。8 个固定脚本覆盖 analyze/brainstorm/review/verify/grill/plan/execute/milestone-audit，每个脚本内嵌对抗决策模式

**Flags:** <intent> (任务描述) · --script <name> (指定脚本) · --dims <d1,d2> (分析维度) · --roles <r1,r2> (角色) · --count N (角色数量) · --tier quick|standard (审查层级) · --resume <runId> (恢复运行)

---

### `maestro-companion` — 轻量执行伴侣

**Usage:** `/maestro-companion <intent> [--note <text>] [--promote] [-y]`

轻量任务直接执行入口：创建最小 Run，直接完成明确任务，持续记录非正式 evidence log，最后完成 Run。

**Flags:** <intent> (任务描述) · --note <text> (追加记录) · --promote (提升洞察) · -y (跳过确认)

---

### `maestro-grill` — 苏格拉底式测试

**Usage:** `/maestro-grill <topic|plan> [-y] [-c] [--from <source>] [--depth shallow|standard|deep]`

苏格拉底式压力测试：对计划/想法/需求进行代码库现实检验。逐个分支走决策树，用具体场景挑战模糊术语，用代码证据验证假设。产出 verified context package 供下游 brainstorm/analyze/roadmap 消费。位于 brainstorm 之前

**Flags:** <topic|plan> (主题或计划) · -y (自动模式) · -c (恢复会话) · --from <source> (上游输入) · --depth shallow|standard|deep (分支深度)

---

### `maestro-next` — 单命令推荐

**Usage:** `/maestro-next <intent> [-y] [--dry-run] [--top N] [--list]`

单链推荐引擎：解析 intent + 项目状态 → 路由表评分 → 推荐单个原子命令 → 确认后通过 Skill() 执行。不创建 session，不构建 chain，不写 status.json。适用于意图清晰且单步即可完成的场景

**Flags:** <intent> (意图文本) · -y (跳过确认) · --dry-run (仅显示推荐) · --top N (显示前 N 个候选) · --list (列出候选池)

---

### `maestro-ralph` — 闭环引擎

**Usage:** `/maestro-ralph <intent> [-y] | status | continue`

闭环决策引擎：读取项目状态 → 推断位置 → 构建自适应链 → 委托执行。与 maestro-ralph-execute 互调形成自延续工作循环。支持 ralph（自适应链）和 maestro（静态链）两类 session。决策节点自动评估质量门

**Flags:** <intent> (意图文本) · -y (自动模式) · status (显示进度) · continue (恢复执行)

---

### `maestro-ralph-execute` — 单步执行

**Usage:** `/maestro-ralph-execute [-y] [session-id]`

Ralph session 单步执行器：每次调用定位 session → 找下一步 → 解析参数 → 执行 → 更新 → 自调用下一步。与 /maestro-ralph 互调形成自延续工作循环。支持 ralph（自适应链）和 maestro（静态链）两类 session

**Flags:** -y (自动模式) · [session-id] (指定会话)

---

### `maestro-guard` — 编辑边界

**Usage:** `/maestro-guard <on|off|status|allow <path>|deny <path>>`

目录级写入边界管理：由 workflow-guard PreToolUse hook 强制执行。启用时 Write/Edit 工具对允许路径外的文件调用被阻断。配置存储在 .workflow/config.json guard 段

**Flags:** on (启用) · off (禁用) · status (显示状态) · allow <path> (允许路径) · deny <path> (拒绝路径)

---

### `maestro-ui-codify` — 设计系统提取

**Usage:** `/maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]`

从现有源代码提取设计系统：4 阶段管线 — 验证 → 提取（3 并行 agent：Style/Animation/Layout）→ 打包（生成 preview.html + preview.css）→ 持久化为知识资产

**Flags:** <source-path> (源代码目录，必填) · --package-name <name> (包名) · --output-dir <path> (输出目录) · --overwrite (覆盖已有)

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

### `maestro-learn` — 学习路由

**Usage:** `/maestro-learn "intent text" [-y] [--dry-run] [--chain <name>]`

学习协调器：根据意图文本路由到最优学习命令，支持单命令或链式多步学习

**Flags:** "intent text" (意图文本) · -y (自动模式) · --dry-run (演练) · --chain <name> (指定链)

---

### ~~`maestro-link-coordinate`~~ — 已废弃

> **已废弃**：功能已由 `maestro-ralph` 替代。使用 `/maestro-ralph` 替代。

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

Codify reusable business processes as tool specs (e.g. payment reconciliation, OAuth integration, E2E verification). Register during planning, after execution, before testing, or during retrospective. Auto-discovered by agents via maestro-spec load and spec-injector.

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

## Quality (11 commands)
*Testing, debugging, code review, refactoring, security, and quality assurance*

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

OWASP Top 10 和 STRIDE 安全审计，含供应链分析。三级深度控制：quick（OWASP+依赖）、standard（+密钥+CI/CD）、deep（+STRIDE+Git History）

**Flags:** [quick|standard|deep] (审计深度) · --scope <path> (限定扫描目录)

---

## Management (11 commands)
*Project status, memory management, codebase documentation, knowledge audit, and issue tracking*

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

### `manage-codebase-refresh` — 刷新代码库文档

**Usage:** `/manage-codebase-refresh [--since <date>] [--deep]`

增量刷新代码库文档：检测变更文件 → 识别受影响文档 → 仅重新生成必要部分。比全量重建快得多

**Flags:** --since <date> (指定起始日期) · --deep (深度刷新)

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

### `manage-learn` — 学习管理

**Usage:** `/manage-learn [<text>|tip <text>|list|search|show <id>] [--category ...] [--tag t1,t2] [--phase N] [--confidence ...]`

统一原子知识捕获：洞察（模式、陷阱、技术）和提示（跨会话恢复笔记），存储到 .workflow/specs/learnings.md

**Flags:** [<text>] (洞察文本) · [tip <text>] (提示模式) · [list] (列表) · [search] (搜索) · [show <id>] (查看) · --category ... (分类) · --tag t1,t2 (标签) · --phase N (阶段) · --confidence ... (置信度)

---

### `manage-wiki` — 知识图谱管理

**Usage:** `/manage-wiki [health|search|cleanup|stats] [options]`

知识图谱管理工具：健康仪表板（连通性、孤立条目检测）、条目搜索、孤立清理和图谱统计

**Flags:** [health] (健康仪表板) · [search] (条目搜索) · [cleanup] (孤立清理) · [stats] (图谱统计) · [options] (子命令选项)

---

### `manage-knowledge-audit` — 知识审计

**Usage:** `/manage-knowledge-audit --scope <spec|knowhow|artifact|all> [--level P0|P1|P2] [--timeline T1..T6] [--since YYYY-MM-DD] [--milestone <name>] [--include-archive] [--interactive] [--mark|--delete|--purge] [--dry-run] [--report]`

知识审计与修剪：对称于 manage-harvest（写入入口）的知识淘汰入口。覆盖 8 大场景类、28 子场景（矛盾、失效、老化、孤儿等），通过 keep/deprecate/delete 三态决策清理 spec/knowhow/artifact 三大存储

**Flags:** --scope <spec|knowhow|artifact|all> (范围，必填) · --level P0|P1|P2 (优先级) · --timeline T1..T6 (时间线) · --since YYYY-MM-DD (起始日期) · --milestone <name> (里程碑) · --include-archive (包含归档) · --interactive (交互模式) · --mark|--delete|--purge (操作) · --dry-run (演练) · --report (生成报告)

---

## Learning (5 commands)
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

### `learn-retro` — 学习复盘

**Usage:** `/learn-retro [--lens git|decision|all] [--days N] [--author <name>] [--area <path>] [--phase N] [--tag <tag>] [--id <id>] [--compare]`

统一复盘：结合 git 活动分析（提交指标、会话检测、文件热点）和决策质量评估（跨 wiki/spec/git 追踪），支持独立或组合使用

**Flags:** --lens git|decision|all (视角选择) · --days N (天数) · --author <name> (作者) · --area <path> (区域) · --phase N (阶段) · --tag <tag> (标签) · --id <id> (会话ID) · --compare (对比)

---

### `learn-second-opinion` — 第二意见

**Usage:** `/learn-second-opinion <target> [--mode review|challenge|consult]`

结构化第二意见：review（3 个并行代理独立评估）、challenge（对抗性代理寻找隐藏假设）、consult（交互式问答）

**Flags:** <target> (目标：文件路径/wiki ID/HEAD/staged) · --mode review|challenge|consult (模式)

---

## Wiki (2 commands)
*Knowledge graph management, connection discovery, and digest generation*

### `wiki-connect` — 知识关联

**Usage:** `/wiki-connect [--scope <type>] [--min-similarity N] [--fix] [--max N]`

知识图谱关联发现：分析 wiki 索引找到孤立条目、缺失连接和传递链接缺口，建议或自动应用新关联

**Flags:** --scope <type> (限制类型) · --min-similarity N (最小相似度) · --fix (自动应用建议) · --max N (最大建议数)

---

### `wiki-digest` — 知识摘要

**Usage:** `/wiki-digest [<topic>|--recent N] [--type <type>] [--format brief|full]`

知识综合命令：语义主题聚类 → 知识缺口识别 → 覆盖度热力图，产出可操作的摘要和推荐下一步

**Flags:** [<topic>] (主题) · --recent N (最近 N 天) · --type <type> (类型过滤) · --format brief|full (输出格式)

---

