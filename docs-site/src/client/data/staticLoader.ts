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

// Guide category definitions
export interface GuideCategory {
  id: string;
  title: string;
  title_zh: string;
  description: string;
  description_zh: string;
}

export const guideCategories: GuideCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    title_zh: '入门上手',
    description: 'Install, first workflow, and core concepts',
    description_zh: '安装、第一个工作流、核心概念',
  },
  {
    id: 'core',
    title: 'Core Usage',
    title_zh: '核心功能',
    description: 'Daily commands, quality pipeline, and knowledge management',
    description_zh: '日常命令、质量管线、知识管理',
  },
  {
    id: 'orchestration',
    title: 'Orchestration',
    title_zh: '编排调度',
    description: 'Multi-agent coordination, delegation, and team patterns',
    description_zh: '多 Agent 协调、委派、团队协作模式',
  },
  {
    id: 'knowledge',
    title: 'Knowledge System',
    title_zh: '知识系统',
    description: 'Knowledge persistence, search, learning, and discovery',
    description_zh: '知识沉淀、搜索、学习、问题发现',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    title_zh: '进阶配置',
    description: 'Configuration, extensions, security, and internals',
    description_zh: '配置、扩展、安全、内部架构',
  },
];

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
  category: string;
}> = [
  // ─── Getting Started ───────────────────────────────────────────────────────
  {
    slug: 'quick-start',
    file: 'quick-start-guide.md',
    file_en: 'quick-start-guide.en.md',
    title: 'Quick Start',
    description: 'Get started in 10 minutes — install, first workflow, key concepts',
    title_zh: '10 分钟快速入门',
    description_zh: '安装 → 第一个工作流 → 核心概念，最短路径上手',
    icon: 'rocket',
    category: 'getting-started',
  },
  {
    slug: 'install',
    file: 'install-guide.md',
    title: 'Install & Setup',
    description: 'CLI install, component selection, workspace initialization, and verification',
    title_zh: '安装与初始化',
    description_zh: 'CLI 安装、组件选择、工作空间初始化、验证步骤',
    icon: 'download',
    category: 'getting-started',
  },
  {
    slug: 'maestro-ralph',
    file: 'maestro-ralph-guide.md',
    file_en: 'maestro-ralph-guide.en.md',
    title: 'Ralph v2 Engine & Coordinator',
    description: 'Adaptive lifecycle engine + static coordinator — decision nodes, quality modes, intent routing, chain selection',
    title_zh: 'Ralph v2 引擎与协调器',
    description_zh: '自适应生命周期引擎 + 静态协调器 — decision 节点、质量模式、意图路由、链选择',
    icon: 'refresh-cw',
    category: 'getting-started',
  },
  {
    slug: 'command-usage',
    file: 'command-usage-guide.md',
    file_en: 'command-usage-guide.en.md',
    title: 'All Commands & Workflows',
    description: '64 slash commands + supplementary commands, with workflow diagrams and pipeline chaining',
    title_zh: '全部命令与工作流',
    description_zh: '64 个斜杠命令 + 辅助命令，含工作流图和管线衔接',
    icon: 'book-open',
    category: 'getting-started',
  },
  // ─── Core Usage ────────────────────────────────────────────────────────────
  {
    slug: 'cli-commands',
    file: 'cli-commands-guide.md',
    file_en: 'cli-commands-guide.en.md',
    title: 'CLI Quick Reference',
    description: '35+ terminal commands at a glance — install, delegate, search, wiki, hooks, overlay',
    title_zh: 'CLI 命令速查',
    description_zh: '35+ 终端命令一览 — 安装、委派、搜索、Wiki、Hook、Overlay',
    icon: 'terminal',
    category: 'core',
  },
  {
    slug: 'quality-pipeline',
    file: 'quality-pipeline-guide.md',
    file_en: 'quality-pipeline-guide.en.md',
    title: 'Quality Pipeline',
    description: 'verify → review → test three-tier quality gate, plus debug, refactor, and retrospective',
    title_zh: '质量管线',
    description_zh: 'verify → review → test 三级质量门，及调试、重构、复盘',
    icon: 'shield-check',
    category: 'core',
  },
  {
    slug: 'knowledge-management',
    file: 'knowledge-management-guide.md',
    file_en: 'knowledge-management-guide.en.md',
    title: 'Knowledge & Spec System',
    description: 'Spec constraints + Knowhow accumulation — injection rules, config, analytics, and knowledge lifecycle',
    title_zh: '知识管理与 Spec 系统',
    description_zh: 'Spec 约束 + Knowhow 积累 — 注入规则、配置、分析、知识生命周期',
    icon: 'brain',
    category: 'core',
  },
  {
    slug: 'explore',
    file: 'explore-guide.md',
    title: 'Explore & MOA Search',
    description: 'Lightweight code search (single/multi-prompt) + MOA multi-model aggregation mode',
    title_zh: 'Explore 搜索与 MOA 聚合',
    description_zh: '轻量代码搜索（单/多 prompt）+ MOA 多模型聚合模式',
    icon: 'search',
    category: 'core',
  },
  {
    slug: 'issue-discover',
    file: 'issue-discover-guide.md',
    file_en: 'issue-discover-guide.en.md',
    title: 'Issue Discovery',
    description: '8-perspective scanning and by-prompt discovery for comprehensive issue detection',
    title_zh: '问题发现与扫描',
    description_zh: '8 视角全扫描 + by-prompt 发现模式',
    icon: 'search',
    category: 'core',
  },
  // ─── Orchestration ─────────────────────────────────────────────────────────
  {
    slug: 'delegate-async',
    file: 'delegate-async-guide.md',
    file_en: 'delegate-async-guide.en.md',
    title: 'Async Delegation',
    description: 'Cross-CLI task dispatch with broker lifecycle, message injection, and chaining',
    title_zh: '跨 CLI 异步委派',
    description_zh: '跨 CLI 任务派发、broker 生命周期、消息注入、链式调用',
    icon: 'send',
    category: 'orchestration',
  },
  {
    slug: 'team-lite',
    file: 'team-lite-guide.md',
    title: 'Team Collaboration',
    description: 'Git-native collaboration for small teams (2-8 people)',
    title_zh: '小团队协作',
    description_zh: '面向 2-8 人的 Git-native 协作扩展',
    icon: 'users',
    category: 'orchestration',
  },
  {
    slug: 'team-swarm',
    file: 'team-swarm-guide.md',
    file_en: 'team-swarm-guide.en.md',
    title: 'Swarm Intelligence',
    description: 'ACO-driven multi-agent exploration with adversarial decision patterns',
    title_zh: '蚁群智能探索',
    description_zh: 'ACO 驱动的多 Agent 探索与对抗决策',
    icon: 'bug',
    category: 'orchestration',
  },
  // ─── Knowledge System ──────────────────────────────────────────────────────
  {
    slug: 'learn-tools',
    file: 'learn-tools-guide.md',
    file_en: 'learn-tools-guide.en.md',
    title: 'Learning Toolkit',
    description: 'Five interactive commands — retro, follow, decompose, second opinion, investigate',
    title_zh: '学习五件套',
    description_zh: '复盘、跟读、模式拆解、多视角分析、系统化探究',
    icon: 'graduation-cap',
    category: 'knowledge',
  },
  {
    slug: 'harvest',
    file: 'harvest-guide.md',
    file_en: 'harvest-guide.en.md',
    title: 'Knowledge Harvest',
    description: 'Extract knowledge from artifacts — scan, session, path modes with dedup',
    title_zh: '知识提取与回收',
    description_zh: '从产物中提取知识 — scan/session/path 三模式、去重',
    icon: 'wheat',
    category: 'knowledge',
  },
  {
    slug: 'embedding',
    file: 'embedding-guide.md',
    file_en: 'embedding-guide.en.md',
    title: 'Semantic Search (Embedding)',
    description: 'ONNX-based embedding search — device detection, RRF fusion, incremental indexing',
    title_zh: '语义搜索（Embedding）',
    description_zh: '基于 ONNX 的向量搜索 — 设备检测、RRF 融合、增量索引',
    icon: 'cpu',
    category: 'knowledge',
  },
  // ─── Advanced ──────────────────────────────────────────────────────────────
  {
    slug: 'config-reference',
    file: 'tools-config-guide.md',
    title: 'Configuration Reference',
    description: 'All config files — role routing, hooks, overlays, search, workspace, worktree, skill params',
    title_zh: '配置参考大全',
    description_zh: '全部配置项 — 角色路由、Hook、Overlay、搜索、工作空间、Worktree、Skill 参数',
    icon: 'settings',
    category: 'advanced',
  },
  {
    slug: 'workflow-structure',
    file: 'workflow-structure-guide.md',
    file_en: 'workflow-structure-guide.en.md',
    title: 'Workflow Directory Layout',
    description: '.workflow/ structure — artifact paths, state.json schema, naming conventions',
    title_zh: '产物目录结构',
    description_zh: '.workflow/ 目录布局、state.json Schema、命名规则',
    icon: 'folder-tree',
    category: 'advanced',
  },
  {
    slug: 'mcp-tools',
    file: 'mcp-tools-guide.md',
    file_en: 'mcp-tools-guide.en.md',
    title: 'MCP Tools Reference',
    description: 'All 9 MCP endpoint tools — file operations, team messaging, persistent memory',
    title_zh: 'MCP 工具参考',
    description_zh: '9 个 MCP 工具 — 文件操作、团队消息、持久记忆',
    icon: 'wrench',
    category: 'advanced',
  },
  {
    slug: 'ui-production',
    file: 'ui-production-guide.md',
    file_en: 'ui-production-guide.en.md',
    title: 'UI Production Pipeline',
    description: 'Design → Craft → Codify automated pipeline with score-driven critique loops',
    title_zh: 'UI 自动化生产管线',
    description_zh: 'Design → Craft → Codify 评分驱动的自动化 UI 管线',
    icon: 'palette',
    category: 'advanced',
  },
  {
    slug: 'security-audit',
    file: 'security-audit-guide.md',
    file_en: 'security-audit-guide.en.md',
    title: 'Security Audit',
    description: 'OWASP Top 10, STRIDE threat modeling, and supply chain analysis',
    title_zh: '安全审计',
    description_zh: 'OWASP Top 10、STRIDE 威胁建模、供应链分析',
    icon: 'shield',
    category: 'advanced',
  },
];

