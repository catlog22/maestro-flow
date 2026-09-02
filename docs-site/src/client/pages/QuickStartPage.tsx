import { useState, useMemo } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { Link } from 'react-router-dom';
import { TerminalBlock } from '@/client/components/content/GuideComponents.js';

// ---------------------------------------------------------------------------
// QuickStartPage — Interactive single-page quick guide
// Layout inspired by ccw-command-explorer, styled with Gemini CLI tokens
// ---------------------------------------------------------------------------

// -- Types --

type Category = 'all' | 'init' | 'pipeline' | 'quality' | 'quick' | 'issue' | 'advanced';
type Status = 'core' | 'recommended' | 'stable';
type Level = 1 | 2 | 3;

interface CommandData {
  id: string;
  cmd: string;
  altCmd?: string;
  category: Category;
  status: Status;
  level: Level;
  zh: { desc: string; when: string; how: string; tips: string[] };
  en: { desc: string; when: string; how: string; tips: string[] };
  related?: string[];
}

interface ScenarioData {
  id: string;
  icon: string;
  zh: { title: string; desc: string; steps: string[] };
  en: { title: string; desc: string; steps: string[] };
}

// -- Command Data --

const COMMANDS: CommandData[] = [
  // Init
  {
    id: 'init', cmd: '/maestro-init', category: 'init', status: 'core', level: 1,
    zh: {
      desc: '初始化 .workflow/ 目录，创建 state.json 和目录结构',
      when: '新项目第一次使用 Maestro，或已有项目需要引入工作流管理',
      how: '/maestro-init',
      tips: ['会自动扫描代码库填充初始 spec', '可配合 --from brainstorm:ID 基于头脑风暴结果初始化'],
    },
    en: {
      desc: 'Initialize .workflow/ directory, create state.json and directory structure',
      when: 'First time using Maestro on a new or existing project',
      how: '/maestro-init',
      tips: ['Auto-scans codebase to populate initial specs', 'Use --from brainstorm:ID to init from brainstorm results'],
    },
  },
  {
    id: 'roadmap', cmd: '/maestro "roadmap"', category: 'init', status: 'core', level: 1,
    zh: {
      desc: '消费 analyze 宏观产出，将目标分解为 Milestone > Phase 层级（Session 链步骤，由编排器派发）',
      when: 'analyze 宏观分析产出 scope_verdict=large 时，需要多 Phase 里程碑分解',
      how: '/maestro "roadmap"',
      tips: ['纯编排层，需要上游 context（analyze 或 brainstorm 产出）', '链内以 roadmap -y 自动确认，省去交互问答', '链内 roadmap --revise 随时修订路线图', 'scope_verdict=medium/small 时可跳过，直接 plan --from analyze:ANL-xxx'],
    },
    en: {
      desc: 'Consume macro analyze output, decompose goals into Milestone > Phase hierarchy (Session chain step, dispatched by the orchestrator)',
      when: 'After macro analyze produces scope_verdict=large, for multi-phase milestone decomposition',
      how: '/maestro "roadmap"',
      tips: ['Pure orchestration layer, requires upstream context (analyze or brainstorm output)', 'In-chain, roadmap -y auto-confirms and skips interactive Q&A', 'In-chain, roadmap --revise revises anytime', 'Skip when scope_verdict=medium/small — go direct with plan --from analyze:ANL-xxx'],
    },
  },
  {
    id: 'blueprint', cmd: '/maestro "blueprint ..."', category: 'init', status: 'recommended', level: 2,
    zh: {
      desc: '6 阶段规范蓝图：产品简报 → PRD → 架构文档 → 史诗故事（Session 链步骤，由编排器派发）',
      when: '大型项目需要完整规范文档体系，与 brainstorm 并行的正式规范路径',
      how: '/maestro "blueprint 项目想法或目标"',
      tips: ['产出保存在 .workflow/blueprint/ 目录', '下游通过 --from blueprint:BLP-xxx 消费', '链内以 blueprint -y 跳过交互确认'],
    },
    en: {
      desc: '6-stage spec blueprint: Product Brief → PRD → Architecture → Epics (Session chain step, dispatched by the orchestrator)',
      when: 'Large projects needing comprehensive spec documentation, parallel to brainstorm',
      how: '/maestro "blueprint project idea or goal"',
      tips: ['Outputs saved to .workflow/blueprint/ directory', 'Downstream consumes via --from blueprint:BLP-xxx', 'In-chain, blueprint -y skips interactive confirmation'],
    },
  },
  // Pipeline
  {
    id: 'grill', cmd: '/maestro "grill ..."', category: 'pipeline', status: 'recommended', level: 2,
    zh: {
      desc: '苏格拉底式压力测试 — 对抗性提问验证方案假设，用代码证据挑战模糊术语（Session 链步骤，由编排器派发）',
      when: '在 brainstorm 或 roadmap 之前，需要验证方案假设和需求可行性',
      how: '/maestro "grill 多租户架构方案"',
      tips: ['支持 shallow/standard/deep 三级深度', '产出验证过的 context-package，可直接导入下游命令', '与 brainstorm 互补：grill 是收敛验证，brainstorm 是发散探索'],
    },
    en: {
      desc: 'Socratic stress-testing — adversarial questioning verifies assumptions with code evidence (Session chain step, dispatched by the orchestrator)',
      when: 'Before brainstorm or roadmap, need to verify assumptions and feasibility',
      how: '/maestro "grill multi-tenancy architecture"',
      tips: ['Supports shallow/standard/deep depth levels', 'Produces verified context-package for downstream commands', 'Complements brainstorm: grill converges/verifies, brainstorm diverges/explores'],
    },
  },
  {
    id: 'analyze', cmd: '/maestro "analyze phase N"', category: 'pipeline', status: 'core', level: 1,
    zh: {
      desc: '双层分析：Micro（数字参数）Phase 级 6 维度深度分析，Macro（文本参数）宏观需求探索（Session 链步骤，由编排器派发）',
      when: 'Micro：开始新 Phase 前深度分析；Macro：roadmap 之前探索需求影响面',
      how: '/maestro "analyze phase 1"',
      tips: ['Micro 模式：数字参数（如 1）→ Phase 级 6 维度评分 → 直接进入 plan', 'Macro 模式：文本参数（如 "多租户架构"）→ scope_verdict → 路由到 roadmap 或 plan', '支持 --from brainstorm:ID 导入上游上下文'],
    },
    en: {
      desc: 'Dual-layer: Micro (number) for phase-level 6-dimension analysis, Macro (text) for requirement exploration (Session chain step, dispatched by the orchestrator)',
      when: 'Micro: deep analysis before a phase; Macro: explore requirement impact before roadmap',
      how: '/maestro "analyze phase 1"',
      tips: ['Micro mode: number arg (e.g. 1) → 6-dimension scoring → directly to plan', 'Macro mode: text arg (e.g. "multi-tenancy") → scope_verdict → routes to roadmap or plan', 'Use --from brainstorm:ID for upstream context'],
    },
  },
  {
    id: 'plan', cmd: '/maestro "plan phase N"', category: 'pipeline', status: 'core', level: 1,
    zh: {
      desc: '基于分析结果生成执行计划，分解为具体任务（Session 链步骤，由编排器派发）',
      when: '分析完成后，准备制定实现方案',
      how: '/maestro "plan phase 1"',
      tips: ['--from analyze:ANL-xxx 可跳过 roadmap 直达规划（中小功能推荐）', '可带 --gaps 基于验证缺陷生成修复计划', '计划产物保存在 .workflow/scratch/ 下'],
    },
    en: {
      desc: 'Generate execution plan from analysis, decompose into tasks (Session chain step, dispatched by the orchestrator)',
      when: 'After analysis, ready to create implementation plan',
      how: '/maestro "plan phase 1"',
      tips: ['--from analyze:ANL-xxx skips roadmap for direct planning (recommended for mid/small features)', 'Use --gaps to generate fix plan from verification gaps', 'Plan artifacts saved under .workflow/scratch/'],
    },
  },
  {
    id: 'execute', cmd: '/maestro "execute phase N"', category: 'pipeline', status: 'core', level: 1,
    zh: {
      desc: '按计划执行任务，生成代码和产物（Session 链步骤，由编排器派发）',
      when: '计划确认后，开始实际编码实现',
      how: '/maestro "execute phase 1"',
      tips: ['执行前确认计划内容完整', '可用 --dir 指定特定计划目录'],
    },
    en: {
      desc: 'Execute tasks per plan, generate code and artifacts (Session chain step, dispatched by the orchestrator)',
      when: 'Plan confirmed, ready to implement',
      how: '/maestro "execute phase 1"',
      tips: ['Review plan content before execution', 'Use --dir to target a specific plan directory'],
    },
  },
  // Quality
  {
    id: 'auto-test', cmd: '/maestro "auto-test phase N"', category: 'quality', status: 'recommended', level: 2,
    zh: {
      desc: '智能自动测试，自动路由到 spec/gap/code 测试轨道（Session 链步骤，由编排器派发）',
      when: '验证通过后需要补充测试覆盖',
      how: '/maestro "auto-test phase 1"',
      tips: ['链内以 auto-test 1 --re-run 只重跑失败场景', '会自动分析测试缺口并生成补全'],
    },
    en: {
      desc: 'Smart auto-testing, routes to spec/gap/code test tracks (Session chain step, dispatched by the orchestrator)',
      when: 'After verification, need to add test coverage',
      how: '/maestro "auto-test phase 1"',
      tips: ['In-chain, auto-test 1 --re-run reruns only failed scenarios', 'Auto-analyzes test gaps and generates supplements'],
    },
  },
  {
    id: 'test', cmd: '/maestro "test phase N"', category: 'quality', status: 'recommended', level: 2,
    zh: {
      desc: '交互式 UAT 测试，人工确认每个测试场景（Session 链步骤，由编排器派发）',
      when: '需要人工验收测试，确保功能符合预期',
      how: '/maestro "test phase 1"',
      tips: ['会生成 UAT 测试清单供逐步确认', '加 --auto-fix 自动修复简单问题，--smoke 先跑冒烟测试'],
    },
    en: {
      desc: 'Interactive UAT testing, manual confirmation for each scenario (Session chain step, dispatched by the orchestrator)',
      when: 'Manual acceptance testing needed to confirm functionality',
      how: '/maestro "test phase 1"',
      tips: ['Generates UAT checklist for step-by-step confirmation', 'Add --auto-fix to auto-fix simple issues, --smoke to run smoke tests first'],
    },
  },
  {
    id: 'review', cmd: '/maestro "review phase N"', category: 'quality', status: 'recommended', level: 2,
    zh: {
      desc: '代码审查，多维度评估代码质量（Session 链步骤，由编排器派发）',
      when: '提交前需要代码审查',
      how: '/maestro "review phase 1"',
      tips: ['审查分 quick/standard/deep 三档，按变更规模和风险自动推断', '审查结果保存在 review.json'],
    },
    en: {
      desc: 'Code review, multi-dimensional quality assessment (Session chain step, dispatched by the orchestrator)',
      when: 'Code review before submission',
      how: '/maestro "review phase 1"',
      tips: ['Review tiers quick/standard/deep, inferred from change size and risk', 'Review results saved in review.json'],
    },
  },
  {
    id: 'debug', cmd: '/maestro-odyssey --mode debug', category: 'quality', status: 'stable', level: 2,
    zh: {
      desc: '诊断测试失败或验证缺陷的根因（原 quality-debug，已并入 Odyssey debug 模式）',
      when: '测试失败或验证不通过，需要定位问题',
      how: '/maestro-odyssey --mode debug "登录失败" --from-uat 1',
      tips: ['--from-uat 基于 UAT 结果诊断', '会生成诊断报告和修复方向'],
    },
    en: {
      desc: 'Diagnose root cause of test failures or verification gaps (former quality-debug, folded into Odyssey debug mode)',
      when: 'Tests fail or verification doesn\'t pass',
      how: '/maestro-odyssey --mode debug "login fails" --from-uat 1',
      tips: ['--from-uat diagnoses from UAT results', 'Generates diagnosis report with fix directions'],
    },
  },
  // Quick
  {
    id: 'security-audit', cmd: '/maestro-odyssey --mode security', category: 'quality', status: 'recommended', level: 2,
    zh: {
      desc: '系统性安全审计 — 覆盖 OWASP Top 10、供应链、密钥泄露、CI/CD 管线（已并入 Odyssey security 模式）',
      when: '发布前、安全敏感变更后、定期安全检查',
      how: '/maestro-odyssey "审计认证模块安全性" --mode security',
      tips: ['原 security-audit 命令已融入 Odyssey，通过 --mode security 进入', 'Odyssey 归档 → 审计 → 修复 → 验证 的长循环', '会生成安全发现和修复优先级排序'],
    },
    en: {
      desc: 'Systematic security audit — OWASP Top 10, supply chain, secrets leak, CI/CD pipeline (folded into Odyssey security mode)',
      when: 'Before releases, after security-sensitive changes, periodic security checks',
      how: '/maestro-odyssey "audit auth module security" --mode security',
      tips: ['The former security-audit command is now Odyssey --mode security', 'Odyssey long loop: archaeology → audit → fix → verify', 'Generates security findings with fix priority ranking'],
    },
  },
  {
    id: 'next', cmd: '/maestro-next', category: 'quick', status: 'stable', level: 1,
    zh: {
      desc: '单命令推荐引擎 — 解析意图和项目状态，推荐一个最合适的命令',
      when: '不确定该用哪个命令时，轻量级路由入口',
      how: '/maestro-next "我想优化性能"',
      tips: ['不创建 session，不写 status.json，纯推荐', '--top 3 显示前 3 个候选命令', '与 /maestro 的区别：next 只推荐不执行'],
    },
    en: {
      desc: 'Single-command recommendation — parses intent and project state, recommends one command',
      when: 'Unsure which command to use, lightweight routing entry',
      how: '/maestro-next "I want to optimize performance"',
      tips: ['No session created, no status.json written, pure recommendation', '--top 3 shows top 3 candidate commands', 'Unlike /maestro: next only recommends, doesn\'t execute'],
    },
  },
  {
    id: 'companion', cmd: '/maestro-companion', category: 'quick', status: 'core', level: 1,
    zh: {
      desc: '轻量任务直接执行，并记录非正式证据',
      when: 'Bug 修复、小功能、简单重构等不需要完整管线的任务',
      how: '/maestro-companion "修复登录页 Bug"',
      tips: ['不创建 plan/execute chain', '需要规划、验证或讨论时升级到 /maestro 或 /maestro-next --run'],
    },
    en: {
      desc: 'Execute lightweight tasks directly with informal evidence recording',
      when: 'Bug fixes, small features, simple refactors that don\'t need full pipeline',
      how: '/maestro-companion "fix login page bug"',
      tips: ['Does not create a plan/execute chain', 'Use /maestro or /maestro-next --run when planning or gates are needed'],
    },
  },
  {
    id: 'auto', cmd: '/maestro -y', altCmd: '/maestro "描述"', category: 'quick', status: 'core', level: 1,
    zh: {
      desc: '一键全自动执行完整生命周期',
      when: '明确知道要做什么，希望全自动完成',
      how: '/maestro -y "实现用户认证系统"',
      tips: ['自动走 analyze → plan → execute → verify 全流程', '适合需求明确的中大型任务'],
    },
    en: {
      desc: 'One-command full lifecycle automation',
      when: 'Clear requirements, want fully automated execution',
      how: '/maestro -y "implement user authentication"',
      tips: ['Runs full analyze → plan → execute → verify cycle', 'Best for well-defined mid-to-large tasks'],
    },
  },
  // Issue
  {
    id: 'discover', cmd: '/maestro-issue', category: 'issue', status: 'recommended', level: 2,
    zh: {
      desc: '8 视角全扫描发现潜在问题',
      when: '需要全面检查代码库问题，或按提示搜索特定问题',
      how: '/maestro-issue "发现问题：检查 API 错误处理"',
      tips: ['意图驱动，用自然语言描述要扫描的范围', '发现的 Issue 可自动进入修复管线'],
    },
    en: {
      desc: '8-perspective scan to discover potential issues',
      when: 'Comprehensive codebase issue scan or targeted search',
      how: '/maestro-issue "discover: check API error handling"',
      tips: ['Intent-driven — describe the scan scope in natural language', 'Discovered issues can auto-enter fix pipeline'],
    },
  },
  {
    id: 'issue', cmd: '/maestro-issue', category: 'issue', status: 'stable', level: 2,
    zh: {
      desc: '创建、查看、关闭 Issue',
      when: '手动创建 Issue 或管理已发现的问题',
      how: '/maestro-issue "记录一个内存泄漏 bug，严重度 high"',
      tips: ['意图驱动：报告 / 列出 / 关闭 / 关联 用自然语言描述即可', 'Issue 可关联 Phase 管线自动修复'],
    },
    en: {
      desc: 'Create, view, close issues',
      when: 'Manually create issues or manage discovered problems',
      how: '/maestro-issue "log a memory leak bug, high severity"',
      tips: ['Intent-driven: report / list / close / link — just describe it', 'Issues can link to pipeline for auto-fix'],
    },
  },
  // Advanced
  {
    id: 'fork', cmd: '/maestro-fork', category: 'advanced', status: 'stable', level: 3,
    zh: {
      desc: 'Fork worktree 实现里程碑级并行开发',
      when: '需要并行处理多个里程碑，不想等 Bug 修完再开始下一阶段',
      how: '/maestro-fork -m 2',
      tips: ['在 worktree 中独立开发，完成后 /maestro-merge 合并', '--sync 可同步 main 修复到 worktree'],
    },
    en: {
      desc: 'Fork worktree for milestone-level parallel development',
      when: 'Need to parallelize across milestones without waiting',
      how: '/maestro-fork -m 2',
      tips: ['Develop independently in worktree, merge with /maestro-merge', '--sync pulls main fixes into worktree'],
    },
  },
  {
    id: 'delegate', cmd: 'maestro delegate', category: 'advanced', status: 'recommended', level: 3,
    zh: {
      desc: '异步委托任务到外部 AI 引擎（Gemini/Qwen/Codex/Claude/Grok）',
      when: '需要利用外部 AI 的算力或特定能力',
      how: 'maestro delegate "分析性能瓶颈" --to gemini --mode analysis',
      tips: ['--mode analysis 只读安全，--mode write 可修改文件', '支持 --rule 模板加速常见任务'],
    },
    en: {
      desc: 'Async delegate tasks to external AI engines (Gemini/Qwen/Codex/Claude/Grok)',
      when: 'Need external AI compute power or specific capabilities',
      how: 'maestro delegate "analyze perf bottlenecks" --to gemini --mode analysis',
      tips: ['--mode analysis is read-only safe, --mode write can modify', 'Supports --rule templates for common tasks'],
    },
  },
  {
    id: 'ralph', cmd: '/maestro-ralph', category: 'advanced', status: 'recommended', level: 3,
    zh: {
      desc: '自适应生命周期引擎，带决策节点的闭环循环',
      when: '复杂项目需要自动调试-修复-重试的闭环能力',
      how: '/maestro-ralph "重构认证模块" -y',
      tips: ['与 /maestro 的区别：ralph 有决策节点，链可动态增长', '适合不确定性强的大型任务'],
    },
    en: {
      desc: 'Adaptive lifecycle engine with decision-node closed loops',
      when: 'Complex projects need auto debug-fix-retry closed loop',
      how: '/maestro-ralph "refactor auth module" -y',
      tips: ['Unlike /maestro: ralph has decision nodes, chain grows dynamically', 'Best for high-uncertainty large tasks'],
    },
  },  {
    id: 'guard', cmd: '/maestro-guard', category: 'advanced', status: 'stable', level: 3,
    zh: {
      desc: '编辑边界控制 — 配置目录级写入边界，防止代理误改不相关文件',
      when: '在敏感代码区域工作时，限制代理只能修改指定目录',
      how: '/maestro-guard on',
      tips: ['on 启用守卫 / off 禁用 / status 查看配置', 'allow <path> 添加允许编辑的路径', 'deny <path> 切换到拒绝模式（仅允许指定路径）'],
    },
    en: {
      desc: 'Editing boundary control — configure directory-level write boundaries to prevent unintended edits',
      when: 'Working in sensitive code areas, restrict agent to only modify specified directories',
      how: '/maestro-guard on',
      tips: ['on enables guard / off disables / status shows config', 'allow <path> adds allowed edit path', 'deny <path> switches to deny mode (only specified paths allowed)'],
    },
  },
];

