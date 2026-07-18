import { resolve, join } from 'node:path';

// ============================================================================
// Frontmatter parsing & formatting
// ============================================================================

export function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) {
    return { data: {}, body: raw };
  }
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { data: {}, body: raw };
  }
  const yamlBlock = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 4);
  const data: Record<string, any> = {};

  let currentKey = '';
  let arrayItems: string[] | null = null;

  for (const line of yamlBlock.split('\n')) {
    const trimLine = line.trim();
    if (trimLine.startsWith('- ') && arrayItems !== null) {
      arrayItems.push(trimLine.substring(2).trim());
      continue;
    }
    if (arrayItems !== null && currentKey) {
      data[currentKey] = arrayItems;
      arrayItems = null;
    }
    const colonIdx = trimLine.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimLine.substring(0, colonIdx).trim();
    const value = trimLine.substring(colonIdx + 1).trim();
    currentKey = key;
    if (value === '' || value === '[]') {
      arrayItems = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s) => s.length > 0);
    } else {
      let parsedValue: any = value.replace(/^["']|["']$/g, '');
      if (parsedValue.startsWith('[') || parsedValue.startsWith('{')) {
        try { parsedValue = JSON.parse(parsedValue); } catch { /* ignore */ }
      }
      data[key] = parsedValue;
    }
  }
  if (arrayItems !== null && currentKey) {
    data[currentKey] = arrayItems;
  }
  return { data, body };
}

export function stripFrontmatter(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return raw;
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) return raw;
  return trimmed.substring(endIdx + 4).trim();
}

export function escapeYamlValue(value: string): string {
  if (/[:\n"'#,{}[\]]/.test(value)) return JSON.stringify(value);
  return value;
}

// ============================================================================
// Slugify
// ============================================================================

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ============================================================================
// Knowhow shared constants
// ============================================================================

export const KNOWHOW_CATEGORIES = ['session', 'tip', 'template', 'recipe', 'reference', 'decision', 'asset', 'blueprint', 'document'] as const;
export type KnowHowCategory = (typeof KNOWHOW_CATEGORIES)[number];

export const KNOWHOW_PREFIX_MAP: Record<string, string> = {
  session: 'KNW', tip: 'TIP', template: 'TPL',
  recipe: 'RCP', reference: 'REF', decision: 'DCS',
  asset: 'AST', blueprint: 'BLP', document: 'DOC',
};

export function getKnowhowDir(projectRoot?: string): string {
  const root = projectRoot ?? resolve('.');
  return join(root, '.workflow', 'knowhow');
}

/**
 * Canonical wiki id for a knowhow file — exactly as WikiIndexer derives it:
 * `knowhow-` + slugified filename stem, type prefix included
 * (e.g. `TIP-20260427-my-slug.md` → `knowhow-tip-20260427-my-slug`).
 */
export function knowhowFileToWikiId(filename: string): string {
  const stem = filename.replace(/\.md$/i, '');
  return `knowhow-${slugify(stem)}`;
}

export function generateKnowhowFilename(type: KnowHowCategory, title?: string): { id: string; filename: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const prefix = KNOWHOW_PREFIX_MAP[type];
  const slug = title ? slugify(title).slice(0, 40) : '';
  const filename = slug
    ? `${prefix}-${ts}-${slug}.md`
    : `${prefix}-${ts}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
  return { id: knowhowFileToWikiId(filename), filename };
}
