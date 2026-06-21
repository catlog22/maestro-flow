import { resolve, join } from 'node:path';

// ============================================================================
// Frontmatter parsing & formatting
// ============================================================================

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w\s]*?):\s*(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
      }
      data[kv[1].trim()] = value;
    }
  }
  return { data, body: raw.slice(match[0].length) };
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

export function generateKnowhowFilename(type: KnowHowCategory, title?: string): { id: string; filename: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const prefix = KNOWHOW_PREFIX_MAP[type];
  const slug = title ? slugify(title).slice(0, 40) : '';
  const filename = slug
    ? `${prefix}-${ts}-${slug}.md`
    : `${prefix}-${ts}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
  const idSuffix = slug || `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return { id: `knowhow-${slugify(ts)}-${idSuffix}`, filename };
}