// -- Category Config --

const CATEGORIES: { id: Category; icon: string; zh: string; en: string }[] = [
  { id: 'all', icon: '◉', zh: '全部', en: 'All' },
  { id: 'init', icon: '◎', zh: '初始化', en: 'Setup' },
  { id: 'pipeline', icon: '▶', zh: '核心管线', en: 'Pipeline' },
  { id: 'quality', icon: '✓', zh: '质量保证', en: 'Quality' },
  { id: 'quick', icon: '⚡', zh: '快速任务', en: 'Quick' },
  { id: 'issue', icon: '●', zh: 'Issue 追踪', en: 'Issues' },
  { id: 'advanced', icon: '◆', zh: '进阶', en: 'Advanced' },
];

// -- Usage Scenarios --

const SCENARIOS: ScenarioData[] = [
  {
    id: 'new-project', icon: '🚀',
    zh: {
      title: '新项目起步（Path A）',
      desc: '大型项目完整工作流：宏观分析 → roadmap 分解 → 逐 Phase 推进',
      steps: ['/maestro-init', '/maestro "analyze 项目目标"', '# scope_verdict=large → roadmap', '/maestro "roadmap"', '/maestro "analyze phase 1"', '/maestro "plan phase 1"', '/maestro "execute phase 1"'],
    },
    en: {
      title: 'New Project (Path A)',
      desc: 'Large project full workflow: macro analyze → roadmap decomposition → per-phase execution',
      steps: ['/maestro-init', '/maestro "analyze project goals"', '# scope_verdict=large → roadmap', '/maestro "roadmap"', '/maestro "analyze phase 1"', '/maestro "plan phase 1"', '/maestro "execute phase 1"'],
    },
  },
  {
    id: 'medium-feature', icon: '📦',
    zh: {
      title: '中等功能（Path B）',
      desc: '跳过 roadmap，analyze 直达 plan — 适合 1-2 个子系统的功能',
      steps: ['/maestro "analyze 功能描述"', '# scope_verdict=medium → 直达 plan', '/maestro "plan --from analyze:ANL-xxx"', '/maestro "execute"'],
    },
    en: {
      title: 'Medium Feature (Path B)',
      desc: 'Skip roadmap, analyze direct to plan — for features spanning 1-2 subsystems',
      steps: ['/maestro "analyze feature description"', '# scope_verdict=medium → direct to plan', '/maestro "plan --from analyze:ANL-xxx"', '/maestro "execute"'],
    },
  },
  {
    id: 'quick-fix', icon: '🔧',
    zh: {
      title: '快速修复',
      desc: 'Bug 修复和小改动，跳过完整管线',
      steps: ['/maestro-companion "修复登录页 Bug"', '# 需要规划和验证时', '/maestro "重构 API 层"'],
    },
    en: {
      title: 'Quick Fix',
      desc: 'Bug fixes and small changes, skip full pipeline',
      steps: ['/maestro-companion "fix login bug"', '# use the full orchestrator when gates are needed', '/maestro "refactor API layer"'],
    },
  },
  {
    id: 'full-auto', icon: '🤖',
    zh: {
      title: '一键全自动',
      desc: '需求明确，全自动从分析到验证',
      steps: ['/maestro -y "实现用户认证系统"', '# 自动走完整生命周期'],
    },
    en: {
      title: 'Full Auto',
      desc: 'Clear requirements, fully automated analysis to verification',
      steps: ['/maestro -y "implement user auth"', '# auto-runs full lifecycle'],
    },
  },
  {
    id: 'issue-flow', icon: '📋',
    zh: {
      title: '问题发现与修复',
      desc: '发现问题 → 定位 → 修复 → 关闭',
      steps: ['/maestro-issue "发现问题：检查错误处理"', '/maestro "修复 ISS-001 的缺陷"', '/maestro-issue "关闭 ISS-001，已修复"'],
    },
    en: {
      title: 'Issue Discovery & Fix',
      desc: 'Discover → diagnose → fix → close',
      steps: ['/maestro-issue "discover: check error handling"', '/maestro "fix the gaps in ISS-001"', '/maestro-issue "close ISS-001, resolved"'],
    },
  },
  {
    id: 'parallel', icon: '🔀',
    zh: {
      title: '并行开发',
      desc: '多里程碑同时推进，不等 Bug 修完',
      steps: ['/maestro-fork -m 2', 'cd .worktrees/m2-*/', '/maestro -y "推进 phase 3"', 'cd /project', '/maestro-merge -m 2'],
    },
    en: {
      title: 'Parallel Dev',
      desc: 'Multiple milestones simultaneously',
      steps: ['/maestro-fork -m 2', 'cd .worktrees/m2-*/', '/maestro -y "advance phase 3"', 'cd /project', '/maestro-merge -m 2'],
    },
  },
  {
    id: 'quality-loop', icon: '🔄',
    zh: {
      title: '质量闭环',
      desc: '测试失败 → 诊断 → 修复 → 重测',
      steps: ['/maestro "test phase 1"', '# 测试失败时', '/maestro-odyssey --mode debug "<from-uat 1>"', '/maestro "plan phase 1 --gaps"', '/maestro "execute phase 1"', '/maestro "auto-test phase 1"'],
    },
    en: {
      title: 'Quality Loop',
      desc: 'Test fail → diagnose → fix → retest',
      steps: ['/maestro "test phase 1"', '# on failure', '/maestro-odyssey --mode debug "<from-uat 1>"', '/maestro "plan phase 1 --gaps"', '/maestro "execute phase 1"', '/maestro "auto-test phase 1"'],
    },
  },
  {
    id: 'knowledge', icon: '📚',
    zh: {
      title: '知识管理闭环',
      desc: '执行后提取知识 → 沉淀到 wiki/spec → 下次规划时自动注入',
      steps: ['/maestro-knowhow "沉淀这次的决策与技巧"', '# 捕获经验到 knowhow', '/maestro-knowledge "提取最近 3 个会话的知识"', '# harvest 并入库', '/maestro-knowledge "检查 wiki 健康并连接知识图谱"', '# 发现并修复隐藏关联'],
    },
    en: {
      title: 'Knowledge Loop',
      desc: 'Extract knowledge after execution → persist to wiki/spec → auto-inject in next planning',
      steps: ['/maestro-knowhow "capture this decision and tips"', '# precipitate into knowhow', '/maestro-knowledge "harvest the last 3 sessions"', '# harvest into the store', '/maestro-knowledge "check wiki health and link the graph"', '# discover and fix hidden connections'],
    },
  },
  {
    id: 'security-flow', icon: '🛡️',
    zh: {
      title: '安全审计与修复',
      desc: '发布前安全扫描 → 发现漏洞 → 修复 → 验证',
      steps: ['/maestro-odyssey "全面安全审计" --mode security', '# 安全审计长循环', '/maestro-issue "创建 issue：修复 XSS 漏洞，severity critical"', '# 创建安全 Issue', '/maestro "修复 XSS 漏洞"', '# 使用完整编排和验证', '/maestro-odyssey "复查安全修复" --mode security', '# 复查确认'],
    },
    en: {
      title: 'Security Audit & Fix',
      desc: 'Pre-release security scan → discover vulnerabilities → fix → verify',
      steps: ['/maestro-odyssey "full security audit" --mode security', '# security audit long loop', '/maestro-issue "create issue: fix XSS vulnerability, severity critical"', '# create security issue', '/maestro "Fix XSS vulnerability"', '# full orchestration and verification', '/maestro-odyssey "re-check the security fix" --mode security', '# re-audit to confirm'],
    },
  },];

