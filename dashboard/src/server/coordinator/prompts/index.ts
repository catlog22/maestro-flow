// ---------------------------------------------------------------------------
// Prompt loader — manages built-in + user-customized prompt templates
//
// Directory structure:
//   Built-in (fallback):  <compiled>/coordinator/prompts/{name}.md
//   User override:        {workflowRoot}/coordinator/prompts/{name}.md
//
// Resolution: user override → built-in default
// Cache is per-process; restart dashboard to pick up changes.
// ---------------------------------------------------------------------------

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = new Map<string, string>();

let _userPromptsDir: string | null = null;

/** Configure the user-customizable prompts directory */
export function setPromptsDir(workflowRoot: string): void {
  _userPromptsDir = join(workflowRoot, 'coordinator', 'prompts');
}

/** Clear cached prompts (useful after user edits override files) */
export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Load a prompt template by name.
 * Checks {workflowRoot}/coordinator/prompts/{name}.md first,
 * then falls back to the built-in default.
 */
export async function loadPrompt(name: string): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;

  // Try user override
  if (_userPromptsDir) {
    try {
      const content = await readFile(join(_userPromptsDir, `${name}.md`), 'utf-8');
      cache.set(name, content);
      return content;
    } catch {
      // Not found — fall through to built-in
    }
  }

  // Built-in default
  const content = await readFile(join(__dirname, `${name}.md`), 'utf-8');
  cache.set(name, content);
  return content;
}

/**
 * List available prompt names from both user and built-in directories.
 * Returns deduplicated names (without .md extension).
 */
export async function listPrompts(): Promise<{ name: string; source: 'user' | 'builtin' }[]> {
  const results = new Map<string, 'user' | 'builtin'>();

  // User prompts first (higher priority)
  if (_userPromptsDir) {
    try {
      const files = await readdir(_userPromptsDir);
      for (const f of files) {
        if (f.endsWith('.md')) results.set(f.replace(/\.md$/, ''), 'user');
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Built-in prompts (only add if not already overridden)
  try {
    const files = await readdir(__dirname);
    for (const f of files) {
      if (f.endsWith('.md') && !results.has(f.replace(/\.md$/, ''))) {
        results.set(f.replace(/\.md$/, ''), 'builtin');
      }
    }
  } catch {
    // Should not happen
  }

  return Array.from(results.entries()).map(([name, source]) => ({ name, source }));
}
