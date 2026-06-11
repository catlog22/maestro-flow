import { useI18n } from '@/client/i18n/index.js';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// ChangelogPage — version history with recent releases
// ---------------------------------------------------------------------------

interface ChangelogEntry {
  version: string;
  date: string;
  changes: Array<{
    type: 'feat' | 'fix' | 'refactor' | 'chore' | 'docs';
    text_en: string;
    text_zh: string;
  }>;
}

const changelog: ChangelogEntry[] = [
  {
    version: '0.5.2',
    date: '2026-06',
    changes: [
      { type: 'fix', text_en: 'skill-scanner: add ~/.agents/skills/ global scanning for agent platform (parity with claude/codex/agy)', text_zh: 'skill-scanner: agent 平台添加 ~/.agents/skills/ 全局扫描（与 claude/codex/agy 一致）' },
      { type: 'fix', text_en: 'codex skills: unify invocation syntax — Skill({}) and /name replaced with $name across 45 files', text_zh: 'codex skills: 统一调用语法——Skill({}) 和 /name 全部替换为 $name，涉及 45 个文件' },
      { type: 'fix', text_en: 'codex maestro SKILL.md: AskUserQuestion → request_user_input, command_path aligned to .codex/skills/', text_zh: 'codex maestro SKILL.md: AskUserQuestion 改为 request_user_input，command_path 对齐 .codex/skills/ 路径' },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-06',
    changes: [
      { type: 'fix', text_en: 'knowhow/spec description attribute full sync across all commands, skills, and workflows', text_zh: 'knowhow/spec description 属性全量同步至所有命令、技能和工作流' },
      { type: 'feat', text_en: 'install TUI: add CodeGraph toggle for one-click tree-sitter KG installation', text_zh: 'install TUI 新增 CodeGraph 开关，一键安装 tree-sitter 代码分析' },
      { type: 'fix', text_en: 'install: fix statusline not recorded in manifest and defaulting to off', text_zh: '修复 statusline 未记录到 manifest 导致默认关闭的问题' },
      { type: 'feat', text_en: 'forceInstall: add --statusline and --codegraph CLI options', text_zh: 'forceInstall 新增 --statusline 和 --codegraph CLI 选项' },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'knowledge system reform: unified search, KG Hook auto-injection, CodeGraph function-level call graph', text_zh: '知识系统改革——统一搜索入口、KG Hook 自动注入、CodeGraph 函数级调用图' },
      { type: 'refactor', text_en: 'install pipeline overhaul: .agy/ removed from git, realtime conversion from .claude/ on install', text_zh: 'install 管线改造——.agy/ 从 git 移除，install 时从 .claude/ 实时转换' },
      { type: 'feat', text_en: 'ralph skills --platform enforcement: add agent/agy platforms, warn on missing', text_zh: 'ralph skills --platform 强制化——新增 agent/agy 平台，缺失时警告' },
      { type: 'refactor', text_en: 'maestro-verify merged into maestro-execute as built-in verification gate', text_zh: 'maestro-verify 合并到 maestro-execute 作为内置验证 gate' },
      { type: 'feat', text_en: 'spec/knowhow entries gain title/description attributes, unified search sync', text_zh: 'spec/knowhow 条目增加 title/description 属性，搜索命令统一同步' },
      { type: 'feat', text_en: 'global command writing style optimization: descriptive to prescriptive', text_zh: '全局命令撰写风格优化——从描述性到规范性' },
    ],
  },
  {
    version: '0.4.26',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'delegate: add proxy config in cli-tools.json — per-tool proxy toggle, subprocess-only env injection', text_zh: 'delegate: cli-tools.json 新增代理配置，支持 per-tool 开关，仅注入子进程环境变量' },
      { type: 'fix', text_en: 'codex adapter: classify Rust tracing stderr (RMCP/MCP errors) as non-fatal thinking instead of error', text_zh: 'codex adapter: 将 Rust tracing stderr（RMCP/MCP 错误）归类为非致命诊断信息而非错误' },
    ],
  },
  {
    version: '0.4.25',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'spec: add scope filtering for project-level or global spec loading', text_zh: '规范加载新增范围过滤，支持按项目或全局维度' },
      { type: 'feat', text_en: 'graph: integrate codegraph enhancements into native graph module', text_zh: '集成 codegraph 增强功能至原生 graph 模块' },
      { type: 'feat', text_en: 'docs-site: add new commands with Chinese descriptions, enhance QuickStartPage', text_zh: '新增多个命令及中文描述，增强快速启动页面' },
      { type: 'fix', text_en: 'fix AskUserQuestion parenthetical annotation causing interactions to be skipped', text_zh: '修复 AskUserQuestion 括注式写法导致交互被跳过的问题' },
      { type: 'docs', text_en: 'sync command docs, mark deprecated commands, remove duplicates', text_zh: '同步命令文档，标记废弃命令，移除重复条目' },
    ],
  },
  {
    version: '0.4.24',
    date: '2026-06',
    changes: [
      { type: 'refactor', text_en: 'codebase-rebuild: remove UA external graph tool legacy, migrate to native kg index', text_zh: '移除 UA 外部图工具遗留，迁移至原生 kg index' },
      { type: 'fix', text_en: 'execute: clarify summary/commit/status ownership in E2 Agent path', text_zh: '明确 E2 Agent 路径中 summary/commit/status 的职责归属' },
    ],
  },
  {
    version: '0.4.23',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'docs-site: add sidebar navigation for workflow enhancement, security audit, and swarm intelligence guides', text_zh: 'docs-site: 侧边栏导航新增工作流增强、安全审计、蚁群智能指南' },
      { type: 'refactor', text_en: 'commands: extract interview-mechanics.md to streamline runtime references', text_zh: 'commands: 抽取 interview-mechanics.md 精简运行时引用' },
      { type: 'docs', text_en: 'commands: add Pipeline command authoring standard and unify 12 commands to spec', text_zh: 'commands: 新增 Pipeline 命令撰写标准并统一 12 个命令至规范' },
      { type: 'docs', text_en: 'guide: add workflow enhancement, security audit, and swarm intelligence guide docs', text_zh: 'guide: 添加工作流增强、安全审计、蚁群智能指南文档' },
      { type: 'chore', text_en: 'swarm: add scoring and pheromone modules for team adversarial swarm', text_zh: 'swarm: 新增 team adversarial swarm 评分和信息素模块' },
    ],
  },
  {
    version: '0.4.22',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'swarm: fix GBK encoding errors in Python scripts on Chinese Windows', text_zh: 'swarm: 修复 Python 脚本在中文 Windows 下的 GBK 编码错误' },
    ],
  },
  {
    version: '0.4.21',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'graph: remove UA external dependency, create native src/graph/ module (types, merger, loader, query, FsAnalyzer)', text_zh: 'graph: 移除 UA 外部依赖，创建原生 src/graph/ 模块（类型、合并、加载、查询、FsAnalyzer）' },
      { type: 'feat', text_en: 'kg: new maestro kg index command — local codebase scanning with git-aware enumeration', text_zh: 'kg: 新增 maestro kg index 命令 — 本地代码库扫描 + git 感知枚举' },
      { type: 'feat', text_en: 'graph: enhanced indexing — call graph extraction, tested_by edges, topological sort tour, file category classification', text_zh: 'graph: 图索引增强 — 调用图提取(calls)、测试配对(tested_by)、拓扑排序 tour、文件分类' },
      { type: 'feat', text_en: 'swarm: new team-adversarial-swarm — ACO + modular Workflow + adversarial decision gates', text_zh: 'swarm: 新增 team-adversarial-swarm — ACO 蚁群 + 模块化 Workflow + 对抗决策门' },
      { type: 'feat', text_en: 'commands: new maestro-universal-workflow for dynamic adversarial workflow generation', text_zh: 'commands: 新增 maestro-universal-workflow 动态对抗工作流生成' },
      { type: 'fix', text_en: 'universal-workflow: hardened script generation to prevent Unicode parse errors', text_zh: 'universal-workflow: 强化脚本生成防错机制，消除 Unicode 解析错误' },
    ],
  },
  {
    version: '0.4.20',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'kg: deep integration of Understand-Anything knowledge graph with Wiki search and codebase-rebuild pipeline', text_zh: 'kg: Understand-Anything 知识图谱与 Wiki 搜索、codebase-rebuild 管道深度集成' },
      { type: 'feat', text_en: 'commands: new maestro-swarm-workflow parallel acceleration layer — 8 fixed Workflow scripts covering core commands', text_zh: 'commands: 新增 maestro-swarm-workflow 并行加速层 — 8 个固定 Workflow 脚本覆盖核心命令' },
      { type: 'feat', text_en: 'skills: new maestro-companion for task context management and knowledge routing', text_zh: 'skills: 新增 maestro-companion 任务上下文管理与知识路由技能' },
      { type: 'fix', text_en: 'plan: enforce P3 agent invocation and align read_first/action fields', text_zh: 'plan: 强制 P3 agent 调用并对齐 read_first/action 字段' },
      { type: 'docs', text_en: 'github skills: added Phase 3 (Phase Files Design) and Phase 4 (Validation & Integration) documentation', text_zh: 'github skills: 新增 Phase 3（阶段文件设计）和 Phase 4（验证与集成）文档' },
    ],
  },
  {
    version: '0.4.19',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'skills: new team-swarm — ACO-driven swarm intelligence with pheromone optimizer (4 roles + Python controller + 5 specs)', text_zh: 'skills: 新增 team-swarm 蚁群智能技能 — ACO 驱动 + 信息素优化器（4 角色 + Python 控制器 + 5 份 spec）' },
      { type: 'feat', text_en: 'install: TUI supports Agy (Antigravity) hooks configuration alongside Claude/Codex', text_zh: 'install: 安装器 TUI 支持 Agy (Antigravity) hooks 配置，与 Claude/Codex hooks 独立' },
      { type: 'refactor', text_en: 'install: load manifest defaults by scope+target via findManifest, avoiding cross-scope contamination', text_zh: 'install: 改用 findManifest 按 scope+target 加载 manifest 默认值，避免跨 scope 污染' },
      { type: 'refactor', text_en: 'install: hookLevel default reads hooks.claude.level only — drops unreliable legacy top-level field', text_zh: 'install: hookLevel 默认源仅读 hooks.claude.level，去除不可靠的 legacy 顶层字段' },
      { type: 'chore', text_en: 'maestro-next: rewrite command body to align with new skill topology', text_zh: 'maestro-next: 重写命令体以贴合新技能拓扑' },
    ],
  },
  {
    version: '0.4.18',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'wiki: unified knowledge retrieval — codebase/session virtual nodes + finish-work workflow', text_zh: 'wiki: 统一知识检索 — codebase/session 虚拟节点 + finish-work 工作流' },
      { type: 'feat', text_en: 'commands: new maestro-next single-chain recommendation command', text_zh: 'commands: 新增 maestro-next 单链推荐命令' },
      { type: 'fix', text_en: 'ralph: CLI recognizes both maestro-* and ralph-* sessions', text_zh: 'ralph: CLI 识别 maestro-* 与 ralph-* 两类 session' },
      { type: 'refactor', text_en: 'codex/skills: unified spawn_agents_on_csv contract — mandatory worker termination + strict output_schema', text_zh: 'codex/skills: 统一 spawn_agents_on_csv 契约 — 强制 worker 终止 + 严格 output_schema' },
      { type: 'docs', text_en: 'changelog and announcement banner updated for v0.4.17', text_zh: '更新 v0.4.17 changelog 与公告栏' },
    ],
  },
  {
    version: '0.4.17',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'ralph: dual-platform (claude/codex) skill discovery with --platform filter; merged loop-runner maestro-ralph-beta endpoint', text_zh: 'ralph: 双平台 (claude/codex) skill 识别 + --platform 过滤；合并版 maestro-ralph-beta 端点' },
      { type: 'feat', text_en: 'ralph: codex maestro-ralph / maestro-ralph-execute synced to latest claude version, using $skill direct-invoke style', text_zh: 'ralph: codex maestro-ralph / maestro-ralph-execute 同步最新 claude 版本，采用 $skill 直调形式' },
      { type: 'feat', text_en: 'ralph: ralph next now injects skill config defaults', text_zh: 'ralph: ralph next 注入 skill config defaults' },
      { type: 'fix', text_en: 'install: fixed codex MCP duplicate key — improved duplicate block detection', text_zh: 'install: 修复 codex MCP 重复 key — 改进重复块识别' },
      { type: 'refactor', text_en: 'config: aligned .workflow/config.json schema', text_zh: 'config: 对齐 .workflow/config.json schema' },
    ],
  },
  {
    version: '0.4.16',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'ralph: new maestro ralph CLI sub-commands (session/skills/next/check/complete) with scripted step loading', text_zh: 'ralph: 新增 maestro ralph CLI 子命令族（session/skills/next/check/complete）+ step 加载脚本化' },
      { type: 'feat', text_en: 'knowledge-audit: new manage-knowledge-audit command as symmetric eviction entry for spec / wiki / knowhow tri-store', text_zh: 'knowledge-audit: 新增 manage-knowledge-audit 命令 — spec / wiki / knowhow 三存储淘汰对称入口' },
      { type: 'fix', text_en: 'ralph: path expansion fix and emit format redesign', text_zh: 'ralph: 路径展开 + emit 格式重设计' },
      { type: 'fix', text_en: 'statusline: simplified line 2 chain rendering with 48h expiry and legacy schema compat', text_zh: 'statusline: 简化 line 2 链式渲染 + 48h 过期 + 兼容旧 schema' },
      { type: 'fix', text_en: 'install: manifest now records hook level; TUI defaults restored from last install', text_zh: 'install: manifest 记录 hook level + TUI 默认值从上次安装恢复' },
      { type: 'docs', text_en: 'maestro / ralph-execute description trimmed: A_EXEC_STEP reduced to pure directives, aligned with new emit format', text_zh: 'maestro / ralph-execute 描述精简：A_EXEC_STEP 改为纯指令、对齐新 emit 格式' },
    ],
  },
  {
    version: '0.4.15',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'install: fix statusline being installed when unchecked; manifest v2 now tracks hooks/statusline/MCP entries for precise uninstall', text_zh: 'install: 修复 statusline 未勾选仍被安装；manifest v2 统一跟踪 hooks/statusline/MCP 全量条目实现精确卸载' },
      { type: 'fix', text_en: 'uninstall: hooks removal upgraded from marker-scan to name-based precise deletion (claude/codex/agy); third-party MCP targets (Cursor/Qoder/etc.) now support precise uninstall', text_zh: '卸载: hooks 卸载由全扫 marker 升级为按名精确删除（claude/codex/agy）；第三方 MCP 目标（Cursor/Qoder 等）支持精确卸载' },
      { type: 'refactor', text_en: 'maestro: -y flag only propagated when user explicitly specifies; Goal Prompt no longer blocks, user can input /goal anytime during execution', text_zh: 'maestro: -y 仅在用户显式指定时透传；Goal Prompt 输出后不再 STOP，可在执行中随时输入 /goal' },
      { type: 'refactor', text_en: 'maestro: streamlined command parameters and node type descriptions, unified execution step handling', text_zh: 'maestro: 精简命令参数和节点类型描述，统一执行步骤处理' },
    ],
  },
  {
    version: '0.4.14',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'ralph: internal step loading now honors required_reading / deferred_reading contract', text_zh: 'ralph: 内部 step 加载时遵循 required_reading / deferred_reading 契约' },
      { type: 'refactor', text_en: 'maestro-ralph: clarified goal prompt handling in session creation and decision evaluation', text_zh: 'maestro-ralph: 更新文档以明确会话创建和决策评估中的目标提示处理' },
      { type: 'refactor', text_en: 'ralph: streamlined Goal Prompt and recalibrated execution entry to ralph-execute', text_zh: 'ralph: 精简 Goal Prompt + 校准推进入口为 ralph-execute' },
      { type: 'refactor', text_en: 'Unified scratch session directory naming to {YYYYMMDD}-{type}-{slug}/', text_zh: '统一 scratch session 目录命名为 {YYYYMMDD}-{type}-{slug}/' },
    ],
  },
  {
    version: '0.4.13',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Added knowledge management system docs, defining the relationship between constraints and accumulation', text_zh: '添加知识沉淀管理系统文档，定义约束与积累的关系' },
      { type: 'feat', text_en: 'Unified Mac-terminal code blocks on guide pages with bilingual support', text_zh: 'guide 页面统一 Mac-terminal 代码框，完善中英文双语支持' },
      { type: 'fix', text_en: 'Fixed logic issues and contract conflicts in commands/skills/workflows', text_zh: '修复 commands/skills/workflows 逻辑问题与契约矛盾' },
      { type: 'fix', text_en: 'Fixed parallel agent persistence issue and contract conflicts in brainstorm', text_zh: '修复 brainstorm 并行 agent 不落盘问题与契约冲突' },
      { type: 'fix', text_en: 'Notification bar links now use React Router Link, fixed basename prefix', text_zh: '通知栏链接改用 React Router Link，修复 basename 前缀缺失' },
      { type: 'refactor', text_en: 'Updated interview protocol with enhanced user control and decision write-back', text_zh: '更新访谈协议，增强用户控制与决策写回机制' },
    ],
  },
  {
    version: '0.4.12',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Workflow topology refactor — blueprint as standalone command, Milestone hierarchy, dual-layer analyze, global .spec→blueprint migration', text_zh: '工作流拓扑重构 — blueprint 独立命令、Milestone 层级重排、双层 analyze、全局 .spec→blueprint 迁移' },
      { type: 'feat', text_en: 'New maestro-amend skill for generating workflow command overlays', text_zh: '新增 maestro-amend skill：生成工作流命令 overlay' },
      { type: 'feat', text_en: 'Unified context-package system with harvest --prune for state.json management', text_zh: '统一 context-package 体系，新增 harvest --prune 支持 state.json 管理' },
      { type: 'feat', text_en: 'analyze/brainstorm/roadmap commands now include interview_protocol block', text_zh: 'analyze/brainstorm/roadmap 三命令新增 interview_protocol 块' },
      { type: 'fix', text_en: 'Unified spec seed templates as single source of truth with YAML frontmatter', text_zh: '统一 seed 模板单一来源，保证 spec 文件带 YAML frontmatter' },
      { type: 'refactor', text_en: 'Code structure improvements for readability and maintainability', text_zh: '代码结构重构提升可读性和可维护性' },
    ],
  },
  {
    version: '0.4.11',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'install supports optional MCP registration for 7 extra targets (Cursor/Qoder/Trae/Kiro/Roo/VS Code Copilot/Gemini CLI) with multi-select TUI', text_zh: 'install 新增 7 个可选 MCP 目标的注册支持（Cursor/Qoder/Trae/Kiro/Roo/VS Code Copilot/Gemini CLI），含多选 TUI' },
      { type: 'feat', text_en: 'Added neutral .agents/ mirror built from .claude/ via prepublishOnly script; 8 new opt-in components for non-Claude IDEs', text_zh: '新增中性 .agents/ 镜像，通过 prepublishOnly 脚本从 .claude/ 构建，含 8 个非 Claude IDE 用 opt-in 组件' },
      { type: 'feat', text_en: 'Added QuickStart page with sidebar link and bilingual i18n; major docs-site layout/style refactor (Layout/Sidebar/TopBar/MainContent)', text_zh: '新增快速入门页面、侧边栏链接和中英双语 i18n；docs-site 布局/样式大规模重构（Layout/Sidebar/TopBar/MainContent）' },
      { type: 'refactor', text_en: 'maestro-ralph state machine restructured; goal-checklist and status.json unified to single source of truth', text_zh: 'maestro-ralph 状态机重排，goal-checklist 与 status.json 对齐为单一信息源' },
      { type: 'docs', text_en: 'Added Maestro Team Lite collaboration design doc and user guide (EN/ZH)', text_zh: '新增 Maestro Team Lite 协作设计文档和用户指南（中英双语）' },
    ],
  },
  {
    version: '0.4.10',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'Added .agy/agents and .agy/skills to npm package files; previously missing, agy CLI assets failed to install', text_zh: '将 .agy/agents 和 .agy/skills 加入 npm 包 files，修复 agy CLI 资源安装缺失问题' },
    ],
  },
  {
    version: '0.4.9',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Added Antigravity (agy) CLI as delegate target with 57 skills + 22 sub-agent definitions in .agy/', text_zh: '新增 Antigravity (agy) CLI 作为 delegate target，含 .agy/ 下 57 个 skills + 22 个 sub-agent 定义' },
      { type: 'feat', text_en: 'AgyAdapter integration: adapter-factory, shared agent-types, cli-agent-runner support', text_zh: 'AgyAdapter 集成：adapter-factory、shared agent-types、cli-agent-runner 支持' },
      { type: 'feat', text_en: 'Update-notice framework pre-wired: cli-tools.json auto-merges missing tool entries on upgrade', text_zh: 'update-notice 框架预埋：升级时 cli-tools.json 自动合并缺失工具条目，保留自定义字段' },
      { type: 'feat', text_en: 'Added Antigravity Tools Guide and convert-claude-to-agy.mjs conversion script', text_zh: '新增 Antigravity Tools Guide 和 convert-claude-to-agy.mjs 转换脚本' },
      { type: 'fix', text_en: 'Codex adapter correctly classifies mcp_tool_call vs command_execution events', text_zh: 'codex adapter 正确分类 mcp_tool_call / command_execution 事件' },
      { type: 'refactor', text_en: 'Refactored skill invocation and updated documentation', text_zh: '重构 skill invocation 调用方式并更新相关文档' },
    ],
  },
  {
    version: '0.4.8',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'delegate CLI: cross-platform process-tree termination (killProcessTree) eliminates orphaned grandchildren on Windows', text_zh: 'delegate CLI 跨平台进程树终止 (killProcessTree)，消除 Windows 孤儿孙进程残留' },
      { type: 'fix', text_en: 'Unified stale-handler across 6 adapters; StreamMonitor default silence window 60s → 600s with --timeout / streamTimeoutMs config so long tasks are no longer killed', text_zh: '6 个 adapter 统一 stale-handler；StreamMonitor 默认静默窗口 60s→600s 并新增 --timeout 配置，长任务不再被误杀' },
      { type: 'refactor', text_en: 'maestro / maestro-ralph share decomposition contract prompt (in-context execution + dynamic step growth)', text_zh: 'maestro / maestro-ralph 共享 decomposition contract prompt（in-context 执行 + 动态步骤增长）' },
    ],
  },
  {
    version: '0.4.7',
    date: '2026-05',
    changes: [
      { type: 'refactor', text_en: 'Unified all 6 team skills to CSV wave execution model (spawn_agents_on_csv)', text_zh: '6 个 team skills 统一迁移到 CSV wave 执行模型 (spawn_agents_on_csv)' },
      { type: 'fix', text_en: 'Fixed CSV wave column name conflicts and artifact consumption issues', text_zh: '修复 CSV wave 模式的列名冲突和产出消费问题' },
    ],
  },
  {
    version: '0.4.6',
    date: '2026-05',
    changes: [
      { type: 'chore', text_en: 'Enhanced maestro-ralph session creation with goal tracking and state management', text_zh: '增强 maestro-ralph 会话创建的 goal 追踪和状态管理功能' },
      { type: 'docs', text_en: 'Updated changelog for v0.4.5', text_zh: '更新 v0.4.5 更新日志' },
    ],
  },
  {
    version: '0.4.5',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added knowledge context loading instructions for pre-test design preparation', text_zh: '添加知识上下文加载说明，增强测试设计前的准备工作' },
      { type: 'feat', text_en: 'Enhanced knowledge capture with language-aware tag generation rules', text_zh: '增强知识捕获功能，添加语言感知标签生成规则' },
      { type: 'feat', text_en: 'Enhanced keyword extraction with bilingual content support', text_zh: '增强关键词提取功能，支持中英文内容生成相应关键词' },
      { type: 'fix', text_en: 'Updated parameter prompt format across multiple commands for better readability', text_zh: '更新多个命令的参数提示格式以提高可读性' },
    ],
  },
  {
    version: '0.4.4',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added Spec Analytics module for logging and statistics', text_zh: '新增 Spec Analytics 分析模块，支持日志记录和统计' },
      { type: 'feat', text_en: 'Upgraded always-inject to structured config with docs/keywords/categories dimensions', text_zh: 'always 注入升级为结构化配置，支持 docs/keywords/categories 三维度' },
      { type: 'feat', text_en: 'Added maestro spec injection CLI command group', text_zh: '新增 maestro spec injection CLI 命令组' },
      { type: 'feat', text_en: 'Enhanced spec injection with keyword granularity and extra docs linking', text_zh: '增强 spec 注入系统，支持 keyword 颗粒度配置和额外文档关联' },
      { type: 'fix', text_en: 'Fixed docs-site i18n, mermaid theme, build optimization and touch a11y', text_zh: 'docs-site i18n 完整化、mermaid 主题适配、构建优化和触控无障碍改进' },
      { type: 'refactor', text_en: 'Improved UI component styling and functionality', text_zh: 'UI 组件样式和功能优化' },
    ],
  },
  {
    version: '0.4.3',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced skill docs with next-step routing and success criteria details', text_zh: '增强各技能文档，添加下一步路由和成功标准细节' },
      { type: 'feat', text_en: 'Added DecisionLogPlugin for logging decision outcomes', text_zh: '添加 DecisionLogPlugin 用于记录决策结果' },
      { type: 'fix', text_en: 'Fixed Codex hooks hookEventName enum validation failure', text_zh: '修复 Codex hooks hookEventName 枚举验证失败' },
    ],
  },
  {
    version: '0.4.2',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added Codex Hooks and MCP server support, enhanced installation flow', text_zh: '添加 Codex Hooks 和 MCP 服务器支持，增强安装流程' },
      { type: 'fix', text_en: 'Dark mode adaptation and Chat page UX optimization', text_zh: '暗色模式适配与 Chat 页面 UX 优化' },
      { type: 'feat', text_en: 'Updated maestro-impeccable docs, enhanced command chain and intent matching', text_zh: '更新 maestro-impeccable 文档，增强命令链和意图匹配说明' },
    ],
  },
  {
    version: '0.4.1',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced intent matching and task routing in maestro coordinator', text_zh: '增强 maestro 和 maestro-impeccable 的意图匹配和任务路由' },
      { type: 'fix', text_en: 'Fixed script path priority for project-local and installed paths', text_zh: '修正脚本路径优先级，确保正确解析项目本地和安装路径' },
      { type: 'refactor', text_en: 'Refactored maestro-impeccable command usage and documentation', text_zh: '重构 maestro-impeccable 命令用法和文档' },
    ],
  },
  {
    version: '0.4.0',
    date: '2025-05',
    changes: [
      { type: 'refactor', text_en: 'Merged maestro-ui-craft into maestro-impeccable as unified command', text_zh: '合并 maestro-ui-craft 到 maestro-impeccable 为统一命令' },
      { type: 'feat', text_en: 'Updated UI production pipeline, replaced ui-craft with maestro-impeccable', text_zh: '更新 UI 生产管线文档，替换 ui-craft 为 maestro-impeccable' },
      { type: 'feat', text_en: 'Enhanced design flow and knowledge accumulation in impeccable', text_zh: '增强 impeccable 设计流程和知识积累说明' },
    ],
  },
  {
    version: '0.3.49',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added preloading spec descriptions for multi-role analysis', text_zh: '添加预加载规范说明，增强多角色分析和上下文支持' },
      { type: 'feat', text_en: 'Added BM25 search engine for UI/UX style guides with CLI', text_zh: '添加 BM25 搜索引擎用于 UI/UX 风格指南搜索' },
      { type: 'refactor', text_en: 'Refactored delegate usage documentation for clarity', text_zh: '重构委派用法文档，提升清晰度和一致性' },
    ],
  },
  {
    version: '0.3.48',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced maestro-ralph docs with artifact reasoning and lifecycle stages', text_zh: '更新 maestro-ralph 文档，增强工件推理和生命周期阶段描述' },
    ],
  },
  {
    version: '0.3.47',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added UI spec loading for design consistency and context support', text_zh: '添加 UI 规范加载功能，增强设计一致性和上下文支持' },
      { type: 'feat', text_en: 'Converted Impeccable tools to TypeScript, adapted to maestro CLI architecture', text_zh: '将 Impeccable 工具转换为 TypeScript，适配 maestro CLI 架构' },
      { type: 'feat', text_en: 'Added Impeccable live session management tools', text_zh: '添加 Impeccable 实时会话管理工具' },
      { type: 'feat', text_en: 'Added comprehensive workflows for impeccable design processes', text_zh: '添加 impeccable 设计流程的完整工作流' },
    ],
  },
];