// -- Status Badge --

function StatusBadge({ status, isZh }: { status: Status; isZh: boolean }) {
  const styles: Record<Status, string> = {
    core: 'bg-tint-blue text-accent-blue',
    recommended: 'bg-tint-green text-accent-green',
    stable: 'bg-tint-gray text-text-tertiary',
  };
  const labels: Record<Status, { zh: string; en: string }> = {
    core: { zh: '核心', en: 'Core' },
    recommended: { zh: '推荐', en: 'Rec.' },
    stable: { zh: '稳定', en: 'Stable' },
  };
  return (
    <span className={`text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[1px] rounded-[var(--radius-full)] ${styles[status]}`}>
      {isZh ? labels[status].zh : labels[status].en}
    </span>
  );
}

// -- Level Dots --

function LevelDots({ level }: { level: Level }) {
  return (
    <span className="flex gap-[2px]" title={`Level ${level}`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`w-1.5 h-1.5 rounded-full ${n <= level ? 'bg-accent-blue' : 'bg-border-divider'}`}
        />
      ))}
    </span>
  );
}

// TerminalBlock imported from GuideComponents

// -- Pipeline Step --

interface PipelineStepProps {
  label: string;
  cmd: string;
  color: string;
  isLast?: boolean;
  isZh: boolean;
}

