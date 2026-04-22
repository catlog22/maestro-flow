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
    slug: 'team-lite',
    file: 'team-lite-design.md',
    file_en: 'team-lite-design.en.md',
    title: 'Team Lite Collaboration',
    description: 'Git-native team collaboration for 2-8 person teams with zero infrastructure',
    title_zh: 'Team Lite 协作方案',
    description_zh: '面向 2-8 人小团队的 Git-native 协作方案，零基础设施',
    icon: 'users',
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
    slug: 'introduction',
    file: 'maestro-flow-introduction.md',
    file_en: 'maestro-flow-introduction.en.md',
    title: 'Maestro Flow Introduction',
    description: 'Overview of Maestro Flow philosophy and command landscape',
    title_zh: 'Maestro Flow 介绍',
    description_zh: 'Maestro Flow 设计理念和命令全景概览',
    icon: 'sparkles',
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
