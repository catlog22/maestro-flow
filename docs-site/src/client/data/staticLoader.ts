// ---------------------------------------------------------------------------
// staticLoader — Vite-based static file loader for markdown content
// Uses import.meta.glob to load all command/skill files at build time
// ---------------------------------------------------------------------------

import { parseFrontmatter, extractXmlTags } from './contentParser.js';

export interface CommandContent {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  purpose?: string;
  requiredReading?: string;
  context?: string;
  execution?: string;
  errorCodes?: string;
  successCriteria?: string;
  rawContent: string;
}

export interface SkillContent {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  documentation: string;
  phases?: string[];
  roles?: string[];
  rawContent: string;
}

export interface GuideContent {
  slug: string;
  title: string;
  description: string;
  title_zh?: string;
  description_zh?: string;
  icon: string;
  rawContent: string;
}

// Guide registry — bilingual metadata for each guide
// file = Chinese content (default), file_en = English content (optional, falls back to file)
export const guideRegistry: Array<{
  slug: string;
  file: string;
  file_en?: string;
  title: string;
  description: string;
  title_zh: string;
  description_zh: string;
  icon: string;
}> = [
  {
    slug: 'command-usage',
    file: 'command-usage-guide.md',
    file_en: 'command-usage-guide.en.md',
    title: 'Command Usage Guide',
    description: 'Complete guide to all 51 commands with workflow diagrams and usage examples',
    title_zh: '命令使用指南',
    description_zh: '51 个命令的完整使用指南，包含工作流图和命令衔接说明',
    icon: 'book-open',
  },
  {
    slug: 'spec-system',
    file: 'spec-system-guide.md',
    file_en: 'spec-system-guide.en.md',
    title: 'Spec System Guide',
    description: 'Project specs with <spec-entry> closed-tag format, keyword loading, validation hooks',
    title_zh: 'Spec 系统指南',
    description_zh: '<spec-entry> 闭合标签格式、keyword 加载、验证 Hook、session dedup 注入',
    icon: 'sparkles',
  },
  {
    slug: 'spec-injection',
    file: 'spec-injection-guide.md',
    file_en: 'spec-injection-guide.en.md',
    title: 'Spec Injection Configuration',
    description: 'Keyword-granularity injection control, extra document binding, agent mapping overrides, CLI/TUI/Dashboard configuration',
    title_zh: 'Spec 注入配置指南',
    description_zh: 'keyword 颗粒度注入控制、额外文档绑定、agent 映射覆盖、CLI/TUI/Dashboard 三端配置',
    icon: 'sliders',
  },
  {
    slug: 'spec-analytics',
    file: 'spec-analytics-guide.md',
    file_en: 'spec-analytics-guide.en.md',
    title: 'Spec Analytics Guide',
    description: 'Injection logging, hit rate statistics, keyword analysis, hook invocation tracking, and TUI visualization',
    title_zh: 'Spec 分析系统指南',
    description_zh: '注入日志、命中率统计、关键词分析、Hook 调用追踪、TUI 可视化',
    icon: 'bar-chart-2',
  },
  {
    slug: 'overlay',
    file: 'overlay-guide.md',
    file_en: 'overlay-guide.en.md',
    title: 'Overlay System Guide',
    description: 'Non-invasive command extension with JSON patches and idempotent injection',
    title_zh: 'Overlay 系统指南',
    description_zh: '非侵入式命令扩展机制 — JSON 补丁注入，幂等且可逆',
    icon: 'layers',
  },
  {
    slug: 'worktree',
    file: 'worktree-guide.md',
    file_en: 'worktree-guide.en.md',
    title: 'Worktree Parallel Development',
    description: 'Milestone-level parallel development using git worktrees',
    title_zh: 'Worktree 并行开发指南',
    description_zh: '基于 git worktree 的里程碑级并行开发',
    icon: 'git-branch',
  },
  {
    slug: 'hooks-codex',
    file: 'hooks-guide-codex.md',
    file_en: 'hooks-guide-codex.en.md',
    title: 'Codex Hooks Integration',
    description: 'Hooks integration design for OpenAI Codex CLI',
    title_zh: 'Codex Hooks 集成设计',
    description_zh: '为 OpenAI Codex CLI 设计的 hooks 集成方案',
    icon: 'hook',
  },
  {
    slug: 'quick-start',
    file: 'quick-start-guide.md',
    file_en: 'quick-start-guide.en.md',
    title: 'Quick Start Guide',
    description: 'Get started with Maestro Flow in 10 minutes — core features and common workflows',
    title_zh: '快速入门指南',
    description_zh: '10 分钟了解 Maestro Flow 核心功能 — 安装、管线、Issue、委托、规范、Overlay、Hook、并行开发',
    icon: 'rocket',
  },
  {
    slug: 'hooks',
    file: 'hooks-guide.md',
    file_en: 'hooks-guide.en.md',
    title: 'Hooks System Guide',
    description: 'Complete guide to the Maestro hooks system for Claude Code',
    title_zh: 'Hooks 系统指南',
    description_zh: 'Maestro hooks 系统的完整使用指南',
    icon: 'zap',
  },
  {
    slug: 'delegate-async',
    file: 'delegate-async-guide.md',
    file_en: 'delegate-async-guide.en.md',
    title: 'Async Delegate Guide',
    description: 'Asynchronous task delegation with broker-managed lifecycle',
    title_zh: '异步委派指南',
    description_zh: '异步任务委派与 broker 生命周期管理',
    icon: 'send',
  },
  {
    slug: 'team-lite-usage',
    file: 'team-lite-guide.md',
    file_en: 'team-lite-guide.en.md',
    title: 'Team Lite Usage Guide',
    description: 'Practical usage guide for Team Lite collaboration features',
    title_zh: 'Team Lite 使用指南',
    description_zh: 'Team Lite 协作功能的实际使用指南',
    icon: 'handshake',
  },
  {
    slug: 'mcp-tools',
    file: 'mcp-tools-guide.md',
    file_en: 'mcp-tools-guide.en.md',
    title: 'MCP Tools Reference',
    description: 'Complete reference for all 9 MCP tools — file operations, team collaboration, and persistent memory',
    title_zh: 'MCP 工具参考',
    description_zh: '全部 9 个 MCP 工具的完整参考 — 文件操作、团队协作和持久记忆',
    icon: 'wrench',
  },
  {
    slug: 'cli-commands',
    file: 'cli-commands-guide.md',
    file_en: 'cli-commands-guide.en.md',
    title: 'CLI Commands Reference',
    description: 'All 21 terminal commands — install, delegate, coordinate, wiki, hooks, overlay, collab, and more',
    title_zh: 'CLI 命令参考',
    description_zh: '全部 21 个终端命令 — 安装、委派、协调、Wiki、Hook、Overlay、协作等',
    icon: 'terminal',
  },
  {
    slug: 'role-routing',
    file: 'role-routing-guide.md',
    file_en: 'role-routing-guide.en.md',
    title: 'Role Routing & Tool Config',
    description: 'Role-based CLI tool routing — 7 fixed roles, fallback chains, domain tags, workspace overrides',
    title_zh: '角色路由与工具配置',
    description_zh: '基于角色的 CLI 工具路由 — 7 个固定角色、fallback chain、domain tags、工作空间覆盖',
    icon: 'shuffle',
  },
  {
    slug: 'skill-config',
    file: 'skill-config-guide.md',
    file_en: 'skill-config-guide.en.md',
    title: 'Skill Config Guide',
    description: 'Per-skill parameter defaults with TUI editor and hook-based auto-injection',
    title_zh: 'Skill 参数配置指南',
    description_zh: '为 51 个命令设置默认参数 — TUI 编辑器、Hook 自动注入、双层级作用域',
    icon: 'sliders',
  },
  {
    slug: 'maestro-coordinator',
    file: 'maestro-coordinator-guide.md',
    file_en: 'maestro-coordinator-guide.en.md',
    title: 'Maestro Coordinator Guide',
    description: 'Static chain selector — intent analysis, chain routing, unified executor dispatch',
    title_zh: 'Maestro 智能协调器指南',
    description_zh: '静态 chain 选择器 — 意图分析、链路由、统一执行器派发',
    icon: 'compass',
  },
  {
    slug: 'maestro-ralph',
    file: 'maestro-ralph-guide.md',
    file_en: 'maestro-ralph-guide.en.md',
    title: 'Maestro Ralph Lifecycle Engine',
    description: 'Adaptive lifecycle engine — closed-loop cycling with decision nodes, auto debug-fix retry',
    title_zh: 'Maestro Ralph 生命周期引擎指南',
    description_zh: '自适应生命周期引擎 — decision 节点闭环循环、自动 debug-fix 重试',
    icon: 'refresh-cw',
  },
  {
    slug: 'workflow-structure',
    file: 'workflow-structure-guide.md',
    file_en: 'workflow-structure-guide.en.md',
    title: 'Workflow Directory Structure',
    description: 'Complete reference for .workflow/ directory — artifact paths, state.json schema, naming conventions',
    title_zh: '产物目录体系指南',
    description_zh: '.workflow/ 完整目录结构参考 — 产物路径、state.json Schema、命名规则速查',
    icon: 'folder-tree',
  },
  {
    slug: 'learn-tools',
    file: 'learn-tools-guide.md',
    file_en: 'learn-tools-guide.en.md',
    title: 'Learning Toolkit Guide',
    description: 'Interactive deep learning commands — retro, follow, decompose, second opinion, investigate',
    title_zh: '学习工具集指南',
    description_zh: '交互式深度学习命令 — 复盘、跟读、模式拆解、多视角分析、系统化探究',
    icon: 'graduation-cap',
  },
  {
    slug: 'quality-pipeline',
    file: 'quality-pipeline-guide.md',
    file_en: 'quality-pipeline-guide.en.md',
    title: 'Quality Pipeline Guide',
    description: 'Review, test, debug, refactor, sync, and retrospective — the complete quality closed loop',
    title_zh: '质量管线指南',
    description_zh: '审查、测试、调试、重构、同步、复盘 — 完整的质量闭环',
    icon: 'shield-check',
  },
  {
    slug: 'harvest',
    file: 'harvest-guide.md',
    file_en: 'harvest-guide.en.md',
    title: 'Knowledge Harvest Guide',
    description: 'Knowledge extraction and routing — scan, session, path modes with source registry',
    title_zh: '知识回收指南',
    description_zh: '知识提取与路由 — scan/session/path 三种模式、source registry、去重逻辑',
    icon: 'wheat',
  },
  {
    slug: 'ui-production',
    file: 'ui-production-guide.md',
    file_en: 'ui-production-guide.en.md',
    title: 'UI Production Pipeline',
    description: 'Design → Craft → Codify — score-driven automated UI production with critique loops',
    title_zh: 'UI 生产系统指南',
    description_zh: 'Design → Craft → Codify — 评分驱动的自动化 UI 生产管线',
    icon: 'palette',
  },
  {
    slug: 'issue-discover',
    file: 'issue-discover-guide.md',
    file_en: 'issue-discover-guide.en.md',
    title: 'Issue Discovery Guide',
    description: '8-perspective scanning and by-prompt discovery for comprehensive issue detection',
    title_zh: '问题发现指南',
    description_zh: '8 视角全扫描和 by-prompt 发现模式的完整问题检测流程',
    icon: 'search',
  },
  {
    slug: 'misc-commands',
    file: 'misc-commands-guide.md',
    file_en: 'misc-commands-guide.en.md',
    title: 'Miscellaneous Commands',
    description: 'amend, update, spec-remove, milestone-release — supplementary workflow commands',
    title_zh: '杂项命令指南',
    description_zh: 'amend、update、spec-remove、milestone-release — 补充工作流命令',
    icon: 'tool',
  },
  {
    slug: 'statusline',
    file: 'statusline-guide.md',
    file_en: 'statusline-guide.en.md',
    title: 'Statusline Guide',
    description: 'Claude Code custom statusline — model, tokens, git status, context usage, milestone tracking',
    title_zh: 'Statusline 状态栏指南',
    description_zh: 'Claude Code 自定义状态栏 — 模型、Token、Git、上下文、里程碑追踪',
    icon: 'monitor',
  },
  {
    slug: 'knowledge-management',
    file: 'knowledge-management-guide.md',
    file_en: 'knowledge-management-guide.en.md',
    title: 'Knowledge Management System',
    description: 'Two knowledge types: constraints (specs) and accumulation (knowhow) — forced loading vs on-demand retrieval',
    title_zh: '知识沉淀管理系统',
    description_zh: '约束（Spec）与积累（Knowhow）两种知识 — 强制加载与按需检索',
    icon: 'brain',
  },
  {
    slug: 'team-lite-design',
    file: 'team-lite-design.md',
    file_en: 'team-lite-design.en.md',
    title: 'Team Lite Design',
    description: 'Minimal collaboration extension for 2-8 person teams — Git-native, file-driven, advisory',
    title_zh: 'Team Lite 协作方案设计',
    description_zh: '面向 2-8 人小团队的极简协作扩展 — Git-native + 文件驱动 + advisory',
    icon: 'users',
  },
  {
    slug: 'antigravity-tools',
    file: 'antigravity_tools_guide.md',
    file_en: 'antigravity_tools_guide.en.md',
    title: 'Antigravity Tools Guide',
    description: 'Antigravity AI assistant available tools with parameters and schema',
    title_zh: 'Antigravity 工具指南',
    description_zh: 'Antigravity AI 助手可用工具，包含参数和 Schema',
    icon: 'rocket',
  },
  {
    slug: 'workflow-enhancement',
    file: 'workflow-enhancement-guide.md',
    file_en: 'workflow-enhancement-guide.en.md',
    title: 'Workflow Enhancement Guide',
    description: 'Dynamic adversarial workflow generation and parallel workflow acceleration',
    title_zh: '工作流增强指南',
    description_zh: '动态对抗工作流生成和并行工作流加速',
    icon: 'workflow',
  },
  {
    slug: 'security-audit',
    file: 'security-audit-guide.md',
    file_en: 'security-audit-guide.en.md',
    title: 'Security Audit Guide',
    description: 'OWASP Top 10, STRIDE threat modeling, and supply chain analysis',
    title_zh: '安全审计指南',
    description_zh: 'OWASP Top 10、STRIDE 威胁建模和供应链分析',
    icon: 'shield',
  },
  {
    slug: 'team-swarm',
    file: 'team-swarm-guide.md',
    file_en: 'team-swarm-guide.en.md',
    title: 'Team Swarm Intelligence Guide',
    description: 'ACO swarm optimization with adversarial decision patterns',
    title_zh: '团队蚁群智能指南',
    description_zh: 'ACO 蚁群优化与对抗决策模式',
    icon: 'bug',
  },
];