const typeConfig: Record<string, { label: string; color: string; bg: string }> = {
  feat: { label: 'Feature', color: 'text-accent-green', bg: 'bg-status-bg-completed' },
  fix: { label: 'Fix', color: 'text-accent-red', bg: 'bg-status-bg-blocked' },
  refactor: { label: 'Refactor', color: 'text-accent-blue', bg: 'bg-status-bg-in-progress' },
  chore: { label: 'Chore', color: 'text-text-tertiary', bg: 'bg-bg-hover' },
  docs: { label: 'Docs', color: 'text-accent-purple', bg: 'bg-status-bg-planning' },
};

export default function ChangelogPage() {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh-CN';

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3] mb-[var(--spacing-2)]">
          {t('changelog.title')}
        </h1>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {t('changelog.description')}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-accent-blue no-underline hover:underline mt-[var(--spacing-3)]"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t('changelog.back_to_home')}
        </Link>
      </div>

      {/* Version entries */}
      <div className="space-y-[var(--spacing-8)] max-w-[860px]">
        {changelog.map((entry) => (
          <section key={entry.version}>
            {/* Version header */}
            <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-3)]">
              <span className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary">
                v{entry.version}
              </span>
              <span className="text-[length:var(--font-size-sm)] text-text-tertiary">
                {entry.date}
              </span>
              {entry.version === '0.4.3' && (
                <span className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full bg-status-bg-completed text-accent-green">
                  {t('changelog.latest')}
                </span>
              )}
            </div>

            {/* Changes list */}
            <ul className="space-y-[var(--spacing-2)] pl-[var(--spacing-1)]">
              {entry.changes.map((change, i) => {
                const config = typeConfig[change.type];
                return (
                  <li
                    key={i}
                    className="flex items-start gap-[var(--spacing-3)] py-[var(--spacing-1-5)] px-[var(--spacing-3)] rounded-[var(--radius-default)] hover:bg-bg-hover transition-colors duration-[var(--duration-fast)]"
                  >
                    <span className={`shrink-0 mt-[3px] text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[2px] rounded-[var(--radius-sm)] ${config.bg} ${config.color}`}>
                      {config.label}
                    </span>
                    <span className="text-[length:var(--font-size-sm)] text-text-secondary leading-[var(--line-height-relaxed)]">
                      {isZh ? change.text_zh : change.text_en}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
