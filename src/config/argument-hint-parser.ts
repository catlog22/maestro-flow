// ---------------------------------------------------------------------------
// argument-hint parser — extracts structured SkillParamDef[] from command
// frontmatter `argument-hint` strings.
//
// Drives TUI form generation and skill config validation.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillParamDef {
  /** Parameter name as in argument-hint (e.g. "--auto-commit", "-y", "phase") */
  name: string;
  /** Derived type */
  type: 'boolean' | 'enum' | 'string' | 'number';
  /** Allowed values for enum type */
  choices?: string[];
  /** Short alias (e.g. "-y") */
  alias?: string;
  /** True for positional args */
  positional?: boolean;
  /** True if <required>, false if [optional] */
  required?: boolean;
}

export interface CommandDef {
  /** Command name from frontmatter */
  name: string;
  /** Raw argument-hint string */
  argumentHint: string;
  /** One-line description */
  description: string;
  /** Parsed parameter definitions */
  params: SkillParamDef[];
}

// ---------------------------------------------------------------------------
// Frontmatter extraction (minimal, no YAML dependency)
// ---------------------------------------------------------------------------

interface Frontmatter {
  name: string;
  description: string;
  argumentHint: string;
}

function extractFrontmatter(content: string): Frontmatter | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const block = fmMatch[1];
  const get = (key: string): string => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!m) return '';
    // Strip surrounding quotes
    return m[1].replace(/^["']|["']$/g, '').trim();
  };

  const name = get('name');
  if (!name) return null;

  return {
    name,
    description: get('description'),
    argumentHint: get('argument-hint'),
  };
}

// ---------------------------------------------------------------------------
// argument-hint tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize an argument-hint string into bracket-delimited or bare segments.
 *
 * Examples:
 *   "[phase] [--auto-commit] <path>"
 *   → ["[phase]", "[--auto-commit]", "<path>"]
 *
 *   "[--method agent|codex|auto]"
 *   → ["[--method agent|codex|auto]"]
 *
 *   "\"intent text\" [-y]"
 *   → ["\"intent text\"", "[-y]"]
 */