// Use import.meta.glob to load all markdown files
// Files are copied to docs-site/.claude/ during build (see deploy-docs.yml)
const commandModules = import.meta.glob('/.claude/commands/*.md', { query: '?raw', import: 'default' });
const claudeSkillModules = import.meta.glob('/.claude/skills/*/SKILL.md', { query: '?raw', import: 'default' });
const codexSkillModules = import.meta.glob('/.codex/skills/*/SKILL.md', { query: '?raw', import: 'default' });
const guideModules = import.meta.glob('/guides/*.md', { query: '?raw', import: 'default' });

/**
 * Normalize allowedTools — frontmatter may be a string or an array
 */
function normalizeTools(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((s: string) => s.trim()).filter(Boolean);
  return undefined;
}

/**
 * Parse command markdown content
 */
function parseCommand(markdown: string): CommandContent {
  const { frontmatter, content } = parseFrontmatter(markdown);
  const xmlTags = extractXmlTags(content);

  return {
    name: String(frontmatter.name || ''),
    description: String(frontmatter.description || ''),
    argumentHint: frontmatter['argument-hint'] as string | undefined,
    allowedTools: normalizeTools(frontmatter['allowed-tools']),
    purpose: xmlTags.purpose,
    requiredReading: xmlTags.required_reading,
    context: xmlTags.context,
    execution: xmlTags.execution,
    errorCodes: xmlTags.error_codes,
    successCriteria: xmlTags.success_criteria,
    rawContent: content,
  };
}

