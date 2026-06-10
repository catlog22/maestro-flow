// ---------------------------------------------------------------------------
// commandLoader — Load and parse command markdown files
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

/**
 * Load a command file by name
 * @param commandName - Name of the command (e.g., "maestro-init")
 * @returns Parsed command content or null if not found
 */
export async function loadCommand(commandName: string): Promise<CommandContent | null> {
  try {
    // Try to fetch from the commands directory
    const response = await fetch(`/.claude/commands/${commandName}.md`);
    if (!response.ok) {
      return null;
    }

    const markdown = await response.text();
    return parseCommand(markdown);
  } catch (error) {
    console.error(`Failed to load command: ${commandName}`, error);
    return null;
  }
}

/**
 * Parse command markdown content
 */
export function parseCommand(markdown: string): CommandContent {
  const { frontmatter, content } = parseFrontmatter(markdown);

  // Extract XML tags from content
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
 * Get multiple commands at once
 */
export async function loadCommands(commandNames: string[]): Promise<Map<string, CommandContent>> {
  const commands = new Map<string, CommandContent>();

  await Promise.all(
    commandNames.map(async (name) => {
      const content = await loadCommand(name);
      if (content) {
        commands.set(name, content);
      }
    })
  );

  return commands;
}

/**
 * Preload commonly used commands
 */
export async function preloadCommands(): Promise<void> {
  const commonCommands = [
    'maestro',
    'maestro-init',
    'maestro-plan',
    'maestro-execute',
    'maestro-quick',
    'maestro-brainstorm',
    'maestro-analyze',
    'maestro-collab',
    'spec-setup',
    'quality-test',
    'quality-debug',
    'manage-status',
  ];

  await loadCommands(commonCommands);
}
