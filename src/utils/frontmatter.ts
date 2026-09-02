import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import {
  KNOWHOW_TYPES,
  normalizeCanonicalKnowledgeContent,
  type CanonicalContentInput,
} from '../../shared/knowledge-content.js';

export {
  CANONICAL_KNOWLEDGE_CATEGORIES,
  DECISION_STATES,
  KNOWHOW_TYPES,
  LIFECYCLE_STATUSES,
  deriveContentSummary,
  isCanonicalKnowledgeCategory,
  normalizeCanonicalKnowledgeContent,
  normalizeRelatedPath,
} from '../../shared/knowledge-content.js';
export type {
  CanonicalContentInput,
  CanonicalKnowledgeCategory,
  CanonicalKnowledgeContent,
  CanonicalKnowhowType,
  DecisionState,
  KnowledgeLifecycleStatus,
} from '../../shared/knowledge-content.js';

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

export const KNOWHOW_CATEGORIES = KNOWHOW_TYPES;
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

const KNOWHOW_EXPLICIT_ID_RE = /^(knw|tip|tpl|rcp|ref|dcs|ast|blp|doc)-[0-9]{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface KnowhowFilename {
  id: string;
  filename: string;
  explicitId: string | null;
}

/**
 * Resolve a knowhow filename from either the legacy clock/title convention or
 * a caller-owned stable stem. Stable stems deliberately include the type
 * prefix and date so their public wiki id and on-disk path never depend on the
 * replay date.
 */
export function resolveKnowhowFilename(
  type: KnowHowCategory,
  title?: string,
  explicitId?: string | null,
): KnowhowFilename {
  if (explicitId !== undefined && explicitId !== null) {
    const stem = explicitId.trim().toLowerCase();
    if (!KNOWHOW_EXPLICIT_ID_RE.test(stem)) {
      throw new Error(
        'Invalid explicit knowhow id: expected <prefix>-YYYYMMDD-<kebab-case-slug>',
      );
    }
    const expectedPrefix = KNOWHOW_PREFIX_MAP[type].toLowerCase();
    const actualPrefix = stem.slice(0, 3);
    if (actualPrefix !== expectedPrefix) {
      throw new Error(
        `CALLER_PAYLOAD_CONFLICT: explicit knowhow id prefix "${actualPrefix}" `
        + `does not match type "${type}" (${expectedPrefix})`,
      );
    }
    const filename = `${KNOWHOW_PREFIX_MAP[type]}${stem.slice(3)}.md`;
    return { id: knowhowFileToWikiId(filename), filename, explicitId: stem };
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const prefix = KNOWHOW_PREFIX_MAP[type];
  const slug = title ? slugify(title).slice(0, 40) : '';
  const filename = slug
    ? `${prefix}-${ts}-${slug}.md`
    : `${prefix}-${ts}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
  return { id: knowhowFileToWikiId(filename), filename, explicitId: null };
}

export function generateKnowhowFilename(
  type: KnowHowCategory,
  title?: string,
  explicitId?: string | null,
): KnowhowFilename {
  return resolveKnowhowFilename(type, title, explicitId);
}

export interface KnowhowReplayPayloadInput extends CanonicalContentInput {
  [key: string]: unknown;
}

function normalizedStringSet(value: string[]): string[] | null {
  const normalized = [...new Set(value)].sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : null;
}

export function normalizeKnowhowBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return `${value.replace(/\r\n?/g, '\n').replace(/\n+$/g, '')}\n`;
}

/**
 * Canonical caller-owned equality payload for explicit-ID add replay.
 *
 * Server-owned timestamps, index enrichment and lifecycle fields are ignored
 * by construction: only the fixed keys below enter the canonical bytes.
 */
export function normalizeKnowhowReplayPayload(
  input: KnowhowReplayPayloadInput,
): { canonical: string; sha256: string } {
  const normalized = normalizeCanonicalKnowledgeContent(input);
  const payload = {
    type: normalized.type,
    title: normalized.title || null,
    content: normalizeKnowhowBody(normalized.content),
    keywords: normalizedStringSet(normalized.keywords),
    category: normalized.category,
    sourceRef: normalized.sourceRef,
    relatedPaths: normalizedStringSet(normalized.relatedPaths),
    appliesToRepoIds: normalizedStringSet(normalized.appliesToRepoIds),
    language: normalized.language,
    decisionState: normalized.decisionState,
    lifecycleStatus: normalized.lifecycleStatus,
    tool: normalized.tool,
    explicitId: normalized.explicitId,
  };
  const canonical = JSON.stringify(payload);
  const sha256 = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  return { canonical, sha256 };
}