function tokenize(hint: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < hint.length) {
    // Skip whitespace
    while (i < hint.length && /\s/.test(hint[i])) i++;
    if (i >= hint.length) break;

    const ch = hint[i];

    if (ch === '[') {
      // Bracket-delimited optional
      const end = findMatchingBracket(hint, i, '[', ']');
      tokens.push(hint.slice(i, end + 1));
      i = end + 1;
    } else if (ch === '<') {
      // Angle-bracket required
      const end = findMatchingBracket(hint, i, '<', '>');
      tokens.push(hint.slice(i, end + 1));
      i = end + 1;
    } else if (ch === '"') {
      // Quoted positional
      const end = hint.indexOf('"', i + 1);
      if (end === -1) { tokens.push(hint.slice(i)); break; }
      tokens.push(hint.slice(i, end + 1));
      i = end + 1;
    } else {
      // Bare word (rare)
      const end = hint.indexOf(' ', i);
      if (end === -1) { tokens.push(hint.slice(i)); break; }
      tokens.push(hint.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

function findMatchingBracket(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return s.length - 1;
}

// ---------------------------------------------------------------------------
// Token → SkillParamDef parser
// ---------------------------------------------------------------------------

/**
 * Parse a single token into one or more SkillParamDef entries.
 *
 * Supported patterns:
 *   [--flag]                    → boolean
 *   [-y]                        → boolean
 *   [-y|-c]                     → multiple booleans
 *   [--name val1|val2|val3]     → enum
 *   [--name <placeholder>]      → string
 *   [--name N]                  → number
 *   [--name "text"]             → string
 *   [positional]                → positional string
 *   <positional>                → required positional string
 *   "quoted text"               → positional string
 *   [<subcommand> [options]]    → positional string (e.g. manage-issue)
 */
function parseToken(token: string): SkillParamDef[] {
  // Determine wrapping
  const isRequired = token.startsWith('<') && token.endsWith('>');
  const isOptional = token.startsWith('[') && token.endsWith(']');
  const isQuoted = token.startsWith('"') && token.endsWith('"');

  // Unwrap
  let inner: string;
  if (isOptional || isRequired) {
    inner = token.slice(1, -1).trim();
  } else if (isQuoted) {
    inner = token.slice(1, -1).trim();
    return [{ name: inner, type: 'string', positional: true, required: false }];
  } else {
    inner = token.trim();
  }

  // Handle grouped short flags: -y|-c
  if (/^-[a-zA-Z](\|-[a-zA-Z])+$/.test(inner)) {
    return inner.split('|').map(flag => ({
      name: flag,
      type: 'boolean' as const,
      required: false,
    }));
  }

  // Handle --flag or -x (standalone boolean)
  if (/^-{1,2}[a-zA-Z][\w-]*$/.test(inner)) {
    return [{ name: inner, type: 'boolean', required: isRequired }];
  }

  // Handle --name with value: split at first space
  const spaceIdx = inner.indexOf(' ');
  if (spaceIdx !== -1 && inner.startsWith('-')) {
    const paramName = inner.slice(0, spaceIdx);
    const valueSpec = inner.slice(spaceIdx + 1).trim();

    // Enum: val1|val2|val3 (no angle brackets, no N)
    if (valueSpec.includes('|') && !valueSpec.startsWith('<')) {
      const choices = valueSpec.split('|').map(c => c.trim());
      return [{ name: paramName, type: 'enum', choices, required: isRequired }];
    }

    // Number: single uppercase N or digits pattern
    if (/^N$/i.test(valueSpec)) {
      return [{ name: paramName, type: 'number', required: isRequired }];
    }

    // String: <placeholder> or "text" or other
    return [{ name: paramName, type: 'string', required: isRequired }];
  }

  // Handle special: nested brackets like <create|list|status|...>
  if (inner.includes('|') && !inner.startsWith('-')) {
    // Positional enum
    const choices = inner.split('|').map(c => c.trim().replace(/[<>\[\]]/g, ''));
    const name = choices.join('|').length > 30
      ? choices[0]
      : inner.replace(/[<>\[\]]/g, '');
    return [{ name, type: 'enum', choices, positional: true, required: isRequired }];
  }

  // Plain positional: [phase], <path>, [description], etc.
  // Strip nested angle brackets: [<version>] → version
  const cleaned = inner.replace(/[<>]/g, '').trim();
  if (!cleaned || cleaned.startsWith('[')) {
    // Complex nested optional like [<subcommand> [options]] — treat as string positional
    const first = cleaned.split(/\s/)[0] || 'arg';
    return [{ name: first, type: 'string', positional: true, required: isRequired }];
  }

  return [{ name: cleaned, type: 'string', positional: true, required: isRequired }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an argument-hint string into structured parameter definitions.
 */
export function parseArgumentHint(hint: string): SkillParamDef[] {
  if (!hint || !hint.trim()) return [];

  const tokens = tokenize(hint);
  const params: SkillParamDef[] = [];

  for (const token of tokens) {
    params.push(...parseToken(token));
  }

  return params;
}

/**
 * Load all command definitions from a `.claude/commands/` directory.
 * Returns a Map of command name → CommandDef.
 */
export function loadCommandDefs(commandsDir: string): Map<string, CommandDef> {
  const defs = new Map<string, CommandDef>();

  let files: string[];
  try {
    files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  } catch {
    return defs;
  }

  for (const file of files) {
    try {
      const content = readFileSync(join(commandsDir, file), 'utf8');
      const fm = extractFrontmatter(content);
      if (!fm) continue;

      defs.set(fm.name, {
        name: fm.name,
        argumentHint: fm.argumentHint,
        description: fm.description,
        params: parseArgumentHint(fm.argumentHint),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return defs;
}

/**
 * Discover command directories — checks both global and project-scoped locations.
 * Returns array of existing directories.
 */
export function discoverCommandDirs(projectDir?: string): string[] {
  const dirs: string[] = [];

  // Global commands
  const globalDir = join(homedir(), '.claude', 'commands');
  try { readdirSync(globalDir); dirs.push(globalDir); } catch { /* */ }

  // Project commands
  if (projectDir) {
    const projectCmdDir = join(projectDir, '.claude', 'commands');
    try { readdirSync(projectCmdDir); dirs.push(projectCmdDir); } catch { /* */ }
  }

  return dirs;
}

/**
 * Load all command definitions from all discoverable directories.
 * Project-scoped commands override global ones with the same name.
 */
export function loadAllCommandDefs(projectDir?: string): Map<string, CommandDef> {
  const merged = new Map<string, CommandDef>();
  const dirs = discoverCommandDirs(projectDir);

  for (const dir of dirs) {
    const defs = loadCommandDefs(dir);
    for (const [name, def] of defs) {
      merged.set(name, def); // Later dirs (project) override earlier (global)
    }
  }

  return merged;
}

/**
 * Get only the configurable (non-positional) parameters for a skill.
 * These are the params users typically want to set defaults for.
 */
export function getConfigurableParams(params: SkillParamDef[]): SkillParamDef[] {
  return params.filter(p => !p.positional);
}