// Use import.meta.glob to load all markdown files
// Files are copied to docs-site/.claude/ during build (see deploy-docs.yml)
const commandModules = import.meta.glob('/.claude/commands/*.md', { query: '?raw', import: 'default' });
const claudeSkillModules = import.meta.glob('/.claude/skills/*/SKILL.md', { query: '?raw', import: 'default' });
const codexSkillModules = import.meta.glob('/.codex/skills/*/SKILL.md', { query: '?raw', import: 'default' });
const guideModules = import.meta.glob('/src/content/docs/guides/*.md', { query: '?raw', import: 'default' });
// English guide source — bilingual sibling directory. Preferred over legacy
// `guides/{file_en}` .en.md siblings (which are rarely present on disk).
const guideModulesEn = import.meta.glob('/src/content/docs/en/guides/*.md', { query: '?raw', import: 'default' });

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

  const isEn = locale === 'en';

  // Locale-aware fallback chain:
  //   en: en/guides/{file}  →  guides/{file_en}  →  guides/{file} (zh)
  //   zh: guides/{file}
  let finalLoader: (() => Promise<unknown>) | undefined;
  if (isEn) {
    const enPath = `/src/content/docs/en/guides/${entry.file}`;
    finalLoader = guideModulesEn[enPath] || guideModulesEn[enPath.replace(/^\//, '')];
    if (!finalLoader && entry.file_en) {
      const enSiblingPath = `/src/content/docs/guides/${entry.file_en}`;
      finalLoader = guideModules[enSiblingPath] || guideModules[enSiblingPath.replace(/^\//, '')];
    }
  }
  if (!finalLoader) {
    const zhPath = `/src/content/docs/guides/${entry.file}`;
    finalLoader = guideModules[zhPath] || guideModules[zhPath.replace(/^\//, '')];
  }

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
