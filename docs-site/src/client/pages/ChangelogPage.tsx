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
