// ---------------------------------------------------------------------------
// skillLoader — Load and parse skill markdown files
// ---------------------------------------------------------------------------

import { parseFrontmatter } from './contentParser.js';

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

/**
 * Load a Claude skill by name
 * @param skillName - Name of the skill (e.g., "team-lifecycle-v4")
 * @returns Parsed skill content or null if not found
 */
export async function loadClaudeSkill(skillName: string): Promise<SkillContent | null> {
  try {
    const response = await fetch(`/.claude/skills/${skillName}/SKILL.md`);
    if (!response.ok) {
      return null;
    }

    const markdown = await response.text();
    return parseSkill(markdown);
  } catch (error) {
    console.error(`Failed to load Claude skill: ${skillName}`, error);
    return null;
  }
}

/**
 * Load a Codex skill by name
 * @param skillName - Name of the skill (e.g., "maestro-init")
 * @returns Parsed skill content or null if not found
 */
export async function loadCodexSkill(skillName: string): Promise<SkillContent | null> {
  try {
    const response = await fetch(`/.codex/skills/${skillName}/SKILL.md`);
    if (!response.ok) {
      return null;
    }

    const markdown = await response.text();
    return parseSkill(markdown);
  } catch (error) {
    console.error(`Failed to load Codex skill: ${skillName}`, error);
    return null;
  }
}

/**
 * Parse skill markdown content
 */
export function parseSkill(markdown: string): SkillContent {
  const { frontmatter, content } = parseFrontmatter(markdown);

  // Extract roles from content (from role registry table)
  const roles = extractRoles(content);
  // Extract phases from content
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
 * Extract role names from a role registry table
 */
function extractRoles(content: string): string[] | undefined {
  // Look for role registry table format
  const tableRegex = /\|\s*Role\s*\|[\s\S]*?\|[\s\S]*?\n\n/;
  const match = content.match(tableRegex);

  if (!match) {
    return undefined;
  }

  const roles: string[] = [];
  const lines = match[0].split('\n');

  for (const line of lines) {
    // Skip header and separator
    if (line.includes('---') || line.includes('Role') || !line.includes('|')) {
      continue;
    }

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
  // Look for phase list or diagram
  const phaseRegex = /(?:Phase\s+\d+:|###\s+Phase[\s-]?[\d\w]+)\s*(.+?)(?:\n|$)/gi;
  const matches = content.matchAll(phaseRegex);

  const phases: string[] = [];
  for (const match of matches) {
    if (match[1]) {
      phases.push(match[1].trim());
    }
  }

  // Also look for pipeline diagram format
  const pipelineRegex = /([a-z-]+)\s*──/gi;
  const pipelineMatches = content.matchAll(pipelineRegex);
  for (const match of pipelineMatches) {
    const phase = match[1].trim();
    if (phase && !phases.includes(phase)) {
      phases.push(phase);
    }
  }

  return phases.length > 0 ? phases : undefined;
}

/**
 * Load skill by type and name
 */
export async function loadSkill(
  skillType: 'claude' | 'codex',
  skillName: string
): Promise<SkillContent | null> {
  return skillType === 'claude' ? loadClaudeSkill(skillName) : loadCodexSkill(skillName);
}

/**
 * Preload commonly used skills
 */
export async function preloadSkills(): Promise<void> {
  const commonSkills = [
    { type: 'claude' as const, name: 'team-lifecycle-v4' },
  ];

  await Promise.all(
    commonSkills.map(({ type, name }) => loadSkill(type, name))
  );
}