function PipelineStep({ label, cmd, color, isLast, isZh }: PipelineStepProps) {
  const colorMap: Record<string, { bg: string; border: string; text: string }> = {
    blue: { bg: 'bg-tint-blue', border: 'border-[rgba(54,75,255,0.3)]', text: 'text-accent-blue' },
    purple: { bg: 'bg-tint-purple', border: 'border-[rgba(132,48,206,0.3)]', text: 'text-accent-purple' },
    orange: { bg: 'bg-tint-orange', border: 'border-[rgba(227,116,0,0.3)]', text: 'text-accent-orange' },
    green: { bg: 'bg-tint-green', border: 'border-[rgba(30,142,62,0.3)]', text: 'text-accent-green' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="flex items-center gap-[var(--spacing-3)]">
      <div className={`flex flex-col items-center gap-[var(--spacing-1)] px-[var(--spacing-4)] py-[var(--spacing-3)] rounded-[var(--radius-lg)] border ${c.bg} ${c.border} min-w-[120px]`}>
        <span className={`text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] ${c.text}`}>{label}</span>
        <code className="text-[length:11px] text-text-tertiary font-[var(--font-mono)]">{cmd}</code>
      </div>
      {!isLast && (
        <svg className="w-5 h-5 text-text-tertiary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
}

// -- Command Card --

interface CommandCardProps {
  cmd: CommandData;
  isZh: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function CommandCard({ cmd, isZh, isExpanded, onToggle }: CommandCardProps) {
  const content = isZh ? cmd.zh : cmd.en;
  return (
    <div
      className={[
        'group border border-border rounded-[var(--radius-lg)] bg-bg-card',
        'transition-all duration-[var(--duration-normal)]',
        'hover:shadow-md hover:border-[var(--color-border-focused)]',
        isExpanded ? 'ring-1 ring-[var(--color-accent-blue)] ring-opacity-30' : '',
      ].join(' ')}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-[var(--spacing-4)] py-[var(--spacing-3)] flex flex-col gap-[var(--spacing-2)]"
      >
        <div className="flex items-center gap-[var(--spacing-2)]">
          <code className="text-[length:13px] font-[var(--font-mono)] font-[var(--font-weight-semibold)] text-text-primary">
            {cmd.cmd}
          </code>
          <StatusBadge status={cmd.status} isZh={isZh} />
          <LevelDots level={cmd.level} />
          <svg
            className={[
              'w-4 h-4 ml-auto text-text-tertiary transition-transform duration-[var(--duration-fast)]',
              isExpanded ? 'rotate-180' : '',
            ].join(' ')}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6]">
          {content.desc}
        </p>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-[var(--spacing-4)] pb-[var(--spacing-4)] flex flex-col gap-[var(--spacing-3)] border-t border-border-divider pt-[var(--spacing-3)]">
          {/* Syntax */}
          <div>
            <span className="text-[length:11px] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[0.05em] mb-[var(--spacing-1)] block">
              {isZh ? '语法' : 'Syntax'}
            </span>
            <TerminalBlock title="Terminal" compact>
              <code className="text-[length:12px] text-accent-blue">{content.how}</code>
            </TerminalBlock>
          </div>

          {/* When to use */}
          <div>
            <span className="text-[length:11px] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[0.05em]">
              {isZh ? '何时使用' : 'When to use'}
            </span>
            <p className="mt-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6]">
              {content.when}
            </p>
          </div>

          {/* Tips */}
          <div>
            <span className="text-[length:11px] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[0.05em]">
              {isZh ? '经验技巧' : 'Tips'}
            </span>
            <ul className="mt-[var(--spacing-1)] flex flex-col gap-[var(--spacing-1)]">
              {content.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-[var(--spacing-2)] text-[length:var(--font-size-sm)] text-text-secondary">
                  <span className="text-accent-blue mt-[2px] shrink-0">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          {/* Related */}
          {cmd.related && cmd.related.length > 0 && (
            <div className="flex flex-wrap gap-[var(--spacing-1)]">
              <span className="text-[length:11px] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[0.05em]">
                {isZh ? '相关命令' : 'Related'}
              </span>
              <div className="flex flex-wrap gap-[var(--spacing-1)] ml-[var(--spacing-2)]">
                {cmd.related.map((r) => (
                  <span key={r} className="text-[length:11px] px-[var(--spacing-1-5)] py-[1px] rounded-[var(--radius-full)] bg-tint-blue text-accent-blue font-[var(--font-mono)]">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Scenario Card --

function ScenarioCard({ scenario, isZh }: { scenario: ScenarioData; isZh: boolean }) {
  const content = isZh ? scenario.zh : scenario.en;
  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-bg-card px-[var(--spacing-4)] py-[var(--spacing-3)]">
      <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-2)]">
        <span className="text-[length:18px]">{scenario.icon}</span>
        <span className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">
          {content.title}
        </span>
      </div>
      <p className="text-[length:var(--font-size-sm)] text-text-secondary mb-[var(--spacing-3)]">
        {content.desc}
      </p>
      <TerminalBlock title="Terminal" compact>
        <div className="flex flex-col gap-[var(--spacing-0-5)]">
          {content.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-[var(--spacing-2)]">
              <span className="text-[length:11px] text-text-tertiary w-4 text-right shrink-0">{i + 1}</span>
              {step.startsWith('#') ? (
                <span className="text-[length:12px] text-[#8e8e8e] dark:text-[#686868] italic">{step}</span>
              ) : (
                <code className="text-[length:12px] text-[#bd9cfe] dark:text-[#bd9cfe]">{step}</code>
              )}
            </div>
          ))}
        </div>
      </TerminalBlock>
    </div>
  );
}

// -- Main Page --

export default function QuickStartPage() {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh-CN';

  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = COMMANDS;
    if (selectedCategory !== 'all') {
      result = result.filter((c) => c.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) =>
        c.cmd.toLowerCase().includes(q) ||
        c.zh.desc.toLowerCase().includes(q) ||
        c.en.desc.toLowerCase().includes(q) ||
        c.zh.when.toLowerCase().includes(q) ||
        c.en.when.toLowerCase().includes(q)
      );
    }
    return result;
  }, [selectedCategory, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="max-w-[960px]">
      {/* Hero */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-default)] bg-tint-blue text-accent-blue">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </span>
          <h1 className="text-[36px] font-[var(--font-weight-bold)] text-text-primary leading-[1.2] tracking-[var(--letter-spacing-tight)]">
            {isZh ? '快速入门' : 'Quick Start'}
          </h1>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[1.75] max-w-[640px]">
          {isZh
            ? 'Maestro 的核心是 4 步管线：分析 → 规划 → 执行 → 验证。掌握这些命令，10 分钟上手。'
            : 'Maestro\'s core is a 4-step pipeline: Analyze → Plan → Execute → Verify. Master these commands in 10 minutes.'}
        </p>
      </div>

      {/* Pipeline Flow */}
      <div className="mb-[var(--spacing-8)] px-[var(--spacing-2)] py-[var(--spacing-4)] border border-border rounded-[var(--radius-lg)] bg-bg-elevated">
        <div className="text-[length:11px] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[0.06em] mb-[var(--spacing-3)]">
          {isZh ? '核心管线流程' : 'Core Pipeline Flow'}
        </div>
        <div className="flex items-center justify-center gap-0 flex-wrap">
          <PipelineStep label={isZh ? '分析' : 'Analyze'} cmd="analyze" color="blue" isZh={isZh} />
          <PipelineStep label={isZh ? '规划' : 'Plan'} cmd="plan" color="purple" isZh={isZh} />
          <PipelineStep label={isZh ? '执行' : 'Execute'} cmd="execute" color="orange" isLast isZh={isZh} />
        </div>
      </div>

      {/* Filter + Search */}
      <div className="mb-[var(--spacing-4)] flex flex-col sm:flex-row sm:items-center gap-[var(--spacing-3)]">
        {/* Category pills */}
        <div className="flex flex-wrap gap-[var(--spacing-1)]">
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => { setSelectedCategory(cat.id); setExpandedId(null); }}
                className={[
                  'flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-1)]',
                  'text-[length:var(--font-size-sm)] rounded-[var(--radius-full)]',
                  'transition-all duration-[var(--duration-fast)]',
                  isActive
                    ? 'bg-accent-blue text-text-inverse font-[var(--font-weight-semibold)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                ].join(' ')}
              >
                <span className="text-[length:12px]">{cat.icon}</span>
                {isZh ? cat.zh : cat.en}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative sm:ml-auto sm:w-56">
          <svg className="absolute left-[var(--spacing-2)] top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isZh ? '搜索命令...' : 'Search commands...'}
            className="w-full pl-[var(--spacing-8)] pr-[var(--spacing-3)] py-[var(--spacing-1-5)] text-[length:var(--font-size-sm)] bg-bg-elevated border border-border rounded-[var(--radius-default)] text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-[var(--color-border-focused)] focus:ring-1 focus:ring-[var(--color-accent-blue)] focus:ring-opacity-30 transition-all duration-[var(--duration-fast)]"
          />
        </div>
      </div>

      {/* Results count */}
      <div className="mb-[var(--spacing-3)] text-[length:var(--font-size-sm)] text-text-tertiary">
        {isZh ? `${filtered.length} 个命令` : `${filtered.length} commands`}
      </div>

      {/* Command Cards Grid */}
      <div className="flex flex-col gap-[var(--spacing-2)] mb-[var(--spacing-10)]">
        {filtered.length === 0 ? (
          <div className="py-[var(--spacing-8)] text-center text-text-tertiary text-[length:var(--font-size-sm)]">
            {isZh ? '未找到匹配的命令' : 'No matching commands'}
          </div>
        ) : (
          filtered.map((cmd) => (
            <CommandCard
              key={cmd.id}
              cmd={cmd}
              isZh={isZh}
              isExpanded={expandedId === cmd.id}
              onToggle={() => toggleExpand(cmd.id)}
            />
          ))
        )}
      </div>

      {/* Usage Scenarios */}
      <div className="mb-[var(--spacing-10)]">
        <h2 className="text-[28px] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-2)] tracking-[var(--letter-spacing-tight)]">
          {isZh ? '典型场景' : 'Usage Scenarios'}
        </h2>
        <p className="text-[length:var(--font-size-base)] text-text-secondary mb-[var(--spacing-4)]">
          {isZh ? '不同场景下选择不同的命令组合' : 'Choose different command combinations for different scenarios'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--spacing-3)]">
          {SCENARIOS.map((s) => (
            <ScenarioCard key={s.id} scenario={s} isZh={isZh} />
          ))}
        </div>
      </div>

      {/* Quick Reference */}
      <div className="mb-[var(--spacing-10)]">
        <h2 className="text-[28px] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-4)] tracking-[var(--letter-spacing-tight)]">
          {isZh ? '经验总结' : 'Key Takeaways'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--spacing-3)]">
          {[
            { icon: '1', color: 'bg-tint-blue text-accent-blue', zh: '管线是核心', en: 'Pipeline is king', zhDesc: 'analyze → plan → execute → verify 四步循环。每个 Phase 走完整管线质量最高。', enDesc: 'analyze → plan → execute → verify loop. Full pipeline per phase yields best quality.' },
            { icon: '2', color: 'bg-tint-green text-accent-green', zh: '简单任务用 Companion', en: 'Use Companion for simple tasks', zhDesc: 'Bug 修复、小改动不需要走完整管线。/maestro-companion 直接执行并记录证据。', enDesc: 'Bug fixes and small changes do not need the full pipeline. /maestro-companion executes directly and records evidence.' },
            { icon: '3', color: 'bg-tint-purple text-accent-purple', zh: '-y 省时间', en: '-y saves time', zhDesc: '大多数命令支持 -y 自动确认。熟悉后加上 -y 可以大幅提升效率。', enDesc: 'Most commands support -y auto-confirm. Add -y once familiar to boost efficiency.' },
            { icon: '4', color: 'bg-tint-orange text-accent-orange', zh: '质量闭环别跳过', en: 'Don\'t skip quality loop', zhDesc: '执行后一定要 verify + test。质量管线是代码质量的最后一道防线。', enDesc: 'Always verify + test after execute. Quality pipeline is the last line of defense.' },
            { icon: '5', color: 'bg-tint-blue text-accent-blue', zh: '知识要沉淀', en: 'Persist knowledge', zhDesc: '每个阶段结束后用 /maestro-knowledge 提取知识、/maestro-knowhow 沉淀经验。积累的知识会在下次规划时自动注入。', enDesc: 'Use /maestro-knowledge to harvest and /maestro-knowhow to capture after each phase. Accumulated knowledge auto-injects in the next planning cycle.' },
            { icon: '6', color: 'bg-tint-green text-accent-green', zh: '不确定时用 ralph', en: 'When unsure, use ralph', zhDesc: '/maestro-ralph 自动推断最优命令链，适合不确定该走哪条路的复杂场景。', enDesc: '/maestro-ralph auto-infers the optimal command chain for complex scenarios with uncertain paths.' },
          ].map((item) => (
            <div key={item.icon} className="flex gap-[var(--spacing-3)] p-[var(--spacing-3)] border border-border rounded-[var(--radius-lg)] bg-bg-card">
              <span className={`flex items-center justify-center w-7 h-7 rounded-full ${item.color} text-[length:13px] font-[var(--font-weight-bold)] shrink-0`}>
                {item.icon}
              </span>
              <div>
                <div className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-0-5)]">
                  {isZh ? item.zh : item.en}
                </div>
                <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6]">
                  {isZh ? item.zhDesc : item.enDesc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Back link */}
      <div className="border-t border-border-divider pt-[var(--spacing-4)]">
        <Link
          to="/guides"
          className="inline-flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-accent-blue no-underline hover:underline"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t('guides.back_to_all')}
        </Link>
      </div>
    </div>
  );
}