/**
 * Parse skill markdown content
 */
function parseSkill(markdown: string): SkillContent {
  const { frontmatter, content } = parseFrontmatter(markdown);

  // Extract roles from content
  const roles = extractRoles(content);
  const phases = extractPhases(content);

  return {
    name: String(frontmatter.name || ''),
    description: String(frontmatter.description || ''),
    argumentHint: frontmatter['argument-hint'] as string | undefined,
    allowedTools: normalizeTools(frontmatter['allowed-tools']),
    documentation: content,
    roles,
    phases,
    rawContent: content,
  };
}

/**
 * Extract role names from role registry table
 */
function extractRoles(content: string): string[] | undefined {
  const tableRegex = /\|\s*Role\s*\|[\s\S]*?\|[\s\S]*?\n\n/;
  const match = content.match(tableRegex);

  if (!match) return undefined;

  const roles: string[] = [];
  const lines = match[0].split('\n');

  for (const line of lines) {
    if (line.includes('---') || line.includes('Role') || !line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length > 1 && parts[1] && parts[1] !== 'Role') {
      roles.push(parts[1]);
    }
  }

  return roles.length > 0 ? roles : undefined;
}

/**
 * Extract phase names from content
 */
function extractPhases(content: string): string[] | undefined {
  const phases: string[] = [];

  // Look for phase list format
  const phaseRegex = /(?:Phase\s+\d+:|###\s+Phase[\s-]?[\d\w]+)\s*(.+?)(?:\n|$)/gi;
  const matches = content.matchAll(phaseRegex);
  for (const match of matches) {
    if (match[1]) phases.push(match[1].trim());
  }

  // Also look for pipeline diagram format
  const pipelineRegex = /([a-z-]+)\s*──/gi;
  const pipelineMatches = content.matchAll(pipelineRegex);
  for (const match of pipelineMatches) {
    const phase = match[1].trim();
    if (phase && !phases.includes(phase)) phases.push(phase);
  }

  return phases.length > 0 ? phases : undefined;
}

/**
 * Get all commands as a map
 */
export async function getAllCommands(): Promise<Map<string, CommandContent>> {
  const commands = new Map<string, CommandContent>();

  const promises = Object.entries(commandModules).map(async ([path, loader]) => {
    const markdown = await loader() as string;
    const parsed = parseCommand(markdown);
    // Extract command name from path (e.g., .claude/commands/maestro-init.md -> maestro-init)
    const name = path.replace(/^\/?\.claude\/commands\//, '').replace('.md', '');
    commands.set(name, parsed);
  });

  await Promise.all(promises);
  return commands;
}

/**
 * Get all Claude skills as a map
 */
export async function getAllClaudeSkills(): Promise<Map<string, SkillContent>> {
  const skills = new Map<string, SkillContent>();

  const promises = Object.entries(claudeSkillModules).map(async ([path, loader]) => {
    const markdown = await loader() as string;
    const parsed = parseSkill(markdown);
    // Extract skill name from path (e.g., .claude/skills/team-lifecycle-v4/SKILL.md -> team-lifecycle-v4)
    const match = path.match(/\.claude\/skills\/([^/]+)\//);
    if (match) {
      skills.set(match[1], parsed);
    }
  });

  await Promise.all(promises);
  return skills;
}

/**
 * Get all Codex skills as a map
 */
export async function getAllCodexSkills(): Promise<Map<string, SkillContent>> {
  const skills = new Map<string, SkillContent>();

  const promises = Object.entries(codexSkillModules).map(async ([path, loader]) => {
    const markdown = await loader() as string;
    const parsed = parseSkill(markdown);
    // Extract skill name from path
    const match = path.match(/\.codex\/skills\/([^/]+)\//);
    if (match) {
      skills.set(match[1], parsed);
    }
  });

  await Promise.all(promises);
  return skills;
}

/**
 * Load a single command by name
 */
export async function loadCommand(commandName: string): Promise<CommandContent | null> {
  const modulePath = `/.claude/commands/${commandName}.md`;
  const loader = commandModules[modulePath] || commandModules[modulePath.replace(/^\//, '')];

  if (!loader) return null;

  try {
    const markdown = await loader() as string;
    return parseCommand(markdown);
  } catch {
    return null;
  }
}

/**
 * Load a single skill by type and name
 */
export async function loadSkill(
  skillType: 'claude' | 'codex',
  skillName: string
): Promise<SkillContent | null> {
  const modules = skillType === 'claude' ? claudeSkillModules : codexSkillModules;
  const pattern = skillType === 'claude'
    ? `/.claude/skills/${skillName}/SKILL.md`
    : `/.codex/skills/${skillName}/SKILL.md`;

  const loader = modules[pattern] || modules[pattern.replace(/^\//, '')];

  if (!loader) return null;

  try {
    const markdown = await loader() as string;
    return parseSkill(markdown);
  } catch {
    return null;
  }
}

/**
 * Load a single guide by slug, with locale-aware file selection.
 * For 'en' locale: tries file_en first, falls back to file (Chinese).
 * For 'zh-CN' locale: uses file directly.
 */
export async function loadGuide(slug: string, locale: string = 'zh-CN'): Promise<GuideContent | null> {
  const entry = guideRegistry.find(g => g.slug === slug);
  if (!entry) return null;

  // Determine which file to load
  const isEn = locale === 'en';
  const targetFile = isEn && entry.file_en ? entry.file_en : entry.file;

  const modulePath = `/guides/${targetFile}`;
  const loader = guideModules[modulePath] || guideModules[modulePath.replace(/^\//, '')];

  // If English file not found, fall back to Chinese
  const fallbackPath = `/guides/${entry.file}`;
  const finalLoader = loader || guideModules[fallbackPath] || guideModules[fallbackPath.replace(/^\//, '')];

  if (!finalLoader) return null;

  try {
    const markdown = await finalLoader() as string;
    return {
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      title_zh: entry.title_zh,
      description_zh: entry.description_zh,
      icon: entry.icon,
      rawContent: markdown,
    };
  } catch {
    return null;
  }
}

/**
 * Get all guide metadata (without loading full content)
 */
export function getAllGuideMeta() {
  return guideRegistry;
}
