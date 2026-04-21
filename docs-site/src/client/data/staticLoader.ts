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

// Use import.meta.glob to load all markdown files
// Files are copied to docs-site/.claude/ during build (see deploy-docs.yml)
const commandModules = import.meta.glob('/.claude/commands/*.md', { query: '?raw', import: 'default' });
const claudeSkillModules = import.meta.glob('/.claude/skills/*/SKILL.md', { query: '?raw', import: 'default' });
const codexSkillModules = import.meta.glob('/.codex/skills/*/SKILL.md', { query: '?raw', import: 'default' });

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
    allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
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
    allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
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
    // Extract command name from path (e.g., /.claude/commands/maestro-init.md -> maestro-init)
    const name = path.replace('/.claude/commands/', '').replace('.md', '');
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
    // Extract skill name from path (e.g., /.claude/skills/team-lifecycle-v4/SKILL.md -> team-lifecycle-v4)
    const match = path.match(/\/\.claude\/skills\/([^/]+)\//);
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
    const match = path.match(/\/\.codex\/skills\/([^/]+)\//);
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
  const loader = commandModules[modulePath];

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

  const loader = modules[pattern];

  if (!loader) return null;

  try {
    const markdown = await loader() as string;
    return parseSkill(markdown);
  } catch {
    return null;
  }
}
